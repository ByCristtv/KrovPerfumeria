-- ============================================================================
-- 20261109000200_loyalty_admin_configuration.sql
-- Loyalty rewards, part 2 of 2: administrators configure tier XP thresholds and
-- coupon rewards from /admin/rewards.
--
-- SOURCE OF TRUTH
--   public.levels.required_xp is THE threshold of each rank. The app no longer
--   carries a copy (lib/rank.ts reads the ladder from this table), and the
--   issuance functions read it too, so there is exactly one number per rank.
--   public.coupons is THE reward-definition table (several per level allowed
--   since part 1); public.user_coupons holds issued, immutable snapshots.
--
-- WHAT THIS MIGRATION DOES
--   1. loyalty_audit_log — append-only record of every admin change made
--      through the functions below (who, when, before, after).
--   2. levels: updated_by column, an upper bound on required_xp, and a
--      DEFERRED constraint trigger that rejects — at COMMIT, whatever path
--      wrote it (RPC, Studio, a future migration) — any ladder that is not
--      "lowest level = 0, strictly increasing by level_number".
--   3. coupons: created_by / updated_by, whole-colón fixed discounts, an upper
--      bound on amounts and on validity days.
--   4. Direct writes to levels/coupons are revoked from API roles; the
--      SECURITY DEFINER functions below are the only write path, and each one
--      checks is_admin() itself (the server action is not the gate).
--        admin_update_level_thresholds(jsonb, timestamptz)   atomic ladder save
--        admin_create_coupon_reward(...)                     new definition
--        admin_update_coupon_reward(...)                     edit a definition
--        admin_set_coupon_reward_active(uuid, boolean)       activate / retire
--        admin_delete_coupon_reward(uuid)                    only if never issued
--        admin_issue_coupon_reward_retroactively(uuid, bool) explicit back-issue
--
-- BEHAVIOUR (documented for the admin UI too)
--   * Editing a definition changes FUTURE issues only; issued coupons keep the
--     terms snapshotted in part 1. The level and the discount TYPE of a
--     definition are fixed once created (create a new reward instead).
--   * Deactivating stops future issuance; issued copies stay spendable.
--   * Lowering a threshold makes customers who already have that XP reach the
--     level now: they get an unlock row and the level's ACTIVE rewards, in the
--     same transaction as the save. Raising one never revokes anything.
--   * A NEW definition is not issued to customers who already reached its
--     level, unless an admin runs the retroactive operation for it.
--
-- Limits (mirrored in lib/loyalty/*.ts — change both together):
--   required_xp           0 .. 10,000,000, lowest level fixed at 0
--   name                  1 .. 80 chars          description ≤ 300 chars
--   percentage            > 0 .. 100, ≤ 2 decimals
--   fixed amount          1 .. 10,000,000 CRC, whole colones
--   min_order_subtotal    0 .. 10,000,000 CRC, whole colones
--   max_discount_amount   NULL or 1 .. 10,000,000 CRC, percentage only
--   valid_days            NULL or 1 .. 3,650
--
-- Error contract: RAISE EXCEPTION '<code>[:detail]'. Parsed ONLY by
-- lib/loyalty/errors.ts — change both together.
--
-- Depends on: 20261109000100 (part 1), 20261005000100, is_admin(), profiles.
-- Idempotent: safe to re-run in Supabase Studio. Runs as one transaction.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Pre-flight
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.profile_level_unlocks') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'user_coupons'
                       AND column_name = 'discount_type') THEN
    RAISE EXCEPTION 'Apply 20261109000100_loyalty_reward_issuance.sql first.';
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 1. loyalty_audit_log
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.loyalty_audit_log (
  id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- SET NULL: removing an admin account must not erase the trail.
  actor_id   UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  action     TEXT        NOT NULL CHECK (action IN (
                           'levels.update', 'reward.create', 'reward.update',
                           'reward.activate', 'reward.deactivate', 'reward.delete',
                           'reward.issue_retroactive')),
  target_id  TEXT,
  before     JSONB,
  after      JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loyalty_audit_log_created
  ON public.loyalty_audit_log (created_at DESC);

ALTER TABLE public.loyalty_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Loyalty audit: admins read" ON public.loyalty_audit_log;
CREATE POLICY "Loyalty audit: admins read"
  ON public.loyalty_audit_log FOR SELECT
  USING (public.is_admin());

REVOKE ALL ON public.loyalty_audit_log FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.loyalty_audit_log FROM authenticated;
GRANT  SELECT ON public.loyalty_audit_log TO authenticated;
GRANT  ALL    ON public.loyalty_audit_log TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. levels — audit column, bounds, and the ladder invariant
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.levels
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

DO $$
BEGIN
  -- NOT VALID: enforced for every new write, without re-checking history.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'levels_required_xp_max'
                    AND conrelid = 'public.levels'::regclass) THEN
    ALTER TABLE public.levels
      ADD CONSTRAINT levels_required_xp_max CHECK (required_xp <= 10000000) NOT VALID;
  END IF;
END $$;

-- The whole-ladder rule cannot be a CHECK (it spans rows), so it is a
-- constraint trigger, DEFERRED to commit: a save that moves several thresholds
-- is judged on the final ladder, not on an intermediate row.
--   * the lowest level requires 0 XP (every customer starts somewhere), and
--   * required_xp strictly increases with level_number (no ties, no inversions).
CREATE OR REPLACE FUNCTION public.tg_levels_enforce_ladder()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_bad INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM public.levels)
     AND (SELECT required_xp FROM public.levels ORDER BY level_number LIMIT 1) <> 0 THEN
    RAISE EXCEPTION 'levels_base_not_zero';
  END IF;

  SELECT level_number INTO v_bad
    FROM (SELECT level_number, required_xp,
                 lag(required_xp) OVER (ORDER BY level_number) AS prev_xp
            FROM public.levels) s
   WHERE prev_xp IS NOT NULL AND required_xp <= prev_xp
   ORDER BY level_number
   LIMIT 1;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'levels_not_increasing:%', v_bad;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_levels_enforce_ladder() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_levels_enforce_ladder ON public.levels;
CREATE CONSTRAINT TRIGGER trg_levels_enforce_ladder
  AFTER INSERT OR UPDATE OR DELETE ON public.levels
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.tg_levels_enforce_ladder();


-- ────────────────────────────────────────────────────────────────────────────
-- 3. coupons — audit columns and bounds
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'coupons_fixed_whole_colones'
                    AND conrelid = 'public.coupons'::regclass) THEN
    ALTER TABLE public.coupons
      ADD CONSTRAINT coupons_fixed_whole_colones
      CHECK (discount_type <> 'fixed' OR discount_value = trunc(discount_value)) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'coupons_amounts_bounded'
                    AND conrelid = 'public.coupons'::regclass) THEN
    ALTER TABLE public.coupons
      ADD CONSTRAINT coupons_amounts_bounded CHECK (
            discount_value <= 10000000
        AND min_order_subtotal <= 10000000
        AND (max_discount_amount IS NULL OR max_discount_amount <= 10000000)
        AND (valid_days IS NULL OR valid_days <= 3650)
      ) NOT VALID;
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. Write path lockdown — reads stay as they were
-- ────────────────────────────────────────────────────────────────────────────
-- 20261005000100 let admins INSERT/UPDATE/DELETE both tables straight through
-- PostgREST. Every admin write now goes through the validated, audited
-- functions below; the public read policies are untouched.
DROP POLICY IF EXISTS "Admins can manage levels"  ON public.levels;
DROP POLICY IF EXISTS "Admins can manage coupons" ON public.coupons;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.levels, public.coupons FROM anon, authenticated;
GRANT  SELECT ON public.levels, public.coupons TO anon, authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. Shared validation for coupon terms (internal)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.loyalty_assert_reward_terms(
  p_name                TEXT,
  p_description         TEXT,
  p_discount_type       TEXT,
  p_discount_value      NUMERIC,
  p_min_order_subtotal  NUMERIC,
  p_max_discount_amount NUMERIC,
  p_valid_days          INTEGER
) RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'reward_invalid_name';
  END IF;
  IF p_description IS NOT NULL AND char_length(btrim(p_description)) > 300 THEN
    RAISE EXCEPTION 'reward_invalid_description';
  END IF;
  IF p_discount_type IS NULL OR p_discount_type NOT IN ('percentage', 'fixed') THEN
    RAISE EXCEPTION 'reward_invalid_type';
  END IF;

  IF p_discount_value IS NULL OR p_discount_value <= 0 THEN
    RAISE EXCEPTION 'reward_invalid_value';
  END IF;
  IF p_discount_type = 'percentage'
     AND (p_discount_value > 100 OR p_discount_value <> round(p_discount_value, 2)) THEN
    RAISE EXCEPTION 'reward_invalid_value';
  END IF;
  IF p_discount_type = 'fixed'
     AND (p_discount_value > 10000000 OR p_discount_value <> trunc(p_discount_value)) THEN
    RAISE EXCEPTION 'reward_invalid_value';
  END IF;

  IF p_min_order_subtotal IS NULL
     OR p_min_order_subtotal < 0
     OR p_min_order_subtotal > 10000000
     OR p_min_order_subtotal <> trunc(p_min_order_subtotal) THEN
    RAISE EXCEPTION 'reward_invalid_min_subtotal';
  END IF;

  IF p_max_discount_amount IS NOT NULL THEN
    IF p_discount_type <> 'percentage'
       OR p_max_discount_amount < 1
       OR p_max_discount_amount > 10000000
       OR p_max_discount_amount <> trunc(p_max_discount_amount) THEN
      RAISE EXCEPTION 'reward_invalid_max_discount';
    END IF;
  END IF;

  IF p_valid_days IS NOT NULL AND p_valid_days NOT BETWEEN 1 AND 3650 THEN
    RAISE EXCEPTION 'reward_invalid_valid_days';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.loyalty_assert_reward_terms(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.loyalty_assert_reward_terms(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, INTEGER) FROM anon, authenticated;


-- Every row of a definition, as JSON, for the audit log.
CREATE OR REPLACE FUNCTION public.loyalty_reward_json(p_coupon_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
           'id', id, 'code', code, 'name', name, 'description', description,
           'discount_type', discount_type, 'discount_value', discount_value,
           'max_discount_amount', max_discount_amount,
           'min_order_subtotal', min_order_subtotal,
           'level_required', level_required, 'valid_days', valid_days,
           'is_active', is_active)
    FROM public.coupons WHERE id = p_coupon_id;
$$;

REVOKE EXECUTE ON FUNCTION public.loyalty_reward_json(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.loyalty_reward_json(UUID) FROM anon, authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 6. admin_update_level_thresholds — the atomic ladder save
-- ────────────────────────────────────────────────────────────────────────────
-- p_thresholds: [{"level_number": 1, "required_xp": 0}, …] — EVERY level,
--   exactly once. Partial saves are refused so the ladder is always judged as
--   a whole.
-- p_expected_updated_at: max(levels.updated_at) the admin's form was loaded
--   with. If another admin saved since, the save is refused ('levels_stale')
--   instead of silently overwriting their change. NULL skips the check.
--
-- All-or-nothing: any failure raises, and the whole call rolls back.
CREATE OR REPLACE FUNCTION public.admin_update_level_thresholds(
  p_thresholds          JSONB,
  p_expected_updated_at TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_elem     JSONB;
  v_levels   INTEGER[] := '{}';
  v_xps      INTEGER[] := '{}';
  v_count    INTEGER;
  v_prev_xp  INTEGER;
  v_before   JSONB;
  v_after    JSONB;
  v_changed  INTEGER := 0;
  v_sync     JSONB := jsonb_build_object('levels_unlocked', 0, 'customers_reached', 0, 'coupons_issued', 0);
  r          RECORD;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'loyalty_forbidden';
  END IF;

  IF p_thresholds IS NULL OR jsonb_typeof(p_thresholds) <> 'array' THEN
    RAISE EXCEPTION 'levels_invalid_payload';
  END IF;

  -- Serialize admin saves. SHARE ROW EXCLUSIVE conflicts with itself and with
  -- writers, but NOT with readers — checkout and XP triggers keep reading.
  LOCK TABLE public.levels IN SHARE ROW EXCLUSIVE MODE;

  IF p_expected_updated_at IS NOT NULL
     AND (SELECT max(updated_at) FROM public.levels) > p_expected_updated_at THEN
    RAISE EXCEPTION 'levels_stale';
  END IF;

  -- Parse + per-element validation.
  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_thresholds) LOOP
    IF jsonb_typeof(v_elem) <> 'object'
       OR jsonb_typeof(v_elem->'level_number') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_elem->'required_xp')  IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'levels_invalid_payload';
    END IF;
    IF (v_elem->>'level_number')::NUMERIC <> trunc((v_elem->>'level_number')::NUMERIC) THEN
      RAISE EXCEPTION 'levels_invalid_payload';
    END IF;
    IF (v_elem->>'required_xp')::NUMERIC <> trunc((v_elem->>'required_xp')::NUMERIC)
       OR (v_elem->>'required_xp')::NUMERIC < 0
       OR (v_elem->>'required_xp')::NUMERIC > 10000000 THEN
      RAISE EXCEPTION 'levels_invalid_value:%', v_elem->>'level_number';
    END IF;
    IF (v_elem->>'level_number')::NUMERIC NOT BETWEEN 1 AND 1000 THEN
      RAISE EXCEPTION 'levels_unknown_level:%', v_elem->>'level_number';
    END IF;
    IF ((v_elem->>'level_number')::INTEGER) = ANY (v_levels) THEN
      RAISE EXCEPTION 'levels_duplicate_level:%', v_elem->>'level_number';
    END IF;
    v_levels := v_levels || (v_elem->>'level_number')::INTEGER;
    v_xps    := v_xps    || (v_elem->>'required_xp')::INTEGER;
  END LOOP;

  -- Every level exactly once: same count, and every number exists.
  SELECT count(*) INTO v_count FROM public.levels;
  IF cardinality(v_levels) <> v_count THEN
    RAISE EXCEPTION 'levels_incomplete';
  END IF;
  FOR r IN SELECT unnest(v_levels) AS level_number LOOP
    IF NOT EXISTS (SELECT 1 FROM public.levels WHERE level_number = r.level_number) THEN
      RAISE EXCEPTION 'levels_unknown_level:%', r.level_number;
    END IF;
  END LOOP;

  -- Whole-ladder rules, on the PROPOSED values in level order.
  v_prev_xp := NULL;
  FOR r IN
    SELECT t.level_number, t.required_xp
      FROM unnest(v_levels, v_xps) AS t(level_number, required_xp)
     ORDER BY t.level_number
  LOOP
    IF v_prev_xp IS NULL THEN
      IF r.required_xp <> 0 THEN
        RAISE EXCEPTION 'levels_base_not_zero';
      END IF;
    ELSIF r.required_xp <= v_prev_xp THEN
      RAISE EXCEPTION 'levels_not_increasing:%', r.level_number;
    END IF;
    v_prev_xp := r.required_xp;
  END LOOP;

  SELECT jsonb_agg(jsonb_build_object('level_number', level_number, 'name', name,
                                      'required_xp', required_xp) ORDER BY level_number)
    INTO v_before FROM public.levels;

  -- Apply. required_xp is UNIQUE and that index is checked row by row, so the
  -- order matters: raise thresholds from the TOP down, then lower them from the
  -- BOTTOM up. With both the old and the new ladder strictly increasing, no
  -- intermediate state can then duplicate a value. (The deferred ladder trigger
  -- re-checks the final result at commit.)
  FOR r IN
    SELECT t.level_number, t.required_xp
      FROM unnest(v_levels, v_xps) AS t(level_number, required_xp)
      JOIN public.levels l USING (level_number)
     WHERE t.required_xp > l.required_xp
     ORDER BY t.level_number DESC
  LOOP
    UPDATE public.levels
       SET required_xp = r.required_xp, updated_by = v_uid
     WHERE level_number = r.level_number;
    v_changed := v_changed + 1;
  END LOOP;

  FOR r IN
    SELECT t.level_number, t.required_xp
      FROM unnest(v_levels, v_xps) AS t(level_number, required_xp)
      JOIN public.levels l USING (level_number)
     WHERE t.required_xp < l.required_xp
     ORDER BY t.level_number ASC
  LOOP
    UPDATE public.levels
       SET required_xp = r.required_xp, updated_by = v_uid
     WHERE level_number = r.level_number;
    v_changed := v_changed + 1;
  END LOOP;

  IF v_changed > 0 THEN
    SELECT jsonb_agg(jsonb_build_object('level_number', level_number, 'name', name,
                                        'required_xp', required_xp) ORDER BY level_number)
      INTO v_after FROM public.levels;

    -- Customers whose XP now reaches a level for the first time unlock it and
    -- receive its active rewards. Raising a threshold unlocks nothing.
    v_sync := public.sync_level_unlocks('threshold_change');

    INSERT INTO public.loyalty_audit_log (actor_id, action, target_id, before, after)
    VALUES (v_uid, 'levels.update', NULL, v_before,
            jsonb_build_object('levels', v_after, 'sync', v_sync));
  END IF;

  RETURN jsonb_build_object(
    'changed_levels',    v_changed,
    'customers_reached', (v_sync->>'customers_reached')::INTEGER,
    'coupons_issued',    (v_sync->>'coupons_issued')::INTEGER,
    'updated_at',        (SELECT max(updated_at) FROM public.levels)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_update_level_thresholds(JSONB, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_update_level_thresholds(JSONB, TIMESTAMPTZ) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_update_level_thresholds(JSONB, TIMESTAMPTZ) TO authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 7. Coupon reward definitions
-- ────────────────────────────────────────────────────────────────────────────
-- 7a. Create. The code is generated ("ALQUIMISTA-15", then "-2", "-3" … on a
--     collision) so admins never have to invent a unique identifier.
CREATE OR REPLACE FUNCTION public.admin_create_coupon_reward(
  p_level_number        INTEGER,
  p_name                TEXT,
  p_description         TEXT,
  p_discount_type       TEXT,
  p_discount_value      NUMERIC,
  p_min_order_subtotal  NUMERIC,
  p_max_discount_amount NUMERIC DEFAULT NULL,
  p_valid_days          INTEGER DEFAULT NULL,
  p_is_active           BOOLEAN DEFAULT TRUE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_level  RECORD;
  v_base   TEXT;
  v_code   TEXT;
  v_n      INTEGER := 1;
  v_id     UUID;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'loyalty_forbidden';
  END IF;

  SELECT level_number, name INTO v_level FROM public.levels WHERE level_number = p_level_number;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reward_invalid_level';
  END IF;

  PERFORM public.loyalty_assert_reward_terms(
    p_name, p_description, p_discount_type, p_discount_value,
    p_min_order_subtotal, p_max_discount_amount, p_valid_days);

  -- "ALQUIMISTA-15", "ALQUIMISTA-7_5", "MAESTRO-5000CRC". Non A–Z/0–9 → '_'.
  v_base := left(regexp_replace(upper(v_level.name), '[^A-Z0-9]+', '_', 'g'), 24)
            || '-'
            || replace(trim_scale(p_discount_value)::TEXT, '.', '_')
            || CASE WHEN p_discount_type = 'fixed' THEN 'CRC' ELSE '' END;
  v_code := v_base;
  WHILE EXISTS (SELECT 1 FROM public.coupons WHERE code = v_code) LOOP
    v_n    := v_n + 1;
    v_code := v_base || '-' || v_n;
  END LOOP;

  INSERT INTO public.coupons
         (code, name, description, discount_type, discount_value,
          max_discount_amount, min_order_subtotal, level_required,
          valid_days, is_active, created_by, updated_by)
  VALUES (v_code, btrim(p_name), NULLIF(btrim(p_description), ''), p_discount_type,
          p_discount_value, p_max_discount_amount, p_min_order_subtotal, p_level_number,
          p_valid_days, COALESCE(p_is_active, TRUE), v_uid, v_uid)
  RETURNING id INTO v_id;

  INSERT INTO public.loyalty_audit_log (actor_id, action, target_id, before, after)
  VALUES (v_uid, 'reward.create', v_id::TEXT, NULL, public.loyalty_reward_json(v_id));

  RETURN public.loyalty_reward_json(v_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_create_coupon_reward(INTEGER, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, INTEGER, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_create_coupon_reward(INTEGER, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, INTEGER, BOOLEAN) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_create_coupon_reward(INTEGER, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, INTEGER, BOOLEAN) TO authenticated;


-- 7b. Edit. Level and discount TYPE are not editable (they define what the
--     reward IS); everything else is, for FUTURE issues only. Optimistic lock
--     on updated_at so two admins cannot silently overwrite each other.
CREATE OR REPLACE FUNCTION public.admin_update_coupon_reward(
  p_coupon_id           UUID,
  p_name                TEXT,
  p_description         TEXT,
  p_discount_value      NUMERIC,
  p_min_order_subtotal  NUMERIC,
  p_max_discount_amount NUMERIC DEFAULT NULL,
  p_valid_days          INTEGER DEFAULT NULL,
  p_expected_updated_at TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_row    public.coupons%ROWTYPE;
  v_before JSONB;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'loyalty_forbidden';
  END IF;

  SELECT * INTO v_row FROM public.coupons WHERE id = p_coupon_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reward_not_found';
  END IF;
  IF p_expected_updated_at IS NOT NULL AND v_row.updated_at > p_expected_updated_at THEN
    RAISE EXCEPTION 'reward_stale';
  END IF;

  PERFORM public.loyalty_assert_reward_terms(
    p_name, p_description, v_row.discount_type, p_discount_value,
    p_min_order_subtotal, p_max_discount_amount, p_valid_days);

  v_before := public.loyalty_reward_json(p_coupon_id);

  UPDATE public.coupons
     SET name                = btrim(p_name),
         description         = NULLIF(btrim(p_description), ''),
         discount_value      = p_discount_value,
         min_order_subtotal  = p_min_order_subtotal,
         max_discount_amount = p_max_discount_amount,
         valid_days          = p_valid_days,
         updated_by          = v_uid
   WHERE id = p_coupon_id;

  INSERT INTO public.loyalty_audit_log (actor_id, action, target_id, before, after)
  VALUES (v_uid, 'reward.update', p_coupon_id::TEXT, v_before, public.loyalty_reward_json(p_coupon_id));

  RETURN public.loyalty_reward_json(p_coupon_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_update_coupon_reward(UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, INTEGER, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_update_coupon_reward(UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, INTEGER, TIMESTAMPTZ) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_update_coupon_reward(UUID, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, INTEGER, TIMESTAMPTZ) TO authenticated;


-- 7c. Activate / deactivate. Deactivating stops future issuance only.
CREATE OR REPLACE FUNCTION public.admin_set_coupon_reward_active(
  p_coupon_id UUID,
  p_is_active BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_before JSONB;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'loyalty_forbidden';
  END IF;
  IF p_is_active IS NULL THEN
    RAISE EXCEPTION 'reward_invalid_request';
  END IF;

  PERFORM 1 FROM public.coupons WHERE id = p_coupon_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reward_not_found';
  END IF;

  v_before := public.loyalty_reward_json(p_coupon_id);

  UPDATE public.coupons
     SET is_active = p_is_active, updated_by = v_uid
   WHERE id = p_coupon_id
     AND is_active IS DISTINCT FROM p_is_active;

  IF FOUND THEN
    INSERT INTO public.loyalty_audit_log (actor_id, action, target_id, before, after)
    VALUES (v_uid, CASE WHEN p_is_active THEN 'reward.activate' ELSE 'reward.deactivate' END,
            p_coupon_id::TEXT, v_before, public.loyalty_reward_json(p_coupon_id));
  END IF;

  RETURN public.loyalty_reward_json(p_coupon_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_set_coupon_reward_active(UUID, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_set_coupon_reward_active(UUID, BOOLEAN) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_set_coupon_reward_active(UUID, BOOLEAN) TO authenticated;


-- 7d. Delete — only a definition that was NEVER issued. Once a customer holds
--     a copy, the definition is part of history: deactivate it instead. (The
--     user_coupons FK is ON DELETE RESTRICT as a structural backstop.)
CREATE OR REPLACE FUNCTION public.admin_delete_coupon_reward(p_coupon_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_before JSONB;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'loyalty_forbidden';
  END IF;

  PERFORM 1 FROM public.coupons WHERE id = p_coupon_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reward_not_found';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_coupons WHERE coupon_id = p_coupon_id) THEN
    RAISE EXCEPTION 'reward_has_issued_coupons';
  END IF;

  v_before := public.loyalty_reward_json(p_coupon_id);
  DELETE FROM public.coupons WHERE id = p_coupon_id;

  INSERT INTO public.loyalty_audit_log (actor_id, action, target_id, before, after)
  VALUES (v_uid, 'reward.delete', p_coupon_id::TEXT, v_before, NULL);

  RETURN jsonb_build_object('deleted', true, 'id', p_coupon_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_delete_coupon_reward(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_delete_coupon_reward(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_delete_coupon_reward(UUID) TO authenticated;


-- 7e. Explicit retroactive issuance of ONE active definition to every customer
--     whose XP currently reaches its level and who does not hold it yet.
--     p_dry_run = TRUE (the default) only counts — the admin UI shows that
--     number in its confirmation before calling again with FALSE.
--     Duplicate-safe: UNIQUE (user_id, coupon_id) + ON CONFLICT DO NOTHING.
CREATE OR REPLACE FUNCTION public.admin_issue_coupon_reward_retroactively(
  p_coupon_id UUID,
  p_dry_run   BOOLEAN DEFAULT TRUE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_coupon   RECORD;
  v_eligible INTEGER;
  v_issued   INTEGER := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'loyalty_forbidden';
  END IF;

  SELECT c.id, c.is_active, c.valid_days, l.required_xp
    INTO v_coupon
    FROM public.coupons c JOIN public.levels l ON l.level_number = c.level_required
   WHERE c.id = p_coupon_id
     FOR SHARE OF c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reward_not_found';
  END IF;
  IF NOT v_coupon.is_active THEN
    RAISE EXCEPTION 'reward_inactive';
  END IF;

  SELECT count(*) INTO v_eligible
    FROM public.profiles p
   WHERE p.experience_points >= v_coupon.required_xp
     AND NOT EXISTS (SELECT 1 FROM public.user_coupons uc
                      WHERE uc.user_id = p.id AND uc.coupon_id = p_coupon_id);

  IF COALESCE(p_dry_run, TRUE) THEN
    RETURN jsonb_build_object('dry_run', true, 'eligible', v_eligible, 'issued', 0);
  END IF;

  INSERT INTO public.user_coupons (user_id, coupon_id, status, expires_at, issue_source)
  SELECT p.id,
         p_coupon_id,
         'unlocked',
         CASE WHEN v_coupon.valid_days IS NULL THEN NULL
              ELSE now() + make_interval(days => v_coupon.valid_days) END,
         'retroactive'
    FROM public.profiles p
   WHERE p.experience_points >= v_coupon.required_xp
  ON CONFLICT (user_id, coupon_id) DO NOTHING;
  GET DIAGNOSTICS v_issued = ROW_COUNT;

  INSERT INTO public.loyalty_audit_log (actor_id, action, target_id, before, after)
  VALUES (v_uid, 'reward.issue_retroactive', p_coupon_id::TEXT, NULL,
          jsonb_build_object('eligible', v_eligible, 'issued', v_issued));

  RETURN jsonb_build_object('dry_run', false, 'eligible', v_eligible, 'issued', v_issued);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_issue_coupon_reward_retroactively(UUID, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_issue_coupon_reward_retroactively(UUID, BOOLEAN) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_issue_coupon_reward_retroactively(UUID, BOOLEAN) TO authenticated;

COMMIT;


-- ============================================================================
-- VERIFICATION QUERIES — run after the migration
-- ============================================================================
-- 1. Ladder unchanged and valid (5 rows, 0 / 1000 / 5000 / 10000 / 18000 on a
--    database nobody has edited yet):
--    SELECT level_number, name, required_xp, updated_at, updated_by
--      FROM public.levels ORDER BY level_number;
--
-- 2. The ladder guard works — this must FAIL with levels_not_increasing:3 and
--    leave the table untouched (Studio rolls the statement back):
--    UPDATE public.levels SET required_xp = 1000 WHERE level_number = 3;
--
-- 3. API roles can no longer write the tables directly (expect 0 rows):
--    SELECT grantee, table_name, privilege_type
--      FROM information_schema.role_table_grants
--     WHERE table_schema = 'public' AND table_name IN ('levels', 'coupons')
--       AND grantee IN ('anon', 'authenticated')
--       AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
--
-- 4. Admin functions: SECURITY DEFINER, pinned search_path, authenticated only:
--    SELECT p.proname, p.prosecdef, p.proconfig
--      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--     WHERE n.nspname = 'public' AND p.proname LIKE 'admin_%coupon_reward%'
--        OR p.proname = 'admin_update_level_thresholds';
--    SELECT routine_name, grantee FROM information_schema.routine_privileges
--     WHERE routine_name LIKE 'admin_%coupon_reward%'
--        OR routine_name = 'admin_update_level_thresholds'
--     ORDER BY 1, 2;                -- authenticated / postgres / service_role, never anon
--
-- 5. Non-admin is refused (SQL editor → role "authenticated", impersonate a
--    customer):
--    SELECT public.admin_update_level_thresholds('[]'::jsonb);   -- ERROR: loyalty_forbidden
--
-- 6. Rewards per level (existing four, unchanged):
--    SELECT level_required, code, discount_type, discount_value, min_order_subtotal,
--           is_active FROM public.coupons ORDER BY level_required, created_at;
--
-- Then run supabase/tests/20261109000100_loyalty_rewards_test.sql.
-- After both parts are applied: pnpm update-types (see the report — the
-- hand-edited types/database.ts must be replaced by generated output).
-- ============================================================================
