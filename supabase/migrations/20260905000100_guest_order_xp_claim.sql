-- ============================================================================
-- 20260905000100_guest_order_xp_claim.sql
-- Retroactive XP for guest purchases that are claimed at registration.
-- ============================================================================
-- THE GAP THIS CLOSES
--   XP is awarded by `trg_orders_grant_xp`, which fires on the transition INTO
--   `order_status = 'received'`. `grant_order_xp` then SKIPS the order when
--   `orders.user_id IS NULL` (reason: 'guest_order') -- there is no profile to
--   credit yet.
--
--   `claim_guest_orders` (20260525000400) later reassigns those orders to the
--   registering user, but nothing re-runs the award: the status transition
--   already happened, so the trigger never fires again. The customer sees the
--   order in their history with 0 XP, forever.
--
--   This migration makes claiming ALSO settle the XP debt.
--
-- DESIGN
--   * `reconcile_profile_order_xp(user_id)` is the ONE place that answers
--     "which XP has this profile earned but not been granted?". It walks the
--     profile's `received` orders that have no `profile_experience_events` row
--     and delegates each to the existing `grant_order_xp` -- the formula and
--     the balance update stay in exactly one function (no duplicated XP math).
--   * `claim_guest_orders` keeps its EXACT signature and INT return (count of
--     claimed orders), so the auth trigger and any support tooling that calls
--     it are unaffected. It just calls the reconciler after the UPDATE.
--   * `backfill_guest_order_xp()` repairs history: profiles that claimed guest
--     orders BEFORE this migration existed. Service-role only.
--
-- IDEMPOTENCY (no double XP, ever)
--   1. `profile_experience_events.order_id` is UNIQUE and `grant_order_xp`
--      inserts with ON CONFLICT DO NOTHING -- the balance is only bumped by the
--      call that actually inserted the row. This is the real guard.
--   2. The reconciler pre-filters on NOT EXISTS purely to avoid useless work.
--   3. `claim_guest_orders` only ever touches rows `WHERE user_id IS NULL`, so
--      an order cannot be claimed twice.
--
-- SECURITY
--   * No new trust is granted. XP follows ownership, and ownership is still
--     established only by `handle_email_confirmed_claim`, which requires
--     `email_confirmed_at IS NOT NULL` -- i.e. proof the registrant controls
--     the inbox. Signing up with a victim's address grants nothing until (and
--     unless) that address is confirmed.
--   * The reconciler reads ONLY orders already owned by `p_user_id`. It cannot
--     be steered by an email argument, so it cannot be used to mine another
--     account's orders even if it were ever exposed.
--   * EXECUTE is revoked from PUBLIC on every function here.
--
-- FAILURE ISOLATION
--   These functions run inside the `auth.users` INSERT/UPDATE transaction. An
--   unhandled exception there would abort the signup or the email confirmation.
--   The XP step is therefore wrapped in an EXCEPTION block: a failure logs a
--   WARNING and leaves the claim standing. Nothing is lost -- running
--   `backfill_guest_order_xp()` re-settles it later.
-- ============================================================================
-- Depends on: 20260525000400 (claim_guest_orders) + 20260611000100 (XP).
-- Fully idempotent. Safe to re-run.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. reconcile_profile_order_xp(p_user_id) -> INT (orders newly granted)
-- ----------------------------------------------------------------------------
-- Grants any XP this profile has earned but never received. Safe to call at
-- any time, from anywhere, as often as you like.

