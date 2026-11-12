-- ============================================================================
-- DB-LEVEL TEST SUITE -- Guest-order claim XP parity
-- (migration 20261111000100_claim_guest_orders_shipped_xp.sql)
-- ============================================================================
-- HOW TO RUN
--   Paste this whole file into the Supabase SQL Editor (TESTING project) and
--   run it AFTER applying 20261110000200 and 20261111000100.
--
--   Everything happens inside BEGIN ... ROLLBACK: test users, orders, XP events,
--   coupons issued by level-ups and audit rows never survive the script.
--   T15 runs the real backfill_guest_order_xp(), so inside the transaction it
--   also credits any real customer who is owed XP — rolled back with the rest;
--   assertions only look at the suite's own users.
--
--   PASS -> the final SELECT prints "ALL CLAIM XP PARITY TESTS PASSED".
--   FAIL -> the script aborts with `assertion failed` naming the test, and the
--           transaction rolls back.
--
-- HOW THE CLAIM IS TRIGGERED
--   Exactly like production: inserting a CONFIRMED auth.users row fires
--   on_auth_user_created (profile) then on_auth_user_email_confirmed_claim
--   (claim + XP); confirming later fires the UPDATE branch. Nothing is stubbed.
--
-- WHAT IS COVERED
--   T1  confirmed signup claims the email's unclaimed orders (case-insensitive),
--       never another account's order or another email's
--   T2  received → XP now (subtotal - discount)
--   T3  shipped → XP now (THE FIX), several shipped orders each once
--   T4  pending → no XP at claim time
--   T5  denied → no XP
--   T6  an order whose XP was granted before keeps its original event; no dup
--   T7  balance = what was granted, one event per eligible order
--   T8  retrying the claim / the reconciler adds nothing
--   T9  claimed pending → received: the existing trigger credits the new owner
--       once; shipped afterwards adds nothing
--   T10 email/password flow: nothing before confirmation, XP at confirmation
--   T11 XP failure inside the claim: the claim stands, NO partial XP, the
--       balance matches the ledger, and a later reconcile recovers it all
--   T12 PARITY: the same orders give the same XP whether claimed
--       automatically or linked through admin_link_order_to_customer
--   T13 API roles cannot call claim / reconcile / backfill
--   T14 balance invariant for every suite user
--   T15 backfill_guest_order_xp repairs a shipped order claimed before the fix
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

CREATE OR REPLACE FUNCTION pg_temp.make_user(p_id UUID, p_email TEXT, p_confirmed BOOLEAN DEFAULT TRUE)
RETURNS VOID
LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    p_email, 'x', CASE WHEN p_confirmed THEN now() END,
    '{"provider":"email","providers":["email"]}'::jsonb,
    json_build_object('full_name', p_email)::jsonb, now(), now()
  );
END $f$;

