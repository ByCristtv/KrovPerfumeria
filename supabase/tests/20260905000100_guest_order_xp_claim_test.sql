-- ============================================================================
-- DB-LEVEL TEST SUITE -- Guest XP claim (migration 20260905000100)
-- ============================================================================
-- HOW TO RUN
--   Paste this whole file into the Supabase SQL Editor and run it, AFTER
--   applying 20260905000100_guest_order_xp_claim.sql.
--
--   Everything happens inside BEGIN ... ROLLBACK, so the database is left
--   byte-for-byte unchanged whether the suite passes or fails. The test user
--   and its orders never survive the script -- it is safe to run against the
--   live project.
--
--   PASS  -> the final SELECT prints "ALL GUEST-XP TESTS PASSED".
--   FAIL  -> the script aborts with `assertion failed` naming the test that
--            broke, and the transaction rolls back.
--
-- WHY NOT pgTAP
--   pgTAP is not installed on this project (and `supabase test db` needs a
--   local Postgres via Docker, which this machine does not have -- migrations
--   here are applied by hand in Studio). Plain `ASSERT` inside a DO block gives
--   the same fail-fast, named-assertion behaviour with zero setup. If pgTAP is
--   ever enabled, each ASSERT maps 1:1 onto an `ok()` / `is()` call.
--
-- WHAT IS COVERED
--   1  guest orders are claimed on confirmed signup                (regression)
--   2  received guest orders grant their XP retroactively               (Task 1)
--   3  the XP formula is the same 50-per-1000 rule                      (Task 1)
--   4  non-received orders grant nothing yet                            (Task 1)
--   5  the running balance matches the event log                        (Task 1)
--   6  reconciliation is idempotent -- no double XP                     (Task 1)
--   7  re-claiming is idempotent -- no double XP                        (Task 1)
--   8  the ordinary "order reaches received" path still works       (regression)
--   9  another person's guest order is never claimed                  (security)
--  10  email matching stays case-insensitive                        (regression)
--  11  claim_guest_orders still returns the claimed-order COUNT   (compat)
--  12  no received order is left owing XP                               (Task 1)
--  13  a missing profile degrades to 0 instead of an FK error         (fail-safe)
--
-- IF THE auth.users INSERT IS REJECTED
--   `profiles.id` has an FK to `auth.users`, so the suite must seed a real auth
--   row. The column list below is the standard GoTrue seed; if a future GoTrue
--   release adds a NOT NULL column the INSERT will fail with a clear message.
--   Add that column and re-run -- no other part of the suite depends on the
--   auth schema. Tests 6-13 can also be exercised on their own by replacing the
--   INSERT with an existing profile id and calling
--   `public.claim_guest_orders(<that id>, v_email)` directly.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_user_id     UUID := gen_random_uuid();
  v_email       TEXT := 'pgtest-guest@krov.test';
  v_other_email TEXT := 'pgtest-stranger@krov.test';

  v_order_received_a UUID;   -- total 5000 -> 250 XP
  v_order_received_b UUID;   -- total 1500 ->  50 XP  (floor: 1 x 50)
  v_order_pending    UUID;   -- total 9000 ->   0 XP for now
  v_order_upper      UUID;   -- total 2000 -> 100 XP, EMAIL IN UPPERCASE
  v_order_stranger   UUID;   -- belongs to someone else -- must never be touched

  v_claimed  INT;
  v_granted  INT;
  v_events   INT;
  v_balance  INT;
  v_orphans  INT;