CREATE OR REPLACE FUNCTION public.reconcile_profile_order_xp(
  p_user_id UUID
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID;
  v_result   JSONB;
  v_granted  INT := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 0;
  END IF;

  -- `profile_experience_events.user_id` FKs to `profiles`. During signup the
  -- profile is created by `on_auth_user_created`, which sorts BEFORE
  -- `on_auth_user_email_confirmed_claim` and therefore always ran first -- but
  -- a missing profile must degrade to a no-op rather than raise an FK error
  -- inside the auth transaction.
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE WARNING 'reconcile_profile_order_xp: no profile for %, skipping', p_user_id;
    RETURN 0;
  END IF;

  FOR v_order_id IN
    SELECT o.id
      FROM public.orders o
     WHERE o.user_id = p_user_id
       AND o.order_status = 'received'
       -- Pre-filter only. The UNIQUE(order_id) + ON CONFLICT inside
       -- grant_order_xp is what actually makes double-granting impossible.
       AND NOT EXISTS (
             SELECT 1
               FROM public.profile_experience_events e
              WHERE e.order_id = o.id
           )
     ORDER BY o.created_at
  LOOP
    v_result := public.grant_order_xp(v_order_id);
    IF COALESCE((v_result ->> 'granted')::BOOLEAN, false) THEN
      v_granted := v_granted + 1;
    END IF;
  END LOOP;

  RETURN v_granted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reconcile_profile_order_xp(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.reconcile_profile_order_xp(UUID) TO service_role;


-- ----------------------------------------------------------------------------
-- 2. claim_guest_orders(p_user_id, p_email) -> INT   [REPLACED]
-- ----------------------------------------------------------------------------
-- Same signature, same return value (count of orders reassigned) as
-- 20260525000400 -- callers are unchanged. New behaviour: after reassigning the
-- orders it settles the XP those orders earned while the buyer was a guest.
--
-- The XP step is deliberately NOT part of the return value: the auth trigger
-- ignores it, and widening the return type would break the existing contract.
-- Call `reconcile_profile_order_xp` directly when the count matters.

CREATE OR REPLACE FUNCTION public.claim_guest_orders(
  p_user_id UUID,
  p_email   TEXT
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT;
BEGIN
  -- Defensive: missing inputs -> no-op
  IF p_user_id IS NULL OR p_email IS NULL OR TRIM(p_email) = '' THEN
    RETURN 0;
  END IF;

  UPDATE public.orders
     SET user_id = p_user_id
   WHERE user_id IS NULL
     AND LOWER(customer_email) = LOWER(TRIM(p_email));

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Settle retroactive XP for the freshly claimed orders. Runs even when
  -- v_count = 0: a previous partial claim (or a manual reassignment in Studio)
  -- can leave XP owed on orders that are already owned by this profile.
  --
  -- Isolated so an XP failure can never abort the claim -- or, since this runs
  -- inside the auth.users transaction, the user's signup / email confirmation.
  BEGIN
    PERFORM public.reconcile_profile_order_xp(p_user_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'claim_guest_orders: XP reconciliation failed for % (%): %',
      p_user_id, SQLSTATE, SQLERRM;
  END;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_guest_orders(UUID, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.claim_guest_orders(UUID, TEXT) TO service_role;


-- ----------------------------------------------------------------------------
-- 3. backfill_guest_order_xp() -> TABLE(user_id, orders_granted)
-- ----------------------------------------------------------------------------
-- One-shot repair for history: profiles whose guest orders were claimed by the
-- OLD `claim_guest_orders` (which granted no XP). Also covers any order that
-- reached `received` while the XP trigger was absent.
--
-- Returns one row per profile that actually gained XP -- an empty result means
-- the ledger is already consistent. Re-running it is a no-op.

CREATE OR REPLACE FUNCTION public.backfill_guest_order_xp()
RETURNS TABLE (user_id UUID, orders_granted INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_granted INT;
BEGIN
  FOR v_user_id IN
    SELECT DISTINCT o.user_id
      FROM public.orders o
     WHERE o.user_id IS NOT NULL
       AND o.order_status = 'received'
       AND NOT EXISTS (
             SELECT 1
               FROM public.profile_experience_events e
              WHERE e.order_id = o.id
           )
  LOOP
    v_granted := public.reconcile_profile_order_xp(v_user_id);
    IF v_granted > 0 THEN
      user_id        := v_user_id;
      orders_granted := v_granted;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.backfill_guest_order_xp() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.backfill_guest_order_xp() TO service_role;


-- ============================================================================
-- VERIFICATION QUERIES -- run after the migration
-- ============================================================================
-- 1. All three functions exist with the expected signatures:
--    SELECT proname, pg_get_function_arguments(oid) AS args,
--           pg_get_function_result(oid)             AS returns
--      FROM pg_proc
--     WHERE proname IN ('claim_guest_orders',
--                       'reconcile_profile_order_xp',
--                       'backfill_guest_order_xp')
--     ORDER BY proname;
--    -> backfill_guest_order_xp()     TABLE(user_id uuid, orders_granted integer)
--    -> claim_guest_orders(p_user_id uuid, p_email text)   integer   [unchanged]
--    -> reconcile_profile_order_xp(p_user_id uuid)         integer
--
-- 2. claim_guest_orders now reconciles XP (proves the new body is live):
--    SELECT pg_get_functiondef('public.claim_guest_orders(uuid,text)'::regprocedure)
--             LIKE '%reconcile_profile_order_xp%' AS is_upgraded;   -- -> true
--
-- 3. The auth trigger is still attached (this migration does not touch it):
--    SELECT tgname FROM pg_trigger
--     WHERE tgrelid = 'auth.users'::regclass AND tgname LIKE '%claim%';
--    -> on_auth_user_email_confirmed_claim
--
-- 4. Nothing is callable by anon/authenticated:
--    SELECT routine_name, grantee, privilege_type
--      FROM information_schema.routine_privileges
--     WHERE routine_name IN ('claim_guest_orders',
--                            'reconcile_profile_order_xp',
--                            'backfill_guest_order_xp');
--    -> service_role (and the owner) only -- never anon / authenticated.
--
-- 5. Safe no-op smoke test (no such profile -> 0, no error):
--    SELECT public.reconcile_profile_order_xp(gen_random_uuid());   -- -> 0
--
-- 6. REPAIR HISTORY -- run once, then re-run to prove idempotency:
--    SELECT * FROM public.backfill_guest_order_xp();   -- rows = profiles repaired
--    SELECT * FROM public.backfill_guest_order_xp();   -- -> 0 rows, always
--
-- 7. Ledger consistency invariant -- must return 0 after step 6:
--    SELECT count(*) AS orders_owed_xp
--      FROM public.orders o
--     WHERE o.user_id IS NOT NULL
--       AND o.order_status = 'received'
--       AND NOT EXISTS (SELECT 1 FROM public.profile_experience_events e
--                        WHERE e.order_id = o.id);
--
-- 8. Balance invariant -- the running total must equal the event log:
--    SELECT p.id, p.experience_points,
--           COALESCE(SUM(e.xp_earned), 0) AS from_events
--      FROM public.profiles p
--      LEFT JOIN public.profile_experience_events e ON e.user_id = p.id
--     GROUP BY p.id, p.experience_points
--    HAVING p.experience_points <> COALESCE(SUM(e.xp_earned), 0);
--    -> 0 rows
--
-- 9. END-TO-END (manual QA -- full script in docs/qa/guest-xp-claim.md):
--    -- a. Guest order, already delivered, worth 5 x 50 = 250 XP:
--    -- INSERT INTO public.orders (
--    --   user_id, customer_name, customer_email, customer_phone,
--    --   shipping_address, shipping_canton, shipping_province,
--    --   subtotal, total, source, order_status
--    -- ) VALUES (
--    --   NULL, 'Guest XP Test', 'guest-xp-test@example.com', '00000000',
--    --   '100m sur', 'San Jose', 'San Jose', 5000, 5000, 'web', 'received'
--    -- );
--    -- b. Register that email in the app and CONFIRM it.
--    -- c. SELECT o.user_id, e.xp_earned, p.experience_points
--    --      FROM public.orders o
--    --      JOIN public.profile_experience_events e ON e.order_id = o.id
--    --      JOIN public.profiles p ON p.id = o.user_id
--    --     WHERE o.customer_email = 'guest-xp-test@example.com';
--    --    -> user_id set, xp_earned = 250, balance includes it
--    -- d. Idempotency: SELECT public.reconcile_profile_order_xp('<user-id>'); -> 0
--    -- e. Cleanup: see docs/qa/guest-xp-claim.md (deleting the order cascades
--    --    the XP event, so the profile balance must be corrected by hand).
-- ============================================================================
