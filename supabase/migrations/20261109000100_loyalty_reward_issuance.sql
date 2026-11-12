-- ============================================================================
-- 20261109000100_loyalty_reward_issuance.sql
-- Loyalty rewards, part 1 of 2: issued coupons become immutable snapshots, and
-- reward issuance is driven by a "rank unlock" ledger.
--
-- WHY
--   Until now a customer's coupon (user_coupons) was priced from the LIVE
--   definition row (coupons) every time it was redeemed:
--     * editing a definition's percentage would silently reprice coupons that
--       customers had already earned, and
--     * deactivating a definition (is_active = false) made apply_order_coupon
--       refuse every copy already issued ('coupon_inactive') and hid them from
--       /profile/coupons (RLS hides inactive definitions from customers).
--   The admin rewards panel (part 2) lets administrators edit and deactivate
--   definitions, so both behaviours must go first.
--
-- WHAT THIS MIGRATION DOES
--   1. user_coupons gets a SNAPSHOT of the terms it was issued with
--      (code, name, description, discount type/value, cap, minimum, level).
--      Existing rows are backfilled from their definition — those definitions
--      were never editable from the app, so their current terms are the terms
--      the customer earned. A BEFORE INSERT trigger fills the snapshot for every
--      new row (whatever inserts it), and a BEFORE UPDATE trigger makes it
--      immutable. issue_source records HOW the row was issued.
--
--   2. profile_level_unlocks — one row per (customer, level) the FIRST time the
--      customer reaches that level. Rewards are issued at that moment: every
--      ACTIVE definition of that level, once (user_coupons stays UNIQUE on
--      (user_id, coupon_id), the structural double-issue guard).
--        * A definition created LATER is not issued to customers who had
--          already reached its level — no silent retroactive mass issuance.
--          Part 2 adds an explicit, admin-only retroactive operation.
--        * Lowering a threshold (part 2) makes customers reach a level for the
--          first time; they unlock it then and receive its active rewards.
--        * A failed issuance is still recovered: the unlock row and its coupons
--          are written together, so if the trigger fails (it only WARNs), the
--          next XP change retries both.
--      Existing customers get a 'baseline' unlock row for every level their XP
--      has reached today, so nothing is re-issued to them.
--
--   3. Legacy reconciliation (section 6): BEFORE the baseline is laid, every
--      customer receives any active level coupon the PREVIOUS rule entitled them
--      to but they do not hold yet (that rule granted every active coupon at or
--      below the customer's level on each XP increase). Normally this inserts 0
--      rows; it exists so the cut-over cannot silently revoke an entitlement.
--
--   4. apply_order_coupon prices from the SNAPSHOT and no longer refuses a
--      coupon because its definition was deactivated. Everything else in it —
--      ownership, status, expiry, minimum, wholesale exclusion, rounding, the
--      atomic spend — is unchanged (diff it against 20261005000100 §9).
--
--   5. The one-ACTIVE-coupon-per-level unique index is dropped: a level may now
--      carry several independent rewards (each issued once per customer).
--
--   6. A new account unlocks the entry level (Aficionado, 0 XP) at signup, so a
--      reward configured for the entry level is issued to new customers.
--
-- NOT CHANGED
--   XP earning (grant_order_xp), coupon claiming, the payment-sync trigger, the
--   expiry sweep, user_coupons status machine, orders.user_coupon_id.
--
-- ⚠ Do NOT re-run 20261005000100_level_coupons.sql after this file: it would
--   restore the old grant_level_coupons / apply_order_coupon bodies (and fail on
--   its one-active-per-level index once a level has two active rewards).
--
-- Depends on: 20261005000100 (levels, coupons, user_coupons, apply_order_coupon,
--             grant_level_coupons trigger), profiles, orders.
-- Idempotent: safe to re-run in Supabase Studio. Runs as one transaction.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Pre-flight — refuse to run on a database without the level-coupon schema
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.levels') IS NULL
     OR to_regclass('public.coupons') IS NULL
     OR to_regclass('public.user_coupons') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261005000100_level_coupons.sql first (levels/coupons/user_coupons missing).';
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 1. user_coupons — snapshot of the terms the coupon was issued with
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.user_coupons
  ADD COLUMN IF NOT EXISTS coupon_code         TEXT,
  ADD COLUMN IF NOT EXISTS coupon_name         TEXT,
  ADD COLUMN IF NOT EXISTS coupon_description  TEXT,
  ADD COLUMN IF NOT EXISTS discount_type       TEXT,
  ADD COLUMN IF NOT EXISTS discount_value      NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS max_discount_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS min_order_subtotal  NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS level_required      INTEGER,
  ADD COLUMN IF NOT EXISTS issue_source        TEXT;

-- Backfill rows issued before this migration. Their definitions have never been
-- editable from the app, so the definition's current terms are what was earned.
-- (If someone edited a definition in Studio after issuing it, the edited terms
-- are what apply_order_coupon has been charging anyway — so this keeps today's
-- behaviour for those rows too.)
UPDATE public.user_coupons uc
   SET coupon_code         = c.code,
       coupon_name         = c.name,
       coupon_description  = c.description,
       discount_type       = c.discount_type,
       discount_value      = c.discount_value,
       max_discount_amount = c.max_discount_amount,
       min_order_subtotal  = c.min_order_subtotal,
       level_required      = c.level_required
  FROM public.coupons c
 WHERE c.id = uc.coupon_id
   AND uc.coupon_code IS NULL;

UPDATE public.user_coupons
   SET issue_source = 'legacy'
 WHERE issue_source IS NULL;

ALTER TABLE public.user_coupons
  ALTER COLUMN coupon_code        SET NOT NULL,
  ALTER COLUMN coupon_name        SET NOT NULL,
  ALTER COLUMN discount_type      SET NOT NULL,
  ALTER COLUMN discount_value     SET NOT NULL,
  ALTER COLUMN min_order_subtotal SET NOT NULL,
  ALTER COLUMN level_required     SET NOT NULL,
  ALTER COLUMN issue_source       SET DEFAULT 'level_unlock',
  ALTER COLUMN issue_source       SET NOT NULL;

-- Same guarantees the definition table has, on the snapshot.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'user_coupons_snapshot_terms_valid'
                    AND conrelid = 'public.user_coupons'::regclass) THEN
    ALTER TABLE public.user_coupons
      ADD CONSTRAINT user_coupons_snapshot_terms_valid CHECK (
            discount_type IN ('percentage', 'fixed')
        AND discount_value > 0
        AND (discount_type <> 'percentage' OR discount_value <= 100)
        AND (max_discount_amount IS NULL
             OR (max_discount_amount > 0 AND discount_type = 'percentage'))
        AND min_order_subtotal >= 0
        AND level_required >= 1
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'user_coupons_issue_source_valid'
                    AND conrelid = 'public.user_coupons'::regclass) THEN
    ALTER TABLE public.user_coupons
      ADD CONSTRAINT user_coupons_issue_source_valid
      CHECK (issue_source IN ('legacy', 'level_unlock', 'retroactive'));
  END IF;
