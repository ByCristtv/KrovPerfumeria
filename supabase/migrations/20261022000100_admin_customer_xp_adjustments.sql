-- ============================================================================
-- 20261022000100_admin_customer_xp_adjustments.sql
-- Admin "Clientes" panel: manual XP adjustments (add / deduct) with an audit
-- ledger.
--
-- DESIGN
--   * profiles.experience_points stays THE running balance (20260611000100).
--     Ranks, the public /ranking (get_ranking_top) and level coupons all read
--     it, so adjusting the balance keeps every consumer consistent without any
--     change to them.
--
--   * Adjustments get their OWN ledger, profile_xp_adjustments, instead of
--     rows in profile_experience_events. That table is the per-ORDER award log:
--     order_id is NOT NULL + UNIQUE (the double-grant guard) and xp_earned is
--     CHECK >= 0. Loosening either to fit manual deltas would weaken the guard
--     grant_order_xp / reconcile_profile_order_xp rely on. Two ledgers, one
--     balance:
--         experience_points = SUM(events.xp_earned) + SUM(adjustments.delta)
--
--   * admin_adjust_customer_xp() is the ONLY write path:
--       - SECURITY DEFINER, but refuses unless is_admin() — calling it as a
--         customer (or anon) raises, so the Next server action is not the gate.
--       - Atomic: the profile row is locked (FOR UPDATE) for the read-check-
--         write, so a concurrent order award or a second adjustment serializes
--         behind it and a deduction can never race the balance below zero. The
--         CHECK (experience_points >= 0) on profiles is the structural backstop.
--       - Balance update + ledger insert happen in the same transaction.
--
--   * Level coupons: an INCREASE fires trg_profiles_grant_level_coupons
--     (20261005000100) exactly like an order award does, so a manual bump that
--     crosses a level unlocks its coupon. A DEDUCTION does not revoke coupons
--     already unlocked — same as every other XP path today.
--
--   * Limits (mirrored in lib/customers/xpAdjustment.ts — keep in lock-step):
--       |delta|  1 .. 100,000 per adjustment
--       reason   optional, trimmed, ≤ 300 chars
--
-- Depends on: profiles.experience_points (20260611000100), is_admin().
-- Fully idempotent. Safe to re-run in Supabase Studio.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. Ledger — one immutable row per manual adjustment
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profile_xp_adjustments (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  delta           INTEGER     NOT NULL
                    CHECK (delta <> 0 AND delta BETWEEN -100000 AND 100000),
  balance_before  INTEGER     NOT NULL CHECK (balance_before >= 0),
  balance_after   INTEGER     NOT NULL CHECK (balance_after >= 0),
  reason          TEXT        CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 300),
  -- SET NULL: removing an admin account must not erase the audit trail.
  created_by      UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT profile_xp_adjustments_balance_math
    CHECK (balance_after = balance_before + delta)
);

CREATE INDEX IF NOT EXISTS idx_profile_xp_adjustments_user
  ON public.profile_xp_adjustments (user_id, created_at DESC);


-- ────────────────────────────────────────────────────────────────────────────
-- 2. RLS — admins read; nobody writes directly
--    The reason is an internal note, so customers do NOT get a SELECT policy.
--    Inserts happen only inside the SECURITY DEFINER function below. The
--    absence of INSERT/UPDATE/DELETE policies is intentional.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.profile_xp_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view XP adjustments" ON public.profile_xp_adjustments;
CREATE POLICY "Admins can view XP adjustments"
  ON public.profile_xp_adjustments
  FOR SELECT
  USING (public.is_admin());

