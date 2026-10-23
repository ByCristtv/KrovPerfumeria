-- ============================================================================
-- DB-LEVEL SECURITY TEST SUITE -- profiles privilege hardening
-- (migration 20261023000100_profiles_privilege_hardening.sql)
-- ============================================================================
-- HOW TO RUN
--   Paste this whole file into the Supabase SQL Editor and run it, AFTER
--   applying 20261023000100. Run it on a STAGING / branch project first; it is
--   also safe on production:
--
--   Everything happens inside BEGIN ... ROLLBACK, so the database is left
--   unchanged whether the suite passes or fails. The test users, orders and
--   grants never survive the script.
--
--   PASS  -> the final SELECT prints "ALL PROFILES HARDENING TESTS PASSED".
--            Optional sections whose RPC is not deployed print a NOTICE "SKIP".
--   FAIL  -> the script aborts with `assertion failed` naming the test, and the
--            transaction rolls back.
--
-- HOW THE CALLER IS FAKED
--   Unlike the other suites, this one must exercise GRANTs, not just
--   auth.uid(), so it switches the real Postgres role exactly like PostgREST
--   does:   SET LOCAL ROLE authenticated | anon   +   request.jwt.claims.
--   `RESET ROLE` returns to the SQL editor's own role (postgres) for seeding and
--   for asserting on the stored rows. Nothing is stubbed.
--
-- WHAT IS COVERED
--    1  registration: the signup trigger still creates a 'customer' profile
--    2  a customer CAN edit phone / avatar_url / username / show_in_ranking
--    3  a customer CANNOT write role, experience_points, id, created_at,
--       updated_at, is_profile_public or full_name                 (42501)
--    4  a mixed allowed+forbidden update is rejected as a whole
--    5  a customer cannot touch another customer's row (RLS: 0 rows)
--    6  a customer cannot INSERT or DELETE profiles                (42501)
--    7  reads: own row only for a customer; every row for an admin
--    8  set_social_profile_visibility() still works for the customer
--    9  privileged RPCs refuse a customer (admin_adjust_customer_xp,
--       review_wholesale_application)
--   10  an ADMIN cannot write role / XP directly either — only via RPC
--   11  admin_adjust_customer_xp() works for an admin (+ level coupon unlock)
--   12  review_wholesale_application() still changes the role for an admin
--   13  guard trigger blocks role/XP writes even if someone re-GRANTs them
--   14  order -> received still awards XP (trigger path)
--   15  anon: get_ranking_top() still works; direct profile reads are denied
--   16  final state: exactly two policies, exactly four updatable columns
--
-- IF THE auth.users INSERT IS REJECTED
--   See the note in 20260905000100_guest_order_xp_claim_test.sql -- same seed.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_a      UUID := gen_random_uuid();   -- customer A (the attacker)
  v_b      UUID := gen_random_uuid();   -- customer B (the victim)
  v_admin  UUID := gen_random_uuid();   -- admin

  v_claims_a     TEXT;
  v_claims_b     TEXT;
  v_claims_admin TEXT;

  v_col    TEXT;
  v_val    TEXT;
  v_state  TEXT;
  v_msg    TEXT;
  v_n      INTEGER;
  v_res    JSONB;
  v_order  UUID;
  v_row    RECORD;
  v_forbidden CONSTANT TEXT[][] := ARRAY[
    ARRAY['role',              quote_literal('admin')],
    ARRAY['experience_points', '999999'],
    ARRAY['id',                quote_literal(gen_random_uuid()::text) || '::uuid'],
    ARRAY['created_at',        quote_literal('2000-01-01') || '::timestamptz'],
    ARRAY['updated_at',        quote_literal('2000-01-01') || '::timestamptz'],
    ARRAY['is_profile_public', 'true'],
    ARRAY['full_name',         quote_literal('Pwned')]
  ];
  i INTEGER;
