-- ============================================================================
-- DB-LEVEL TEST SUITE -- Sales dashboard date ranges
-- (migration 20261114000100_analytics_sales_date_range.sql)
-- ============================================================================
-- HOW TO RUN
--   Paste this whole file into the Supabase SQL Editor (TESTING project) and
--   run it AFTER applying 20261114000100.
--
--   Everything happens inside BEGIN ... ROLLBACK: the test admin, the test
--   customer and every fixture order never survive the script. Real orders are
--   never touched; assertions on unbounded periods ("Todo", rolling windows)
--   compare a BASELINE taken before the fixtures with the result after them,
--   so they hold whatever real data the database already has.
--
--   Side effect that ROLLBACK cannot undo: the orders.order_number identity
--   advances by the ~1,515 fixture orders (sequences are not transactional).
--   Harmless on TESTING; do not run this on production.
--
--   PASS -> the final SELECT prints "ALL SALES DATE RANGE TESTS PASSED".
--   FAIL -> the script aborts with `assertion failed` naming the test.
--
-- FIXTURES
--   Bounded periods use calendar dates in 2001 and 2002, where no real order
--   exists, written as Costa Rica wall-clock time (-06, no DST) — exactly the
--   bounds lib/analytics/dateRange.ts sends for a custom range:
--     start date D  → p_from = D 00:00 -06
--     end date   E  → p_to   = (E + 1 day) 00:00 -06   (exclusive)
--
--     tag  created_at (CR)              status    total    units
--     A    2001-03-15 12:00             received   10 000   1     (months before)
--     C    2001-05-31 23:59:59.999      received   40 000   1     (1 ms before range)
--     B    2001-06-01 00:00:00          shipped    20 000   2     (range start, exact)
--     G    2001-06-15 10:00             pending     1 000   1     (pending counts)
--     F    2001-06-15 11:00             denied    320 000   5     (never counts)
--     D    2001-06-30 23:59:59.999      pending    80 000   3     (end date, late night)
--     E    2001-07-01 00:00:00          shipped   160 000   1     (first instant after)
--
--   Custom range 2001-06-01 → 2001-06-30  ⇒  B + G + D = 3 orders, ₡101 000, 6 units.
--
-- WHAT IS COVERED
--   T1  "Todo" (both bounds NULL) includes orders older than 90 days
--   T2  "Todo" total = baseline + every non-denied fixture; denied excluded
--   T3  "Todo" is never below the 90-day window (the production symptom)
--   T4  rolling 7 / 30 / 90-day windows (p_from = now() - N days, p_to NULL)
--       include an order just inside and exclude one just outside
--   T5  custom range includes the start date's first instant
--   T6  custom range includes the end date's last instant (23:59:59.999)
--   T7  custom range excludes the instant before and the instant after
--   T8  one-day ranges
--   T9  invalid ranges (end before start, empty) → 22023
--   T10 best sellers honour the same period and status rule as the summary
--   T11 1,500 orders in one period aggregate completely (beyond PostgREST's
--       1,000-row cap) — the RPC returns one aggregated row
--   T12 legacy analytics_revenue_summary / analytics_best_sellers delegate
--       (same numbers for an admin)
--   T13 access: anon and non-admin customers are refused (42501); the helper
--       is not executable through the API
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_user UUID) RETURNS VOID
LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text,
    true
  );
END $f$;

CREATE OR REPLACE FUNCTION pg_temp.make_user(p_id UUID, p_email TEXT) RETURNS VOID
LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    p_email, 'x', now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    json_build_object('full_name', p_email)::jsonb, now(), now()
  );
END $f$;