REVOKE ALL ON public.profile_xp_adjustments FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.profile_xp_adjustments FROM authenticated;
GRANT  SELECT ON public.profile_xp_adjustments TO authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. admin_adjust_customer_xp(user_id, delta, reason) -> JSONB
-- ────────────────────────────────────────────────────────────────────────────
-- Error messages are matched by app/admin/clientes/actions.ts — change both
-- together.
CREATE OR REPLACE FUNCTION public.admin_adjust_customer_xp(
  p_user_id UUID,
  p_delta   INTEGER,
  p_reason  TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_reason   TEXT := NULLIF(BTRIM(p_reason), '');
  v_before   INTEGER;
  v_after    BIGINT;
  v_id       UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Insufficient privilege: admin only.';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Customer not found.';
  END IF;

  IF p_user_id = v_admin_id THEN
    RAISE EXCEPTION 'Admins cannot adjust their own XP.';
  END IF;

  IF p_delta IS NULL OR p_delta = 0 OR p_delta NOT BETWEEN -100000 AND 100000 THEN
    RAISE EXCEPTION 'Invalid XP amount.';
  END IF;

  IF v_reason IS NOT NULL AND char_length(v_reason) > 300 THEN
    RAISE EXCEPTION 'Reason too long.';
  END IF;

  -- Row lock: serializes with grant_order_xp and with any other adjustment,
  -- so the negative-balance check below cannot be raced.
  SELECT experience_points
    INTO v_before
    FROM public.profiles
   WHERE id = p_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer not found.';
  END IF;

  v_after := v_before::BIGINT + p_delta;

  IF v_after < 0 THEN
    RAISE EXCEPTION 'XP balance cannot go negative (current: %).', v_before;
  END IF;
  IF v_after > 2147483647 THEN
    RAISE EXCEPTION 'Invalid XP amount.';
  END IF;

  -- Increases fire trg_profiles_grant_level_coupons (level-coupon unlock).
  UPDATE public.profiles
     SET experience_points = v_after::INTEGER
   WHERE id = p_user_id;

  INSERT INTO public.profile_xp_adjustments
         (user_id, delta, balance_before, balance_after, reason, created_by)
  VALUES (p_user_id, p_delta, v_before, v_after::INTEGER, v_reason, v_admin_id)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'adjustment_id',  v_id,
    'user_id',        p_user_id,
    'delta',          p_delta,
    'balance_before', v_before,
    'balance_after',  v_after::INTEGER
  );
END;
$$;

-- Callable by signed-in users only; the is_admin() check inside is the gate.
REVOKE EXECUTE ON FUNCTION public.admin_adjust_customer_xp(UUID, INTEGER, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_adjust_customer_xp(UUID, INTEGER, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_adjust_customer_xp(UUID, INTEGER, TEXT) TO authenticated;


-- ============================================================================
-- VERIFICATION QUERIES — run after the migration
-- ============================================================================
-- 1. Objects exist:
--    SELECT to_regclass('public.profile_xp_adjustments');                 -- not null
--    SELECT proname, prosecdef FROM pg_proc
--     WHERE proname = 'admin_adjust_customer_xp';                         -- prosecdef = true
--
-- 2. Grants (expect authenticated + postgres/service_role, NOT anon):
--    SELECT grantee, privilege_type FROM information_schema.routine_privileges
--     WHERE routine_name = 'admin_adjust_customer_xp';
--
-- 3. Non-admin is refused (run in Studio's SQL editor, "authenticated" role,
--    impersonating a customer):
--    SELECT public.admin_adjust_customer_xp('<customer-uuid>'::uuid, 100, 'test');
--    -- → ERROR: Insufficient privilege: admin only.
--
-- 4. Balance reconciles across both ledgers (expect 0 rows):
--    SELECT p.id, p.experience_points,
--           COALESCE(e.xp, 0) + COALESCE(a.xp, 0) AS ledger_xp
--      FROM public.profiles p
--      LEFT JOIN (SELECT user_id, SUM(xp_earned) xp
--                   FROM public.profile_experience_events GROUP BY user_id) e
--             ON e.user_id = p.id
--      LEFT JOIN (SELECT user_id, SUM(delta) xp
--                   FROM public.profile_xp_adjustments GROUP BY user_id) a
--             ON a.user_id = p.id
--     WHERE p.experience_points <> COALESCE(e.xp, 0) + COALESCE(a.xp, 0);
--    (Profiles whose XP predates the ledgers, or was edited in Studio, show up
--     here too — that is pre-existing drift, not caused by this migration.)
-- ============================================================================
