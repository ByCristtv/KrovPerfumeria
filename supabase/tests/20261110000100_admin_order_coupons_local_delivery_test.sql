-- ============================================================================
-- DB-LEVEL TEST SUITE -- Admin order coupons + free Cariari delivery
-- (migration 20261110000100_admin_order_coupons_local_delivery.sql)
-- ============================================================================
-- HOW TO RUN
--   Paste this whole file into the Supabase SQL Editor (TESTING project) and
--   run it AFTER applying the migration.
--
--   Everything happens inside BEGIN ... ROLLBACK: the test users, coupon
--   definitions, orders, stock movements and XP never survive the script,
--   whether it passes or fails.
--
--   PASS -> the final SELECT prints "ALL ADMIN ORDER COUPON TESTS PASSED".
--   FAIL -> the script aborts with `assertion failed` naming the test, and the
--           transaction rolls back.
--
-- WHAT IT NEEDS FROM THE DATABASE
--   One active, non-decant product variant with an effective price >= ₡1.000.
--   Its stock is topped up and reserved only inside the rolled-back
--   transaction.
--   Expectations are computed from that variant's price and from the LIVE
--   calculate_shipping_cost, so no shipping value is assumed.
--
-- HOW THE CALLER IS FAKED
--   auth.uid() reads request.jwt.claims; act_as() sets it. For the GRANT test
--   the Postgres role is switched too (SET LOCAL ROLE authenticated), like
--   PostgREST does. Nothing is stubbed.
--
-- WHAT IS COVERED
--   C1  only admins can create manual orders
--   C2  a coupon needs an explicitly linked account (nothing is created)
--   C3  a coupon cannot be combined with a manual discount
--   C4  percentage coupon: discount on the subtotal, total, coupon on hold
--   C5  fixed coupon
--   C6  another customer's coupon is refused — and NOTHING persists
--       (no order, no stock movement, the coupon is untouched)
--   C7  expired coupon refused
--   C8  coupon already on hold for another order refused
--   C9  below the coupon's minimum refused, nothing persists
--   C10 a spent coupon cannot be spent twice
--   C11 payment sync: paid stamps the coupon; a denied order hands it back
--   C12 XP on a coupon order = floor((subtotal - discount)/1000) * 50
--   L1  Cariari: shipping 0, zone price reported, total = subtotal - discount
--   L2  another district: the zone rate is charged
--   L3  pickup ignores the flag
--   L4  coupon + Cariari together
--   W1  the web checkout wrapper (apply_order_coupon) behaves as before
--   G1  redeem_user_coupon_for_order is not callable by API roles
-- ============================================================================

BEGIN;

-- ── helpers (temp functions: they vanish with the session) ──────────────────
CREATE OR REPLACE FUNCTION pg_temp.act_as(p_user UUID) RETURNS VOID
LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text,
    true
  );
END $f$;

CREATE OR REPLACE FUNCTION pg_temp.act_as_guest() RETURNS VOID
LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
END $f$;

CREATE OR REPLACE FUNCTION pg_temp.try(p_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $f$;

CREATE OR REPLACE FUNCTION pg_temp.make_user(p_id UUID, p_email TEXT) RETURNS VOID
LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    p_email, 'x', now(), '{"provider":"email","providers":["email"]}'::jsonb,
    json_build_object('full_name', p_email)::jsonb, now(), now()
  );
END $f$;