-- One order with one line of p_units units, created at p_at.
CREATE OR REPLACE FUNCTION pg_temp.sale(
  p_tag TEXT, p_at TIMESTAMPTZ, p_status TEXT, p_total NUMERIC, p_units INT,
  p_sku TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql AS $f$
DECLARE v_id UUID;
BEGIN
  INSERT INTO public.orders (
    user_id, customer_name, customer_email, customer_phone,
    shipping_address, shipping_district, shipping_canton, shipping_province,
    shipping_cost, subtotal, discount, total, source, order_status, payment_status,
    created_at
  ) VALUES (
    NULL, 'PG Sales ' || p_tag, 'pgsales-guest@krov.test', '00000000',
    '100m sur', 'Cariari', 'Pococí', 'Limón',
    0, p_total, 0, p_total, 'web',
    p_status::public.order_status,
    CASE WHEN p_status IN ('received', 'shipped') THEN 'paid' ELSE 'pending' END::public.payment_status,
    p_at
  ) RETURNING id INTO v_id;

  INSERT INTO public.order_items (
    order_id, variant_id, product_name, brand_name, product_type,
    size_ml, sku, quantity, unit_price, line_total
  ) VALUES (
    v_id, NULL, 'PG Sales ' || p_tag, 'PG Brand', 'full_size',
    100, COALESCE(p_sku, 'PGSALES-' || p_tag), p_units,
    round(p_total / p_units, 2), p_total
  );
  RETURN v_id;
END $f$;

-- Summary shortcuts (caller must be acting as an admin).
CREATE OR REPLACE FUNCTION pg_temp.orders_in(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ) RETURNS BIGINT
LANGUAGE sql AS $f$ SELECT total_orders FROM public.analytics_sales_summary(p_from, p_to) $f$;
CREATE OR REPLACE FUNCTION pg_temp.revenue_in(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ) RETURNS NUMERIC
LANGUAGE sql AS $f$ SELECT gross_revenue FROM public.analytics_sales_summary(p_from, p_to) $f$;
CREATE OR REPLACE FUNCTION pg_temp.units_in(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ) RETURNS BIGINT
LANGUAGE sql AS $f$ SELECT total_units FROM public.analytics_sales_summary(p_from, p_to) $f$;

DO $$
DECLARE
  u_admin    UUID := gen_random_uuid();
  u_customer UUID := gen_random_uuid();

  -- Custom-range bounds as the client computes them (CR = -06).
  jun_from TIMESTAMPTZ := '2001-06-01 00:00:00-06';
  jun_to   TIMESTAMPTZ := '2001-07-01 00:00:00-06';   -- end date 2001-06-30, exclusive next midnight

  -- Baselines (real data) taken BEFORE any fixture.
  b_all_orders BIGINT;  b_all_rev NUMERIC;  b_all_units BIGINT;
  b_90_orders  BIGINT;  b_90_rev  NUMERIC;
  b_30_orders  BIGINT;  b_7_orders BIGINT;

  v_now   TIMESTAMPTZ := now();   -- now() is fixed for the whole transaction
  v_s     RECORD;
  v_n     BIGINT;
  v_err   TEXT;
BEGIN
  -- ══ ARRANGE ═════════════════════════════════════════════════════════════
  PERFORM pg_temp.make_user(u_admin,    'pgsales-admin@krov.test');
  PERFORM pg_temp.make_user(u_customer, 'pgsales-customer@krov.test');
  UPDATE public.profiles SET role = 'admin' WHERE id = u_admin;
  PERFORM pg_temp.act_as(u_admin);

  b_all_orders := pg_temp.orders_in(NULL, NULL);
  b_all_rev    := pg_temp.revenue_in(NULL, NULL);
  b_all_units  := pg_temp.units_in(NULL, NULL);
  b_90_orders  := pg_temp.orders_in(v_now - INTERVAL '90 days', NULL);
  b_90_rev     := pg_temp.revenue_in(v_now - INTERVAL '90 days', NULL);
  b_30_orders  := pg_temp.orders_in(v_now - INTERVAL '30 days', NULL);
  b_7_orders   := pg_temp.orders_in(v_now - INTERVAL '7 days',  NULL);

  ASSERT pg_temp.orders_in('2001-01-01 00:00-06', '2003-01-01 00:00-06') = 0,
    'precondition: no real orders in 2001-2002';

  PERFORM pg_temp.sale('A', '2001-03-15 12:00:00-06',     'received',  10000, 1);
  PERFORM pg_temp.sale('C', '2001-05-31 23:59:59.999-06', 'received',  40000, 1);
  PERFORM pg_temp.sale('B', '2001-06-01 00:00:00-06',     'shipped',   20000, 2);
  PERFORM pg_temp.sale('G', '2001-06-15 10:00:00-06',     'pending',    1000, 1);
  PERFORM pg_temp.sale('F', '2001-06-15 11:00:00-06',     'denied',   320000, 5);
  PERFORM pg_temp.sale('D', '2001-06-30 23:59:59.999-06', 'pending',   80000, 3);
  PERFORM pg_temp.sale('E', '2001-07-01 00:00:00-06',     'shipped',  160000, 1);

  -- Rolling-window probes, relative to now().
  PERFORM pg_temp.sale('IN7',   v_now - INTERVAL '6 days 23 hours',  'shipped', 700, 1);
  PERFORM pg_temp.sale('OUT7',  v_now - INTERVAL '7 days 1 hour',    'shipped', 701, 1);  -- in 30
  PERFORM pg_temp.sale('OUT30', v_now - INTERVAL '30 days 1 hour',   'shipped', 702, 1);  -- in 90
  PERFORM pg_temp.sale('OUT90', v_now - INTERVAL '90 days 1 hour',   'shipped', 703, 1);  -- only "Todo"

  -- ══ T1-T3. "Todo" ═══════════════════════════════════════════════════════
  -- Non-denied fixtures: A C B G D E (311 000) + 4 probes (2 806) = 10 orders.
  ASSERT pg_temp.orders_in(NULL, NULL) = b_all_orders + 10,
    format('T1/T2a: Todo counts every non-denied fixture incl. 2001 and >90d, got +%s',
           pg_temp.orders_in(NULL, NULL) - b_all_orders);
  ASSERT pg_temp.revenue_in(NULL, NULL) = b_all_rev + 313806,
    format('T2b: Todo revenue = baseline + 313806, got +%s', pg_temp.revenue_in(NULL, NULL) - b_all_rev);
  ASSERT pg_temp.units_in(NULL, NULL) = b_all_units + 13,
    format('T2c: Todo units = baseline + 13 (F excluded), got +%s', pg_temp.units_in(NULL, NULL) - b_all_units);
  SELECT * INTO v_s FROM public.analytics_sales_summary();   -- defaults: both NULL
  ASSERT v_s.total_orders = b_all_orders + 10, 'T2d: omitting both bounds means all time, never a default window';
  ASSERT abs(v_s.avg_order_value - v_s.gross_revenue / v_s.total_orders) < 0.000001,
    'T2e: AOV = revenue / orders on the same dataset';

  ASSERT pg_temp.revenue_in(NULL, NULL) >= pg_temp.revenue_in(v_now - INTERVAL '90 days', NULL),
    'T3a: Todo revenue is never below 90 days';
  ASSERT pg_temp.orders_in(NULL, NULL) >= pg_temp.orders_in(v_now - INTERVAL '90 days', NULL),
    'T3b: Todo orders are never below 90 days';

  -- ══ T4. Rolling windows ═════════════════════════════════════════════════
  ASSERT pg_temp.orders_in(v_now - INTERVAL '7 days', NULL) = b_7_orders + 1,
    format('T4a: 7d gets IN7 only, got +%s', pg_temp.orders_in(v_now - INTERVAL '7 days', NULL) - b_7_orders);
  ASSERT pg_temp.orders_in(v_now - INTERVAL '30 days', NULL) = b_30_orders + 2,
    format('T4b: 30d gets IN7+OUT7, got +%s', pg_temp.orders_in(v_now - INTERVAL '30 days', NULL) - b_30_orders);
  ASSERT pg_temp.orders_in(v_now - INTERVAL '90 days', NULL) = b_90_orders + 3,
    format('T4c: 90d gets IN7+OUT7+OUT30, got +%s', pg_temp.orders_in(v_now - INTERVAL '90 days', NULL) - b_90_orders);
  ASSERT pg_temp.revenue_in(v_now - INTERVAL '90 days', NULL) = b_90_rev + 2103,
    'T4d: 90d revenue excludes OUT90 and everything in 2001';

  -- ══ T5-T7. Custom range 2001-06-01 → 2001-06-30 ═════════════════════════
  SELECT * INTO v_s FROM public.analytics_sales_summary(jun_from, jun_to);
  ASSERT v_s.total_orders = 3,      format('T5-7a: B+G+D, got %s orders', v_s.total_orders);
  ASSERT v_s.gross_revenue = 101000, format('T5-7b: 20000+1000+80000, got %s', v_s.gross_revenue);
  ASSERT v_s.total_units = 6,       format('T5-7c: 2+1+3 units, got %s', v_s.total_units);
  ASSERT round(v_s.avg_order_value, 2) = 33666.67, format('T5-7d: AOV, got %s', v_s.avg_order_value);

  ASSERT pg_temp.orders_in(jun_from, jun_from + INTERVAL '1 microsecond') = 1,
    'T5: the start date''s first instant (B, 00:00:00.000) is included';
  ASSERT pg_temp.orders_in(jun_to - INTERVAL '1 millisecond', jun_to) = 1,
    'T6: the end date''s 23:59:59.999 (D) is included';
  ASSERT pg_temp.orders_in(jun_from - INTERVAL '1 millisecond', jun_from) = 1,
    'T7a: C (1 ms before the start) exists, and T5-7a shows it is not counted';
  ASSERT pg_temp.orders_in(jun_to, jun_to + INTERVAL '1 day') = 1,
    'T7b: E (first instant after the end date) exists but p_to is exclusive';

  -- ══ T8. One-day ranges ══════════════════════════════════════════════════
  ASSERT pg_temp.orders_in('2001-06-01 00:00-06', '2001-06-02 00:00-06') = 1, 'T8a: June 1 = B';
  ASSERT pg_temp.revenue_in('2001-06-30 00:00-06', '2001-07-01 00:00-06') = 80000, 'T8b: June 30 = D (late night)';
  ASSERT pg_temp.orders_in('2001-06-15 00:00-06', '2001-06-16 00:00-06') = 1, 'T8c: June 15 = G, F denied';
  SELECT * INTO v_s FROM public.analytics_sales_summary('2001-06-10 00:00-06', '2001-06-11 00:00-06');
  ASSERT v_s.total_orders = 0 AND v_s.gross_revenue = 0 AND v_s.total_units = 0 AND v_s.avg_order_value = 0,
    'T8d: an empty day returns one row of real zeros';

  -- ══ T9. Invalid ranges ══════════════════════════════════════════════════
  v_err := NULL;
  BEGIN PERFORM * FROM public.analytics_sales_summary(jun_to, jun_from);
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  ASSERT v_err = '22023', format('T9a: end before start, got %s', v_err);
  v_err := NULL;
  BEGIN PERFORM * FROM public.analytics_sales_summary(jun_from, jun_from);
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  ASSERT v_err = '22023', format('T9b: empty range, got %s', v_err);
  v_err := NULL;
  BEGIN PERFORM * FROM public.analytics_sales_best_sellers(jun_to, jun_from, 10);
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  ASSERT v_err = '22023', format('T9c: best sellers reject it too, got %s', v_err);

  -- ══ T10. Best sellers use the same period + status rule ═════════════════
  ASSERT (SELECT array_agg(sku ORDER BY sku) FROM public.analytics_sales_best_sellers(jun_from, jun_to, 10))
       = ARRAY['PGSALES-B', 'PGSALES-D', 'PGSALES-G'],
    'T10a: exactly B, D, G (no C, E, or denied F)';
  ASSERT (SELECT sku FROM public.analytics_sales_best_sellers(jun_from, jun_to, 10) LIMIT 1) = 'PGSALES-D',
    'T10b: ranked by units (D has 3)';
  ASSERT (SELECT sum(total_units) FROM public.analytics_sales_best_sellers(jun_from, jun_to, 10)) = 6
     AND (SELECT sum(total_revenue) FROM public.analytics_sales_best_sellers(jun_from, jun_to, 10)) = 101000,
    'T10c: best-seller units/revenue reconcile with the summary for the same period';
  ASSERT (SELECT count(*) FROM public.analytics_sales_best_sellers(jun_from, jun_to, 2)) = 2, 'T10d: p_limit';

  -- ══ T11. Large period: no truncation ════════════════════════════════════
  INSERT INTO public.orders (
    user_id, customer_name, customer_email, customer_phone,
    shipping_address, shipping_district, shipping_canton, shipping_province,
    shipping_cost, subtotal, discount, total, source, order_status, payment_status, created_at
  )
  SELECT NULL, 'PG Sales bulk ' || g, 'pgsales-guest@krov.test', '00000000',
         '100m sur', 'Cariari', 'Pococí', 'Limón',
         0, 100, 0, 100, 'web', 'shipped', 'paid',
         TIMESTAMPTZ '2002-01-01 00:00:00-06' + (g * INTERVAL '25 minutes')   -- spread over ~26 days
    FROM generate_series(1, 1500) g;
  INSERT INTO public.order_items (order_id, variant_id, product_name, brand_name, product_type,
                                  size_ml, sku, quantity, unit_price, line_total)
  SELECT o.id, NULL, 'PG Sales bulk', 'PG Brand', 'full_size', 100, 'PGSALES-BULK', 1, 100, 100
    FROM public.orders o
   WHERE o.customer_name LIKE 'PG Sales bulk %';

  SELECT * INTO v_s FROM public.analytics_sales_summary('2002-01-01 00:00-06', '2002-02-01 00:00-06');
  ASSERT v_s.total_orders = 1500, format('T11a: 1500 orders, got %s', v_s.total_orders);
  ASSERT v_s.gross_revenue = 150000 AND v_s.total_units = 1500, 'T11b: revenue/units over all 1500';
  ASSERT pg_temp.orders_in(NULL, NULL) = b_all_orders + 1510, 'T11c: Todo includes the bulk too';
  ASSERT (SELECT total_units FROM public.analytics_sales_best_sellers('2002-01-01 00:00-06', '2002-02-01 00:00-06', 10)
           WHERE sku = 'PGSALES-BULK') = 1500, 'T11d: best sellers aggregate all 1500 lines';

  -- ══ T12. Legacy RPCs delegate ═══════════════════════════════════════════
  ASSERT (SELECT total_orders FROM public.analytics_revenue_summary(jun_from)) = pg_temp.orders_in(jun_from, NULL),
    'T12a: legacy summary = new summary with an open end';
  ASSERT (SELECT count(*) FROM public.analytics_best_sellers(3, '2001-01-01 00:00-06')) = 3,
    'T12b: legacy best sellers honour p_limit';

  -- ══ T13. Access ═════════════════════════════════════════════════════════
  PERFORM pg_temp.act_as(u_customer);
  SET LOCAL ROLE authenticated;
  v_err := NULL;
  BEGIN PERFORM * FROM public.analytics_sales_summary();
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  ASSERT v_err = '42501', format('T13a: a customer cannot read revenue, got %s', v_err);
  v_err := NULL;
  BEGIN PERFORM * FROM public.analytics_sales_best_sellers();
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  ASSERT v_err = '42501', format('T13b: nor best sellers, got %s', v_err);
  v_err := NULL;
  BEGIN PERFORM * FROM public.analytics_revenue_summary();
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  ASSERT v_err = '42501', format('T13c: nor the legacy summary, got %s', v_err);
  v_err := NULL;
  BEGIN PERFORM * FROM public.analytics_countable_orders(NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  ASSERT v_err = '42501', format('T13d: the helper is not callable, got %s', v_err);
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  v_err := NULL;
  BEGIN PERFORM * FROM public.analytics_sales_summary();
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  ASSERT v_err = '42501', format('T13e: anon cannot read revenue, got %s', v_err);
  v_err := NULL;
  BEGIN PERFORM * FROM public.analytics_revenue_summary();
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  ASSERT v_err = '42501', format('T13f: nor the legacy summary (the leak), got %s', v_err);
  v_err := NULL;
  BEGIN PERFORM * FROM public.analytics_best_sellers();
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  ASSERT v_err = '42501', format('T13g: nor legacy best sellers, got %s', v_err);
  RESET ROLE;

  ASSERT NOT has_function_privilege('anon', 'public.analytics_sales_summary(timestamptz,timestamptz)', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'public.analytics_revenue_summary(timestamptz)', 'EXECUTE')
     AND NOT has_function_privilege('authenticated', 'public.analytics_countable_orders(timestamptz,timestamptz)', 'EXECUTE'),
    'T13h: grants';
END $$;

SELECT 'ALL SALES DATE RANGE TESTS PASSED' AS result;

ROLLBACK;