CREATE OR REPLACE FUNCTION pg_temp.order_for(
  p_tag TEXT, p_email TEXT, p_status TEXT, p_subtotal NUMERIC,
  p_discount NUMERIC DEFAULT 0, p_source TEXT DEFAULT 'web'
) RETURNS UUID
LANGUAGE plpgsql AS $f$
DECLARE v_id UUID;
BEGIN
  INSERT INTO public.orders (
    user_id, customer_name, customer_email, customer_phone,
    shipping_address, shipping_district, shipping_canton, shipping_province,
    shipping_cost, subtotal, discount, total, source, order_status, payment_status
  ) VALUES (
    NULL, 'PG Claim ' || p_tag, p_email, '00000000',
    '100m sur', 'Cariari', 'Pococí', 'Limón',
    2900, p_subtotal, p_discount, p_subtotal - p_discount + 2900, p_source,
    p_status::public.order_status,
    CASE WHEN p_status IN ('received', 'shipped') THEN 'paid' ELSE 'pending' END::public.payment_status
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

CREATE OR REPLACE FUNCTION pg_temp.xp_of(p_order UUID) RETURNS INT
LANGUAGE sql AS $f$
  SELECT xp_earned FROM public.profile_experience_events WHERE order_id = p_order
$f$;

CREATE OR REPLACE FUNCTION pg_temp.balance(p_user UUID) RETURNS INT
LANGUAGE sql AS $f$
  SELECT experience_points FROM public.profiles WHERE id = p_user
$f$;

-- Fault injection for T11: fail any XP insert for the order named in a GUC.
CREATE OR REPLACE FUNCTION public.pgtest_fail_xp_insert() RETURNS TRIGGER
LANGUAGE plpgsql AS $f$
BEGIN
  IF NEW.order_id::TEXT = current_setting('pgtest.fail_order', true) THEN
    RAISE EXCEPTION 'pgtest: injected XP failure';
  END IF;
  RETURN NEW;
END $f$;
CREATE TRIGGER pgtest_fail_xp_insert BEFORE INSERT ON public.profile_experience_events
  FOR EACH ROW EXECUTE FUNCTION public.pgtest_fail_xp_insert();

DO $$
DECLARE
  e1 TEXT := 'pgclaim-one@krov.test';
  e2 TEXT := 'pgclaim-two@krov.test';
  e3 TEXT := 'pgclaim-three@krov.test';
  e4 TEXT := 'pgclaim-four@krov.test';

  u_other UUID := gen_random_uuid();
  u1      UUID := gen_random_uuid();
  u2      UUID := gen_random_uuid();
  u3      UUID := gen_random_uuid();
  u4      UUID := gen_random_uuid();   -- parity: automatic claim
  u5      UUID := gen_random_uuid();   -- parity: admin link
  u6      UUID := gen_random_uuid();   -- claimed before the fix
  u_admin UUID := gen_random_uuid();

  o_rec UUID; o_ship UUID; o_ship2 UUID; o_upper UUID; o_pend UUID; o_den UUID;
  o_prev UUID; o_owned UUID; o_stranger UUID;
  o_c2 UUID; o_f1 UUID; o_f2 UUID; o_old UUID;
  a_ship UUID; a_rec UUID; a_pend UUID; a_den UUID;   -- claimed (u4)
  b_ship UUID; b_rec UUID; b_pend UUID; b_den UUID;   -- admin-linked (u5)

  v_n   INT;
  v_res JSONB;
  v_err TEXT;
BEGIN
  -- ══ ARRANGE (orders exist BEFORE the accounts, as historical guest orders) ═
  PERFORM pg_temp.make_user(u_other, 'pgclaim-other@krov.test');
  PERFORM pg_temp.make_user(u_admin, 'pgclaim-admin@krov.test');
  UPDATE public.profiles SET role = 'admin' WHERE id = u_admin;

  o_rec      := pg_temp.order_for('rec',      e1, 'received', 10500, 500);   --  500 XP
  o_ship     := pg_temp.order_for('ship',     e1, 'shipped',  42900, 1900);  -- 2050 XP
  o_ship2    := pg_temp.order_for('ship2',    e1, 'shipped',  3000);         --  150 XP
  o_upper    := pg_temp.order_for('upper',    UPPER(e1), 'shipped', 2000);   --  100 XP
  o_pend     := pg_temp.order_for('pend',     e1, 'pending',  20000);        -- later 1000
  o_den      := pg_temp.order_for('den',      e1, 'denied',   30000);        -- never
  o_prev     := pg_temp.order_for('prev',     e1, 'shipped',  15000);        -- credited before
  o_owned    := pg_temp.order_for('owned',    e1, 'shipped',  9000);
  o_stranger := pg_temp.order_for('stranger', 'pgclaim-nobody@krov.test', 'shipped', 9000);

  UPDATE public.orders SET user_id = u_other WHERE id = o_owned;
  -- o_prev: credited to u_other once, then its owner was removed in Studio.
  INSERT INTO public.profile_experience_events (user_id, order_id, xp_earned) VALUES (u_other, o_prev, 750);
  UPDATE public.profiles SET experience_points = experience_points + 750 WHERE id = u_other;

  ASSERT NOT EXISTS (SELECT 1 FROM public.profile_experience_events
                      WHERE order_id IN (o_rec, o_ship, o_ship2, o_upper, o_pend, o_den)),
    'precondition: historical orders carry no XP yet';

  -- ══ ACT: confirmed signup → automatic claim ══════════════════════════════
  PERFORM pg_temp.make_user(u1, e1);

  -- ══ T1. What was claimed ═════════════════════════════════════════════════
  SELECT count(*) INTO v_n FROM public.orders
   WHERE user_id = u1 AND id IN (o_rec, o_ship, o_ship2, o_upper, o_pend, o_den, o_prev);
  ASSERT v_n = 7, format('T1a: 7 orders claimed (incl. the uppercase email), got %s', v_n);
  ASSERT (SELECT user_id FROM public.orders WHERE id = o_owned) = u_other, 'T1b: never another account''s order';
  ASSERT (SELECT user_id FROM public.orders WHERE id = o_stranger) IS NULL, 'T1c: never another email''s order';

  -- ══ T2 / T3. received and shipped earn now ═══════════════════════════════
  ASSERT pg_temp.xp_of(o_rec)   = 500,  format('T2: received, got %s', pg_temp.xp_of(o_rec));
  ASSERT pg_temp.xp_of(o_ship)  = 2050, format('T3a: shipped, got %s', pg_temp.xp_of(o_ship));
  ASSERT pg_temp.xp_of(o_ship2) = 150,  format('T3b: second shipped, got %s', pg_temp.xp_of(o_ship2));
  ASSERT pg_temp.xp_of(o_upper) = 100,  format('T3c: uppercase-email shipped, got %s', pg_temp.xp_of(o_upper));
  ASSERT (SELECT bool_and(user_id = u1) FROM public.profile_experience_events
           WHERE order_id IN (o_rec, o_ship, o_ship2, o_upper)), 'T3d: credited to the claimant';

  -- ══ T4 / T5. pending and denied earn nothing now ═════════════════════════
  ASSERT pg_temp.xp_of(o_pend) IS NULL, 'T4: pending earns nothing at claim time';
  ASSERT pg_temp.xp_of(o_den)  IS NULL, 'T5: denied earns nothing';

  -- ══ T6. Granted before → kept, not duplicated ════════════════════════════
  ASSERT (SELECT count(*) FROM public.profile_experience_events WHERE order_id = o_prev) = 1, 'T6a: one event';
  ASSERT (SELECT user_id FROM public.profile_experience_events WHERE order_id = o_prev) = u_other,
    'T6b: the original event is untouched';

  -- ══ T7. Balance ══════════════════════════════════════════════════════════
  ASSERT pg_temp.balance(u1) = 2800, format('T7a: 500+2050+150+100, got %s', pg_temp.balance(u1));
  ASSERT (SELECT count(*) FROM public.profile_experience_events WHERE user_id = u1) = 4, 'T7b: 4 events';

  -- ══ T8. Retrying adds nothing ════════════════════════════════════════════
  ASSERT public.claim_guest_orders(u1, e1) = 0, 'T8a: nothing left to claim';
  ASSERT public.reconcile_profile_order_xp(u1) = 0, 'T8b: nothing left to grant';
  UPDATE auth.users SET email_confirmed_at = now() WHERE id = u1;   -- re-confirm: trigger ignores it
  ASSERT pg_temp.balance(u1) = 2800, 'T8c: balance unchanged after retries';
  ASSERT (SELECT count(*) FROM public.profile_experience_events WHERE user_id = u1) = 4, 'T8d: still 4 events';

  -- ══ T9. Pending later reaches received → existing trigger ════════════════
  UPDATE public.orders SET order_status = 'received' WHERE id = o_pend;
  ASSERT pg_temp.xp_of(o_pend) = 1000, format('T9a: got %s', pg_temp.xp_of(o_pend));
  ASSERT pg_temp.balance(u1) = 3800, 'T9b: balance';
  UPDATE public.orders SET order_status = 'shipped' WHERE id = o_pend;
  ASSERT pg_temp.balance(u1) = 3800 AND
         (SELECT count(*) FROM public.profile_experience_events WHERE order_id = o_pend) = 1,
    'T9c: shipping it afterwards adds nothing';

  -- ══ T10. Email/password flow: XP at confirmation, not before ═════════════
  o_c2 := pg_temp.order_for('c2', e2, 'shipped', 5000);
  PERFORM pg_temp.make_user(u2, e2, FALSE);
  ASSERT (SELECT user_id FROM public.orders WHERE id = o_c2) IS NULL, 'T10a: unconfirmed claims nothing';
  ASSERT pg_temp.xp_of(o_c2) IS NULL, 'T10b: and grants nothing';
  UPDATE auth.users SET email_confirmed_at = now() WHERE id = u2;
  ASSERT (SELECT user_id FROM public.orders WHERE id = o_c2) = u2, 'T10c: claimed on confirmation';
  ASSERT pg_temp.xp_of(o_c2) = 250 AND pg_temp.balance(u2) = 250, 'T10d: shipped XP on confirmation';

  -- ══ T11. XP failure: claim stands, no partial XP, recoverable ════════════
  o_f1 := pg_temp.order_for('f1', e3, 'received', 5000);   -- 250
  o_f2 := pg_temp.order_for('f2', e3, 'shipped',  3000);   -- 150, will fail
  PERFORM set_config('pgtest.fail_order', o_f2::TEXT, true);
  PERFORM pg_temp.make_user(u3, e3);                      -- signup must still succeed
  ASSERT (SELECT count(*) FROM public.orders WHERE user_id = u3) = 2, 'T11a: both orders still claimed';
  ASSERT NOT EXISTS (SELECT 1 FROM public.profile_experience_events WHERE user_id = u3),
    'T11b: no partial XP — the grant for f1 was rolled back with f2''s failure';
  ASSERT pg_temp.balance(u3) = 0, 'T11c: balance matches the (empty) ledger';
  PERFORM set_config('pgtest.fail_order', '', true);
  ASSERT public.reconcile_profile_order_xp(u3) = 2, 'T11d: a later reconcile recovers both';
  ASSERT pg_temp.balance(u3) = 400, format('T11e: got %s', pg_temp.balance(u3));

  -- ══ T12. Parity: automatic claim vs admin link ═══════════════════════════
  a_ship := pg_temp.order_for('a-ship', e4, 'shipped',  42900, 1900);
  a_rec  := pg_temp.order_for('a-rec',  e4, 'received', 10500, 500);
  a_pend := pg_temp.order_for('a-pend', e4, 'pending',  20000);
  a_den  := pg_temp.order_for('a-den',  e4, 'denied',   30000);
  b_ship := pg_temp.order_for('b-ship', NULL, 'shipped',  42900, 1900, 'admin');
  b_rec  := pg_temp.order_for('b-rec',  NULL, 'received', 10500, 500,  'admin');
  b_pend := pg_temp.order_for('b-pend', NULL, 'pending',  20000, 0,    'admin');
  b_den  := pg_temp.order_for('b-den',  NULL, 'denied',   30000, 0,    'admin');

  PERFORM pg_temp.make_user(u4, e4);                                    -- automatic
  PERFORM pg_temp.make_user(u5, 'pgclaim-five@krov.test');
  PERFORM pg_temp.act_as(u_admin);                                      -- manual
  v_res := public.admin_link_order_to_customer(b_ship, u5);
  ASSERT (v_res->>'xp_awarded')::INT = pg_temp.xp_of(a_ship),
    format('T12a: shipped — admin %s vs claim %s', v_res->>'xp_awarded', pg_temp.xp_of(a_ship));
  v_res := public.admin_link_order_to_customer(b_rec, u5);
  ASSERT (v_res->>'xp_awarded')::INT = pg_temp.xp_of(a_rec), 'T12b: received';
  v_res := public.admin_link_order_to_customer(b_pend, u5);
  ASSERT v_res->>'xp_status' = 'pending_status' AND pg_temp.xp_of(a_pend) IS NULL, 'T12c: pending — none on both';
  v_res := public.admin_link_order_to_customer(b_den, u5);
  ASSERT v_res->>'xp_status' = 'not_eligible' AND pg_temp.xp_of(a_den) IS NULL, 'T12d: denied — none on both';
  ASSERT pg_temp.balance(u4) = pg_temp.balance(u5),
    format('T12e: same balance — claim %s vs admin %s', pg_temp.balance(u4), pg_temp.balance(u5));
  UPDATE public.orders SET order_status = 'received' WHERE id IN (a_pend, b_pend);
  ASSERT pg_temp.xp_of(a_pend) = pg_temp.xp_of(b_pend) AND pg_temp.xp_of(a_pend) = 1000,
    'T12f: pending → received pays both the same, via the trigger';
  ASSERT pg_temp.balance(u4) = pg_temp.balance(u5), 'T12g: still equal';

  -- ══ T13. Not callable through the API ════════════════════════════════════
  PERFORM pg_temp.act_as(u1);
  SET LOCAL ROLE authenticated;
  v_err := NULL;
  BEGIN PERFORM public.claim_guest_orders(u1, 'pgclaim-nobody@krov.test');
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  ASSERT v_err = '42501', format('T13a: authenticated cannot claim by email, got %s', v_err);
  v_err := NULL;
  BEGIN PERFORM public.reconcile_profile_order_xp(u1);
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  ASSERT v_err = '42501', format('T13b: nor reconcile, got %s', v_err);
  v_err := NULL;
  BEGIN PERFORM * FROM public.backfill_guest_order_xp();
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  ASSERT v_err = '42501', format('T13c: nor backfill, got %s', v_err);
  RESET ROLE;
  SET LOCAL ROLE anon;
  v_err := NULL;
  BEGIN PERFORM public.claim_guest_orders(u1, 'pgclaim-nobody@krov.test');
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  ASSERT v_err = '42501', format('T13d: anon cannot claim, got %s', v_err);
  RESET ROLE;
  ASSERT (SELECT user_id FROM public.orders WHERE id = o_stranger) IS NULL, 'T13e: nothing was claimed';

  -- ══ T15. Backfill repairs a shipped order claimed before the fix ═════════
  -- (before T14 so the invariant covers it too)
  PERFORM pg_temp.make_user(u6, 'pgclaim-six@krov.test');
  o_old := pg_temp.order_for('old', 'pgclaim-six-old@krov.test', 'shipped', 8000);  -- 400
  UPDATE public.orders SET user_id = u6 WHERE id = o_old;   -- owned, no XP: the old bug's result
  ASSERT pg_temp.xp_of(o_old) IS NULL, 'T15a: precondition';
  ASSERT EXISTS (SELECT 1 FROM public.backfill_guest_order_xp() b WHERE b.user_id = u6 AND b.orders_granted = 1),
    'T15b: the backfill credits it';
  ASSERT pg_temp.xp_of(o_old) = 400 AND pg_temp.balance(u6) = 400, 'T15c: right amount';
  ASSERT NOT EXISTS (SELECT 1 FROM public.backfill_guest_order_xp() b WHERE b.user_id = u6),
    'T15d: re-running credits nothing';

  -- ══ T14. Balance invariant ═══════════════════════════════════════════════
  ASSERT NOT EXISTS (
    SELECT 1
      FROM public.profiles p
      LEFT JOIN public.profile_experience_events e ON e.user_id = p.id
     WHERE p.id IN (u_other, u1, u2, u3, u4, u5, u6)
     GROUP BY p.id, p.experience_points
    HAVING p.experience_points <> COALESCE(SUM(e.xp_earned), 0)
  ), 'T14: profile XP = sum of its ledger rows';
END $$;

SELECT 'ALL CLAIM XP PARITY TESTS PASSED' AS result;

ROLLBACK;