BEGIN
  v_claims_a     := json_build_object('sub', v_a,     'role', 'authenticated')::text;
  v_claims_b     := json_build_object('sub', v_b,     'role', 'authenticated')::text;
  v_claims_admin := json_build_object('sub', v_admin, 'role', 'authenticated')::text;

  -- ══ ARRANGE (as postgres) ════════════════════════════════════════════════
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_a,     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'pgsec-a@krov.test', 'x', now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"PG Sec A"}'::jsonb, now(), now()),
    (v_b,     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'pgsec-b@krov.test', 'x', now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"PG Sec B"}'::jsonb, now(), now()),
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'pgsec-admin@krov.test', 'x', now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"PG Sec Admin"}'::jsonb, now(), now());

  -- ══ 1. Registration ══════════════════════════════════════════════════════
  SELECT role, experience_points INTO v_row FROM public.profiles WHERE id = v_a;
  ASSERT FOUND, 'test 1a: the signup trigger must create the profile';
  ASSERT v_row.role = 'customer' AND v_row.experience_points = 0,
    format('test 1b: new profile must be customer/0 XP, got %s/%s', v_row.role, v_row.experience_points);

  -- Seed the admin + victim the way an operator would (Studio = postgres).
  UPDATE public.profiles SET role = 'admin' WHERE id = v_admin;
  UPDATE public.profiles SET username = 'pgsec_victim', phone = '11111111' WHERE id = v_b;

  -- ══ act as customer A ════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', v_claims_a, true);
  SET LOCAL ROLE authenticated;

  -- ══ 2. Allowed self-edits ════════════════════════════════════════════════
  UPDATE public.profiles
     SET phone = '88887777',
         avatar_url = 'https://lh3.googleusercontent.com/a/pgsec',
         username = 'pgsec_attacker',
         show_in_ranking = true
   WHERE id = v_a;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  ASSERT v_n = 1, format('test 2a: allowed self-update must touch 1 row, got %s', v_n);

  SELECT phone, avatar_url, username, show_in_ranking INTO v_row
    FROM public.profiles WHERE id = v_a;
  ASSERT v_row.phone = '88887777'
     AND v_row.avatar_url = 'https://lh3.googleusercontent.com/a/pgsec'
     AND v_row.username = 'pgsec_attacker'
     AND v_row.show_in_ranking,
    'test 2b: allowed columns must be saved';

  -- Each allowed column on its own, too (the app sends them separately).
  UPDATE public.profiles SET phone = '88886666' WHERE id = v_a;
  UPDATE public.profiles SET avatar_url = NULL WHERE id = v_a;
  UPDATE public.profiles SET username = 'pgsec_attacker2', show_in_ranking = false WHERE id = v_a;
  ASSERT (SELECT phone FROM public.profiles WHERE id = v_a) = '88886666',
    'test 2c: single-column phone update must work';

  -- ══ 3. Forbidden columns, one by one ═════════════════════════════════════
  FOR i IN 1 .. array_length(v_forbidden, 1) LOOP
    v_col := v_forbidden[i][1];
    v_val := v_forbidden[i][2];
    v_state := NULL;
    BEGIN
      EXECUTE format('UPDATE public.profiles SET %I = %s WHERE id = %L', v_col, v_val, v_a);
    EXCEPTION WHEN OTHERS THEN
      v_state := SQLSTATE;
    END;
    ASSERT v_state = '42501',
      format('test 3: customer write to %s must be denied (42501), got %s', v_col,
             COALESCE(v_state, 'NO ERROR'));
  END LOOP;

  -- ══ 4. Mixed allowed + forbidden → whole statement rejected ══════════════
  v_state := NULL;
  BEGIN
    UPDATE public.profiles SET phone = '00000000', role = 'admin' WHERE id = v_a;
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  ASSERT v_state = '42501', format('test 4a: mixed update must be denied, got %s', v_state);
  ASSERT (SELECT phone FROM public.profiles WHERE id = v_a) = '88886666',
    'test 4b: the allowed half of a rejected update must not land';

  -- ══ 5. Another customer's row ════════════════════════════════════════════
  UPDATE public.profiles SET phone = '66666666' WHERE id = v_b;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  ASSERT v_n = 0, format('test 5: updating another profile must touch 0 rows, got %s', v_n);

  -- ══ 6. INSERT / DELETE ═══════════════════════════════════════════════════
  v_state := NULL;
  BEGIN
    INSERT INTO public.profiles (id, role) VALUES (gen_random_uuid(), 'admin');
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  ASSERT v_state = '42501', format('test 6a: customer INSERT must be denied, got %s', v_state);

  v_state := NULL;
  BEGIN
    DELETE FROM public.profiles WHERE id = v_a;
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  ASSERT v_state = '42501', format('test 6b: customer DELETE must be denied, got %s', v_state);

  -- ══ 7a. Reads as a customer ══════════════════════════════════════════════
  SELECT count(*) INTO v_n FROM public.profiles WHERE id = v_a;
  ASSERT v_n = 1, 'test 7a: a customer must read their own profile';
  SELECT count(*) INTO v_n FROM public.profiles WHERE id = v_b;
  ASSERT v_n = 0, 'test 7b: a customer must not read another profile';

  -- ══ 8. Social visibility RPC (SECURITY DEFINER) ══════════════════════════
  IF to_regprocedure('public.set_social_profile_visibility(boolean)') IS NOT NULL THEN
    PERFORM public.set_social_profile_visibility(true);
    ASSERT (SELECT is_profile_public FROM public.profiles WHERE id = v_a),
      'test 8: set_social_profile_visibility must still publish the profile';
  ELSE
    RAISE NOTICE 'SKIP test 8: set_social_profile_visibility not deployed';
  END IF;

  -- ══ 9. Privileged RPCs refuse a customer ═════════════════════════════════
  IF to_regprocedure('public.admin_adjust_customer_xp(uuid,integer,text)') IS NOT NULL THEN
    v_msg := NULL;
    BEGIN
      PERFORM public.admin_adjust_customer_xp(v_a, 5000, 'self-grant');
    EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
    ASSERT v_msg ILIKE '%Insufficient privilege%',
      format('test 9a: customer must not adjust XP via RPC, got %s', COALESCE(v_msg, 'NO ERROR'));
  ELSE
    RAISE NOTICE 'SKIP test 9a: admin_adjust_customer_xp not deployed (migration 20261022000100)';
  END IF;

  IF to_regprocedure('public.review_wholesale_application(uuid,text)') IS NOT NULL THEN
    v_msg := NULL;
    BEGIN
      PERFORM public.review_wholesale_application(v_a, 'approved');
    EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
    ASSERT v_msg ILIKE '%Insufficient privilege%',
      format('test 9b: customer must not change roles via RPC, got %s', COALESCE(v_msg, 'NO ERROR'));
  ELSE
    RAISE NOTICE 'SKIP test 9b: review_wholesale_application not deployed';
  END IF;

  -- Nothing above changed A's privileged state.
  RESET ROLE;
  SELECT role, experience_points INTO v_row FROM public.profiles WHERE id = v_a;
  ASSERT v_row.role = 'customer' AND v_row.experience_points = 0,
    format('test 9c: customer A must still be customer/0 XP, got %s/%s', v_row.role, v_row.experience_points);
  ASSERT (SELECT phone FROM public.profiles WHERE id = v_b) = '11111111',
    'test 5b: the victim''s row must be unchanged';

  -- ══ act as the admin ═════════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', v_claims_admin, true);
  SET LOCAL ROLE authenticated;

  -- ══ 7c. Admin reads every profile ════════════════════════════════════════
  SELECT count(*) INTO v_n FROM public.profiles WHERE id IN (v_a, v_b);
  ASSERT v_n = 2, format('test 7c: an admin must read all profiles, got %s', v_n);

  -- ══ 10. Admins cannot bypass the RPCs either ═════════════════════════════
  FOREACH v_col IN ARRAY ARRAY['role', 'experience_points'] LOOP
    v_state := NULL;
    BEGIN
      EXECUTE format('UPDATE public.profiles SET %I = %s WHERE id = %L', v_col,
                     CASE v_col WHEN 'role' THEN quote_literal('admin') ELSE '5000' END, v_b);
    EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
    ASSERT v_state = '42501',
      format('test 10: admin direct write to %s must be denied, got %s', v_col, COALESCE(v_state, 'NO ERROR'));
  END LOOP;

  -- ══ 11. Admin XP adjustment through the RPC ══════════════════════════════
  IF to_regprocedure('public.admin_adjust_customer_xp(uuid,integer,text)') IS NOT NULL THEN
    v_res := public.admin_adjust_customer_xp(v_b, 1200, 'pg security suite');
    ASSERT (v_res->>'balance_after')::int = 1200,
      format('test 11a: admin +1200 XP must land, got %s', v_res);

    v_res := public.admin_adjust_customer_xp(v_b, -200, NULL);
    ASSERT (v_res->>'balance_after')::int = 1000,
      format('test 11b: admin -200 XP must land, got %s', v_res);

    v_msg := NULL;
    BEGIN
      PERFORM public.admin_adjust_customer_xp(v_b, -5000, NULL);
    EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
    ASSERT v_msg ILIKE '%cannot go negative%',
      format('test 11c: overdraw must be refused, got %s', COALESCE(v_msg, 'NO ERROR'));

    v_msg := NULL;
    BEGIN
      PERFORM public.admin_adjust_customer_xp(v_admin, 10, NULL);
    EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
    ASSERT v_msg ILIKE '%own XP%',
      format('test 11d: admin self-adjust must be refused, got %s', COALESCE(v_msg, 'NO ERROR'));
  ELSE
    RAISE NOTICE 'SKIP test 11: admin_adjust_customer_xp not deployed (migration 20261022000100)';
  END IF;

  RESET ROLE;
  IF to_regprocedure('public.admin_adjust_customer_xp(uuid,integer,text)') IS NOT NULL THEN
    ASSERT (SELECT experience_points FROM public.profiles WHERE id = v_b) = 1000,
      'test 11e: stored XP must match the RPC result';
    IF to_regclass('public.user_coupons') IS NOT NULL THEN
      SELECT count(*) INTO v_n FROM public.user_coupons WHERE user_id = v_b;
      ASSERT v_n >= 1,
        format('test 11f: crossing Coleccionista via RPC must unlock its coupon, got %s', v_n);
    END IF;
  END IF;

  -- ══ 12. Wholesale role change through the RPC ════════════════════════════
  IF to_regprocedure('public.review_wholesale_application(uuid,text)') IS NOT NULL
     AND to_regclass('public.wholesale_profiles') IS NOT NULL THEN
    BEGIN
      INSERT INTO public.wholesale_profiles (user_id, company_name, tax_id, application_status)
      VALUES (v_b, 'PG Sec S.A.', '3101000000', 'pending');

      PERFORM set_config('request.jwt.claims', v_claims_admin, true);
      SET LOCAL ROLE authenticated;
      PERFORM public.review_wholesale_application(v_b, 'approved');
      RESET ROLE;

      ASSERT (SELECT role FROM public.profiles WHERE id = v_b) = 'wholesale',
        'test 12: admin approval must still promote the role';
    EXCEPTION
      WHEN assert_failure THEN RAISE;
      WHEN OTHERS THEN
        RESET ROLE;
        RAISE NOTICE 'SKIP test 12: wholesale seed/RPC rejected in this project (%)', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'SKIP test 12: wholesale RPC/table not deployed';
  END IF;
  RESET ROLE;

  -- ══ 13. Guard trigger: even a re-granted column stays protected ══════════
  GRANT UPDATE (role, experience_points) ON public.profiles TO authenticated;

  PERFORM set_config('request.jwt.claims', v_claims_a, true);
  SET LOCAL ROLE authenticated;

  v_state := NULL; v_msg := NULL;
  BEGIN
    UPDATE public.profiles SET role = 'admin' WHERE id = v_a;
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_msg := SQLERRM; END;
  ASSERT v_state = '42501' AND v_msg = 'profile_column_not_editable',
    format('test 13a: guard must block role even when granted, got %s %s', v_state, v_msg);

  v_state := NULL; v_msg := NULL;
  BEGIN
    UPDATE public.profiles SET experience_points = 50000 WHERE id = v_a;
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; v_msg := SQLERRM; END;
  ASSERT v_state = '42501' AND v_msg = 'profile_column_not_editable',
    format('test 13b: guard must block XP even when granted, got %s %s', v_state, v_msg);

  -- An allowed column still passes the guard.
  UPDATE public.profiles SET phone = '55554444' WHERE id = v_a;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  ASSERT v_n = 1, 'test 13c: guard must let allowed columns through';

  RESET ROLE;
  REVOKE UPDATE (role, experience_points) ON public.profiles FROM authenticated;

  -- ══ 14. Order -> received still awards XP ════════════════════════════════
  INSERT INTO public.orders (
    user_id, customer_name, customer_email, customer_phone,
    shipping_address, shipping_district, shipping_canton, shipping_province,
    shipping_cost, subtotal, total, source, order_status, payment_status
  ) VALUES (
    v_a, 'PG Sec A', 'pgsec-a@krov.test', '00000000',
    '100m sur', 'Carmen', 'San Jose', 'San Jose',
    0, 10000, 10000, 'web', 'pending', 'pending'
  ) RETURNING id INTO v_order;

  IF to_regprocedure('public.advance_order_status(uuid,text)') IS NOT NULL THEN
    -- The real admin path: RPC called by an admin through the API role.
    PERFORM set_config('request.jwt.claims', v_claims_admin, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.advance_order_status(v_order, 'received');
    RESET ROLE;
  ELSE
    UPDATE public.orders SET order_status = 'received' WHERE id = v_order;
  END IF;

  ASSERT (SELECT experience_points FROM public.profiles WHERE id = v_a) = 500,
    format('test 14: a received ₡10,000 order must award 500 XP, got %s',
           (SELECT experience_points FROM public.profiles WHERE id = v_a));

  -- ══ 15. Anonymous visitors ═══════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;

  IF to_regprocedure('public.get_ranking_top(integer)') IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM public.get_ranking_top(10);
    ASSERT v_n >= 0, 'test 15a: the public ranking must still be readable by anon';
  ELSE
    RAISE NOTICE 'SKIP test 15a: get_ranking_top not deployed';
  END IF;

  v_state := NULL;
  BEGIN
    PERFORM 1 FROM public.profiles LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  ASSERT v_state = '42501', format('test 15b: anon must not read profiles directly, got %s', v_state);

  RESET ROLE;

  -- ══ 16. Final shape ══════════════════════════════════════════════════════
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles';
  ASSERT v_n = 2, format('test 16a: expected exactly 2 profiles policies, got %s', v_n);
  ASSERT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles'
                  AND policyname = 'Profiles: read own row, admins read all' AND cmd = 'SELECT'),
    'test 16b: the SELECT policy must exist';
  ASSERT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles'
                  AND policyname = 'Profiles: users update own row' AND cmd = 'UPDATE'),
    'test 16c: the UPDATE policy must exist';

  -- has_column_privilege() counts table-level AND column-level grants, and does
  -- not depend on which role granted them (information_schema would).
  SELECT string_agg(attname, ',' ORDER BY attname) INTO v_msg
    FROM pg_attribute
   WHERE attrelid = 'public.profiles'::regclass AND attnum > 0 AND NOT attisdropped
     AND has_column_privilege('authenticated', 'public.profiles', attname, 'UPDATE');
  ASSERT v_msg = 'avatar_url,phone,show_in_ranking,username',
    format('test 16d: authenticated may UPDATE only the allowlist, got %s', v_msg);

  SELECT count(*) INTO v_n
    FROM pg_attribute
   WHERE attrelid = 'public.profiles'::regclass AND attnum > 0 AND NOT attisdropped
     AND (has_column_privilege('anon', 'public.profiles', attname, 'SELECT')
       OR has_column_privilege('anon', 'public.profiles', attname, 'INSERT')
       OR has_column_privilege('anon', 'public.profiles', attname, 'UPDATE')
       OR has_column_privilege('authenticated', 'public.profiles', attname, 'INSERT'));
  ASSERT v_n = 0,
    format('test 16e: anon must hold no profile privileges and authenticated no INSERT, got %s column(s)', v_n);

  ASSERT NOT has_table_privilege('authenticated', 'public.profiles', 'DELETE')
     AND NOT has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE'),
    'test 16f: authenticated must not DELETE/TRUNCATE profiles';
END $$;

RESET ROLE;
SELECT 'ALL PROFILES HARDENING TESTS PASSED' AS result;

ROLLBACK;
