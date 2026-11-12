-- ============================================================================
-- DB-LEVEL TEST SUITE -- Ligar Pedidos (migration 20261110000200_admin_link_orders.sql)
-- ============================================================================
-- HOW TO RUN
--   Paste this whole file into the Supabase SQL Editor (TESTING project) and
--   run it AFTER applying the migration.
--
--   Everything happens inside BEGIN ... ROLLBACK: test users, orders, XP events,
--   coupons issued by level-ups and audit rows never survive the script.
--
--   PASS -> the final SELECT prints "ALL LINK ORDER TESTS PASSED".
--   FAIL -> the script aborts with `assertion failed` naming the test, and the
--           transaction rolls back.
--
-- HOW THE CALLER IS FAKED
--   auth.uid() reads request.jwt.claims; act_as() sets it. For the GRANT / RLS
--   tests the Postgres role is switched too (SET LOCAL ROLE authenticated /
--   anon), like PostgREST does. Nothing is stubbed.
--
-- WHAT IS COVERED
--   K1  customers and guests can neither list nor link
--   K2  the list holds only user_id IS NULL orders; search by name, by phone in
--       any format, by "#order number"; status filter; total_count
--   K3  shipped order: linked, XP granted once (formula), ledger + balance +
--       audit row, every other column of the order unchanged
--   K4  received order: XP on subtotal - discount
--   K5  pending order: no XP at link time; the EXISTING trigger awards it to
--       the new owner when the order moves to received
--   K6  cancelled order: linked, never XP
--   K7  an order that already has an owner is refused, nothing changes, no
--       second XP (two admins, same order)
--   K8  an order whose XP was granted before (owner removed in Studio) is
--       linked but grants nothing again
--   K9  admin accounts are not linkable customers
--   K10 unknown order / unknown account
--   K11 the linked order is visible to its new owner through RLS
--   K12 grant_order_xp still refuses pending and denied orders
--   K13 grants: grant_order_xp is not an API; the admin RPCs refuse anon
--   K14 balance invariant: profile XP = sum of its ledger rows
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

CREATE OR REPLACE FUNCTION pg_temp.act_as_guest() RETURNS VOID
LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
END $f$;

CREATE OR REPLACE FUNCTION pg_temp.try(p_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $f$;

CREATE OR REPLACE FUNCTION pg_temp.make_user(p_id UUID, p_email TEXT) RETURNS VOID
LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    p_email, 'x', now(), '{"provider":"email","providers":["email"]}'::jsonb,
    json_build_object('full_name', p_email)::jsonb, now(), now()
  );
END $f$;