END $$;

-- Snapshot on insert: the terms are ALWAYS copied from the definition at the
-- moment of issue, whatever the inserting code passed. One place, so no
-- issuance path (trigger, RPC, Studio) can forget it.
CREATE OR REPLACE FUNCTION public.tg_user_coupons_snapshot_terms()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_c public.coupons%ROWTYPE;
BEGIN
  SELECT * INTO v_c FROM public.coupons WHERE id = NEW.coupon_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'coupon % does not exist', NEW.coupon_id;
  END IF;

  NEW.coupon_code         := v_c.code;
  NEW.coupon_name         := v_c.name;
  NEW.coupon_description  := v_c.description;
  NEW.discount_type       := v_c.discount_type;
  NEW.discount_value      := v_c.discount_value;
  NEW.max_discount_amount := v_c.max_discount_amount;
  NEW.min_order_subtotal  := v_c.min_order_subtotal;
  NEW.level_required      := v_c.level_required;
  NEW.issue_source        := COALESCE(NEW.issue_source, 'level_unlock');
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_user_coupons_snapshot_terms() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_user_coupons_snapshot_terms ON public.user_coupons;
CREATE TRIGGER trg_user_coupons_snapshot_terms
  BEFORE INSERT ON public.user_coupons
  FOR EACH ROW EXECUTE FUNCTION public.tg_user_coupons_snapshot_terms();

