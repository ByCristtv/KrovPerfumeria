-- ============================================================================
-- DB-LEVEL TEST SUITE -- Level coupons (migration 20261005000100)
-- ============================================================================
-- HOW TO RUN
--   Paste this whole file into the Supabase SQL Editor and run it, AFTER
--   applying 20261005000100_level_coupons.sql.
--
--   Everything happens inside BEGIN ... ROLLBACK, so the database is left
--   unchanged whether the suite passes or fails. The test users and orders
--   never survive the script -- safe to run against the live project.
--
--   PASS  -> the final SELECT prints "ALL LEVEL-COUPON TESTS PASSED".
--   FAIL  -> the script aborts with `assertion failed` naming the test, and the
--            transaction rolls back.
--
-- HOW auth.uid() IS FAKED
--   apply_order_coupon / claim_user_coupon identify the caller with auth.uid(),
--   which reads the request.jwt.claims setting. `act_as()` below sets it for the
--   rest of the transaction, so the real functions run exactly as they do for a
--   customer -- nothing is stubbed.
--
-- WHAT IS COVERED
--    1  XP crossing a level unlocks that level's coupon (and only those)
--    2  unlocking is idempotent -- no duplicate coupons
--    3  a jump across several levels unlocks every coupon in between
--    4  claim: unlocked -> claimed, idempotent, other users cannot claim yours
--    5  apply: discount comes from the ORDER's subtotal, total is rewritten,
--       the coupon is spent and linked to the order
--    6  one coupon cannot be spent on a second order                (race guard)
--    7  one order cannot take a second coupon
--    8  below the minimum subtotal is rejected, with the minimum in the error
--    9  another customer's order / coupon is rejected
--   10  expired coupons are rejected
--   11  wholesale orders are rejected
--   12  paid -> payment_confirmed_at is stamped
--   13  denied / failed -> the coupon goes back to `claimed`, order unlinked
--   14  a released coupon can be spent on a NEW order
--   15  XP is earned on the DISCOUNTED SUBTOTAL, excluding shipping
--   16  XP without a coupon excludes shipping too
--   17  guests / missing arguments are rejected
--
-- IF THE auth.users INSERT IS REJECTED
--   See the note in 20260905000100_guest_order_xp_claim_test.sql -- same seed.
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

