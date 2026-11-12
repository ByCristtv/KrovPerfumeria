-- ============================================================================
-- 20261111000100_claim_guest_orders_shipped_xp.sql
-- Automatic guest-order claiming awards the same XP as "Ligar Pedidos".
-- ============================================================================
-- THE INCONSISTENCY
--   Two paths attach a guest order (user_id IS NULL) to an account:
--     * admin_link_order_to_customer (20261110000200) — admin, by hand
--     * claim_guest_orders           (20260905000100) — automatic, when the
--       customer confirms the email the order was placed with
--   Both settle XP through grant_order_xp, which since 20261110000200 accepts
--   `received` AND `shipped` orders. But the automatic path reaches it through
--   reconcile_profile_order_xp, which PRE-FILTERS `order_status = 'received'`.
--   A claimed order that was already `shipped` never reached grant_order_xp, so
--   it earned 0 XP — while the very same order linked by an admin earned it.
--
-- ROOT CAUSE
--   A second copy of the eligibility rule (the reconciler's status filter) that
--   did not follow the first (grant_order_xp's guard).
--
-- THE FIX — remove the second copy
--   1. reconcile_profile_order_xp  REPLACED. It no longer filters by status:
--      every order the profile owns that has no XP event is handed to
--      grant_order_xp, which alone decides (received / shipped → XP; pending,
--      denied → 'not_received', nothing written). One rule, one place, so the
--      automatic and admin paths cannot drift apart again.
--   2. claim_guest_orders          RE-DECLARED, body identical to
--      20260905000100 §2. Re-stated so this migration guarantees the claim
--      calls the reconciler even on a database where 20260905000100 was never
--      applied (there, the original 20260525000400 body grants no XP at all).
--   3. backfill_guest_order_xp     REPLACED — same change as (1) in its outer
--      query, so the repair tool covers shipped orders too. NOT run by this
--      migration (see "REPAIRING PAST CLAIMS" below).
--   4. EXECUTE on all three: service_role only, revoked explicitly from anon and
--      authenticated. The earlier migrations only revoked PUBLIC, but Supabase's
--      default privileges grant EXECUTE on new public functions to anon and
--      authenticated directly — so claim_guest_orders(<my id>, '<your email>')
--      may currently be callable by ANY signed-in user. The documented intent
--      was always "service_role only" (20260525000400, 20260905000100 verification
--      queries); this enforces it. The auth trigger is unaffected: it runs as
--      the function owner.
--
-- UNCHANGED
--   grant_order_xp (formula floor((subtotal - discount) / 1000) * 50, statuses,
--   UNIQUE ledger, ON CONFLICT dedup) · trg_orders_grant_xp · the auth.users
--   trigger handle_email_confirmed_claim · email matching (case-insensitive,
--   trimmed, unclaimed orders only, confirmed emails only via the trigger) ·
--   the INT return value of claim_guest_orders · RLS · admin_link_order_to_customer.
--
-- DUPLICATE XP — impossible, for the reason it always was
--   profile_experience_events.order_id is UNIQUE and grant_order_xp inserts
--   ON CONFLICT DO NOTHING under a row lock on the order, bumping the balance
--   only when its own row landed. Retried confirmations, re-runs of the
--   reconciler or the backfill, and a concurrent admin link all converge on
--   one event per order.
--
-- FAILURE ISOLATION (unchanged on purpose)
--   The claim runs inside the auth.users transaction (signup / email
--   confirmation). Its XP step stays in an EXCEPTION block: if any grant fails,
--   the WHOLE XP step rolls back to its savepoint (no half-credited claim, the
--   balance and the ledger stay equal) and the claim itself stands, so a
--   customer can still sign up. The XP owed is then recovered by the next
--   reconcile / backfill — which, after this fix, includes shipped orders.
--
-- Depends on: 20260611000100 (XP ledger), 20261110000200 (grant_order_xp
--             accepting shipped). Fully idempotent. Runs as one transaction.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Pre-flight — the fix is only correct once grant_order_xp accepts shipped
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.profile_experience_events') IS NULL THEN
    RAISE EXCEPTION 'Apply 20260611000100_experience_points.sql first.';
  END IF;
  IF to_regprocedure('public.grant_order_xp(uuid)') IS NULL THEN
    RAISE EXCEPTION 'grant_order_xp(uuid) is missing — apply 20260611000100 first.';
  END IF;
  IF pg_get_functiondef(to_regprocedure('public.grant_order_xp(uuid)'))
       NOT LIKE '%''shipped''%' THEN
    RAISE EXCEPTION 'Apply 20261110000200_admin_link_orders.sql first (grant_order_xp must accept shipped orders).';
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 1. reconcile_profile_order_xp(p_user_id) -> INT (orders newly granted)  [REPLACED]
-- ────────────────────────────────────────────────────────────────────────────
-- Identical to 20260905000100 §1 except the line marked -- CHANGED.
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

  -- A missing profile must degrade to a no-op rather than raise an FK error
  -- inside the auth transaction.
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE WARNING 'reconcile_profile_order_xp: no profile for %, skipping', p_user_id;
    RETURN 0;
  END IF;

  FOR v_order_id IN
    SELECT o.id
      FROM public.orders o
     WHERE o.user_id = p_user_id
       -- CHANGED: no status filter. grant_order_xp is the only judge of which
       -- statuses earn XP (it re-checks under a row lock and answers
       -- 'not_received' for pending / denied without writing anything).
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

REVOKE ALL     ON FUNCTION public.reconcile_profile_order_xp(UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reconcile_profile_order_xp(UUID) TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. claim_guest_orders(p_user_id, p_email) -> INT   [RE-DECLARED, unchanged]
-- ────────────────────────────────────────────────────────────────────────────
-- Byte-for-byte the 20260905000100 §2 behaviour: same signature, same INT
-- (count of orders reassigned), same matching, same isolated XP step.
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

  -- Settle XP for the freshly claimed orders (and any owed on orders this
  -- profile already owns). Runs even when v_count = 0.
  --
  -- Isolated so an XP failure can never abort the claim -- or, since this runs
  -- inside the auth.users transaction, the user's signup / email confirmation.
  -- The block is a savepoint: on failure EVERY grant made in it is undone, so
  -- the ledger and the balance never disagree.
  BEGIN
    PERFORM public.reconcile_profile_order_xp(p_user_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'claim_guest_orders: XP reconciliation failed for % (%): %',
      p_user_id, SQLSTATE, SQLERRM;
  END;

  RETURN v_count;
END;
$$;

REVOKE ALL     ON FUNCTION public.claim_guest_orders(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_guest_orders(UUID, TEXT) TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. backfill_guest_order_xp() -> TABLE(user_id, orders_granted)  [REPLACED]
-- ────────────────────────────────────────────────────────────────────────────
-- Identical to 20260905000100 §3 except the line marked -- CHANGED.
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
       -- CHANGED: was `AND o.order_status = 'received'`. Any owned order with
       -- no XP event is a candidate; grant_order_xp (via the reconciler)
       -- decides per order, so shipped orders are repaired too.
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

REVOKE ALL     ON FUNCTION public.backfill_guest_order_xp() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.backfill_guest_order_xp() TO service_role;

COMMIT;


-- ============================================================================
-- VERIFICATION QUERIES — run after the migration (Studio SQL editor)
-- ============================================================================
-- 1. The reconciler no longer filters by status, claim still calls it:
--    SELECT pg_get_functiondef('public.reconcile_profile_order_xp(uuid)'::regprocedure)
--             NOT LIKE '%order_status = ''received''%'   AS reconciler_fixed,     -- true
--           pg_get_functiondef('public.claim_guest_orders(uuid,text)'::regprocedure)
--             LIKE '%reconcile_profile_order_xp%'        AS claim_reconciles;     -- true
--
-- 2. Signatures and return types are unchanged:
--    SELECT proname, pg_get_function_arguments(oid) AS args, pg_get_function_result(oid) AS returns
--      FROM pg_proc
--     WHERE proname IN ('claim_guest_orders','reconcile_profile_order_xp','backfill_guest_order_xp')
--     ORDER BY proname;
--    -> backfill_guest_order_xp()                        TABLE(user_id uuid, orders_granted integer)
--    -> claim_guest_orders(p_user_id uuid, p_email text) integer
--    -> reconcile_profile_order_xp(p_user_id uuid)       integer
--
-- 3. API roles can no longer call them (all false):
--    SELECT f, has_function_privilege('authenticated', f, 'EXECUTE') AS authenticated,
--              has_function_privilege('anon', f, 'EXECUTE')          AS anon
--      FROM unnest(ARRAY['public.claim_guest_orders(uuid,text)',
--                        'public.reconcile_profile_order_xp(uuid)',
--                        'public.backfill_guest_order_xp()']) AS f;
--
-- 4. The auth trigger is still attached (this migration does not touch it):
--    SELECT tgname FROM pg_trigger
--     WHERE tgrelid = 'auth.users'::regclass AND tgname = 'on_auth_user_email_confirmed_claim';
--
-- 5. Behavioural suite (BEGIN … ROLLBACK, leaves nothing behind):
--    supabase/tests/20261111000100_claim_guest_orders_shipped_xp_test.sql
--
-- ── REPAIRING PAST CLAIMS (optional — a business decision, not run above) ──
-- Customers who confirmed their email BEFORE this fix kept their claimed
-- shipped orders without XP. 6a previews exactly who would be credited and how
-- much (read-only); 6b pays it. 6b credits EVERY owned received/shipped order
-- that has no XP event — that also includes any order that was shipped before
-- the XP system existed (June 2026). Review 6a before running 6b.
--
-- 6a. Preview (read-only):
--    SELECT o.user_id, p.full_name, o.order_number, o.order_status, o.created_at,
--           (FLOOR(GREATEST(o.subtotal - o.discount, 0) / 1000))::INT * 50 AS xp_owed,
--           (o.created_at < u.created_at) AS ordered_before_signup   -- true = a claimed guest order
--      FROM public.orders o
--      JOIN public.profiles p ON p.id = o.user_id
--      JOIN auth.users u      ON u.id = o.user_id
--     WHERE o.order_status IN ('received', 'shipped')
--       AND NOT EXISTS (SELECT 1 FROM public.profile_experience_events e WHERE e.order_id = o.id)
--     ORDER BY o.user_id, o.created_at;
--
-- 6b. Pay it (service_role / SQL editor), then re-run to prove idempotency:
--    SELECT * FROM public.backfill_guest_order_xp();   -- rows = profiles credited
--    SELECT * FROM public.backfill_guest_order_xp();   -- -> 0 rows, always
--
-- 7. Invariant after 6b — no received/shipped owned order owes XP (expect 0):
--    SELECT count(*) FROM public.orders o
--     WHERE o.user_id IS NOT NULL AND o.order_status IN ('received', 'shipped')
--       AND NOT EXISTS (SELECT 1 FROM public.profile_experience_events e WHERE e.order_id = o.id);
-- ============================================================================