-- A coupon definition nobody else can receive (inactive) + one issued copy.
CREATE OR REPLACE FUNCTION pg_temp.give_coupon(
  p_user UUID, p_code TEXT, p_type TEXT, p_value NUMERIC, p_min NUMERIC,
  p_status TEXT DEFAULT 'claimed', p_expires TIMESTAMPTZ DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql AS $f$
DECLARE v_def UUID; v_uc UUID;
BEGIN
  SELECT id INTO v_def FROM public.coupons WHERE code = p_code;
  IF v_def IS NULL THEN
    INSERT INTO public.coupons
      (code, name, description, discount_type, discount_value, min_order_subtotal,
       level_required, is_active)
    VALUES (p_code, 'PG ' || p_code, NULL, p_type, p_value, p_min,
            (SELECT min(level_number) FROM public.levels), FALSE)
    RETURNING id INTO v_def;
  END IF;
  INSERT INTO public.user_coupons (user_id, coupon_id, status, expires_at, issue_source)
  VALUES (p_user, v_def, p_status, p_expires, 'retroactive')
  RETURNING id INTO v_uc;
  RETURN v_uc;
END $f$;

CREATE OR REPLACE FUNCTION pg_temp.payload(
  p_tag TEXT, p_variant UUID, p_qty INT,
  p_user UUID DEFAULT NULL, p_coupon UUID DEFAULT NULL,
  p_canton TEXT DEFAULT '702', p_canton_name TEXT DEFAULT 'Pococí',
  p_province TEXT DEFAULT 'Limón', p_district TEXT DEFAULT 'Guápiles',
  p_method TEXT DEFAULT 'delivery', p_discount NUMERIC DEFAULT NULL,
  p_free_local BOOLEAN DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql AS $f$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'customer', jsonb_build_object('name', 'PG Coupon ' || p_tag, 'phone', '00000000',
                                   'user_id', p_user),
    'shipping', jsonb_build_object('address', '100m sur del parque', 'canton_code', p_canton,
                                   'canton_name', p_canton_name, 'province_name', p_province,
                                   'district', p_district, 'free_local_delivery', p_free_local),
    'items', jsonb_build_array(jsonb_build_object('variant_id', p_variant, 'quantity', p_qty)),
    'shipping_method', p_method,
    'discount', p_discount,
    'user_coupon_id', p_coupon
  ))
$f$;

DO $$
DECLARE
  v_admin UUID := gen_random_uuid();
  v_ana   UUID := gen_random_uuid();
  v_beto  UUID := gen_random_uuid();

  v_variant  UUID;
  v_price    NUMERIC(12,2);
  v_stock0   INT;
  v_sub1     NUMERIC(12,2);   -- subtotal for 1 unit
  v_sub2     NUMERIC(12,2);   -- subtotal for 2 units
  v_zone1    NUMERIC(12,2);
  v_zone2    NUMERIC(12,2);

  uc_pct     UUID;  uc_fixed UUID;  uc_expired UUID;  uc_held UUID;
  uc_min     UUID;  uc_beto  UUID;  uc_deny    UUID;  uc_web   UUID;
  uc_local   UUID;

  v_res   JSONB;
  v_err   TEXT;
  v_order UUID;
  v_web   UUID;
  v_disc  NUMERIC(12,2);
  v_n     INT;
  v_row   RECORD;
