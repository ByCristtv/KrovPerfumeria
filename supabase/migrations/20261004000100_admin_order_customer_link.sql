-- ============================================================================
-- 20261004000100_admin_order_customer_link.sql
-- Manual (admin) orders for REGISTERED customers must belong to their account,
-- otherwise they never earn XP.
-- ============================================================================
-- THE BUG
--   place_admin_order always inserted `user_id = NULL`. XP is granted by
--   `trg_orders_grant_xp` -> `grant_order_xp`, which skips guest orders
--   (reason: 'guest_order'). `claim_guest_orders` only runs when someone
--   CONFIRMS their email, so a customer who was ALREADY registered when the
--   admin typed their email never had the order claimed: no owner, no XP, and
--   the order is missing from their history.
--
--   (The XP ledger table is `profile_experience_events`; the award trigger is
--   AFTER UPDATE OF order_status -> 'received'. Neither needs to change: once
--   `orders.user_id` is populated, the existing trigger awards XP exactly as it
--   does for web orders. This migration fixes OWNERSHIP, not the XP maths.)
--
-- WHAT THIS MIGRATION DOES
--   1. tg_orders_resolve_user_id  BEFORE INSERT trigger on orders. When an
--      ADMIN-created order has no user_id but a customer_email that belongs to a
--      registered, email-CONFIRMED account, it fills user_id in.
--   2. admin_search_customers / admin_find_customer_by_email  admin-only lookups
--      that power the customer picker and the "this email is registered" hint
--      in the order form. They read auth.users, which clients cannot.
--   3. place_admin_order  REPLACED. Accepts customer.user_id (explicit link from
--      the picker) and customer.link_account = false (admin declined the link),
--      and reports which account the order ended up on.
--   4. backfill_admin_order_links()  one-shot repair for admin orders that were
--      already created unlinked. Service-role only.
--
-- DECISIONS WORTH KNOWING ABOUT
--   * The trigger is scoped to source = 'admin'. Website guest checkout is NOT
--     auto-linked: there the "email" is whatever an unauthenticated visitor typed,
--     and linking on it would let anyone plant orders (and XP) on somebody
--     else's account by typing their address. An admin is a trusted actor
--     entering a customer's own contact details. To widen the scope later, drop
--     the `source` condition below - it is the only line that needs to change.
--   * Linking by email requires email_confirmed_at IS NOT NULL, the same gate
--     claim_guest_orders uses. An unconfirmed signup proves nothing about who
--     owns the inbox. An admin can still link an unconfirmed account EXPLICITLY
--     by picking it in the form (user_id in the payload) - that is a human
--     decision, not an inference.
--   * Declining the link is honoured. place_admin_order sets a transaction-local
--     flag (app.skip_order_user_link) that the trigger reads, so "don't link"
--     in the UI is not silently overridden by the safety net.
-- ============================================================================
-- Depends on: 20260611000200 (place_admin_order), 20260611000100 (XP),
--             20260905000100 (reconcile_profile_order_xp), is_admin().
-- Fully idempotent. Safe to re-run.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. BEFORE INSERT: resolve orders.user_id from customer_email
-- ────────────────────────────────────────────────────────────────────────────
-- Runs as SECURITY DEFINER because it reads auth.users. Pure lookup, no writes
-- apart from NEW.user_id, and it never raises: a failed resolve must not block
-- an order from being created - the order simply stays a guest order.