CREATE OR REPLACE FUNCTION pg_temp.make_order(
  p_user UUID, p_subtotal NUMERIC, p_shipping NUMERIC, p_wholesale BOOLEAN DEFAULT FALSE
) RETURNS UUID LANGUAGE plpgsql AS $f$
DECLARE v_id UUID;
BEGIN
  INSERT INTO public.orders (
    user_id, customer_name, customer_email, customer_phone,
    shipping_address, shipping_district, shipping_canton, shipping_province,
    shipping_cost, subtotal, total, source, order_status, payment_status,
    is_wholesale_order
  ) VALUES (
    p_user, 'PG Coupon', 'pgcoupon@krov.test', '00000000',
    '100m sur', 'Carmen', 'San Jose', 'San Jose',
    p_shipping, p_subtotal, p_subtotal + p_shipping, 'web', 'pending', 'pending',
    p_wholesale
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

DO $$
DECLARE
  v_user   UUID := gen_random_uuid();
  v_other  UUID := gen_random_uuid();

  v_o1 UUID; v_o2 UUID; v_o3 UUID; v_o_small UUID; v_o_wholesale UUID;
  v_o_other UUID; v_o_xp2 UUID;

  v_uc_maestro  UUID;
  v_uc_colecc   UUID;
  v_uc_conocedor UUID;

  v_res    JSONB;
  v_err    TEXT;
  v_n      INTEGER;
  v_row    RECORD;
BEGIN
  -- ══ ARRANGE: two registered customers ═════════════════════════════════════
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_user,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'pgcoupon-a@krov.test', 'x', now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"PG Coupon A"}'::jsonb, now(), now()),
    (v_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'pgcoupon-b@krov.test', 'x', now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"PG Coupon B"}'::jsonb, now(), now());

  ASSERT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user),
    'precondition: the signup trigger must have created the profile';

  -- ══ 1. Unlocking by XP ════════════════════════════════════════════════════
  SELECT count(*) INTO v_n FROM public.user_coupons WHERE user_id = v_user;
  ASSERT v_n = 0, format('test 1a: a brand-new customer has no coupons, got %s', v_n);

  UPDATE public.profiles SET experience_points = 1000 WHERE id = v_user;
  SELECT count(*) INTO v_n FROM public.user_coupons WHERE user_id = v_user;
  ASSERT v_n = 1, format('test 1b: reaching Coleccionista unlocks 1 coupon, got %s', v_n);

  SELECT uc.id, uc.status, c.code INTO v_row
    FROM public.user_coupons uc JOIN public.coupons c ON c.id = uc.coupon_id
   WHERE uc.user_id = v_user;
  ASSERT v_row.code = 'COLECCIONISTA-5' AND v_row.status = 'unlocked',
    format('test 1c: expected COLECCIONISTA-5 unlocked, got %s %s', v_row.code, v_row.status);
  v_uc_colecc := v_row.id;

  -- 2. Idempotent: more XP inside the same level adds nothing.
  UPDATE public.profiles SET experience_points = 4000 WHERE id = v_user;
  SELECT count(*) INTO v_n FROM public.user_coupons WHERE user_id = v_user;
  ASSERT v_n = 1, format('test 2: same level again must not duplicate, got %s', v_n);

  -- 3. Jump from level 2 straight to level 5: every coupon in between.
  UPDATE public.profiles SET experience_points = 18000 WHERE id = v_user;
  SELECT count(*) INTO v_n FROM public.user_coupons WHERE user_id = v_user;
  ASSERT v_n = 4, format('test 3a: Maestro holds 4 coupons (levels 2-5), got %s', v_n);

  SELECT id INTO v_uc_maestro FROM public.user_coupons
   WHERE user_id = v_user AND coupon_id = (SELECT id FROM public.coupons WHERE code = 'MAESTRO-18');
  SELECT id INTO v_uc_conocedor FROM public.user_coupons
   WHERE user_id = v_user AND coupon_id = (SELECT id FROM public.coupons WHERE code = 'CONOCEDOR-8');
  ASSERT v_uc_maestro IS NOT NULL, 'test 3b: MAESTRO-18 must be unlocked';

  -- ══ 4. Claiming ═══════════════════════════════════════════════════════════
  PERFORM pg_temp.act_as(v_user);

  v_res := public.claim_user_coupon(v_uc_maestro);
  ASSERT (v_res->>'claimed')::boolean = true AND v_res->>'status' = 'claimed',
    'test 4a: claim must move unlocked -> claimed';
  ASSERT (SELECT status FROM public.user_coupons WHERE id = v_uc_maestro) = 'claimed',
    'test 4b: the row must now be claimed';

  v_res := public.claim_user_coupon(v_uc_maestro);
  ASSERT (v_res->>'claimed')::boolean = false AND v_res->>'status' = 'claimed',
    'test 4c: claiming again must succeed without changing anything';

  PERFORM pg_temp.act_as(v_other);
  v_err := NULL;
  BEGIN
    PERFORM public.claim_user_coupon(v_uc_conocedor);
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  ASSERT v_err = 'coupon_not_found',
    format('test 4d: another user must not be able to claim it, got %s', v_err);

  -- ══ 5. Applying: server-side discount ═════════════════════════════════════
  PERFORM pg_temp.act_as(v_user);
  v_o1 := pg_temp.make_order(v_user, 100000, 3500);

  v_res := public.apply_order_coupon(v_o1, v_uc_maestro);
  ASSERT (v_res->>'discount_amount')::numeric = 18000,
    format('test 5a: 18%% of 100,000 is 18,000, got %s', v_res->>'discount_amount');
  ASSERT (v_res->>'total')::numeric = 85500,
    format('test 5b: 100,000 - 18,000 + 3,500 = 85,500, got %s', v_res->>'total');

  SELECT discount, total, user_coupon_id INTO v_row FROM public.orders WHERE id = v_o1;
  ASSERT v_row.discount = 18000 AND v_row.total = 85500 AND v_row.user_coupon_id = v_uc_maestro,
    'test 5c: the order row must carry the discount, total and coupon link';

  SELECT status, used_order_id INTO v_row FROM public.user_coupons WHERE id = v_uc_maestro;
  ASSERT v_row.status = 'used' AND v_row.used_order_id = v_o1,
    'test 5d: the coupon must be spent and point at the order';

  -- 6. The same coupon cannot be spent on a second order.
  v_o2 := pg_temp.make_order(v_user, 100000, 3500);
  v_err := NULL;
  BEGIN
    PERFORM public.apply_order_coupon(v_o2, v_uc_maestro);
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  ASSERT v_err = 'coupon_not_available',
    format('test 6: a spent coupon must be refused, got %s', v_err);
  ASSERT (SELECT user_coupon_id FROM public.orders WHERE id = v_o2) IS NULL
     AND (SELECT discount FROM public.orders WHERE id = v_o2) = 0,
    'test 6b: the refused order must be left untouched';

  -- 7. One order cannot take a second coupon.
  v_err := NULL;
  BEGIN
    PERFORM public.apply_order_coupon(v_o1, v_uc_conocedor);
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  ASSERT v_err = 'coupon_order_invalid',
    format('test 7: a second coupon on one order must be refused, got %s', v_err);
  ASSERT (SELECT status FROM public.user_coupons WHERE id = v_uc_conocedor) = 'unlocked',
    'test 7b: the refused coupon must stay unspent';

  -- ══ 8. Minimum subtotal ═══════════════════════════════════════════════════
  v_o_small := pg_temp.make_order(v_user, 15000, 3500);
  v_err := NULL;
  BEGIN
    PERFORM public.apply_order_coupon(v_o_small, v_uc_conocedor);
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  ASSERT v_err = 'coupon_min_subtotal:20000',
    format('test 8a: expected coupon_min_subtotal:20000, got %s', v_err);
  ASSERT (SELECT status FROM public.user_coupons WHERE id = v_uc_conocedor) = 'unlocked',
    'test 8b: a rejected coupon must not be spent';

  -- ══ 9. Ownership ══════════════════════════════════════════════════════════
  PERFORM pg_temp.act_as(v_other);
  -- Created BEFORE the guarded block: an exception rolls its sub-transaction
  -- back, which would silently delete the order and make 9b pass for the wrong
  -- reason ("order not found").
  v_o_other := pg_temp.make_order(v_other, 100000, 0);
  v_err := NULL;
  BEGIN   -- someone else's coupon on my own order
    PERFORM public.apply_order_coupon(v_o_other, v_uc_conocedor);
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  ASSERT v_err = 'coupon_not_found',
    format('test 9a: a coupon you do not own looks like it does not exist, got %s', v_err);

  PERFORM pg_temp.act_as(v_user);
  v_err := NULL;
  BEGIN   -- my coupon on someone else's order
    PERFORM public.apply_order_coupon(v_o_other, v_uc_conocedor);
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  ASSERT v_err = 'coupon_order_invalid',
    format('test 9b: an order you do not own must be refused, got %s', v_err);

  -- ══ 10. Expiry ════════════════════════════════════════════════════════════
  UPDATE public.user_coupons SET expires_at = now() - interval '1 day' WHERE id = v_uc_conocedor;
  v_o3 := pg_temp.make_order(v_user, 100000, 0);
  v_err := NULL;
  BEGIN
    PERFORM public.apply_order_coupon(v_o3, v_uc_conocedor);
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  ASSERT v_err = 'coupon_expired',
    format('test 10a: an expired coupon must be refused, got %s', v_err);
  UPDATE public.user_coupons SET expires_at = NULL WHERE id = v_uc_conocedor;

  -- ══ 11. Wholesale ═════════════════════════════════════════════════════════
  v_o_wholesale := pg_temp.make_order(v_user, 100000, 0, TRUE);
  v_err := NULL;
  BEGIN
    PERFORM public.apply_order_coupon(v_o_wholesale, v_uc_conocedor);
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  ASSERT v_err = 'coupon_not_applicable',
    format('test 11: wholesale orders take no coupon, got %s', v_err);

  -- ══ 12. Payment confirmed ═════════════════════════════════════════════════
  ASSERT (SELECT payment_confirmed_at FROM public.user_coupons WHERE id = v_uc_maestro) IS NULL,
    'test 12a: before payment the coupon is only on hold';
  UPDATE public.orders SET payment_status = 'paid', paid_at = now() WHERE id = v_o1;
  ASSERT (SELECT payment_confirmed_at FROM public.user_coupons WHERE id = v_uc_maestro) IS NOT NULL,
    'test 12b: paying the order must make the spend permanent';

  -- ══ 13. Release on failure ════════════════════════════════════════════════
  -- Use a second coupon on its own order so test 12's paid order stays intact.
  v_o3 := pg_temp.make_order(v_user, 60000, 3500);
  v_res := public.apply_order_coupon(v_o3, v_uc_conocedor);
  ASSERT (v_res->>'discount_amount')::numeric = 4800,
    format('test 13a: 8%% of 60,000 is 4,800, got %s', v_res->>'discount_amount');
  ASSERT (SELECT status FROM public.user_coupons WHERE id = v_uc_conocedor) = 'used',
    'test 13b: precondition: the coupon is spent while the order is pending';

  -- exactly what cancelOrder() / the sweep / the webhook do:
  UPDATE public.orders SET order_status = 'denied', payment_status = 'failed' WHERE id = v_o3;

  SELECT status, used_at, used_order_id, payment_confirmed_at INTO v_row
    FROM public.user_coupons WHERE id = v_uc_conocedor;
  ASSERT v_row.status = 'claimed' AND v_row.used_order_id IS NULL AND v_row.used_at IS NULL,
    format('test 13c: a failed order must hand the coupon back as claimed, got %s', v_row.status);
  ASSERT (SELECT user_coupon_id FROM public.orders WHERE id = v_o3) IS NULL,
    'test 13d: the failed order must let go of the coupon (UNIQUE slot freed)';

  -- ══ 14. Released coupon is reusable ═══════════════════════════════════════
  v_o2 := pg_temp.make_order(v_user, 60000, 3500);
  v_res := public.apply_order_coupon(v_o2, v_uc_conocedor);
  ASSERT (v_res->>'discount_amount')::numeric = 4800,
    'test 14: a released coupon must be spendable on a new order';

  -- The paid order's coupon is untouched by the release above.
  ASSERT (SELECT status FROM public.user_coupons WHERE id = v_uc_maestro) = 'used',
    'test 14b: the paid order''s coupon must stay spent';

  -- ══ 15 / 16. XP on the discounted subtotal ════════════════════════════════
  -- o1: subtotal 100,000, discount 18,000, shipping 3,500 -> base 82,000 -> 4,100 XP
  SELECT experience_points INTO v_n FROM public.profiles WHERE id = v_user;
  UPDATE public.orders SET order_status = 'received' WHERE id = v_o1;
  ASSERT (SELECT xp_earned FROM public.profile_experience_events WHERE order_id = v_o1) = 4100,
    format('test 15a: XP base is subtotal - discount = 82,000 -> 4,100 XP, got %s',
           (SELECT xp_earned FROM public.profile_experience_events WHERE order_id = v_o1));
  ASSERT (SELECT experience_points FROM public.profiles WHERE id = v_user) = v_n + 4100,
    'test 15b: the balance must grow by exactly that';

  -- No coupon: subtotal 40,000 + shipping 3,500 -> base 40,000 -> 2,000 XP (NOT 2,150)
  v_o_xp2 := pg_temp.make_order(v_user, 40000, 3500);
  UPDATE public.orders SET order_status = 'received' WHERE id = v_o_xp2;
  ASSERT (SELECT xp_earned FROM public.profile_experience_events WHERE order_id = v_o_xp2) = 2000,
    format('test 16: shipping must not earn XP, expected 2,000 got %s',
           (SELECT xp_earned FROM public.profile_experience_events WHERE order_id = v_o_xp2));

  -- ══ 17. Guests and bad input ══════════════════════════════════════════════
  PERFORM pg_temp.act_as_guest();
  v_err := NULL;
  BEGIN
    PERFORM public.apply_order_coupon(v_o2, v_uc_conocedor);
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  ASSERT v_err = 'coupon_login_required',
    format('test 17a: guests must be refused, got %s', v_err);

  PERFORM pg_temp.act_as(v_user);
  v_err := NULL;
  BEGIN
    PERFORM public.apply_order_coupon(NULL, v_uc_conocedor);
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  ASSERT v_err = 'coupon_invalid_request',
    format('test 17b: missing arguments must be refused, got %s', v_err);

  RAISE NOTICE 'ALL LEVEL-COUPON TESTS PASSED';
END $$;

SELECT 'ALL LEVEL-COUPON TESTS PASSED' AS result;

-- Nothing above is kept. Change to COMMIT only if you deliberately want the
-- fixtures to persist (you almost certainly do not).
ROLLBACK;