BEGIN
  -- ══ ARRANGE ═══════════════════════════════════════════════════════════════
  -- Guest orders exist BEFORE anyone registers. That is the whole scenario.

  INSERT INTO public.orders (
    user_id, customer_name, customer_email, customer_phone,
    shipping_address, shipping_district, shipping_canton, shipping_province,
    subtotal, total, source, order_status
  ) VALUES
    (NULL, 'Guest A', v_email,       '00000000', '100m sur', 'Carmen', 'San Jose', 'San Jose', 5000, 5000, 'web', 'received'),
    (NULL, 'Guest B', v_email,       '00000000', '100m sur', 'Carmen', 'San Jose', 'San Jose', 1500, 1500, 'web', 'received'),
    (NULL, 'Guest C', v_email,       '00000000', '100m sur', 'Carmen', 'San Jose', 'San Jose', 9000, 9000, 'web', 'pending'),
    (NULL, 'Guest D', upper(v_email),'00000000', '100m sur', 'Carmen', 'San Jose', 'San Jose', 2000, 2000, 'web', 'received'),
    (NULL, 'Stranger', v_other_email,'00000000', '100m sur', 'Carmen', 'San Jose', 'San Jose', 8000, 8000, 'web', 'received');

  SELECT id INTO v_order_received_a FROM public.orders WHERE customer_name = 'Guest A';
  SELECT id INTO v_order_received_b FROM public.orders WHERE customer_name = 'Guest B';
  SELECT id INTO v_order_pending    FROM public.orders WHERE customer_name = 'Guest C';
  SELECT id INTO v_order_upper      FROM public.orders WHERE customer_name = 'Guest D';
  SELECT id INTO v_order_stranger   FROM public.orders WHERE customer_name = 'Stranger';

  -- Sanity: the XP trigger already ran for the received ones and correctly
  -- refused, because a guest order has no profile to credit.
  SELECT count(*) INTO v_events
    FROM public.profile_experience_events
   WHERE order_id IN (v_order_received_a, v_order_received_b, v_order_upper);
  ASSERT v_events = 0,
    'precondition: guest orders must not have XP events before the claim';

  -- ══ ACT ═══════════════════════════════════════════════════════════════════
  -- Register with the confirmed email. This fires on_auth_user_created (creates
  -- the profile) and then on_auth_user_email_confirmed_claim (claims + XP).

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) VALUES (
    v_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', v_email, 'x',
    now(), '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"PG Test"}'::jsonb, now(), now()
  );

  -- ══ ASSERT ════════════════════════════════════════════════════════════════

  -- 1. Every order for that email now belongs to the new profile.
  SELECT count(*) INTO v_claimed
    FROM public.orders
   WHERE id IN (v_order_received_a, v_order_received_b, v_order_pending, v_order_upper)
     AND user_id = v_user_id;
  ASSERT v_claimed = 4,
    format('test 1: expected 4 claimed orders, got %s', v_claimed);

  -- 2. The received ones granted XP retroactively -- the point of the feature.
  SELECT count(*) INTO v_events
    FROM public.profile_experience_events
   WHERE order_id IN (v_order_received_a, v_order_received_b, v_order_upper);
  ASSERT v_events = 3,
    format('test 2: expected 3 retroactive XP events, got %s', v_events);

  -- 3. Same formula as a normal order: floor(total/1000) * 50.
  ASSERT (SELECT xp_earned FROM public.profile_experience_events
           WHERE order_id = v_order_received_a) = 250,
    'test 3a: 5000 colones must grant 250 XP';
  ASSERT (SELECT xp_earned FROM public.profile_experience_events
           WHERE order_id = v_order_received_b) = 50,
    'test 3b: 1500 colones must grant 50 XP (partial thousand ignored)';
  ASSERT (SELECT xp_earned FROM public.profile_experience_events
           WHERE order_id = v_order_upper) = 100,
    'test 3c: 2000 colones must grant 100 XP';

  -- 4. The pending order is claimed but earns nothing yet.
  ASSERT NOT EXISTS (SELECT 1 FROM public.profile_experience_events
                      WHERE order_id = v_order_pending),
    'test 4: a pending order must not grant XP';

  -- 5. The running balance equals the sum of the events.
  SELECT experience_points INTO v_balance FROM public.profiles WHERE id = v_user_id;
  ASSERT v_balance = 400,
    format('test 5: expected balance 400 (250+50+100), got %s', v_balance);

  -- 6. Reconciling again grants nothing and changes no balance.
  v_granted := public.reconcile_profile_order_xp(v_user_id);
  ASSERT v_granted = 0,
    format('test 6a: re-reconciling must grant 0 orders, got %s', v_granted);
  SELECT experience_points INTO v_balance FROM public.profiles WHERE id = v_user_id;
  ASSERT v_balance = 400,
    format('test 6b: balance must stay 400 after re-reconciling, got %s', v_balance);

  -- 7. Re-claiming grants nothing: the orders are no longer user_id IS NULL.
  v_claimed := public.claim_guest_orders(v_user_id, v_email);
  ASSERT v_claimed = 0,
    format('test 7a: re-claiming must claim 0 orders, got %s', v_claimed);
  SELECT experience_points INTO v_balance FROM public.profiles WHERE id = v_user_id;
  ASSERT v_balance = 400,
    format('test 7b: balance must stay 400 after re-claiming, got %s', v_balance);
  SELECT count(*) INTO v_events
    FROM public.profile_experience_events WHERE user_id = v_user_id;
  ASSERT v_events = 3,
    format('test 7c: still exactly 3 XP events, got %s', v_events);

  -- 8. REGRESSION: the ordinary path (an owned order reaching `received`)
  --    still works, and still grants exactly once.
  UPDATE public.orders SET order_status = 'received' WHERE id = v_order_pending;
  SELECT experience_points INTO v_balance FROM public.profiles WHERE id = v_user_id;
  ASSERT v_balance = 850,
    format('test 8: 9000 colones must add 450 XP (400 -> 850), got %s', v_balance);

  -- 9. SECURITY: a stranger's guest order was never touched.
  ASSERT (SELECT user_id FROM public.orders WHERE id = v_order_stranger) IS NULL,
    'test 9a: an order with a different email must stay unclaimed';
  ASSERT NOT EXISTS (SELECT 1 FROM public.profile_experience_events
                      WHERE order_id = v_order_stranger),
    'test 9b: a stranger''s order must never grant XP to this profile';

  -- 10. Email matching is case-insensitive (Guest D was stored UPPERCASE).
  ASSERT (SELECT user_id FROM public.orders WHERE id = v_order_upper) = v_user_id,
    'test 10: an uppercase customer_email must still be claimed';

  -- 11. BACKWARD COMPATIBILITY: the return value is still the claimed COUNT.
  --     A fresh guest order for the same email, claimed explicitly -> 1.
  INSERT INTO public.orders (
    user_id, customer_name, customer_email, customer_phone,
    shipping_address, shipping_district, shipping_canton, shipping_province,
    subtotal, total, source, order_status
  ) VALUES (
    NULL, 'Guest E', v_email, '00000000', '100m sur', 'Carmen', 'San Jose',
    'San Jose', 3000, 3000, 'web', 'received'
  );
  v_claimed := public.claim_guest_orders(v_user_id, v_email);
  ASSERT v_claimed = 1,
    format('test 11a: claim_guest_orders must return 1, got %s', v_claimed);
  SELECT experience_points INTO v_balance FROM public.profiles WHERE id = v_user_id;
  ASSERT v_balance = 1000,
    format('test 11b: 3000 colones must add 150 XP (850 -> 1000), got %s', v_balance);

  -- 12. Nothing is left owing: the invariant the backfill exists to restore.
  --     (The invariant is asserted rather than calling backfill_guest_order_xp()
  --     itself, because that function sweeps EVERY profile in the database and
  --     would take row locks across the whole orders table just to prove a
  --     property of this one user. Run it deliberately -- see step 6 of the
  --     migration's verification queries.)
  SELECT count(*) INTO v_orphans
    FROM public.orders o
   WHERE o.user_id = v_user_id
     AND o.order_status = 'received'
     AND NOT EXISTS (SELECT 1 FROM public.profile_experience_events e
                      WHERE e.order_id = o.id);
  ASSERT v_orphans = 0,
    format('test 12: %s received orders still owe XP', v_orphans);

  -- 13. FAIL-SAFE: a user id with no profile is a no-op, not an FK error.
  --     This is what protects signup from aborting if the profile is missing.
  v_granted := public.reconcile_profile_order_xp(gen_random_uuid());
  ASSERT v_granted = 0, 'test 13: an unknown profile must reconcile to 0';

  RAISE NOTICE 'ALL GUEST-XP TESTS PASSED (user %, final balance % XP)',
    v_user_id, v_balance;
END $$;

SELECT 'ALL GUEST-XP TESTS PASSED' AS result;

-- Nothing above is kept. Change to COMMIT only if you deliberately want the
-- fixtures to persist (you almost certainly do not).
ROLLBACK;