-- A historical guest order, inserted directly in its final status (the award
-- trigger is AFTER UPDATE, so it does not fire — exactly the situation of an
-- order that went through `received` while it had no owner).
CREATE OR REPLACE FUNCTION pg_temp.guest_order(
  p_tag TEXT, p_status TEXT, p_subtotal NUMERIC, p_discount NUMERIC DEFAULT 0,
  p_phone TEXT DEFAULT '+506 8877 6655'
) RETURNS UUID
LANGUAGE plpgsql AS $f$
DECLARE v_id UUID;
BEGIN
  INSERT INTO public.orders (
    user_id, customer_name, customer_email, customer_phone,
    shipping_address, shipping_district, shipping_canton, shipping_province,
    shipping_cost, subtotal, discount, total, source, order_status, payment_status,
    payment_reference, notes
  ) VALUES (
    NULL, 'PG Link ' || p_tag, NULL, p_phone,
    '100m sur del parque', 'Cariari', 'Pococí', 'Limón',
    2900, p_subtotal, p_discount, p_subtotal - p_discount + 2900, 'admin',
    p_status::public.order_status,
    CASE WHEN p_status IN ('received', 'shipped') THEN 'paid' ELSE 'pending' END::public.payment_status,
    'PG-REF-' || p_tag, 'nota ' || p_tag
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

DO $$
DECLARE
  v_admin  UUID := gen_random_uuid();
  v_admin2 UUID := gen_random_uuid();
  v_ana    UUID := gen_random_uuid();
  v_beto   UUID := gen_random_uuid();

  o_shipped  UUID;  o_received UUID;  o_pending UUID;  o_denied UUID;
  o_prev     UUID;  o_owned    UUID;

  v_res    JSONB;
  v_err    TEXT;
  v_before JSONB;
  v_after  JSONB;
  v_xp0    INT;
  v_n      INT;
  v_num    BIGINT;
BEGIN
  -- ══ ARRANGE ═══════════════════════════════════════════════════════════════
  PERFORM pg_temp.make_user(v_admin,  'pglink-admin@krov.test');
  PERFORM pg_temp.make_user(v_admin2, 'pglink-admin2@krov.test');
  PERFORM pg_temp.make_user(v_ana,    'pglink-ana@krov.test');
  PERFORM pg_temp.make_user(v_beto,   'pglink-beto@krov.test');
  UPDATE public.profiles SET role = 'admin' WHERE id IN (v_admin, v_admin2);

  o_shipped  := pg_temp.guest_order('shipped',  'shipped',  42900);
  o_received := pg_temp.guest_order('received', 'received', 10500, 500);
  o_pending  := pg_temp.guest_order('pending',  'pending',  20000);
  o_denied   := pg_temp.guest_order('denied',   'denied',   30000);
  o_prev     := pg_temp.guest_order('prev',     'shipped',  15000);
  o_owned    := pg_temp.guest_order('owned',    'shipped',  9000);
  UPDATE public.orders SET user_id = v_beto WHERE id = o_owned;

  -- o_prev was credited to Beto once, then its owner was removed in Studio.
  INSERT INTO public.profile_experience_events (user_id, order_id, xp_earned)
  VALUES (v_beto, o_prev, 750);
  UPDATE public.profiles SET experience_points = experience_points + 750 WHERE id = v_beto;

  -- ══ K1. Customers and guests are refused ═════════════════════════════════
  PERFORM pg_temp.act_as(v_ana);
  v_err := pg_temp.try('SELECT * FROM public.admin_list_unlinked_orders()');
  ASSERT v_err LIKE 'Insufficient privilege%', format('K1a: list, got %s', v_err);
  v_err := pg_temp.try(format('SELECT public.admin_link_order_to_customer(%L, %L)', o_shipped, v_ana));
  ASSERT v_err LIKE 'Insufficient privilege%', format('K1b: link, got %s', v_err);
  PERFORM pg_temp.act_as_guest();
  v_err := pg_temp.try(format('SELECT public.admin_link_order_to_customer(%L, %L)', o_shipped, v_ana));
  ASSERT v_err LIKE 'Insufficient privilege%', format('K1c: guest, got %s', v_err);
  ASSERT (SELECT user_id FROM public.orders WHERE id = o_shipped) IS NULL, 'K1d: still unlinked';

  PERFORM pg_temp.act_as(v_admin);

  -- ══ K2. The list ═════════════════════════════════════════════════════════
  SELECT count(*) INTO v_n FROM public.admin_list_unlinked_orders('PG Link', NULL, NULL, 100, 0);
  ASSERT v_n = 5, format('K2a: 5 unlinked test orders (owned one excluded), got %s', v_n);
  ASSERT NOT EXISTS (SELECT 1 FROM public.admin_list_unlinked_orders('PG Link owned', NULL, NULL, 100, 0)),
    'K2b: an owned order is never listed';
  -- Phone typed differently from how it was stored.
  ASSERT EXISTS (SELECT 1 FROM public.admin_list_unlinked_orders('8877-6655', NULL, NULL, 100, 0) l
                  WHERE l.id = o_shipped), 'K2c: phone search ignores formatting';
  SELECT order_number INTO v_num FROM public.orders WHERE id = o_received;
  ASSERT (SELECT array_agg(l.id) FROM public.admin_list_unlinked_orders('#' || v_num, NULL, NULL, 100, 0) l)
         @> ARRAY[o_received], 'K2d: "#number" finds the order';
  SELECT count(*) INTO v_n FROM public.admin_list_unlinked_orders('PG Link', 'shipped', NULL, 100, 0);
  ASSERT v_n = 2, format('K2e: status filter, got %s', v_n);
  ASSERT (SELECT max(l.total_count) FROM public.admin_list_unlinked_orders('PG Link', NULL, NULL, 2, 0) l) = 5,
    'K2f: total_count is the whole filtered set, not the page';
  v_err := pg_temp.try('SELECT * FROM public.admin_list_unlinked_orders(NULL, ''bogus'')');
  ASSERT v_err = 'link_invalid_request', format('K2g: bad status, got %s', v_err);

  -- ══ K3. Shipped order → XP now, nothing else changes ═════════════════════
  SELECT to_jsonb(o) - 'user_id' - 'updated_at' INTO v_before FROM public.orders o WHERE o.id = o_shipped;
  SELECT experience_points INTO v_xp0 FROM public.profiles WHERE id = v_ana;

  v_res := public.admin_link_order_to_customer(o_shipped, v_ana);

  ASSERT v_res->>'xp_status' = 'granted', format('K3a: got %s', v_res);
  ASSERT (v_res->>'xp_awarded')::INT = 2100, 'K3b: floor(42900/1000)*50 = 2100';
  ASSERT (SELECT experience_points FROM public.profiles WHERE id = v_ana) = v_xp0 + 2100, 'K3c: balance';
  ASSERT (v_res->>'xp_balance')::INT = v_xp0 + 2100, 'K3d: reported balance';
  ASSERT (SELECT user_id = v_ana AND xp_earned = 2100 FROM public.profile_experience_events
           WHERE order_id = o_shipped), 'K3e: ledger row for the new owner';
  ASSERT (SELECT user_id FROM public.orders WHERE id = o_shipped) = v_ana, 'K3f: owner set';
  SELECT to_jsonb(o) - 'user_id' - 'updated_at' INTO v_after FROM public.orders o WHERE o.id = o_shipped;
  ASSERT v_after = v_before, format('K3g: nothing else changed: %s vs %s', v_before, v_after);
  ASSERT (SELECT count(*) FROM public.order_account_links
           WHERE order_id = o_shipped AND user_id = v_ana AND linked_by = v_admin
             AND xp_status = 'granted' AND xp_awarded = 2100 AND order_status_at_link = 'shipped') = 1,
    'K3h: audit row';

  -- ══ K4. Received order, discount respected ═══════════════════════════════
  v_res := public.admin_link_order_to_customer(o_received, v_ana);
  ASSERT v_res->>'xp_status' = 'granted' AND (v_res->>'xp_awarded')::INT = 500,
    format('K4: floor((10500-500)/1000)*50 = 500, got %s', v_res);

  -- ══ K5. Pending: later, by the existing trigger ══════════════════════════
  SELECT experience_points INTO v_xp0 FROM public.profiles WHERE id = v_ana;
  v_res := public.admin_link_order_to_customer(o_pending, v_ana);
  ASSERT v_res->>'xp_status' = 'pending_status' AND (v_res->>'xp_awarded')::INT = 0,
    format('K5a: got %s', v_res);
  ASSERT NOT EXISTS (SELECT 1 FROM public.profile_experience_events WHERE order_id = o_pending),
    'K5b: no XP at link time';
  ASSERT (SELECT experience_points FROM public.profiles WHERE id = v_ana) = v_xp0, 'K5c: balance unchanged';
  UPDATE public.orders SET order_status = 'received' WHERE id = o_pending;
  ASSERT (SELECT user_id = v_ana AND xp_earned = 1000 FROM public.profile_experience_events
           WHERE order_id = o_pending), 'K5d: trigger credited the new owner on received';
  ASSERT (SELECT experience_points FROM public.profiles WHERE id = v_ana) = v_xp0 + 1000, 'K5e: balance';
  UPDATE public.orders SET order_status = 'shipped' WHERE id = o_pending;
  ASSERT (SELECT count(*) FROM public.profile_experience_events WHERE order_id = o_pending) = 1,
    'K5f: shipping it afterwards awards nothing more';

  -- ══ K6. Cancelled ════════════════════════════════════════════════════════
  v_res := public.admin_link_order_to_customer(o_denied, v_ana);
  ASSERT v_res->>'xp_status' = 'not_eligible', format('K6a: got %s', v_res);
  ASSERT NOT EXISTS (SELECT 1 FROM public.profile_experience_events WHERE order_id = o_denied), 'K6b';
  ASSERT (SELECT user_id FROM public.orders WHERE id = o_denied) = v_ana, 'K6c: still linked';

  -- ══ K7. Already owned — the second admin loses, nothing changes ══════════
  SELECT experience_points INTO v_xp0 FROM public.profiles WHERE id = v_beto;
  PERFORM pg_temp.act_as(v_admin2);
  v_err := pg_temp.try(format('SELECT public.admin_link_order_to_customer(%L, %L)', o_shipped, v_beto));
  ASSERT v_err = 'link_order_already_linked', format('K7a: got %s', v_err);
  v_err := pg_temp.try(format('SELECT public.admin_link_order_to_customer(%L, %L)', o_shipped, v_ana));
  ASSERT v_err = 'link_order_already_linked', format('K7b: same account again, got %s', v_err);
  ASSERT (SELECT user_id FROM public.orders WHERE id = o_shipped) = v_ana, 'K7c: owner unchanged';
  ASSERT (SELECT count(*) FROM public.profile_experience_events WHERE order_id = o_shipped) = 1, 'K7d: one XP row';
  ASSERT (SELECT experience_points FROM public.profiles WHERE id = v_beto) = v_xp0, 'K7e: Beto unchanged';
  ASSERT (SELECT count(*) FROM public.order_account_links WHERE order_id = o_shipped) = 1, 'K7f: one audit row';
  PERFORM pg_temp.act_as(v_admin);

  -- ══ K8. XP granted before → never again ══════════════════════════════════
  SELECT experience_points INTO v_xp0 FROM public.profiles WHERE id = v_ana;
  v_res := public.admin_link_order_to_customer(o_prev, v_ana);
  ASSERT v_res->>'xp_status' = 'already_granted' AND (v_res->>'xp_awarded')::INT = 0,
    format('K8a: got %s', v_res);
  ASSERT (SELECT experience_points FROM public.profiles WHERE id = v_ana) = v_xp0, 'K8b: Ana unchanged';
  ASSERT (SELECT user_id FROM public.profile_experience_events WHERE order_id = o_prev) = v_beto,
    'K8c: the original ledger row is untouched';

  -- ══ K9. Admin accounts are not customers ═════════════════════════════════
  v_err := pg_temp.try(format('SELECT public.admin_link_order_to_customer(%L, %L)',
                              pg_temp.guest_order('k9', 'shipped', 5000), v_admin2));
  ASSERT v_err = 'link_customer_not_eligible', format('K9: got %s', v_err);

  -- ══ K10. Unknown ids ═════════════════════════════════════════════════════
  v_err := pg_temp.try(format('SELECT public.admin_link_order_to_customer(%L, %L)', gen_random_uuid(), v_ana));
  ASSERT v_err = 'link_order_not_found', format('K10a: got %s', v_err);
  v_err := pg_temp.try(format('SELECT public.admin_link_order_to_customer(%L, %L)',
                              pg_temp.guest_order('k10', 'shipped', 5000), gen_random_uuid()));
  ASSERT v_err = 'link_customer_not_found', format('K10b: got %s', v_err);
  v_err := pg_temp.try('SELECT public.admin_link_order_to_customer(NULL, NULL)');
  ASSERT v_err = 'link_invalid_request', format('K10c: got %s', v_err);

  -- ══ K11. The new owner sees it (RLS) ═════════════════════════════════════
  PERFORM pg_temp.act_as(v_ana);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.orders WHERE id IN (o_shipped, o_received, o_pending, o_denied, o_prev);
  RESET ROLE;
  ASSERT v_n = 5, format('K11: Ana sees her 5 linked orders, got %s', v_n);

  -- ══ K12. The award guard still refuses pending and denied ════════════════
  ASSERT public.grant_order_xp(pg_temp.guest_order('k12p', 'pending', 5000))->>'reason' = 'not_received', 'K12a';
  ASSERT public.grant_order_xp(pg_temp.guest_order('k12d', 'denied', 5000))->>'reason' = 'not_received', 'K12b';

  -- ══ K13. Grants ══════════════════════════════════════════════════════════
  PERFORM pg_temp.act_as(v_admin);
  SET LOCAL ROLE authenticated;
  v_err := NULL;
  BEGIN
    PERFORM public.grant_order_xp(o_shipped);
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  ASSERT v_err = '42501', format('K13a: grant_order_xp must not be callable by authenticated, got %s', v_err);
  RESET ROLE;

  SET LOCAL ROLE anon;
  v_err := NULL;
  BEGIN
    PERFORM public.admin_link_order_to_customer(o_shipped, v_ana);
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  ASSERT v_err = '42501', format('K13b: anon cannot call the link RPC, got %s', v_err);
  v_err := NULL;
  BEGIN
    PERFORM * FROM public.admin_list_unlinked_orders();
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  ASSERT v_err = '42501', format('K13c: anon cannot call the list RPC, got %s', v_err);
  RESET ROLE;

  -- ══ K14. Balance invariant for the suite's customers ═════════════════════
  ASSERT NOT EXISTS (
    SELECT 1
      FROM public.profiles p
      LEFT JOIN public.profile_experience_events e ON e.user_id = p.id
     WHERE p.id IN (v_ana, v_beto)
     GROUP BY p.id, p.experience_points
    HAVING p.experience_points <> COALESCE(SUM(e.xp_earned), 0)
  ), 'K14: profile XP = sum of ledger rows';
END $$;

SELECT 'ALL LINK ORDER TESTS PASSED' AS result;

ROLLBACK;