BEGIN
  -- ══ ARRANGE ═══════════════════════════════════════════════════════════════
  PERFORM pg_temp.make_user(v_admin, 'pgcoupon-admin@krov.test');
  PERFORM pg_temp.make_user(v_ana,   'pgcoupon-ana@krov.test');
  PERFORM pg_temp.make_user(v_beto,  'pgcoupon-beto@krov.test');
  UPDATE public.profiles SET role = 'admin' WHERE id = v_admin;

  SELECT pv.id,
         CASE WHEN pv.is_on_offer AND pv.offer_price IS NOT NULL THEN pv.offer_price ELSE pv.price END
    INTO v_variant, v_price
    FROM public.product_variants pv
   WHERE pv.is_active
     AND pv.product_type <> 'decant'
     AND CASE WHEN pv.is_on_offer AND pv.offer_price IS NOT NULL THEN pv.offer_price ELSE pv.price END >= 1000
   ORDER BY pv.stock DESC
   LIMIT 1;
  ASSERT v_variant IS NOT NULL,
    'precondition: one active non-decant variant with an effective price >= 1000';

  -- The suite places ~8 units; top the variant up (rolled back with everything).
  UPDATE public.product_variants SET stock = stock + 20 WHERE id = v_variant;
  SELECT stock INTO v_stock0 FROM public.product_variants WHERE id = v_variant;

  v_sub1  := v_price;
  v_sub2  := v_price * 2;
  v_zone1 := (public.calculate_shipping_cost('702', v_sub1)->>'cost')::NUMERIC(12,2);
  v_zone2 := (public.calculate_shipping_cost('702', v_sub2)->>'cost')::NUMERIC(12,2);
  IF v_zone1 = 0 THEN
    RAISE NOTICE 'Pococí already ships free at %: L1/L2 still run but cannot tell the waiver from the zone.', v_sub1;
  END IF;

  uc_pct     := pg_temp.give_coupon(v_ana,  'PGTEST-PCT10',  'percentage', 10,   0);
  uc_fixed   := pg_temp.give_coupon(v_ana,  'PGTEST-FIX3K',  'fixed',      3000, 0, 'unlocked');
  uc_expired := pg_temp.give_coupon(v_ana,  'PGTEST-EXP',    'percentage', 5,    0, 'claimed', now() - interval '1 day');
  uc_held    := pg_temp.give_coupon(v_ana,  'PGTEST-HELD',   'percentage', 5,    0, 'used');
  uc_min     := pg_temp.give_coupon(v_ana,  'PGTEST-MIN',    'percentage', 5,    9999999);
  uc_deny    := pg_temp.give_coupon(v_ana,  'PGTEST-DENY',   'percentage', 7,    0);
  uc_web     := pg_temp.give_coupon(v_ana,  'PGTEST-WEB',    'percentage', 10,   0);
  uc_local   := pg_temp.give_coupon(v_ana,  'PGTEST-LOCAL',  'percentage', 10,   0);
  uc_beto    := pg_temp.give_coupon(v_beto, 'PGTEST-PCT10',  'percentage', 10,   0);

  -- ══ C1. Only admins ═══════════════════════════════════════════════════════
  PERFORM pg_temp.act_as(v_ana);
  v_err := pg_temp.try(format('SELECT public.place_admin_order(%L::jsonb)',
                              pg_temp.payload('c1', v_variant, 1)));
  ASSERT v_err LIKE 'Insufficient privilege%', format('C1: customer must be refused, got %s', v_err);

  PERFORM pg_temp.act_as(v_admin);

  -- ══ C2. Coupon without an explicit account ═══════════════════════════════
  v_err := pg_temp.try(format('SELECT public.place_admin_order(%L::jsonb)',
                              pg_temp.payload('c2', v_variant, 1, NULL, uc_pct)));
  ASSERT v_err = 'coupon_customer_required', format('C2a: got %s', v_err);
  ASSERT NOT EXISTS (SELECT 1 FROM public.orders WHERE customer_name = 'PG Coupon c2'), 'C2b: no order';

  -- ══ C3. Coupon + manual discount ═════════════════════════════════════════
  v_err := pg_temp.try(format('SELECT public.place_admin_order(%L::jsonb)',
                              pg_temp.payload('c3', v_variant, 1, v_ana, uc_pct, p_discount => 500)));
  ASSERT v_err = 'coupon_manual_discount_conflict', format('C3: got %s', v_err);

  -- ══ C4. Percentage coupon ════════════════════════════════════════════════
  v_res   := public.place_admin_order(pg_temp.payload('c4', v_variant, 2, v_ana, uc_pct));
  v_order := (v_res->>'order_id')::UUID;
  v_disc  := ROUND(v_sub2 * 10 / 100);
  ASSERT (v_res->>'discount')::NUMERIC = v_disc, format('C4a: discount, got %s', v_res);
  ASSERT (v_res->>'shipping_cost')::NUMERIC = v_zone2, format('C4b: zone shipping, got %s', v_res);
  ASSERT (v_res->>'total')::NUMERIC = v_sub2 + v_zone2 - v_disc, format('C4c: total, got %s', v_res);
  ASSERT (v_res->>'user_coupon_id')::UUID = uc_pct, 'C4d: result names the coupon';
  ASSERT v_res->>'coupon_code' = 'PGTEST-PCT10', 'C4e: coupon code';
  SELECT * INTO v_row FROM public.orders WHERE id = v_order;
  ASSERT v_row.user_id = v_ana AND v_row.user_coupon_id = uc_pct
     AND v_row.discount = v_disc AND v_row.total = v_sub2 + v_zone2 - v_disc
     AND v_row.subtotal = v_sub2 AND v_row.payment_status = 'pending', 'C4f: stored order';
  SELECT * INTO v_row FROM public.user_coupons WHERE id = uc_pct;
  ASSERT v_row.status = 'used' AND v_row.used_order_id = v_order
     AND v_row.payment_confirmed_at IS NULL, 'C4g: coupon on hold for this order';
  ASSERT (SELECT stock FROM public.product_variants WHERE id = v_variant) = v_stock0 - 2,
    'C4h: stock reserved';

  -- ══ C5. Fixed coupon (unlocked, never claimed) ═══════════════════════════
  v_res := public.place_admin_order(pg_temp.payload('c5', v_variant, 1, v_ana, uc_fixed));
  ASSERT (v_res->>'discount')::NUMERIC = LEAST(3000, v_sub1), format('C5a: got %s', v_res);
  ASSERT (v_res->>'total')::NUMERIC = v_sub1 + v_zone1 - LEAST(3000, v_sub1), 'C5b: total';
  ASSERT (SELECT status FROM public.user_coupons WHERE id = uc_fixed) = 'used', 'C5c: spent';

  -- ══ C6. Another customer's coupon — nothing persists ═════════════════════
  v_n := (SELECT stock FROM public.product_variants WHERE id = v_variant);
  v_err := pg_temp.try(format('SELECT public.place_admin_order(%L::jsonb)',
                              pg_temp.payload('c6', v_variant, 1, v_ana, uc_beto)));
  ASSERT v_err = 'coupon_not_found', format('C6a: got %s', v_err);
  ASSERT NOT EXISTS (SELECT 1 FROM public.orders WHERE customer_name = 'PG Coupon c6'), 'C6b: no order';
  ASSERT (SELECT stock FROM public.product_variants WHERE id = v_variant) = v_n, 'C6c: stock untouched';
  ASSERT (SELECT status FROM public.user_coupons WHERE id = uc_beto) = 'claimed', 'C6d: coupon untouched';

  -- ══ C7. Expired ══════════════════════════════════════════════════════════
  v_err := pg_temp.try(format('SELECT public.place_admin_order(%L::jsonb)',
                              pg_temp.payload('c7', v_variant, 1, v_ana, uc_expired)));
  ASSERT v_err = 'coupon_expired', format('C7: got %s', v_err);

  -- ══ C8. On hold elsewhere ════════════════════════════════════════════════
  v_err := pg_temp.try(format('SELECT public.place_admin_order(%L::jsonb)',
                              pg_temp.payload('c8', v_variant, 1, v_ana, uc_held)));
  ASSERT v_err = 'coupon_not_available', format('C8: got %s', v_err);

  -- ══ C9. Below the minimum — nothing persists ═════════════════════════════
  v_err := pg_temp.try(format('SELECT public.place_admin_order(%L::jsonb)',
                              pg_temp.payload('c9', v_variant, 1, v_ana, uc_min)));
  ASSERT v_err = 'coupon_min_subtotal:9999999', format('C9a: got %s', v_err);
  ASSERT (SELECT stock FROM public.product_variants WHERE id = v_variant) = v_n, 'C9b: stock untouched';
  ASSERT (SELECT status FROM public.user_coupons WHERE id = uc_min) = 'claimed', 'C9c: coupon untouched';

  -- ══ C10. Spent once, never twice ═════════════════════════════════════════
  v_err := pg_temp.try(format('SELECT public.place_admin_order(%L::jsonb)',
                              pg_temp.payload('c10', v_variant, 1, v_ana, uc_pct)));
  ASSERT v_err = 'coupon_not_available', format('C10a: got %s', v_err);
  ASSERT (SELECT count(*) FROM public.orders WHERE user_coupon_id = uc_pct) = 1, 'C10b: one order holds it';

  -- ══ C11. Payment sync ════════════════════════════════════════════════════
  UPDATE public.orders SET payment_status = 'paid' WHERE id = v_order;
  ASSERT (SELECT payment_confirmed_at IS NOT NULL FROM public.user_coupons WHERE id = uc_pct),
    'C11a: paid order confirms the spend';

  v_res := public.place_admin_order(pg_temp.payload('c11', v_variant, 1, v_ana, uc_deny));
  UPDATE public.orders SET order_status = 'denied' WHERE id = (v_res->>'order_id')::UUID;
  SELECT * INTO v_row FROM public.user_coupons WHERE id = uc_deny;
  ASSERT v_row.status = 'claimed' AND v_row.used_order_id IS NULL, 'C11b: denied order returns the coupon';
  ASSERT (SELECT user_coupon_id FROM public.orders WHERE id = (v_res->>'order_id')::UUID) IS NULL,
    'C11c: and frees the order slot';

  -- ══ C12. XP uses the discounted subtotal ═════════════════════════════════
  UPDATE public.orders SET order_status = 'received' WHERE id = v_order;
  ASSERT (SELECT xp_earned FROM public.profile_experience_events WHERE order_id = v_order)
         = (FLOOR((v_sub2 - v_disc) / 1000))::INT * 50, 'C12: XP on subtotal - coupon';

  -- ══ L1. Cariari ships free ═══════════════════════════════════════════════
  v_res := public.place_admin_order(pg_temp.payload('l1', v_variant, 1, p_district => 'Cariari',
                                                    p_free_local => TRUE));
  ASSERT (v_res->>'shipping_cost')::NUMERIC = 0, format('L1a: got %s', v_res);
  ASSERT (v_res->>'local_delivery')::BOOLEAN, 'L1b: flagged';
  ASSERT (v_res->'shipping'->>'zone_cost')::NUMERIC = v_zone1, 'L1c: zone price reported';
  ASSERT (v_res->>'total')::NUMERIC = v_sub1, 'L1d: total = subtotal';
  ASSERT (SELECT shipping_cost = 0 AND total = v_sub1 FROM public.orders
           WHERE id = (v_res->>'order_id')::UUID), 'L1e: persisted';

  -- ══ L2. Another district pays the zone ═══════════════════════════════════
  v_res := public.place_admin_order(pg_temp.payload('l2', v_variant, 1, p_district => 'Guápiles',
                                                    p_free_local => FALSE));
  ASSERT (v_res->>'shipping_cost')::NUMERIC = v_zone1, format('L2a: got %s', v_res);
  ASSERT NOT (v_res->>'local_delivery')::BOOLEAN, 'L2b: not flagged';

  -- ══ L3. Pickup ignores the flag ══════════════════════════════════════════
  v_res := public.place_admin_order(pg_temp.payload('l3', v_variant, 1, p_method => 'pickup',
                                                    p_free_local => TRUE));
  ASSERT (v_res->>'shipping_cost')::NUMERIC = 0 AND NOT (v_res->>'local_delivery')::BOOLEAN,
    format('L3: got %s', v_res);

  -- ══ L4. Coupon + Cariari ═════════════════════════════════════════════════
  v_res := public.place_admin_order(pg_temp.payload('l4', v_variant, 1, v_ana, uc_local,
                                                    p_district => 'Cariari', p_free_local => TRUE));
  ASSERT (v_res->>'shipping_cost')::NUMERIC = 0, 'L4a: free shipping';
  ASSERT (v_res->>'total')::NUMERIC = v_sub1 - ROUND(v_sub1 * 10 / 100), format('L4b: got %s', v_res);

  -- ══ W1. Web checkout wrapper ═════════════════════════════════════════════
  INSERT INTO public.orders (
    user_id, customer_name, customer_email, customer_phone,
    shipping_address, shipping_district, shipping_canton, shipping_province,
    shipping_cost, subtotal, total, source, order_status, payment_status
  ) VALUES (
    v_ana, 'PG Coupon web', 'pgcoupon-ana@krov.test', '00000000',
    '100m sur', 'Carmen', 'San José', 'San José',
    1000, 20000, 21000, 'web', 'pending', 'pending'
  ) RETURNING id INTO v_web;

  PERFORM pg_temp.act_as_guest();
  v_err := pg_temp.try(format('SELECT public.apply_order_coupon(%L, %L)', v_web, uc_web));
  ASSERT v_err = 'coupon_login_required', format('W1a: guest, got %s', v_err);

  PERFORM pg_temp.act_as(v_beto);
  v_err := pg_temp.try(format('SELECT public.apply_order_coupon(%L, %L)', v_web, uc_web));
  ASSERT v_err = 'coupon_order_invalid', format('W1b: not your order, got %s', v_err);

  PERFORM pg_temp.act_as(v_ana);
  v_res := public.apply_order_coupon(v_web, uc_web);
  ASSERT (v_res->>'discount_amount')::NUMERIC = 2000, format('W1c: got %s', v_res);
  ASSERT (v_res->>'total')::NUMERIC = 19000, 'W1d: delta on the stored total';
  ASSERT (SELECT status FROM public.user_coupons WHERE id = uc_web) = 'used', 'W1e: spent';

  -- ══ G1. The internal core is not an API ══════════════════════════════════
  PERFORM pg_temp.act_as(v_admin);
  SET LOCAL ROLE authenticated;
  v_err := NULL;
  BEGIN
    PERFORM public.redeem_user_coupon_for_order(v_web, uc_beto, v_beto);
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  ASSERT v_err = '42501', format('G1a: authenticated must get permission denied, got %s', v_err);
  RESET ROLE;

  SET LOCAL ROLE anon;
  v_err := NULL;
  BEGIN
    PERFORM public.redeem_user_coupon_for_order(v_web, uc_beto, v_beto);
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  ASSERT v_err = '42501', format('G1b: anon must get permission denied, got %s', v_err);
  RESET ROLE;
END $$;

SELECT 'ALL ADMIN ORDER COUPON TESTS PASSED' AS result;

ROLLBACK;