-- Immutable afterwards: the status machine keeps working (status, claimed_at,
-- used_at, … are not in this list), but the terms a customer earned can never
-- be rewritten — not by an admin, not by a future function, not in Studio.
CREATE OR REPLACE FUNCTION public.tg_user_coupons_terms_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (OLD.coupon_id, OLD.coupon_code, OLD.coupon_name, OLD.coupon_description,
      OLD.discount_type, OLD.discount_value, OLD.max_discount_amount,
      OLD.min_order_subtotal, OLD.level_required, OLD.issue_source)
     IS DISTINCT FROM
     (NEW.coupon_id, NEW.coupon_code, NEW.coupon_name, NEW.coupon_description,
      NEW.discount_type, NEW.discount_value, NEW.max_discount_amount,
      NEW.min_order_subtotal, NEW.level_required, NEW.issue_source) THEN
    RAISE EXCEPTION 'user_coupon_terms_immutable';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_user_coupons_terms_immutable() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_user_coupons_terms_immutable ON public.user_coupons;
CREATE TRIGGER trg_user_coupons_terms_immutable
  BEFORE UPDATE ON public.user_coupons
  FOR EACH ROW EXECUTE FUNCTION public.tg_user_coupons_terms_immutable();


-- ────────────────────────────────────────────────────────────────────────────
-- 2. Several rewards per level
-- ────────────────────────────────────────────────────────────────────────────
-- The old index made "one coupon per level per user" hold by allowing only one
-- ACTIVE definition per level. Issuance is now per DEFINITION (UNIQUE
-- (user_id, coupon_id) on user_coupons), so a level may carry several.
DROP INDEX IF EXISTS public.coupons_one_active_per_level;

CREATE INDEX IF NOT EXISTS idx_coupons_level_required
  ON public.coupons (level_required);


-- ────────────────────────────────────────────────────────────────────────────
-- 3. profile_level_unlocks — when each customer FIRST reached each level
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profile_level_unlocks (
  user_id               UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  level_number          INTEGER     NOT NULL REFERENCES public.levels(level_number)
                                      ON UPDATE CASCADE ON DELETE CASCADE,
  unlocked_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The customer's XP and the level's threshold at that moment (audit only).
  xp_at_unlock          INTEGER     NOT NULL CHECK (xp_at_unlock >= 0),
  required_xp_at_unlock INTEGER     NOT NULL CHECK (required_xp_at_unlock >= 0),
  source                TEXT        NOT NULL
                          CHECK (source IN ('baseline', 'signup', 'xp_increase', 'threshold_change', 'repair')),
  PRIMARY KEY (user_id, level_number)
);

CREATE INDEX IF NOT EXISTS idx_profile_level_unlocks_level
  ON public.profile_level_unlocks (level_number);

ALTER TABLE public.profile_level_unlocks ENABLE ROW LEVEL SECURITY;

-- Owners and admins read; nobody writes directly (SECURITY DEFINER functions only).
DROP POLICY IF EXISTS "Level unlocks: read own row, admins read all" ON public.profile_level_unlocks;
CREATE POLICY "Level unlocks: read own row, admins read all"
  ON public.profile_level_unlocks FOR SELECT
  USING (auth.uid() = user_id OR public.is_admin());

