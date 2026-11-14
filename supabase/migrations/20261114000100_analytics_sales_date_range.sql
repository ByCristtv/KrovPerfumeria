-- ============================================================================
-- 20261114000100_analytics_sales_date_range.sql
-- Sales dashboard: correct "Todo" (all time), bounded custom ranges, admin-only.
-- ============================================================================
-- THE BUG
--   /admin/dashboard → "Todo" showed LESS revenue than "90 días".
--
-- ROOT CAUSE
--   analytics_revenue_summary(p_since) and analytics_best_sellers(p_limit,
--   p_since) declare `p_since TIMESTAMPTZ DEFAULT now() - INTERVAL '30 days'`.
--   For "Todo" the client OMITTED p_since, believing that meant "no lower
--   bound". PostgREST then applies the SQL default, so "Todo" silently meant
--   "last 30 days" — always ≤ the 90-day window. Reproduced on TESTING
--   (2026-11-14): no p_since → 2 orders / ₡37,900; p_since = 1970-01-01 →
--   8 orders / ₡169,500, which matches the raw non-denied orders exactly.
--   Row limits were NOT involved: both RPCs aggregate in SQL and return one
--   row (summary) or ≤ p_limit rows (best sellers), far below PostgREST's cap.
--
-- SECOND FINDING — revenue was readable by anyone
--   Both legacy functions are SECURITY DEFINER with no role check, and
--   Supabase's default privileges grant EXECUTE to `anon`. Verified on TESTING:
--   POST /rest/v1/rpc/analytics_revenue_summary with only the public anon key
--   returns the shop's revenue. Fixed below.
--
-- WHAT THIS MIGRATION DOES
--   1. analytics_countable_orders(p_from, p_to)   NEW, internal helper.
--      The ONE definition of "orders that count toward sales in a period":
--        order_status <> 'denied'                (unchanged business rule —
--                                                 pending orders still count,
--                                                 abandoned ones are swept to
--                                                 denied after 30 min)
--        AND created_at >= p_from  (if p_from is not NULL)
--        AND created_at <  p_to    (if p_to   is not NULL)
--      Half-open [p_from, p_to): the client sends p_to = 00:00 of the day
--      AFTER the selected end date (Costa Rica time), so the whole end date is
--      included, 23:59:59.999 too, and nothing from the next day leaks in.
--      NULL = unbounded on that side. LANGUAGE sql, no SET clause, SECURITY
--      INVOKER, so the planner inlines it. Not callable through the API.
--   2. analytics_sales_summary(p_from, p_to)              NEW, admin-only.
--   3. analytics_sales_best_sellers(p_from, p_to, p_limit) NEW, admin-only.
--      Both defaults are NULL (= unbounded): omitting a bound can never
--      silently narrow the period again. p_to <= p_from → 22023.
--      Non-admin → 42501.
--   4. analytics_revenue_summary / analytics_best_sellers  BODY REPLACED.
--      Same signatures, same defaults, same results for admins — they now
--      delegate to (2)/(3), so they inherit the admin check. Kept so the
--      currently deployed client keeps working until the new one ships; the
--      new client no longer calls them. Safe to DROP in a later migration.
--   5. EXECUTE: new public RPCs → authenticated only (the admin check is
--      inside); helper → nobody but the owner; anon revoked everywhere.
--
-- UNCHANGED
--   Status rule (everything except 'denied' counts), revenue = orders.total,
--   units = SUM(order_items.quantity), AOV = AVG(orders.total), best-seller
--   grouping and ranking by units · analytics_low_stock · RLS · tables.
--
-- DEPLOY ORDER
--   Apply this migration BEFORE deploying the client that calls
--   analytics_sales_summary / analytics_sales_best_sellers. Applying it first
--   is safe for the client currently in production (see 4).
--
-- Idempotent: CREATE OR REPLACE + REVOKE/GRANT. Safe to run twice.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Internal helper: which orders count toward sales in [p_from, p_to)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.analytics_countable_orders(
  p_from TIMESTAMPTZ,
  p_to   TIMESTAMPTZ
)
RETURNS SETOF public.orders
LANGUAGE sql
STABLE
AS $$
  SELECT o.*
    FROM public.orders o
   WHERE o.order_status <> 'denied'::public.order_status
     AND (p_from IS NULL OR o.created_at >= p_from)
     AND (p_to   IS NULL OR o.created_at <  p_to);
$$;

