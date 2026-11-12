-- ============================================================================
-- 20261110000100_admin_order_coupons_local_delivery.sql
-- Manual (admin) orders: spend the customer's level coupon, and ship Cariari
-- for free — both inside the same transaction that creates the order.
-- ============================================================================
-- WHY
--   The admin order form (app/admin/orders/new) could link an order to a
--   registered customer but could not use the coupons that customer had
--   earned, and every Cariari (Limón › Pococí › Cariari) order needed its
--   shipping fixed by hand.
--
-- WHAT THIS MIGRATION DOES
--   1. redeem_user_coupon_for_order(order, user_coupon, owner)  NEW, internal.
--      The body of apply_order_coupon (20261109000100 §5) with the caller's
--      identity turned into a parameter. ONE implementation of the coupon
--      rules — ownership, status, expiry, minimum, wholesale exclusion,
--      rounding, cap, the atomic spend, the order rewrite — for both callers.
--      EXECUTE: service_role only. It trusts `p_owner_id`, so it must never be
--      reachable from PostgREST as anon/authenticated.
--
--   2. apply_order_coupon(order, user_coupon)  REPLACED, behaviour unchanged.
--      Now a one-line wrapper: redeem_user_coupon_for_order(..., auth.uid()).
--      Same signature, same grants, same error contract as before.
--
--   3. place_admin_order(payload)  REPLACED. Identical to 20261004000100 except
--      the lines marked -- NEW:
--        * "user_coupon_id" (optional, top level): the coupon is redeemed via
--          redeem_user_coupon_for_order AFTER the order, its items, stock and
--          totals exist, in the SAME transaction. Any coupon error aborts the
--          whole call: no order, no stock movement, coupon untouched. The coupon
--          must belong to the account the order is explicitly linked to
--          (customer.user_id), and cannot be combined with a manual discount.
--        * "shipping.free_local_delivery" (optional boolean): the shipping cost
--          becomes 0. The Next server sets it — never the browser — after
--          checking the validated address with lib/shipping/localDelivery.ts
--          (cantón code 702 + the dataset's Cariari district), the same rule the
--          web checkout uses. Geography stays in ONE place (TypeScript); this
--          RPC is admin-only and already lets an admin waive shipping (pickup)
--          or discount freely, so the flag grants no new authority.
--        * The result also reports user_coupon_id / coupon_code / coupon_name /
--          local_delivery.
--
-- COUPON LIFECYCLE ON ADMIN ORDERS (unchanged machinery, reused)
--   used + payment_confirmed_at NULL  = hold, set when the order is created
--   payment_status -> paid            = trg_orders_sync_coupon stamps it
--   order denied / payment failed     = trg_orders_sync_coupon hands it back
--
-- XP: unchanged. grant_order_xp already uses (subtotal - discount), so a coupon
-- on an admin order lowers its XP exactly as it does on a web order.
--
-- Depends on: 20261004000100 (place_admin_order with customer.user_id),
--             20261005000100 + 20261109000100 (user_coupons + snapshot terms,
--             apply_order_coupon), calculate_shipping_cost, is_admin().
-- Idempotent: safe to re-run. Runs as one transaction.
-- ⚠ Re-running 20261109000100 AFTER this file restores the self-contained
--   apply_order_coupon body. That is harmless (same behaviour) — re-run this
--   file afterwards to get the single implementation back.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Pre-flight
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'user_coupons'
       AND column_name  = 'coupon_code'
  ) THEN
    RAISE EXCEPTION 'Apply 20261109000100_loyalty_reward_issuance.sql first (user_coupons snapshot columns missing).';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'orders'
       AND column_name  = 'user_coupon_id'
  ) THEN
    RAISE EXCEPTION 'Apply 20261005000100_level_coupons.sql first (orders.user_coupon_id missing).';
  END IF;

  -- Two IFs, not one OR: SQL does not promise short-circuiting, and
  -- pg_get_functiondef must never see a NULL regprocedure.
  IF to_regprocedure('public.place_admin_order(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'place_admin_order(jsonb) is missing — apply 20260611000200 and 20261004000100 first.';
  END IF;
  IF pg_get_functiondef(to_regprocedure('public.place_admin_order(jsonb)'))
       NOT LIKE '%link_account%' THEN
    RAISE EXCEPTION 'Apply 20261004000100_admin_order_customer_link.sql first (place_admin_order is outdated).';
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 1. redeem_user_coupon_for_order — the ONE implementation of the coupon rules
-- ────────────────────────────────────────────────────────────────────────────
-- Identical to apply_order_coupon in 20261109000100 §5, except that the owner
-- comes from `p_owner_id` instead of `auth.uid()` (lines marked -- PARAM).
--
-- Error contract (RAISE EXCEPTION messages; parsed by lib/coupons/errors.ts):
--   coupon_login_required | coupon_invalid_request | coupon_order_invalid
--   coupon_not_applicable | coupon_not_found       | coupon_expired
--   coupon_not_available  | coupon_no_discount     | coupon_min_subtotal:<amount>
CREATE OR REPLACE FUNCTION public.redeem_user_coupon_for_order(
  p_order_id       UUID,
  p_user_coupon_id UUID,
  p_owner_id       UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order    RECORD;
  v_coupon   RECORD;
  v_discount NUMERIC(12,2);
  v_rows     INTEGER;
  v_total    NUMERIC(12,2);
BEGIN
  IF p_owner_id IS NULL THEN                                           -- PARAM
    RAISE EXCEPTION 'coupon_login_required';
  END IF;
  IF p_order_id IS NULL OR p_user_coupon_id IS NULL THEN
    RAISE EXCEPTION 'coupon_invalid_request';
  END IF;

  -- Lock the order: serializes two applies to the same order.
  SELECT id, user_id, subtotal, shipping_cost, discount, total,
         order_status, payment_status, payment_reference,
         is_wholesale_order, user_coupon_id
    INTO v_order
    FROM public.orders
   WHERE id = p_order_id
     FOR UPDATE;

  IF NOT FOUND OR v_order.user_id IS DISTINCT FROM p_owner_id THEN     -- PARAM
    RAISE EXCEPTION 'coupon_order_invalid';
  END IF;

  -- Only a brand-new, still-unpaid order: no payment object may exist yet, or
  -- the amount the customer is about to be charged would silently change.
  IF v_order.order_status  <> 'pending'
     OR v_order.payment_status <> 'pending'
     OR v_order.payment_reference IS NOT NULL
     OR v_order.user_coupon_id IS NOT NULL THEN
    RAISE EXCEPTION 'coupon_order_invalid';
  END IF;

  -- Wholesale pricing is already a negotiated discount; coupons do not stack.
  IF v_order.is_wholesale_order THEN
    RAISE EXCEPTION 'coupon_not_applicable';
  END IF;

  -- A coupon that is not yours is indistinguishable from one that does not exist.
  SELECT uc.id, uc.status, uc.expires_at,
         uc.coupon_code AS code, uc.coupon_name AS name,
         uc.discount_type, uc.discount_value,
         uc.max_discount_amount, uc.min_order_subtotal
    INTO v_coupon
    FROM public.user_coupons uc
   WHERE uc.id = p_user_coupon_id
     AND uc.user_id = p_owner_id;                                      -- PARAM

  IF NOT FOUND THEN
    RAISE EXCEPTION 'coupon_not_found';
  END IF;
  IF v_coupon.status = 'expired'
     OR (v_coupon.expires_at IS NOT NULL AND v_coupon.expires_at <= now()) THEN
    RAISE EXCEPTION 'coupon_expired';
  END IF;
  IF v_coupon.status NOT IN ('unlocked', 'claimed') THEN
    RAISE EXCEPTION 'coupon_not_available';
  END IF;

  IF v_order.subtotal < v_coupon.min_order_subtotal THEN
    RAISE EXCEPTION 'coupon_min_subtotal:%', v_coupon.min_order_subtotal::BIGINT;
  END IF;

  -- Discount on GOODS only (never shipping). Whole colones, capped, never
  -- more than the subtotal. Mirrored in lib/coupons/discount.ts.
  IF v_coupon.discount_type = 'percentage' THEN
    v_discount := ROUND(v_order.subtotal * v_coupon.discount_value / 100);
    IF v_coupon.max_discount_amount IS NOT NULL THEN
      v_discount := LEAST(v_discount, v_coupon.max_discount_amount);
    END IF;
  ELSE
    v_discount := v_coupon.discount_value;
  END IF;
  v_discount := LEAST(v_discount, v_order.subtotal);

  IF v_discount <= 0 THEN
    RAISE EXCEPTION 'coupon_no_discount';
  END IF;

  -- THE atomic spend. Under READ COMMITTED a concurrent winner's commit makes
  -- this row fail the WHERE on re-check, so the loser updates 0 rows.
  UPDATE public.user_coupons
     SET status               = 'used',
         used_at              = now(),
         claimed_at           = COALESCE(claimed_at, now()),
         used_order_id        = p_order_id,
         payment_confirmed_at = NULL
   WHERE id = p_user_coupon_id
     AND user_id = p_owner_id                                          -- PARAM
     AND status IN ('unlocked', 'claimed')
     AND (expires_at IS NULL OR expires_at > now());
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RAISE EXCEPTION 'coupon_not_available';
  END IF;

  -- Delta, not recompute: preserves any other term already in `total`.
  v_total := GREATEST(v_order.total - v_discount, 0);

  UPDATE public.orders
     SET user_coupon_id = p_user_coupon_id,
         discount       = v_discount,
         total          = v_total
   WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'order_id',        p_order_id,
    'user_coupon_id',  p_user_coupon_id,
    'coupon_code',     v_coupon.code,
    'coupon_name',     v_coupon.name,
    'discount_amount', v_discount,
    'subtotal',        v_order.subtotal,
    'shipping_cost',   v_order.shipping_cost,
    'total',           v_total
  );
END;
$$;

-- Trusts its owner argument → never callable through the API. Supabase grants
-- EXECUTE on new public functions to anon/authenticated by default, so revoking
-- from PUBLIC alone would NOT be enough.
REVOKE ALL     ON FUNCTION public.redeem_user_coupon_for_order(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.redeem_user_coupon_for_order(UUID, UUID, UUID) TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. apply_order_coupon — the web checkout entry point, now a thin wrapper
-- ────────────────────────────────────────────────────────────────────────────
-- Same signature, same result, same errors: the owner is the caller.
CREATE OR REPLACE FUNCTION public.apply_order_coupon(
  p_order_id       UUID,
  p_user_coupon_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.redeem_user_coupon_for_order(p_order_id, p_user_coupon_id, auth.uid());
END;
$$;

-- Unchanged grants (see 20261005000100 §9).
REVOKE EXECUTE ON FUNCTION public.apply_order_coupon(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.apply_order_coupon(UUID, UUID) TO anon, authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. place_admin_order  [REPLACED]
-- ────────────────────────────────────────────────────────────────────────────
-- Identical to 20261004000100 §3 except where marked -- NEW. The per-item loop
-- is deliberately unchanged — keep it in sync with place_order.
--
-- NEW payload fields, all optional:
--   "user_coupon_id":                  UUID     a user_coupons id owned by
--                                               customer.user_id
--   "shipping"."free_local_delivery":  boolean  shipping cost 0 (delivery only)
-- NEW error codes:
--   coupon_customer_required          coupon sent without customer.user_id
--   coupon_manual_discount_conflict   coupon sent together with discount > 0
--   + every coupon_* code of redeem_user_coupon_for_order
-- NEW output fields: user_coupon_id, coupon_code, coupon_name, local_delivery.
CREATE OR REPLACE FUNCTION public.place_admin_order(
  p_payload JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id       UUID := auth.uid();
  v_order_id       UUID;
  v_order_number   BIGINT;

  v_cust_name      TEXT;
  v_cust_email     TEXT;
  v_cust_phone     TEXT;
  v_link_user_id   UUID;
  v_link_account   BOOLEAN;
  v_owner_id       UUID;

  v_ship_address   TEXT;
  v_canton_code    TEXT;
  v_canton_name    TEXT;
  v_province_name  TEXT;
  v_district       TEXT;
  v_ship_reference TEXT;
  v_ship_method    TEXT;
  v_free_local     BOOLEAN := FALSE;   -- NEW
  v_local_applied  BOOLEAN := FALSE;   -- NEW

  v_items_json      JSONB;
  v_item            JSONB;
  v_variant_id      UUID;
  v_quantity        INT;
  v_variant         RECORD;
  v_effective_price NUMERIC(12,2);
  v_line_total      NUMERIC(12,2);
  v_subtotal        NUMERIC(12,2) := 0;
  v_item_count      INT := 0;

  v_ship_calc       JSONB;
  v_ship_cost       NUMERIC(12,2);
  v_discount        NUMERIC(12,2);
  v_total           NUMERIC(12,2);
  v_notes           TEXT;

  v_user_coupon_id  UUID;              -- NEW
  v_coupon          JSONB;             -- NEW
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Insufficient privilege: admin only.';
  END IF;

  -- ════════ 1. Customer (email OPTIONAL for manual orders) ════════
  v_cust_name  := NULLIF(TRIM(p_payload->'customer'->>'name'),  '');
  v_cust_phone := NULLIF(TRIM(p_payload->'customer'->>'phone'), '');
  v_cust_email := NULLIF(LOWER(TRIM(p_payload->'customer'->>'email')), '');

  IF v_cust_name  IS NULL THEN RAISE EXCEPTION 'customer.name is required';  END IF;
  IF v_cust_phone IS NULL THEN RAISE EXCEPTION 'customer.phone is required'; END IF;
  IF v_cust_email IS NOT NULL
     AND v_cust_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'customer.email is invalid';
  END IF;

  BEGIN
    v_link_user_id := NULLIF(TRIM(p_payload->'customer'->>'user_id'), '')::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'customer.user_id is invalid';
  END;

  IF v_link_user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_link_user_id) THEN
    RAISE EXCEPTION 'customer.user_id does not match a registered user';
  END IF;

  v_link_account := COALESCE((p_payload->'customer'->>'link_account')::BOOLEAN, TRUE);

  IF v_link_user_id IS NOT NULL AND v_link_account IS FALSE THEN
    RAISE EXCEPTION 'customer.user_id and customer.link_account=false are mutually exclusive';
  END IF;

  IF v_link_user_id IS NULL AND v_link_account IS FALSE THEN
    PERFORM set_config('app.skip_order_user_link', 'on', true);
  END IF;

  -- ════════ 1b. Coupon intent (NEW) ════════
  -- Validated up front so an impossible request fails before any stock moves.
  -- Ownership, status, expiry and the minimum are checked by
  -- redeem_user_coupon_for_order once the order exists (step 8b).
  BEGIN
    v_user_coupon_id := NULLIF(TRIM(p_payload->>'user_coupon_id'), '')::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'coupon_invalid_request';
  END;

  IF v_user_coupon_id IS NOT NULL THEN
    -- The coupon list in the form belongs to the account the admin picked;
    -- an order owned by an email-resolved (or no) account is not that.
    IF v_link_user_id IS NULL THEN
      RAISE EXCEPTION 'coupon_customer_required';
    END IF;
    -- One `discount` column, one reduction: a coupon replaces the manual
    -- discount instead of stacking on it (and XP stays subtotal - coupon).
    IF COALESCE((p_payload->>'discount')::NUMERIC(12,2), 0) <> 0 THEN
      RAISE EXCEPTION 'coupon_manual_discount_conflict';
    END IF;
  END IF;

  -- ════════ 2. Shipping ════════
  v_ship_method    := COALESCE(NULLIF(TRIM(p_payload->>'shipping_method'), ''), 'delivery');
  IF v_ship_method NOT IN ('delivery', 'pickup') THEN
    RAISE EXCEPTION 'shipping_method must be delivery or pickup';
  END IF;

  v_ship_address   := NULLIF(TRIM(p_payload->'shipping'->>'address'),       '');
  v_canton_code    := NULLIF(TRIM(p_payload->'shipping'->>'canton_code'),   '');
  v_canton_name    := NULLIF(TRIM(p_payload->'shipping'->>'canton_name'),   '');
  v_province_name  := NULLIF(TRIM(p_payload->'shipping'->>'province_name'), '');
  v_district       := NULLIF(TRIM(p_payload->'shipping'->>'district'),      '');
  v_ship_reference := NULLIF(TRIM(p_payload->'shipping'->>'reference'),     '');

  IF v_ship_address  IS NULL THEN RAISE EXCEPTION 'shipping.address (señas) is required'; END IF;
  IF v_canton_code   IS NULL THEN RAISE EXCEPTION 'shipping.canton_code is required';     END IF;
  IF v_canton_name   IS NULL THEN RAISE EXCEPTION 'shipping.canton_name is required';     END IF;
  IF v_province_name IS NULL THEN RAISE EXCEPTION 'shipping.province_name is required';   END IF;

  -- NEW: free local delivery, decided by the Next server (see header).
  BEGIN
    v_free_local := COALESCE((p_payload->'shipping'->>'free_local_delivery')::BOOLEAN, FALSE);
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'shipping.free_local_delivery is invalid';
  END;

  v_notes := NULLIF(TRIM(p_payload->>'notes'), '');

  -- ════════ 3. Items — structural validation ════════
  v_items_json := p_payload->'items';
  IF v_items_json IS NULL
     OR jsonb_typeof(v_items_json) <> 'array'
     OR jsonb_array_length(v_items_json) = 0 THEN
    RAISE EXCEPTION 'items must be a non-empty array';
  END IF;

  -- ════════ 4. Order shell ════════
  INSERT INTO public.orders (
    user_id, created_by_admin_id,
    customer_name, customer_email, customer_phone,
    shipping_address, shipping_canton, shipping_district,
    shipping_province, shipping_reference,
    shipping_method, shipping_cost,
    subtotal, tax, discount, total,
    order_status, payment_status,
    source, notes
  ) VALUES (
    v_link_user_id, v_admin_id,
    v_cust_name, v_cust_email, v_cust_phone,
    v_ship_address, v_canton_name, v_district,
    v_province_name, v_ship_reference,
    v_ship_method, 0,
    0, 0, 0, 0,
    'pending', 'pending',              -- NEVER auto-paid (business rule)
    'admin', v_notes
  )
  RETURNING id, order_number, user_id INTO v_order_id, v_order_number, v_owner_id;

  -- ════════ 5. Per-item: re-validate from DB, snapshot, decrement stock ════════
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items_json)
  LOOP
    v_variant_id := (v_item->>'variant_id')::UUID;
    v_quantity   := (v_item->>'quantity')::INT;

    IF v_variant_id IS NULL THEN
      RAISE EXCEPTION 'items[].variant_id is required';
    END IF;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'items[].quantity must be a positive integer';
    END IF;

    SELECT pv.id, pv.product_id, pv.price, pv.offer_price, pv.is_on_offer,
           pv.is_active, pv.stock, pv.product_type, pv.size_ml, pv.sku,
           p.name AS product_name, b.name AS brand_name
      INTO v_variant
      FROM public.product_variants pv
      JOIN public.products p ON p.id = pv.product_id
      JOIN public.brands   b ON b.id = p.brand_id
     WHERE pv.id = v_variant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variant % no longer exists.', v_variant_id;
    END IF;
    IF NOT v_variant.is_active THEN
      RAISE EXCEPTION 'Variant % (%) is no longer available for sale.',
        v_variant.sku, v_variant.product_name;
    END IF;

    IF v_variant.is_on_offer AND v_variant.offer_price IS NOT NULL THEN
      v_effective_price := v_variant.offer_price;
    ELSE
      v_effective_price := v_variant.price;
    END IF;

    v_line_total := v_effective_price * v_quantity;
    v_subtotal   := v_subtotal + v_line_total;
    v_item_count := v_item_count + v_quantity;

    INSERT INTO public.order_items (
      order_id, variant_id,
      product_name, brand_name, product_type, size_ml, sku,
      quantity, unit_price, line_total
    ) VALUES (
      v_order_id, v_variant.id,
      v_variant.product_name, v_variant.brand_name, v_variant.product_type,
      v_variant.size_ml, v_variant.sku,
      v_quantity, v_effective_price, v_line_total
    );

    IF v_variant.product_type = 'decant' THEN
      PERFORM public.decrease_decant_pool(
        v_variant.product_id,
        v_variant.size_ml * v_quantity,
        v_order_id
      );
    ELSE
      PERFORM public.decrease_variant_stock(v_variant.id, v_quantity, v_order_id);
    END IF;
  END LOOP;

  -- ════════ 6. Shipping cost (pickup = free) ════════
  -- Always priced on the PRE-coupon subtotal, exactly like place_order: a
  -- coupon never pushes an order back under a free-shipping threshold.
  IF v_ship_method = 'pickup' THEN
    v_ship_cost := 0;
    v_ship_calc := jsonb_build_object('cost', 0, 'pickup', true);
  ELSE
    v_ship_calc := public.calculate_shipping_cost(v_canton_code, v_subtotal);
    v_ship_cost := (v_ship_calc->>'cost')::NUMERIC(12,2);

    -- NEW: free local delivery replaces whatever the zone charges.
    IF v_free_local THEN
      v_ship_calc     := v_ship_calc || jsonb_build_object(
                           'cost',           0,
                           'zone_cost',      v_ship_cost,
                           'local_delivery', true);
      v_ship_cost     := 0;
      v_local_applied := TRUE;
    END IF;
  END IF;

  -- ════════ 7. Discount (clamped to a sane range) ════════
  v_discount := COALESCE((p_payload->>'discount')::NUMERIC(12,2), 0);
  IF v_discount < 0 THEN
    RAISE EXCEPTION 'discount cannot be negative';
  END IF;
  IF v_discount > v_subtotal + v_ship_cost THEN
    RAISE EXCEPTION 'discount cannot exceed the order total';
  END IF;

  v_total := v_subtotal + v_ship_cost - v_discount;

  -- ════════ 8. Finalize totals ════════
  UPDATE public.orders
     SET subtotal      = v_subtotal,
         shipping_cost = v_ship_cost,
         discount      = v_discount,
         total         = v_total
   WHERE id = v_order_id;

  -- ════════ 8b. Coupon (NEW) ════════
  -- Same function the web checkout uses. It locks the order, re-checks every
  -- rule against the order's STORED subtotal, spends the coupon with a guarded
  -- UPDATE and rewrites discount + total. If it raises, this whole call rolls
  -- back: the order, its items, the stock movements and the coupon spend.
  IF v_user_coupon_id IS NOT NULL THEN
    v_coupon   := public.redeem_user_coupon_for_order(v_order_id, v_user_coupon_id, v_owner_id);
    v_discount := (v_coupon->>'discount_amount')::NUMERIC(12,2);
    v_total    := (v_coupon->>'total')::NUMERIC(12,2);
  END IF;

  -- ════════ 9. Return summary ════════
  RETURN jsonb_build_object(
    'order_id',       v_order_id,
    'order_number',   v_order_number,
    'subtotal',       v_subtotal,
    'shipping_cost',  v_ship_cost,
    'discount',       v_discount,
    'total',          v_total,
    'item_count',     v_item_count,
    'shipping',       v_ship_calc,
    'user_id',        v_owner_id,
    'user_coupon_id', v_user_coupon_id,          -- NEW
    'coupon_code',    v_coupon->>'coupon_code',  -- NEW
    'coupon_name',    v_coupon->>'coupon_name',  -- NEW
    'local_delivery', v_local_applied            -- NEW
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.place_admin_order(JSONB) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.place_admin_order(JSONB) TO authenticated, service_role;

COMMIT;


-- ============================================================================
-- VERIFICATION QUERIES — run after the migration (Studio SQL editor)
-- ============================================================================
-- 1. The three functions are the new bodies:
--    SELECT pg_get_functiondef('public.place_admin_order(jsonb)'::regprocedure)
--             LIKE '%redeem_user_coupon_for_order%'       AS admin_uses_core,     -- true
--           pg_get_functiondef('public.apply_order_coupon(uuid,uuid)'::regprocedure)
--             LIKE '%redeem_user_coupon_for_order%'       AS checkout_uses_core,  -- true
--           pg_get_functiondef('public.place_admin_order(jsonb)'::regprocedure)
--             LIKE '%free_local_delivery%'                AS has_local_delivery;  -- true
--
-- 2. The internal core is NOT reachable through the API:
--    SELECT grantee, privilege_type FROM information_schema.routine_privileges
--     WHERE routine_name = 'redeem_user_coupon_for_order'
--       AND grantee IN ('PUBLIC','anon','authenticated','service_role');
--    -> service_role only
--
-- 3. Checkout grants are unchanged:
--    SELECT grantee FROM information_schema.routine_privileges
--     WHERE routine_name = 'apply_order_coupon'
--       AND grantee IN ('anon','authenticated') ORDER BY 1;   -- anon, authenticated
--
-- 4. Signatures (one row each, no accidental overloads):
--    SELECT oid::regprocedure FROM pg_proc
--     WHERE proname IN ('place_admin_order','apply_order_coupon','redeem_user_coupon_for_order');
--
-- 5. Full behavioural suite (BEGIN … ROLLBACK, leaves nothing behind):
--    supabase/tests/20261110000100_admin_order_coupons_local_delivery_test.sql
-- ============================================================================