REVOKE ALL ON public.profile_level_unlocks FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.profile_level_unlocks FROM authenticated;
GRANT  SELECT ON public.profile_level_unlocks TO authenticated;
GRANT  ALL    ON public.profile_level_unlocks TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. Issuance functions
-- ────────────────────────────────────────────────────────────────────────────
-- unlock_reached_levels: record every level this customer's XP has reached and
-- that has no unlock row yet, and issue each such level's ACTIVE rewards. Both
-- inserts are idempotent (PK / UNIQUE + ON CONFLICT DO NOTHING), so calling it
-- twice, concurrently, or after a failure never issues anything twice.
-- Returns the number of coupons issued.
CREATE OR REPLACE FUNCTION public.unlock_reached_levels(
  p_user_id UUID,
  p_source  TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_xp     INTEGER;
  v_issued INTEGER;
BEGIN
  SELECT experience_points INTO v_xp FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  WITH new_unlocks AS (
    INSERT INTO public.profile_level_unlocks
           (user_id, level_number, xp_at_unlock, required_xp_at_unlock, source)
    SELECT p_user_id, l.level_number, GREATEST(v_xp, 0), l.required_xp, p_source
      FROM public.levels l
     WHERE l.required_xp <= v_xp
    ON CONFLICT (user_id, level_number) DO NOTHING
    RETURNING level_number
  ), issued AS (
    INSERT INTO public.user_coupons (user_id, coupon_id, status, expires_at, issue_source)
    SELECT p_user_id,
           c.id,
           'unlocked',
           CASE WHEN c.valid_days IS NULL THEN NULL
                ELSE now() + make_interval(days => c.valid_days) END,
           'level_unlock'
      FROM new_unlocks nu
      JOIN public.coupons c ON c.level_required = nu.level_number
     WHERE c.is_active
    ON CONFLICT (user_id, coupon_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_issued FROM issued;

  RETURN v_issued;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.unlock_reached_levels(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.unlock_reached_levels(UUID, TEXT) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.unlock_reached_levels(UUID, TEXT) TO service_role;


-- Same name and signature as 20261005000100, so the existing XP trigger
-- (trg_profiles_grant_level_coupons → tg_profiles_grant_level_coupons) keeps
-- calling it unchanged. Semantics: "unlock what this XP newly reached".
CREATE OR REPLACE FUNCTION public.grant_level_coupons(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.unlock_reached_levels(p_user_id, 'xp_increase');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grant_level_coupons(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.grant_level_coupons(UUID) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.grant_level_coupons(UUID) TO service_role;


-- sync_level_unlocks: the set-based version for EVERY profile. Used after a
-- threshold change (part 2) and as a repair. Returns how many customers reached
-- a level for the first time and how many coupons that issued.
CREATE OR REPLACE FUNCTION public.sync_level_unlocks(p_source TEXT DEFAULT 'repair')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unlocks   INTEGER;
  v_customers INTEGER;
  v_issued    INTEGER;
BEGIN
  WITH new_unlocks AS (
    INSERT INTO public.profile_level_unlocks
           (user_id, level_number, xp_at_unlock, required_xp_at_unlock, source)
    SELECT p.id, l.level_number, GREATEST(p.experience_points, 0), l.required_xp, p_source
      FROM public.profiles p
      JOIN public.levels   l ON l.required_xp <= p.experience_points
    ON CONFLICT (user_id, level_number) DO NOTHING
    RETURNING user_id, level_number
  ), issued AS (
    INSERT INTO public.user_coupons (user_id, coupon_id, status, expires_at, issue_source)
    SELECT nu.user_id,
           c.id,
           'unlocked',
           CASE WHEN c.valid_days IS NULL THEN NULL
                ELSE now() + make_interval(days => c.valid_days) END,
           'level_unlock'
      FROM new_unlocks nu
      JOIN public.coupons c ON c.level_required = nu.level_number
     WHERE c.is_active
    ON CONFLICT (user_id, coupon_id) DO NOTHING
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM new_unlocks),
         (SELECT count(DISTINCT user_id) FROM new_unlocks),
         (SELECT count(*) FROM issued)
    INTO v_unlocks, v_customers, v_issued;

  RETURN jsonb_build_object(
    'levels_unlocked',   v_unlocks,
    'customers_reached', v_customers,
    'coupons_issued',    v_issued
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_level_unlocks(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_level_unlocks(TEXT) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.sync_level_unlocks(TEXT) TO service_role;


-- Same name/signature as 20261005000100 (service_role only). It used to grant
-- every active coupon at or below each customer's level; it now runs the
-- unlock-based sync, which never re-issues and never back-fills definitions
-- created after a customer reached their level.
CREATE OR REPLACE FUNCTION public.backfill_level_coupons()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (public.sync_level_unlocks('repair')->>'coupons_issued')::INTEGER;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.backfill_level_coupons() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.backfill_level_coupons() FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.backfill_level_coupons() TO service_role;


-- Signup: a new account sits at 0 XP, i.e. it has just reached the entry level.
-- Like the XP trigger, a failure here must never abort the signup, so it is
-- downgraded to a WARNING (the next XP change retries it).
CREATE OR REPLACE FUNCTION public.tg_profiles_unlock_on_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.unlock_reached_levels(NEW.id, 'signup');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'unlock_reached_levels(%) at signup failed: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_profiles_unlock_on_signup() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_profiles_unlock_on_signup ON public.profiles;
CREATE TRIGGER trg_profiles_unlock_on_signup
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_profiles_unlock_on_signup();


-- ────────────────────────────────────────────────────────────────────────────
-- 5. apply_order_coupon — priced from the issued SNAPSHOT
-- ────────────────────────────────────────────────────────────────────────────
-- Identical to 20261005000100 §9 except the lines marked -- CHANGED:
--   * terms come from user_coupons (the snapshot), not from coupons;
--   * a deactivated definition no longer blocks a coupon already issued
--     ('coupon_inactive' is no longer raised; the TS mapping keeps the code).
CREATE OR REPLACE FUNCTION public.apply_order_coupon(
  p_order_id       UUID,
  p_user_coupon_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_order    RECORD;
  v_coupon   RECORD;
  v_discount NUMERIC(12,2);
  v_rows     INTEGER;
  v_total    NUMERIC(12,2);
BEGIN
  IF v_uid IS NULL THEN
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

  IF NOT FOUND OR v_order.user_id IS DISTINCT FROM v_uid THEN
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
  SELECT uc.id, uc.status, uc.expires_at,                              -- CHANGED
         uc.coupon_code AS code, uc.coupon_name AS name,               -- CHANGED
         uc.discount_type, uc.discount_value,                          -- CHANGED
         uc.max_discount_amount, uc.min_order_subtotal                 -- CHANGED
    INTO v_coupon
    FROM public.user_coupons uc                                        -- CHANGED
   WHERE uc.id = p_user_coupon_id
     AND uc.user_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'coupon_not_found';
  END IF;
  -- CHANGED: no is_active check — deactivating a definition stops FUTURE
  -- issuance only; coupons already earned stay spendable on their own terms.
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
     AND user_id = v_uid
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

-- Unchanged grants (see 20261005000100 §9).
REVOKE EXECUTE ON FUNCTION public.apply_order_coupon(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.apply_order_coupon(UUID, UUID) TO anon, authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 6. Cut-over: legacy reconciliation, then the baseline
-- ────────────────────────────────────────────────────────────────────────────
-- 6a. The PREVIOUS rule (20261005000100 grant_level_coupons): every active
--     coupon at or below the customer's level, granted on each XP increase.
--     Anything that rule still owed a customer is issued now, once, so laying
--     the baseline below cannot revoke it. Expected: 0 rows on a healthy DB.
DO $$
DECLARE
  v_n INTEGER;
BEGIN
  INSERT INTO public.user_coupons (user_id, coupon_id, status, expires_at, issue_source)
  SELECT p.id,
         c.id,
         'unlocked',
         CASE WHEN c.valid_days IS NULL THEN NULL
              ELSE now() + make_interval(days => c.valid_days) END,
         'legacy'
    FROM public.profiles p
    JOIN public.levels   l ON l.required_xp <= p.experience_points
    JOIN public.coupons  c ON c.level_required = l.level_number AND c.is_active
     -- Only on the FIRST run: once the baseline exists the new rule is in force.
   WHERE NOT EXISTS (SELECT 1 FROM public.profile_level_unlocks)
  ON CONFLICT (user_id, coupon_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'legacy reconciliation issued % coupon(s)', v_n;
END $$;

-- 6b. Baseline: every level each customer has ALREADY reached counts as
--     unlocked, so definitions added from now on are not retro-issued to them.
DO $$
DECLARE
  v_n INTEGER;
BEGIN
  INSERT INTO public.profile_level_unlocks
         (user_id, level_number, xp_at_unlock, required_xp_at_unlock, source)
  SELECT p.id, l.level_number, GREATEST(p.experience_points, 0), l.required_xp, 'baseline'
    FROM public.profiles p
    JOIN public.levels   l ON l.required_xp <= p.experience_points
  ON CONFLICT (user_id, level_number) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'baseline recorded % level unlock(s)', v_n;
END $$;

COMMIT;


-- ============================================================================
-- VERIFICATION QUERIES — run after the migration
-- ============================================================================
-- 1. Every issued coupon carries a snapshot equal to its definition today
--    (expect 0 rows right after the migration — nothing has been edited yet):
--    SELECT uc.id, uc.coupon_code, c.code
--      FROM public.user_coupons uc JOIN public.coupons c ON c.id = uc.coupon_id
--     WHERE (uc.coupon_code, uc.discount_type, uc.discount_value,
--            uc.max_discount_amount, uc.min_order_subtotal, uc.level_required)
--           IS DISTINCT FROM
--           (c.code, c.discount_type, c.discount_value,
--            c.max_discount_amount, c.min_order_subtotal, c.level_required);
--
-- 2. Issue sources (pre-existing rows are 'legacy'):
--    SELECT issue_source, count(*) FROM public.user_coupons GROUP BY 1;
--
-- 3. Baseline: one unlock row per (customer, level reached). Expect 0 rows:
--    SELECT p.id, l.level_number
--      FROM public.profiles p JOIN public.levels l ON l.required_xp <= p.experience_points
--     WHERE NOT EXISTS (SELECT 1 FROM public.profile_level_unlocks u
--                        WHERE u.user_id = p.id AND u.level_number = l.level_number);
--
-- 4. Every customer still holds every reward of every level they reached
--    (expect 0 rows):
--    SELECT u.user_id, c.code
--      FROM public.profile_level_unlocks u
--      JOIN public.coupons c ON c.level_required = u.level_number AND c.is_active
--     WHERE NOT EXISTS (SELECT 1 FROM public.user_coupons uc
--                        WHERE uc.user_id = u.user_id AND uc.coupon_id = c.id);
--
-- 5. Nothing was double-issued (expect 0 rows):
--    SELECT user_id, coupon_id, count(*) FROM public.user_coupons
--     GROUP BY 1, 2 HAVING count(*) > 1;
--
-- 6. Objects: one-active index gone, triggers present, apply reads the snapshot:
--    SELECT to_regclass('public.coupons_one_active_per_level');            -- NULL
--    SELECT tgname FROM pg_trigger
--     WHERE tgname IN ('trg_user_coupons_snapshot_terms', 'trg_user_coupons_terms_immutable',
--                      'trg_profiles_unlock_on_signup', 'trg_profiles_grant_level_coupons');  -- 4
--    SELECT pg_get_functiondef('public.apply_order_coupon(uuid,uuid)'::regprocedure)
--           LIKE '%FROM public.user_coupons uc%-- CHANGED%';                -- true
--
-- 7. Grants — internals are service_role only:
--    SELECT routine_name, grantee FROM information_schema.routine_privileges
--     WHERE routine_name IN ('unlock_reached_levels','sync_level_unlocks',
--                            'grant_level_coupons','backfill_level_coupons','apply_order_coupon')
--       AND grantee IN ('anon','authenticated','service_role','PUBLIC')
--     ORDER BY 1, 2;
--
-- Then run supabase/tests/20261109000100_loyalty_rewards_test.sql (after part 2).
-- ============================================================================