CREATE OR REPLACE FUNCTION public.tg_orders_resolve_user_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Already owned (web checkout, or an explicit link from the admin form).
  IF NEW.user_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Admin chose "do not link" (set by place_admin_order, transaction-local).
  IF COALESCE(current_setting('app.skip_order_user_link', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  -- Scope: admin-created orders only (see header). Nothing to match on without
  -- an email.
  IF NEW.source IS DISTINCT FROM 'admin'
     OR NULLIF(TRIM(NEW.customer_email), '') IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT u.id
    INTO v_user_id
    FROM auth.users u
    JOIN public.profiles p ON p.id = u.id          -- an account we can credit
   WHERE LOWER(u.email) = LOWER(TRIM(NEW.customer_email))
     AND u.email_confirmed_at IS NOT NULL          -- proof of inbox ownership
   ORDER BY u.created_at
   LIMIT 1;

  IF v_user_id IS NOT NULL THEN
    NEW.user_id := v_user_id;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_orders_resolve_user_id() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_orders_resolve_user_id ON public.orders;

CREATE TRIGGER trg_orders_resolve_user_id
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_orders_resolve_user_id();


-- ────────────────────────────────────────────────────────────────────────────
-- 2. Admin customer lookups
-- ────────────────────────────────────────────────────────────────────────────
-- Both return the customer's SAVED address (addresses.province / canton hold
-- CODES, district holds a NAME) so the form can prefill delivery. Admin-only:
-- the is_admin() check raises rather than returning an empty set, so a probing
-- non-admin gets a clear refusal instead of a result that looks like "no
-- customers".

CREATE OR REPLACE FUNCTION public.admin_search_customers(
  p_query TEXT,
  p_limit INT DEFAULT 8
) RETURNS TABLE (
  user_id           UUID,
  full_name         TEXT,
  email             TEXT,
  phone             TEXT,
  address_province  TEXT,
  address_canton    TEXT,
  address_district  TEXT,
  address_exact     TEXT,
  address_reference TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_query   TEXT := NULLIF(TRIM(p_query), '');
  v_pattern TEXT;
  v_limit   INT  := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 20);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Insufficient privilege: admin only.';
  END IF;

  -- Too short to be a useful search; also stops "a" from dumping the user base.
  IF v_query IS NULL OR char_length(v_query) < 2 THEN
    RETURN;
  END IF;

  -- Escape LIKE metacharacters so "%" / "_" in the term are matched literally.
  v_pattern := '%' || REPLACE(REPLACE(REPLACE(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    u.email::TEXT,
    p.phone,
    a.province,
    a.canton,
    a.district,
    a.exact_address,
    a."references"
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  LEFT JOIN LATERAL (
    SELECT ad.province, ad.canton, ad.district, ad.exact_address, ad."references"
      FROM public.addresses ad
     WHERE ad.user_id = p.id
     ORDER BY ad.updated_at DESC
     LIMIT 1
  ) a ON TRUE
  WHERE u.email ILIKE v_pattern
     OR p.full_name ILIKE v_pattern
     OR p.phone ILIKE v_pattern
  ORDER BY
    -- exact email first, then name-prefix, then the rest alphabetically
    (LOWER(u.email) = LOWER(v_query)) DESC,
    (p.full_name ILIKE (REPLACE(REPLACE(REPLACE(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%')) DESC,
    p.full_name NULLS LAST,
    u.email
  LIMIT v_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_search_customers(TEXT, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_search_customers(TEXT, INT) TO authenticated, service_role;


-- Exact (case-insensitive) email lookup for the "this email is registered" hint.
-- Separate from the search so a typed "ana@x.com" can never surface
-- "banana@x.com" as if it were the same person.
CREATE OR REPLACE FUNCTION public.admin_find_customer_by_email(
  p_email TEXT
) RETURNS TABLE (
  user_id           UUID,
  full_name         TEXT,
  email             TEXT,
  phone             TEXT,
  address_province  TEXT,
  address_canton    TEXT,
  address_district  TEXT,
  address_exact     TEXT,
  address_reference TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := NULLIF(LOWER(TRIM(p_email)), '');
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Insufficient privilege: admin only.';
  END IF;

  IF v_email IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    u.email::TEXT,
    p.phone,
    a.province,
    a.canton,
    a.district,
    a.exact_address,
    a."references"
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  LEFT JOIN LATERAL (
    SELECT ad.province, ad.canton, ad.district, ad.exact_address, ad."references"
      FROM public.addresses ad
     WHERE ad.user_id = p.id
     ORDER BY ad.updated_at DESC
     LIMIT 1
  ) a ON TRUE
  WHERE LOWER(u.email) = v_email
  ORDER BY u.created_at
  LIMIT 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_find_customer_by_email(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_find_customer_by_email(TEXT) TO authenticated, service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. place_admin_order  [REPLACED]
-- ────────────────────────────────────────────────────────────────────────────
-- Identical to 20260611000200 except where marked `-- NEW`. The per-item loop is
-- deliberately unchanged - keep it in sync with place_order (see that migration).
--
-- NEW payload fields, both optional, both under "customer":
--   "user_id":      UUID   explicit link to a registered account (from the picker
--                          or the "link this account" hint). Must exist.
--   "link_account": false  admin declined the link: suppress the email-based
--                          auto-link too. Omitted/true = let the trigger decide.
-- NEW output fields: "user_id" (account the order landed on, or null).

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
  v_link_user_id   UUID;      -- NEW
  v_link_account   BOOLEAN;   -- NEW
  v_owner_id       UUID;      -- NEW

  v_ship_address   TEXT;
  v_canton_code    TEXT;
  v_canton_name    TEXT;
  v_province_name  TEXT;
  v_district       TEXT;
  v_ship_reference TEXT;
  v_ship_method    TEXT;

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

  -- NEW: explicit account link. Cast errors become a clear message instead of a
  -- raw "invalid input syntax for type uuid".
  BEGIN
    v_link_user_id := NULLIF(TRIM(p_payload->'customer'->>'user_id'), '')::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'customer.user_id is invalid';
  END;

  IF v_link_user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_link_user_id) THEN
    RAISE EXCEPTION 'customer.user_id does not match a registered user';
  END IF;

  -- Only an explicit JSON false opts out; absent / true / anything else = default.
  v_link_account := COALESCE((p_payload->'customer'->>'link_account')::BOOLEAN, TRUE);

  -- Contradiction guard: you cannot both link an account and decline to.
  IF v_link_user_id IS NOT NULL AND v_link_account IS FALSE THEN
    RAISE EXCEPTION 'customer.user_id and customer.link_account=false are mutually exclusive';
  END IF;

  IF v_link_user_id IS NULL AND v_link_account IS FALSE THEN
    -- Transaction-local (is_local = true): read by tg_orders_resolve_user_id for
    -- the INSERT below, then gone at COMMIT/ROLLBACK. Cannot leak to other calls.
    PERFORM set_config('app.skip_order_user_link', 'on', true);
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

  v_notes := NULLIF(TRIM(p_payload->>'notes'), '');

  -- ════════ 3. Items — structural validation ════════
  v_items_json := p_payload->'items';
  IF v_items_json IS NULL
     OR jsonb_typeof(v_items_json) <> 'array'
     OR jsonb_array_length(v_items_json) = 0 THEN
    RAISE EXCEPTION 'items must be a non-empty array';
  END IF;

  -- ════════ 4. Order shell ════════
  -- user_id is the explicit link when given; otherwise NULL and the BEFORE INSERT
  -- trigger resolves it from customer_email (unless the admin opted out above).
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
    v_link_user_id, v_admin_id,        -- NEW: was NULL
    v_cust_name, v_cust_email, v_cust_phone,
    v_ship_address, v_canton_name, v_district,
    v_province_name, v_ship_reference,
    v_ship_method, 0,
    0, 0, 0, 0,
    'pending', 'pending',              -- NEVER auto-paid (business rule)
    'admin', v_notes
  )
  RETURNING id, order_number, user_id INTO v_order_id, v_order_number, v_owner_id;
  -- ^ NEW: user_id is read back AFTER the BEFORE INSERT trigger ran, so v_owner_id
  --   is the account the order really landed on, however it got there.

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

    -- Same inventory rules as the website's place_order: decant lines draw
    -- from the shared ml pool; all other types decrement variant.stock. Both
    -- lock + raise on insufficiency → the whole txn rolls back.
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
  IF v_ship_method = 'pickup' THEN
    v_ship_cost := 0;
    v_ship_calc := jsonb_build_object('cost', 0, 'pickup', true);
  ELSE
    v_ship_calc := public.calculate_shipping_cost(v_canton_code, v_subtotal);
    v_ship_cost := (v_ship_calc->>'cost')::NUMERIC(12,2);
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

  -- ════════ 9. Return summary ════════
  RETURN jsonb_build_object(
    'order_id',      v_order_id,
    'order_number',  v_order_number,
    'subtotal',      v_subtotal,
    'shipping_cost', v_ship_cost,
    'discount',      v_discount,
    'total',         v_total,
    'item_count',    v_item_count,
    'shipping',      v_ship_calc,
    'user_id',       v_owner_id        -- NEW
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.place_admin_order(JSONB) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.place_admin_order(JSONB) TO authenticated, service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. backfill_admin_order_links() -> TABLE(user_id, orders_linked)
-- ────────────────────────────────────────────────────────────────────────────
-- Repairs admin orders created BEFORE this migration for customers who were
-- already registered. Links with the same rules as the trigger (admin source,
-- confirmed email), then settles XP through reconcile_profile_order_xp - the
-- single place that owns the XP maths - so orders that are already `received`
-- get their points. Re-running is a no-op.
--
-- Run it from Studio (service_role), review the result, then re-run to confirm
-- it returns zero rows.

CREATE OR REPLACE FUNCTION public.backfill_admin_order_links()
RETURNS TABLE (user_id UUID, orders_linked INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
BEGIN
  FOR v_row IN
    WITH linked AS (
      UPDATE public.orders o
         SET user_id = u.id
        FROM auth.users u
        JOIN public.profiles p ON p.id = u.id
       WHERE o.user_id IS NULL
         AND o.source = 'admin'
         AND NULLIF(TRIM(o.customer_email), '') IS NOT NULL
         AND LOWER(u.email) = LOWER(TRIM(o.customer_email))
         AND u.email_confirmed_at IS NOT NULL
      RETURNING u.id AS uid
    )
    SELECT uid, COUNT(*)::INT AS n FROM linked GROUP BY uid
  LOOP
    PERFORM public.reconcile_profile_order_xp(v_row.uid);
    user_id       := v_row.uid;
    orders_linked := v_row.n;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.backfill_admin_order_links() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.backfill_admin_order_links() TO service_role;


-- ============================================================================
-- VERIFICATION QUERIES -- run after the migration (Studio SQL editor)
-- ============================================================================
-- 1. Everything exists:
--    SELECT proname FROM pg_proc
--     WHERE proname IN ('tg_orders_resolve_user_id','admin_search_customers',
--                       'admin_find_customer_by_email','place_admin_order',
--                       'backfill_admin_order_links')
--     ORDER BY proname;                                   -- 5 rows
--    SELECT tgname, tgtype FROM pg_trigger
--     WHERE tgname = 'trg_orders_resolve_user_id';        -- 1 row
--
-- 2. place_admin_order is the new body:
--    SELECT pg_get_functiondef('public.place_admin_order(jsonb)'::regprocedure)
--             LIKE '%link_account%' AS is_upgraded;       -- true
--
-- 3. Lookups are admin-gated (as a NON-admin session this must RAISE):
--    SELECT * FROM public.admin_search_customers('ana');
--
-- 4. TRIGGER, end to end (service_role / SQL editor). Use the email of a real
--    registered + CONFIRMED test account; <uid> is that account's id:
--    INSERT INTO public.orders (
--      user_id, customer_name, customer_email, customer_phone,
--      shipping_address, shipping_canton, shipping_province,
--      subtotal, total, source
--    ) VALUES (
--      NULL, 'Trigger Test', '<registered-email>', '00000000',
--      '100m sur', 'San José', 'San José', 5000, 5000, 'admin'
--    ) RETURNING id, user_id;                              -- user_id = <uid>
--
--    Same insert with source = 'web'                       -- user_id stays NULL
--    Same insert with an UNCONFIRMED account's email       -- user_id stays NULL
--    Cleanup: DELETE FROM public.orders WHERE customer_name = 'Trigger Test';
--
-- 5. XP now flows for a linked admin order: create the order from the admin form
--    for a registered customer, mark it paid, advance it to `received`, then
--      SELECT xp_earned FROM public.profile_experience_events WHERE order_id = '<id>';
--    -> floor(total / 1000) * 50
--
-- 6. REPAIR HISTORY (service_role) - run once, then re-run to prove idempotency:
--    SELECT * FROM public.backfill_admin_order_links();   -- rows = accounts repaired
--    SELECT * FROM public.backfill_admin_order_links();   -- -> 0 rows, always
--
-- 7. Invariant - no admin order may still be unlinked while a confirmed account
--    owns its email (must return 0 after step 6):
--    SELECT count(*)
--      FROM public.orders o
--      JOIN auth.users u ON LOWER(u.email) = LOWER(TRIM(o.customer_email))
--     WHERE o.user_id IS NULL AND o.source = 'admin'
--       AND u.email_confirmed_at IS NOT NULL;
--    NOTE: orders the admin deliberately declined to link (link_account = false)
--    will also show up here - that is expected, not a defect.
-- ============================================================================
