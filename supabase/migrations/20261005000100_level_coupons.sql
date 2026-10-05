-- ============================================================================
-- 20261005000100_level_coupons.sql
-- Level-based, single-use coupons.
--
-- Reaching a level (XP threshold) unlocks that level's coupon. The customer
-- sees it in /profile/coupons and may apply ONE coupon per order at checkout.
--
--   Aficionado     (level 1)    —   no coupon
--   Coleccionista  (level 2)    5% off
--   Conocedor      (level 3)    8% off
--   Alquimista     (level 4)   12% off
--   Maestro        (level 5)   18% off   (was "1 free fragrance")
--
-- DESIGN
--   * place_order() is NOT touched. The wholesale patch to it may not be on the
--     live DB yet (see pending migrations), so this migration adds a SIBLING
--     RPC, apply_order_coupon(), that the Next checkout service calls right
--     after place_order() — the same way the free-local-delivery override is
--     applied after it. The discount is therefore computed by the database, from
--     the order's own server-side subtotal, never from anything the browser sent.
--
--   * Race safety: a coupon is spent by ONE guarded UPDATE
--         UPDATE user_coupons SET status='used'
--          WHERE id = X AND status IN ('unlocked','claimed')
--     Two concurrent checkouts serialize on that row; the loser sees 0 rows.
--     orders.user_coupon_id is UNIQUE as a second, structural guard.
--
--   * Payment-state sync: the coupon is flipped to 'used' when the order is
--     placed (that is the hold), and `payment_confirmed_at` is stamped when the
--     order's payment_status becomes 'paid' (that is "permanently used"). If the
--     order is denied / its payment fails or is refunded — from ANY path: the
--     30-min sweep, cancelOrder(), the Onvo webhook, an admin — a trigger puts
--     the coupon back to 'claimed'. Hooking the table, not each caller, is what
--     makes the revert impossible to forget.
--
--   * XP is now earned on the DISCOUNTED SUBTOTAL (subtotal - discount),
--     excluding shipping and tax. grant_order_xp() is redefined below.
--     ⚠ This also drops shipping out of the XP base for orders WITHOUT a coupon
--     (the old base was orders.total). That is what the product rule says.
--
--   * Unlocking is a trigger on profiles.experience_points, so every XP source
--     (order → received, guest-order claim, admin backfill) is covered.
--
-- Mirrors in TypeScript — keep in lock-step:
--     lib/coupons/discount.ts      discount maths + eligibility
--     lib/rank.ts RANK_THRESHOLDS  ↔ public.levels.required_xp
--
-- Idempotent: safe to re-run in Supabase Studio.
-- Depends on: profiles, orders, is_admin(), handle_updated_at(),
--             20260611000100 (XP), 20260525000500 (pg_cron — optional here).
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. levels — the XP ladder, as data
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.levels (
  level_number INTEGER     PRIMARY KEY CHECK (level_number >= 1),
  name         TEXT        NOT NULL UNIQUE,
  -- UNIQUE: two levels with the same threshold would make "which level is this
  -- XP in?" ambiguous.
  required_xp  INTEGER     NOT NULL UNIQUE CHECK (required_xp >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_levels_updated_at ON public.levels;
CREATE TRIGGER set_levels_updated_at
  BEFORE UPDATE ON public.levels
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();


-- ────────────────────────────────────────────────────────────────────────────
-- 2. coupons — the catalogue of level rewards
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coupons (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT          NOT NULL UNIQUE
                        CHECK (code = UPPER(code) AND LENGTH(code) BETWEEN 3 AND 40),
  name                TEXT          NOT NULL,
  description         TEXT,
  discount_type       TEXT          NOT NULL
                        CHECK (discount_type IN ('percentage', 'fixed')),
  -- percentage → 0 < v <= 100;  fixed → an amount in CRC.
  discount_value      NUMERIC(12,2) NOT NULL CHECK (discount_value > 0),
  -- Optional ceiling for percentage coupons (e.g. "18% off, up to ₡20,000").
  max_discount_amount NUMERIC(12,2) CHECK (max_discount_amount IS NULL OR max_discount_amount > 0),
  -- Compared against the order SUBTOTAL (goods only), inclusive.
  min_order_subtotal  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (min_order_subtotal >= 0),
  level_required      INTEGER       NOT NULL
                        REFERENCES public.levels(level_number)
                        ON UPDATE CASCADE ON DELETE RESTRICT,
  -- Days a customer has to use it once unlocked; NULL = never expires.
  valid_days          INTEGER       CHECK (valid_days IS NULL OR valid_days > 0),
  is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT coupons_percentage_range
    CHECK (discount_type <> 'percentage' OR discount_value <= 100),
  CONSTRAINT coupons_max_discount_percentage_only
    CHECK (max_discount_amount IS NULL OR discount_type = 'percentage')
);

-- "One coupon per level per user" holds because (a) user_coupons is UNIQUE on
-- (user_id, coupon_id) and (b) at most ONE ACTIVE coupon exists per level.
-- To run two promotions on the same level, retire the old one (is_active=false)
-- first — or drop this index deliberately.
CREATE UNIQUE INDEX IF NOT EXISTS coupons_one_active_per_level
  ON public.coupons (level_required)
  WHERE is_active;

DROP TRIGGER IF EXISTS set_coupons_updated_at ON public.coupons;
CREATE TRIGGER set_coupons_updated_at
  BEFORE UPDATE ON public.coupons
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();


-- ────────────────────────────────────────────────────────────────────────────
-- 3. user_coupons — one row per (customer, coupon): the lifecycle
-- ────────────────────────────────────────────────────────────────────────────
--   unlocked → claimed → used            (happy path)
--   used → claimed                       (order failed / denied / refunded)
--   unlocked | claimed → expired         (expires_at passed)
--
-- `used` with payment_confirmed_at NULL is a HOLD (order placed, payment not
-- yet confirmed); with it set, the spend is permanent.
CREATE TABLE IF NOT EXISTS public.user_coupons (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  coupon_id            UUID        NOT NULL REFERENCES public.coupons(id)  ON DELETE RESTRICT,
  status               TEXT        NOT NULL DEFAULT 'unlocked'
                         CHECK (status IN ('unlocked', 'claimed', 'used', 'expired')),
  unlocked_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at           TIMESTAMPTZ,
  used_at              TIMESTAMPTZ,
  payment_confirmed_at TIMESTAMPTZ,
  expires_at           TIMESTAMPTZ,
  -- ON DELETE SET NULL: deleting an order must not be blocked by its coupon.
  used_order_id        UUID        REFERENCES public.orders(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT user_coupons_one_per_coupon UNIQUE (user_id, coupon_id)
);

CREATE INDEX IF NOT EXISTS idx_user_coupons_user_status
  ON public.user_coupons (user_id, status);

DROP TRIGGER IF EXISTS set_user_coupons_updated_at ON public.user_coupons;
CREATE TRIGGER set_user_coupons_updated_at
  BEFORE UPDATE ON public.user_coupons
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();


-- ────────────────────────────────────────────────────────────────────────────
-- 4. orders.user_coupon_id — at most one coupon per order, one order per coupon
-- ────────────────────────────────────────────────────────────────────────────
-- UNIQUE makes both directions structural: an order has one column (so one
-- coupon), and a user_coupon can be referenced by at most one order. NULLs do
-- not collide, so ordinary orders are unaffected.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS user_coupon_id UUID UNIQUE
    REFERENCES public.user_coupons(id) ON DELETE SET NULL;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. RLS + grants
-- ────────────────────────────────────────────────────────────────────────────
-- Tables created via SQL (not the dashboard editor) do not get Supabase's
-- default GRANTs — without them RLS never even runs ("permission denied").
ALTER TABLE public.levels       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_coupons ENABLE ROW LEVEL SECURITY;

-- levels: public ladder (the /ranking page is public too).
DROP POLICY IF EXISTS "Anyone can view levels" ON public.levels;
CREATE POLICY "Anyone can view levels"
  ON public.levels FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can manage levels" ON public.levels;
CREATE POLICY "Admins can manage levels"
  ON public.levels FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- coupons: the terms of an active coupon are not secret.
DROP POLICY IF EXISTS "Anyone can view active coupons" ON public.coupons;
CREATE POLICY "Anyone can view active coupons"
  ON public.coupons FOR SELECT USING (is_active OR public.is_admin());

DROP POLICY IF EXISTS "Admins can manage coupons" ON public.coupons;
CREATE POLICY "Admins can manage coupons"
  ON public.coupons FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- user_coupons: owners and admins READ. Nobody writes directly — every
-- transition goes through the SECURITY DEFINER functions below, which is the
-- only way the status machine can't be bypassed from the browser.
DROP POLICY IF EXISTS "Users can view their own coupons" ON public.user_coupons;
CREATE POLICY "Users can view their own coupons"
  ON public.user_coupons FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all user coupons" ON public.user_coupons;
CREATE POLICY "Admins can view all user coupons"
  ON public.user_coupons FOR SELECT USING (public.is_admin());

GRANT SELECT ON public.levels  TO anon, authenticated;
GRANT SELECT ON public.coupons TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.levels, public.coupons TO authenticated; -- RLS: admins only
GRANT SELECT ON public.user_coupons TO authenticated;
GRANT ALL ON public.levels, public.coupons, public.user_coupons TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 6. Seed — the five tiers
-- ────────────────────────────────────────────────────────────────────────────
-- DO NOTHING (not DO UPDATE): re-running this file must never overwrite terms
-- that marketing has since edited in Studio.
--
-- levels.required_xp mirrors RANK_THRESHOLDS in lib/rank.ts.
INSERT INTO public.levels (level_number, name, required_xp) VALUES
  (1, 'Aficionado',     0),
  (2, 'Coleccionista',  1000),
  (3, 'Conocedor',      5000),
  (4, 'Alquimista',     10000),
  (5, 'Maestro',        18000)
ON CONFLICT DO NOTHING;

-- Aficionado is the entry level: deliberately no coupon.
-- min_order_subtotal = ₡20,000 matches REWARD_MIN_PURCHASE in lib/rewards.ts.
INSERT INTO public.coupons
  (code, name, description, discount_type, discount_value, min_order_subtotal, level_required)
VALUES
  ('COLECCIONISTA-5', 'Cupón Coleccionista',
   '5% de descuento por alcanzar el nivel Coleccionista.',
   'percentage',  5, 20000, 2),
  ('CONOCEDOR-8',     'Cupón Conocedor',
   '8% de descuento por alcanzar el nivel Conocedor.',
   'percentage',  8, 20000, 3),
  ('ALQUIMISTA-12',   'Cupón Alquimista',
   '12% de descuento por alcanzar el nivel Alquimista.',
   'percentage', 12, 20000, 4),
  ('MAESTRO-18',      'Cupón Maestro',
   '18% de descuento por alcanzar el nivel Maestro.',
   'percentage', 18, 20000, 5)
ON CONFLICT DO NOTHING;


-- ────────────────────────────────────────────────────────────────────────────
-- 7. Unlocking — grant every coupon a customer's XP has reached
-- ────────────────────────────────────────────────────────────────────────────
-- Grants ALL coupons at or below the customer's level, not only the newest: a
-- large order can jump two levels at once and skipping the middle coupon would
-- punish exactly the biggest spenders. ON CONFLICT makes it idempotent, so it is
-- safe to call as often as we like (trigger, backfill, repair).
CREATE OR REPLACE FUNCTION public.grant_level_coupons(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_xp      INTEGER;
  v_granted INTEGER;
BEGIN
  SELECT experience_points INTO v_xp FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  INSERT INTO public.user_coupons (user_id, coupon_id, status, expires_at)
  SELECT p_user_id,
         c.id,
         'unlocked',
         CASE WHEN c.valid_days IS NULL THEN NULL
              ELSE now() + make_interval(days => c.valid_days) END
    FROM public.coupons c
    JOIN public.levels  l ON l.level_number = c.level_required
   WHERE c.is_active
     AND l.required_xp <= v_xp
  ON CONFLICT (user_id, coupon_id) DO NOTHING;

  GET DIAGNOSTICS v_granted = ROW_COUNT;
  RETURN v_granted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grant_level_coupons(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.grant_level_coupons(UUID) TO service_role;


-- Fires on every XP increase, whichever code path caused it.
--
-- A failure here must NEVER roll back the XP grant (and with it the order
-- reaching `received`), so it is downgraded to a WARNING. The missed coupon is
-- recovered by the next XP change or by backfill_level_coupons().
CREATE OR REPLACE FUNCTION public.tg_profiles_grant_level_coupons()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.grant_level_coupons(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'grant_level_coupons(%) failed: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_grant_level_coupons ON public.profiles;
CREATE TRIGGER trg_profiles_grant_level_coupons
  AFTER UPDATE OF experience_points ON public.profiles
  FOR EACH ROW
  WHEN (NEW.experience_points > OLD.experience_points)
  EXECUTE FUNCTION public.tg_profiles_grant_level_coupons();


-- Repair / catch-up for every profile. Re-runnable; returns coupons created.
-- Use it after adding a coupon to an existing level.
CREATE OR REPLACE FUNCTION public.backfill_level_coupons()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_granted INTEGER;
BEGIN
  INSERT INTO public.user_coupons (user_id, coupon_id, status, expires_at)
  SELECT p.id,
         c.id,
         'unlocked',
         CASE WHEN c.valid_days IS NULL THEN NULL
              ELSE now() + make_interval(days => c.valid_days) END
    FROM public.profiles p
    JOIN public.levels   l ON l.required_xp <= p.experience_points
    JOIN public.coupons  c ON c.level_required = l.level_number AND c.is_active
  ON CONFLICT (user_id, coupon_id) DO NOTHING;

  GET DIAGNOSTICS v_granted = ROW_COUNT;
  RETURN v_granted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.backfill_level_coupons() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.backfill_level_coupons() TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 8. claim_user_coupon — unlocked → claimed
-- ────────────────────────────────────────────────────────────────────────────
-- Called from the profile ("Reclamar") and, silently, from checkout when the
-- customer picks a coupon they have not claimed yet. Idempotent: claiming a
-- coupon that is already claimed succeeds with claimed=false.
CREATE OR REPLACE FUNCTION public.claim_user_coupon(p_user_coupon_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_status TEXT;
  v_rows   INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'coupon_login_required';
  END IF;

  UPDATE public.user_coupons
     SET status = 'claimed', claimed_at = now()
   WHERE id = p_user_coupon_id
     AND user_id = v_uid
     AND status = 'unlocked'
     AND (expires_at IS NULL OR expires_at > now());
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 1 THEN
    RETURN jsonb_build_object('user_coupon_id', p_user_coupon_id, 'status', 'claimed', 'claimed', true);
  END IF;

  SELECT status INTO v_status
    FROM public.user_coupons
   WHERE id = p_user_coupon_id AND user_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'coupon_not_found';
  END IF;
  IF v_status = 'claimed' THEN
    RETURN jsonb_build_object('user_coupon_id', p_user_coupon_id, 'status', 'claimed', 'claimed', false);
  END IF;
  IF v_status = 'expired' THEN
    RAISE EXCEPTION 'coupon_expired';
  END IF;
  -- 'unlocked' here means the expiry clause above rejected it.
  IF v_status = 'unlocked' THEN
    RAISE EXCEPTION 'coupon_expired';
  END IF;
  RAISE EXCEPTION 'coupon_not_available';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_user_coupon(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.claim_user_coupon(UUID) TO authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 9. apply_order_coupon — the server-side source of truth for a discount
-- ────────────────────────────────────────────────────────────────────────────
-- Called by lib/checkout (through the CUSTOMER's client, so auth.uid() is the
-- real caller) immediately after place_order(), before any payment exists.
--
-- Everything is derived here: ownership, status, expiry, the minimum against
-- the ORDER's stored subtotal (not a number the browser sent), and the discount
-- amount. In ONE transaction it spends the coupon and rewrites the order's
-- discount + total, so there is no moment where one has happened without the
-- other.
--
-- Error contract (RAISE EXCEPTION messages; mapped in lib/checkout/couponService.ts):
--   coupon_login_required | coupon_invalid_request | coupon_order_invalid
--   coupon_not_applicable | coupon_not_found       | coupon_inactive
--   coupon_expired        | coupon_not_available   | coupon_no_discount
--   coupon_min_subtotal:<amount>
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
  SELECT uc.id, uc.status, uc.expires_at,
         c.code, c.name, c.discount_type, c.discount_value,
         c.max_discount_amount, c.min_order_subtotal, c.is_active
    INTO v_coupon
    FROM public.user_coupons uc
    JOIN public.coupons c ON c.id = uc.coupon_id
   WHERE uc.id = p_user_coupon_id
     AND uc.user_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'coupon_not_found';
  END IF;
  IF NOT v_coupon.is_active THEN
    RAISE EXCEPTION 'coupon_inactive';
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

-- anon may CALL it only so a guest gets the clean `coupon_login_required`
-- instead of an opaque "permission denied for function"; the first statement
-- of the body rejects them before anything is read.
REVOKE EXECUTE ON FUNCTION public.apply_order_coupon(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.apply_order_coupon(UUID, UUID) TO anon, authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 10. Payment-state sync — confirm on paid, revert on failure
-- ────────────────────────────────────────────────────────────────────────────
-- release_order_coupon: used → claimed (or expired, if its window has since
-- closed), and detach it from the order so the UNIQUE slot is free again.
-- Guarded by used_order_id = this order so a stale call can never free a coupon
-- that has since been spent on a DIFFERENT order.
CREATE OR REPLACE FUNCTION public.release_order_coupon(p_order_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uc UUID;
BEGIN
  SELECT user_coupon_id INTO v_uc
    FROM public.orders
   WHERE id = p_order_id
     FOR UPDATE;

  IF v_uc IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE public.user_coupons
     SET status = CASE WHEN expires_at IS NOT NULL AND expires_at <= now()
                       THEN 'expired' ELSE 'claimed' END,
         claimed_at           = COALESCE(claimed_at, now()),
         used_at              = NULL,
         used_order_id        = NULL,
         payment_confirmed_at = NULL
   WHERE id = v_uc
     AND status = 'used'
     AND used_order_id = p_order_id;

  UPDATE public.orders SET user_coupon_id = NULL WHERE id = p_order_id;

  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.release_order_coupon(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.release_order_coupon(UUID) TO service_role;


-- Table-level hook: whatever moves an order's status — the abandoned-order
-- sweep, cancelOrder(), the Onvo webhook, an admin in the dashboard — keeps the
-- coupon in step. Failure/denial wins over paid (a denied order that was paid
-- is being refunded, so its coupon goes back too).
CREATE OR REPLACE FUNCTION public.tg_orders_sync_coupon()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.order_status = 'denied'
     OR NEW.payment_status IN ('failed', 'refunded') THEN
    PERFORM public.release_order_coupon(NEW.id);
  ELSIF NEW.payment_status = 'paid' THEN
    UPDATE public.user_coupons
       SET payment_confirmed_at = COALESCE(payment_confirmed_at, now())
     WHERE id = NEW.user_coupon_id
       AND status = 'used'
       AND used_order_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_sync_coupon ON public.orders;
CREATE TRIGGER trg_orders_sync_coupon
  AFTER UPDATE OF order_status, payment_status ON public.orders
  FOR EACH ROW
  WHEN (NEW.user_coupon_id IS NOT NULL
        AND (OLD.order_status   IS DISTINCT FROM NEW.order_status
          OR OLD.payment_status IS DISTINCT FROM NEW.payment_status))
  EXECUTE FUNCTION public.tg_orders_sync_coupon();


-- ────────────────────────────────────────────────────────────────────────────
-- 11. Expiry sweep
-- ────────────────────────────────────────────────────────────────────────────
-- The UI and apply_order_coupon() already treat `expires_at <= now()` as
-- expired, so this only keeps the stored status honest for reporting.
CREATE OR REPLACE FUNCTION public.expire_user_coupons()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired INTEGER;
BEGIN
  UPDATE public.user_coupons
     SET status = 'expired'
   WHERE status IN ('unlocked', 'claimed')
     AND expires_at IS NOT NULL
     AND expires_at <= now();
  GET DIAGNOSTICS v_expired = ROW_COUNT;
  RETURN v_expired;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expire_user_coupons() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.expire_user_coupons() TO service_role;

-- Hourly, only if pg_cron is installed (it is, from the abandoned-order sweep).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'expire-user-coupons';
    PERFORM cron.schedule('expire-user-coupons', '0 * * * *', 'SELECT public.expire_user_coupons()');
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 12. XP on the DISCOUNTED SUBTOTAL
-- ────────────────────────────────────────────────────────────────────────────
-- Identical to 20260611000100 except the XP base (marked -- CHANGED): it was
-- orders.total (goods + shipping), it is now subtotal - discount. Shipping and
-- tax never earn XP, and a coupon (or an admin's manual discount) lowers it.
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

  SELECT id, user_id, subtotal, discount, order_status      -- CHANGED
    INTO v_order
    FROM public.orders
   WHERE id = p_order_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order % does not exist.', p_order_id;
  END IF;

  IF v_order.order_status <> 'received' THEN
    RETURN jsonb_build_object(
      'granted', false,
      'reason',  'not_received',
      'status',  v_order.order_status
    );
  END IF;

  IF v_order.user_id IS NULL THEN
    RETURN jsonb_build_object('granted', false, 'reason', 'guest_order');
  END IF;

  -- CHANGED: 50 XP per full ₡1,000 of the discounted subtotal.
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

REVOKE EXECUTE ON FUNCTION public.grant_order_xp(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.grant_order_xp(UUID) TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 13. Catch up existing customers
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠ BUSINESS DECISION: this grants every coupon at or below each existing
-- customer's CURRENT level (an Alquimista today receives the 5%, 8% and 12%
-- coupons). If you want existing customers to start from zero, delete this line
-- before running the file — new XP will still unlock coupons going forward.
SELECT public.backfill_level_coupons();


-- ============================================================================
-- VERIFICATION QUERIES — run after the migration
-- ============================================================================
-- 1. Seed landed (5 levels, 4 coupons, thresholds match lib/rank.ts):
--    SELECT * FROM public.levels ORDER BY level_number;
--    SELECT code, discount_type, discount_value, min_order_subtotal, level_required
--      FROM public.coupons ORDER BY level_required;
--
-- 2. Structural guards:
--    SELECT conname FROM pg_constraint
--     WHERE conrelid IN ('public.user_coupons'::regclass, 'public.orders'::regclass)
--       AND contype = 'u';            -- expect user_coupons_one_per_coupon, orders_user_coupon_id_key
--
-- 3. Triggers:
--    SELECT tgname FROM pg_trigger
--     WHERE tgname IN ('trg_profiles_grant_level_coupons','trg_orders_sync_coupon');  -- 2 rows
--
-- 4. Backfill result — coupons per customer should equal their level - 1:
--    SELECT p.experience_points, COUNT(uc.id) AS coupons
--      FROM public.profiles p LEFT JOIN public.user_coupons uc ON uc.user_id = p.id
--     GROUP BY p.id, p.experience_points ORDER BY p.experience_points DESC LIMIT 10;
--
-- 5. Privileges — claim is authenticated-only, apply is anon+authenticated (it
--    rejects guests itself), internals are service_role-only:
--    SELECT routine_name, grantee FROM information_schema.routine_privileges
--     WHERE routine_name IN ('apply_order_coupon','claim_user_coupon','release_order_coupon',
--                            'grant_level_coupons','backfill_level_coupons','grant_order_xp')
--       AND grantee IN ('anon','authenticated','service_role','PUBLIC')
--     ORDER BY 1, 2;
--
-- 6. XP formula now uses the discounted subtotal (look for GREATEST(... discount)):
--    SELECT pg_get_functiondef('public.grant_order_xp(uuid)'::regprocedure);
--
-- After applying:  pnpm update-types   (types/database.ts was hand-edited with
-- the new tables, orders.user_coupon_id and the RPC signatures; replace it with
-- real generated output).
-- ============================================================================
