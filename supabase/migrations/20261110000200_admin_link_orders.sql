-- ============================================================================
-- 20261110000200_admin_link_orders.sql
-- "Ligar Pedidos": attach historical guest orders (user_id IS NULL) to the
-- registered account of the customer who placed them, and settle their XP.
-- ============================================================================
-- WHY
--   Customers who bought before having an account (or without giving an email)
--   have since registered. Their old orders still have user_id = NULL, so they
--   are missing from /profile/orders and never earned XP. claim_guest_orders
--   only fixes the ones whose email matches a confirmed signup; the rest need a
--   human decision — an admin who knows "this WhatsApp order is Ana's".
--
-- HOW XP IS AWARDED (no new XP system)
--   * The XP maths stays in ONE function, grant_order_xp (20261005000100 §12):
--     floor((subtotal - discount) / 1000) * 50, shipping excluded.
--   * Duplicates stay impossible for the reason they always were:
--     profile_experience_events.order_id is UNIQUE and grant_order_xp inserts
--     ON CONFLICT DO NOTHING, bumping the balance only when its row landed.
--   * Linking UPDATEs orders.user_id only. trg_orders_grant_xp fires on
--     UPDATE OF order_status, so it does NOT fire here — the link function
--     calls grant_order_xp itself, once, and only for eligible statuses:
--       pending   → no XP now. The existing trigger awards it, to the newly
--                   linked account, when the order is advanced to received.
--       received  → grant_order_xp now.
--       shipped   → grant_order_xp now (see change 1).
--       denied    → no XP, now or later.
--
-- WHAT THIS MIGRATION DOES
--   1. grant_order_xp  REPLACED — one line: the defensive status guard accepts
--      'shipped' as well as 'received'. The state machine is
--      pending → received → shipped (advance_order_status allows no skip), so
--      a shipped order has necessarily passed the point where XP is earned.
--      Before this change a historical order that was already shipped could
--      never be credited (the trigger had fired while it had no owner, and the
--      function refused it afterwards). Nothing else calls grant_order_xp with
--      a shipped order: the trigger still fires only on the transition INTO
--      received, and reconcile_profile_order_xp still selects received orders
--      only, so no existing path changes behaviour.
--   2. order_account_links  NEW — append-only audit log: which admin linked
--      which order to which account, when, and what happened to the XP.
--   3. admin_list_unlinked_orders(...)  NEW — paginated, searchable list of
--      orders with user_id IS NULL (name / email / phone with any formatting /
--      order number). Admin only.
--   4. admin_link_order_to_customer(order, user)  NEW — the atomic link:
--      row lock, still-unlinked check, customer-account check, guarded UPDATE,
--      XP via grant_order_xp, audit row — one transaction. Admin only.
--
-- RACE SAFETY
--   The order row is locked (FOR UPDATE) before it is inspected, and the UPDATE
--   is additionally guarded by `user_id IS NULL`. Two admins linking the same
--   order serialize; the second one gets 'link_order_already_linked' and
--   changes nothing. A concurrent advance to `received` waits for the lock: if
--   it commits first, the link sees `received` and grants; if the link commits
--   first, the trigger sees the owner and grants. Either way grant_order_xp's
--   UNIQUE ledger lets exactly one of them insert.
--
-- WHAT A LINK NEVER CHANGES
--   Only orders.user_id (and the table's own updated_at). Order number, the
--   customer name / email / phone typed on the order, address, items, subtotal,
--   discount, shipping, total, payment fields, status and created_at are left
--   exactly as they were.
--
-- Depends on: 20260611000100 (XP), 20261005000100 (grant_order_xp on the
--             discounted subtotal), is_admin(), profiles.role.
-- Idempotent: safe to re-run. Runs as one transaction.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Pre-flight
-- ────────────────────────────────────────────────────────────────────────────
-- grant_order_xp is redefined below with the 20261005000100 formula
-- (subtotal - discount). On a database without that migration it would
-- silently change the XP base, so refuse to run there.
DO $$
BEGIN
  IF to_regclass('public.profile_experience_events') IS NULL THEN
    RAISE EXCEPTION 'Apply 20260611000100_experience_points.sql first.';
  END IF;
  IF to_regclass('public.user_coupons') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261005000100_level_coupons.sql first (grant_order_xp formula).';
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 1. grant_order_xp  [REPLACED — eligibility guard only]
-- ────────────────────────────────────────────────────────────────────────────
-- Identical to 20261005000100 §12 except the line marked -- CHANGED.
CREATE OR REPLACE FUNCTION public.grant_order_xp(
  p_order_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order    RECORD;
  v_xp       INTEGER;
  v_inserted INTEGER;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id is required';
  END IF;

  SELECT id, user_id, subtotal, discount, order_status
    INTO v_order
    FROM public.orders
   WHERE id = p_order_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % does not exist.', p_order_id;
  END IF;

  -- XP belongs to orders that reached `received`. A shipped order went through
  -- received first (pending → received → shipped), so it qualifies too.
  IF v_order.order_status NOT IN ('received', 'shipped') THEN          -- CHANGED
    RETURN jsonb_build_object(
      'granted', false,
      'reason',  'not_received',
      'status',  v_order.order_status
    );
  END IF;

  IF v_order.user_id IS NULL THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'guest_order');
  END IF;

  -- 50 XP per full ₡1,000 of the discounted subtotal (shipping excluded).
  v_xp := (FLOOR(GREATEST(v_order.subtotal - v_order.discount, 0) / 1000))::INTEGER * 50;

  INSERT INTO public.profile_experience_events (user_id, order_id, xp_earned)
  VALUES (v_order.user_id, v_order.id, v_xp)
  ON CONFLICT (order_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'already_granted');
  END IF;

  UPDATE public.profiles
     SET experience_points = experience_points + v_xp
   WHERE id = v_order.user_id;

  RETURN jsonb_build_object(
    'granted',   true,
    'order_id',  v_order.id,
    'user_id',   v_order.user_id,
    'xp_earned', v_xp
  );
END;
$$;

-- Not admin-guarded (the trigger must fire for any order), so it must not be
-- reachable through the API at all. Explicit anon/authenticated revoke because
-- Supabase's default privileges grant EXECUTE on new functions to both.
REVOKE ALL     ON FUNCTION public.grant_order_xp(UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.grant_order_xp(UUID) TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. order_account_links — who linked what, and what happened to the XP
-- ────────────────────────────────────────────────────────────────────────────
-- Append-only. Several rows per order are possible in principle (an order
-- unlinked in Studio and linked again), so order_id is indexed, not unique;
-- "at most one owner" is enforced on orders itself by the guarded UPDATE.
CREATE TABLE IF NOT EXISTS public.order_account_links (
  id                   BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id             UUID        NOT NULL REFERENCES public.orders(id)   ON DELETE CASCADE,
  user_id              UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- SET NULL: removing an admin account must not erase the trail.
  linked_by            UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  order_status_at_link TEXT        NOT NULL,
  xp_status            TEXT        NOT NULL CHECK (xp_status IN (
                         'granted', 'already_granted', 'pending_status', 'not_eligible')),
  xp_awarded           INTEGER     NOT NULL DEFAULT 0 CHECK (xp_awarded >= 0),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_account_links_order
  ON public.order_account_links (order_id);
CREATE INDEX IF NOT EXISTS idx_order_account_links_user
  ON public.order_account_links (user_id, created_at DESC);

ALTER TABLE public.order_account_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Order links: admins read" ON public.order_account_links;
CREATE POLICY "Order links: admins read"
  ON public.order_account_links FOR SELECT
  USING (public.is_admin());

-- No write policy on purpose: rows are written only by
-- admin_link_order_to_customer (SECURITY DEFINER).
REVOKE ALL ON public.order_account_links FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.order_account_links FROM authenticated;
GRANT  SELECT ON public.order_account_links TO authenticated;
GRANT  ALL    ON public.order_account_links TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. admin_list_unlinked_orders — the Ligar Pedidos list
-- ────────────────────────────────────────────────────────────────────────────
-- Search (case-insensitive, LIKE metacharacters escaped):
--   * customer name / email / phone as typed on the order
--   * the phone again with every non-digit stripped on BOTH sides, so
--     "8888 8888", "8888-8888" and "+506 88888888" find each other
--     (only for 4+ digits, so "12" does not match half the table)
--   * the order number, exactly ("1042" or "#1042")
-- total_count is the size of the whole filtered set (same on every row).
CREATE OR REPLACE FUNCTION public.admin_list_unlinked_orders(
  p_search         TEXT DEFAULT NULL,
  p_order_status   TEXT DEFAULT NULL,
  p_payment_status TEXT DEFAULT NULL,
  p_limit          INT  DEFAULT 20,
  p_offset         INT  DEFAULT 0
) RETURNS TABLE (
  id               UUID,
  order_number     BIGINT,
  customer_name    TEXT,
  customer_email   TEXT,
  customer_phone   TEXT,
  subtotal         NUMERIC,
  discount         NUMERIC,
  shipping_cost    NUMERIC,
  total            NUMERIC,
  order_status     TEXT,
  payment_status   TEXT,
  payment_provider TEXT,
  source           TEXT,
  created_at       TIMESTAMPTZ,
  total_count      BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_query    TEXT := NULLIF(LEFT(TRIM(COALESCE(p_search, '')), 100), '');
  v_pattern  TEXT;
  v_digits   TEXT;
  v_order_no BIGINT;
  v_limit    INT  := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  v_offset   INT  := GREATEST(COALESCE(p_offset, 0), 0);
  v_status   TEXT := NULLIF(TRIM(COALESCE(p_order_status, '')), '');
  v_payment  TEXT := NULLIF(TRIM(COALESCE(p_payment_status, '')), '');
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Insufficient privilege: admin only.';
  END IF;

  IF v_status IS NOT NULL
     AND v_status NOT IN ('pending', 'received', 'shipped', 'denied') THEN
    RAISE EXCEPTION 'link_invalid_request';
  END IF;
  IF v_payment IS NOT NULL
     AND v_payment NOT IN ('pending', 'paid', 'failed', 'refunded') THEN
    RAISE EXCEPTION 'link_invalid_request';
  END IF;

  IF v_query IS NOT NULL THEN
    v_pattern := '%' || REPLACE(REPLACE(REPLACE(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_digits  := NULLIF(regexp_replace(v_query, '\D', '', 'g'), '');
    IF v_digits IS NOT NULL AND char_length(v_digits) < 4 THEN
      v_digits := NULL;
    END IF;
    IF v_query ~ '^#?[0-9]{1,15}$' THEN
      v_order_no := ltrim(v_query, '#')::BIGINT;
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.order_number::BIGINT,
    o.customer_name::TEXT,
    o.customer_email::TEXT,
    o.customer_phone::TEXT,
    o.subtotal::NUMERIC,
    o.discount::NUMERIC,
    o.shipping_cost::NUMERIC,
    o.total::NUMERIC,
    o.order_status::TEXT,
    o.payment_status::TEXT,
    o.payment_provider::TEXT,
    o.source::TEXT,
    o.created_at,
    COUNT(*) OVER ()::BIGINT
  FROM public.orders o
  WHERE o.user_id IS NULL
    AND (v_status  IS NULL OR o.order_status::TEXT   = v_status)
    AND (v_payment IS NULL OR o.payment_status::TEXT = v_payment)
    AND (
          v_query IS NULL
       OR o.customer_name  ILIKE v_pattern
       OR o.customer_email ILIKE v_pattern
       OR o.customer_phone ILIKE v_pattern
       OR (v_digits IS NOT NULL
           AND regexp_replace(COALESCE(o.customer_phone, ''), '\D', '', 'g') LIKE '%' || v_digits || '%')
       OR (v_order_no IS NOT NULL AND o.order_number = v_order_no)
    )
  ORDER BY o.created_at DESC, o.order_number DESC
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE ALL     ON FUNCTION public.admin_list_unlinked_orders(TEXT, TEXT, TEXT, INT, INT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_list_unlinked_orders(TEXT, TEXT, TEXT, INT, INT) TO authenticated, service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. admin_link_order_to_customer — the link itself
-- ────────────────────────────────────────────────────────────────────────────
-- Error contract (RAISE EXCEPTION messages; mapped in lib/orders/orderLinking.ts):
--   Insufficient privilege: admin only.   caller is not an admin
--   link_invalid_request                  missing order or user id
--   link_order_not_found                  no such order
--   link_order_already_linked             the order already has an owner
--   link_customer_not_found               no profile + auth account for that id
--   link_customer_not_eligible            the account is not a customer
--                                         (admins are not customers)
-- Result:
--   { order_id, order_number, order_status, user_id, customer_name,
--     customer_email, xp_status, xp_awarded, xp_balance }
--   xp_status: granted | already_granted | pending_status | not_eligible
CREATE OR REPLACE FUNCTION public.admin_link_order_to_customer(
  p_order_id UUID,
  p_user_id  UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id  UUID := auth.uid();
  v_order     RECORD;
  v_customer  RECORD;
  v_rows      INTEGER;
  v_xp        JSONB;
  v_xp_status TEXT;
  v_xp_amount INTEGER := 0;
  v_balance   INTEGER;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Insufficient privilege: admin only.';
  END IF;
  IF p_order_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'link_invalid_request';
  END IF;

  -- Lock first, inspect second: a concurrent link (or status change) waits here.
  SELECT o.id, o.order_number, o.user_id, o.order_status::TEXT AS order_status
    INTO v_order
    FROM public.orders o
   WHERE o.id = p_order_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'link_order_not_found';
  END IF;
  -- Never overwrite an owner — not even with the same account (that would be a
  -- no-op dressed up as a success, and the admin should see the real state).
  IF v_order.user_id IS NOT NULL THEN
    RAISE EXCEPTION 'link_order_already_linked';
  END IF;

  -- A registered account: a profile backed by an auth user, with a customer role.
  SELECT p.id, p.full_name, p.role::TEXT AS role, u.email::TEXT AS email
    INTO v_customer
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
   WHERE p.id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'link_customer_not_found';
  END IF;
  IF v_customer.role NOT IN ('customer', 'wholesale') THEN
    RAISE EXCEPTION 'link_customer_not_eligible';
  END IF;

  -- The ONLY write to the order. Guarded twice (lock above + this predicate).
  UPDATE public.orders
     SET user_id = p_user_id
   WHERE id = p_order_id
     AND user_id IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'link_order_already_linked';
  END IF;

  -- XP through the one award function. Pending orders are left to the
  -- existing trigger (it fires on the move to received, now with an owner).
  IF v_order.order_status IN ('received', 'shipped') THEN
    v_xp := public.grant_order_xp(p_order_id);
    IF COALESCE((v_xp->>'granted')::BOOLEAN, FALSE) THEN
      v_xp_status := 'granted';
      v_xp_amount := COALESCE((v_xp->>'xp_earned')::INTEGER, 0);
    ELSIF v_xp->>'reason' = 'already_granted' THEN
      v_xp_status := 'already_granted';
    ELSE
      v_xp_status := 'not_eligible';
    END IF;
  ELSIF v_order.order_status = 'pending' THEN
    v_xp_status := 'pending_status';
  ELSE
    v_xp_status := 'not_eligible';   -- denied: cancelled orders never earn XP
  END IF;

  SELECT p.experience_points INTO v_balance
    FROM public.profiles p
   WHERE p.id = p_user_id;

  INSERT INTO public.order_account_links
         (order_id, user_id, linked_by, order_status_at_link, xp_status, xp_awarded)
  VALUES (p_order_id, p_user_id, v_admin_id, v_order.order_status, v_xp_status, v_xp_amount);

  RETURN jsonb_build_object(
    'order_id',       p_order_id,
    'order_number',   v_order.order_number,
    'order_status',   v_order.order_status,
    'user_id',        p_user_id,
    'customer_name',  COALESCE(NULLIF(TRIM(v_customer.full_name), ''), v_customer.email),
    'customer_email', v_customer.email,
    'xp_status',      v_xp_status,
    'xp_awarded',     v_xp_amount,
    'xp_balance',     v_balance
  );
END;
$$;

REVOKE ALL     ON FUNCTION public.admin_link_order_to_customer(UUID, UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_link_order_to_customer(UUID, UUID) TO authenticated, service_role;

COMMIT;


-- ============================================================================
-- VERIFICATION QUERIES — run after the migration (Studio SQL editor)
-- ============================================================================
-- 1. Objects exist:
--    SELECT oid::regprocedure FROM pg_proc
--     WHERE proname IN ('grant_order_xp','admin_list_unlinked_orders','admin_link_order_to_customer');
--    SELECT to_regclass('public.order_account_links');                    -- not null
--
-- 2. grant_order_xp accepts shipped, keeps the discounted-subtotal formula:
--    SELECT pg_get_functiondef('public.grant_order_xp(uuid)'::regprocedure)
--             LIKE '%NOT IN (''received'', ''shipped'')%'     AS accepts_shipped,  -- true
--           pg_get_functiondef('public.grant_order_xp(uuid)'::regprocedure)
--             LIKE '%v_order.subtotal - v_order.discount%'    AS formula_intact;   -- true
--
-- 3. Grants — grant_order_xp is service_role only; the admin RPCs are callable
--    by authenticated (they check is_admin() themselves), never by anon:
--    SELECT routine_name, grantee FROM information_schema.routine_privileges
--     WHERE routine_name IN ('grant_order_xp','admin_list_unlinked_orders',
--                            'admin_link_order_to_customer')
--       AND grantee IN ('PUBLIC','anon','authenticated','service_role')
--     ORDER BY 1, 2;
--
-- 4. How many orders are waiting to be linked:
--    SELECT order_status, count(*) FROM public.orders
--     WHERE user_id IS NULL GROUP BY 1 ORDER BY 1;
--
-- 5. After linking from /admin/orders/link — the audit trail and the XP ledger
--    agree (expect 0 rows):
--    SELECT l.order_id FROM public.order_account_links l
--     WHERE l.xp_status = 'granted'
--       AND NOT EXISTS (SELECT 1 FROM public.profile_experience_events e
--                        WHERE e.order_id = l.order_id AND e.user_id = l.user_id);
--
-- 6. Full behavioural suite (BEGIN … ROLLBACK, leaves nothing behind):
--    supabase/tests/20261110000200_admin_link_orders_test.sql
-- ============================================================================