COMMENT ON FUNCTION public.analytics_countable_orders(TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Internal. Orders that count toward sales in [p_from, p_to); NULL bound = unbounded. Excludes denied.';

REVOKE ALL ON FUNCTION public.analytics_countable_orders(TIMESTAMPTZ, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. Revenue summary for a period (admin-only)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.analytics_sales_summary(
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to   TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  total_orders    BIGINT,
  gross_revenue   NUMERIC,
  total_units     BIGINT,
  avg_order_value NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'analytics_sales_summary: admin only' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_to <= p_from THEN
    RAISE EXCEPTION 'analytics_sales_summary: p_to (%) must be after p_from (%)', p_to, p_from
      USING ERRCODE = '22023';
  END IF;

  -- An aggregate without GROUP BY always yields exactly one row, so an empty
  -- period returns real zeros rather than "no data".
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT,
    COALESCE(SUM(o.total), 0)::NUMERIC,
    COALESCE(SUM(s.units), 0)::BIGINT,
    COALESCE(AVG(o.total), 0)::NUMERIC
  FROM public.analytics_countable_orders(p_from, p_to) o
  LEFT JOIN LATERAL (
    SELECT SUM(oi.quantity) AS units
      FROM public.order_items oi
     WHERE oi.order_id = o.id
  ) s ON TRUE;
END;
$$;

REVOKE ALL     ON FUNCTION public.analytics_sales_summary(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.analytics_sales_summary(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. Best sellers for a period (admin-only)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.analytics_sales_best_sellers(
  p_from  TIMESTAMPTZ DEFAULT NULL,
  p_to    TIMESTAMPTZ DEFAULT NULL,
  p_limit INT         DEFAULT 10
)
RETURNS TABLE (
  variant_id    UUID,
  product_name  TEXT,
  brand_name    TEXT,
  product_type  public.product_type,
  size_ml       NUMERIC,
  sku           TEXT,
  total_units   BIGINT,
  total_revenue NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'analytics_sales_best_sellers: admin only' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_to <= p_from THEN
    RAISE EXCEPTION 'analytics_sales_best_sellers: p_to (%) must be after p_from (%)', p_to, p_from
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    oi.variant_id,
    oi.product_name,
    oi.brand_name,
    oi.product_type,
    oi.size_ml,
    oi.sku,
    SUM(oi.quantity)::BIGINT   AS units,
    SUM(oi.line_total)::NUMERIC AS revenue
  FROM public.order_items oi
  JOIN public.analytics_countable_orders(p_from, p_to) o ON o.id = oi.order_id
  GROUP BY oi.variant_id, oi.product_name, oi.brand_name,
           oi.product_type, oi.size_ml, oi.sku
  -- Units first (the documented ranking); revenue and name only break ties so
  -- the top 10 is deterministic.
  ORDER BY units DESC, revenue DESC, oi.product_name, oi.sku
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 100);
END;
$$;

REVOKE ALL     ON FUNCTION public.analytics_sales_best_sellers(TIMESTAMPTZ, TIMESTAMPTZ, INT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.analytics_sales_best_sellers(TIMESTAMPTZ, TIMESTAMPTZ, INT) TO authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. Legacy RPCs: same signature/defaults, now delegate (→ admin-only)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.analytics_revenue_summary(
  p_since TIMESTAMPTZ DEFAULT now() - INTERVAL '30 days'
)
RETURNS TABLE (
  total_orders    BIGINT,
  gross_revenue   NUMERIC,
  total_units     BIGINT,
  avg_order_value NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.analytics_sales_summary(p_since, NULL);
$$;

CREATE OR REPLACE FUNCTION public.analytics_best_sellers(
  p_limit INT         DEFAULT 10,
  p_since TIMESTAMPTZ DEFAULT now() - INTERVAL '30 days'
)
RETURNS TABLE (
  variant_id    UUID,
  product_name  TEXT,
  brand_name    TEXT,
  product_type  public.product_type,
  size_ml       NUMERIC,
  sku           TEXT,
  total_units   BIGINT,
  total_revenue NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.analytics_sales_best_sellers(p_since, NULL, p_limit);
$$;

REVOKE ALL     ON FUNCTION public.analytics_revenue_summary(TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.analytics_revenue_summary(TIMESTAMPTZ) TO authenticated;
REVOKE ALL     ON FUNCTION public.analytics_best_sellers(INT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.analytics_best_sellers(INT, TIMESTAMPTZ) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- VERIFICATION (run after applying; each should match the expected value)
-- ============================================================================
-- 1. All four RPCs + helper exist (expect 5 rows):
--    SELECT p.proname, pg_get_function_identity_arguments(p.oid)
--      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--     WHERE n.nspname = 'public'
--       AND p.proname IN ('analytics_countable_orders', 'analytics_sales_summary',
--                         'analytics_sales_best_sellers', 'analytics_revenue_summary',
--                         'analytics_best_sellers')
--     ORDER BY 1;
--
-- 2. anon can execute NONE of them (expect all false):
--    SELECT has_function_privilege('anon', 'public.analytics_sales_summary(timestamptz,timestamptz)', 'EXECUTE')            AS sales_summary,
--           has_function_privilege('anon', 'public.analytics_sales_best_sellers(timestamptz,timestamptz,int)', 'EXECUTE')   AS sales_best,
--           has_function_privilege('anon', 'public.analytics_revenue_summary(timestamptz)', 'EXECUTE')                      AS legacy_summary,
--           has_function_privilege('anon', 'public.analytics_best_sellers(int,timestamptz)', 'EXECUTE')                     AS legacy_best,
--           has_function_privilege('anon', 'public.analytics_countable_orders(timestamptz,timestamptz)', 'EXECUTE')         AS helper;
--
-- 3. authenticated: RPCs true, helper false:
--    SELECT has_function_privilege('authenticated', 'public.analytics_sales_summary(timestamptz,timestamptz)', 'EXECUTE')          AS sales_summary,
--           has_function_privilege('authenticated', 'public.analytics_sales_best_sellers(timestamptz,timestamptz,int)', 'EXECUTE') AS sales_best,
--           has_function_privilege('authenticated', 'public.analytics_countable_orders(timestamptz,timestamptz)', 'EXECUTE')       AS helper;
--
-- 4. Ground truth the dashboard's "Todo" must now show (compare with the UI):
--    SELECT count(*) AS orders, COALESCE(sum(total), 0) AS revenue
--      FROM public.orders WHERE order_status <> 'denied';
--
-- 5. Outside SQL: the anon key must now be refused (expect HTTP 401/403, code 42501):
--    curl -X POST "$SUPABASE_URL/rest/v1/rpc/analytics_revenue_summary" \
--      -H "apikey: $ANON_KEY" -H "Content-Type: application/json" -d '{}'
--
-- Behavioural suite: supabase/tests/20261114000100_analytics_sales_date_range_test.sql
-- ============================================================================
