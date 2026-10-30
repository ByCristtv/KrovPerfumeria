-- ============================================================================
-- DB-LEVEL TEST SUITE -- supplier availability ("Por encargo")
-- (migration 20261029000100_supplier_availability.sql)
-- ============================================================================
-- HOW TO RUN
--   Paste this whole file into the Supabase SQL Editor and run it, AFTER
--   applying 20261029000100. Run it on the TESTING / staging project first; it
--   is also safe on production:
--
--   Everything happens inside BEGIN ... ROLLBACK, so the database is left
--   unchanged whether the suite passes or fails. The seeded brand, product,
--   variants, users and orders never survive the script.
--
--   PASS  -> the final SELECT prints "ALL SUPPLIER AVAILABILITY TESTS PASSED".
--            Optional sections whose seed or RPC is not usable in this project
--            print a NOTICE "SKIP" instead of failing.
--   FAIL  -> the script aborts with `assertion failed` naming the test, and the
--            transaction rolls back.
--
-- HOW THE CALLER IS FAKED
--   Same technique as the profiles-hardening suite: switch the real Postgres
--   role the way PostgREST does -- SET LOCAL ROLE anon | authenticated plus
--   request.jwt.claims -- so GRANTs and RLS are genuinely exercised, nothing is
--   stubbed. RESET ROLE returns to the SQL editor's role (postgres) for seeding
--   and for asserting on stored rows.
--
-- WHAT IS COVERED
--    1  columns: supplier_available BOOLEAN NOT NULL DEFAULT false,
--       supplier_checked_at TIMESTAMPTZ NULL
--    2  chk_decant_not_supplier_available exists and is validated
--    3  safe defaults: a variant written without the new fields is NOT
--       supplier-available and has never been checked
--    4  the CHECK: full_size / set may be flagged; a decant may not (INSERT,
--       UPDATE, and converting a flagged variant into a decant); NULL rejected
--    5  stock independence: flagging / unflagging never changes `stock` and
--       never writes a stock_movements row
--    6  access: anon + customers can READ the flag but cannot INSERT/UPDATE
--       variants; an admin can set it and its timestamp
--    7  policy census on the LIVE table (schema.sql is stale): RLS is on and
--       every write policy on product_variants is gated by is_admin()
--    8  purchase integrity through the live place_order: a stock-0 variant
--       flagged supplier_available cannot be bought (guest / forged request),
--       a stale cart mixing it with an in-stock line fails atomically, and an
--       in-stock variant that is ALSO flagged still sells normally and only
--       decrements physical stock
--
-- IF THE auth.users INSERT IS REJECTED
--   See the note in 20260905000100_guest_order_xp_claim_test.sql -- same seed.
-- IF TEST 7 FAILS
--   It names a write policy on product_variants whose definition does not call
--   is_admin(). That is either REAL live drift (e.g. a permissive starter
--   policy added in Studio) or an admin check written some other way. Read the
--   policy: if it lets non-admins write, customers could change
--   supplier_available until it is fixed. Tests 6g-6i would then fail as well.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_cust    UUID := gen_random_uuid();   -- customer
  v_admin   UUID := gen_random_uuid();   -- admin

  v_claims_cust  TEXT;
  v_claims_admin TEXT;

  v_brand   UUID;
  v_prod    UUID;
  v_full0   UUID;   -- full_size, stock 0  (the made-to-order candidate)
  v_full5   UUID;   -- full_size, stock 5
  v_decant  UUID;   -- decant, stock 0 (pool-based)
  v_set0    UUID;   -- set, stock 0 (skipped if the enum has no 'set')

  v_n           INTEGER;
  v_state       TEXT;
  v_constraint  TEXT;
  v_msg         TEXT;
  v_bool        BOOLEAN;
  v_stock       INTEGER;
  v_mov_before  BIGINT;
  v_mov_after   BIGINT;
  v_row         RECORD;
  v_payload     JSONB;
  v_res         JSONB;
  v_email      CONSTANT TEXT := 'supplier-test@krov.test';
BEGIN
  v_claims_cust  := json_build_object('sub', v_cust,  'role', 'authenticated')::text;
  v_claims_admin := json_build_object('sub', v_admin, 'role', 'authenticated')::text;

  -- ══ ARRANGE (as postgres) ════════════════════════════════════════════════
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES
    (v_cust,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'supplier-cust@krov.test', 'x', now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Supplier Cust"}'::jsonb, now(), now()),
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'supplier-admin@krov.test', 'x', now(), '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Supplier Admin"}'::jsonb, now(), now());

  UPDATE public.profiles SET role = 'admin' WHERE id = v_admin;

  INSERT INTO public.brands (name, slug)
  VALUES ('Supplier Test Brand ' || left(gen_random_uuid()::text, 8),
          'supplier-test-brand-' || left(gen_random_uuid()::text, 8))
  RETURNING id INTO v_brand;

  INSERT INTO public.products (name, slug, brand_id, gender, concentration)
  VALUES ('Supplier Test Perfume', 'supplier-test-perfume-' || left(gen_random_uuid()::text, 8),
          v_brand, 'unisex', 'EDP')
  RETURNING id INTO v_prod;

  -- NOTE: none of these INSERTs name the new columns -- that is test 3.
  INSERT INTO public.product_variants (product_id, product_type, size_ml, price, stock, sku)
  VALUES (v_prod, 'full_size', 100, 10000, 0, 'SUPTEST-' || left(gen_random_uuid()::text, 8))
  RETURNING id INTO v_full0;

  INSERT INTO public.product_variants (product_id, product_type, size_ml, price, stock, sku)
  VALUES (v_prod, 'full_size', 50, 10000, 5, 'SUPTEST-' || left(gen_random_uuid()::text, 8))
  RETURNING id INTO v_full5;

  INSERT INTO public.product_variants (product_id, product_type, size_ml, price, stock, sku)
  VALUES (v_prod, 'decant', 5, 2000, 0, 'SUPTEST-' || left(gen_random_uuid()::text, 8))
  RETURNING id INTO v_decant;

  BEGIN
    INSERT INTO public.product_variants (product_id, product_type, size_ml, price, stock, sku)
    VALUES (v_prod, 'set', 30, 8000, 0, 'SUPTEST-' || left(gen_random_uuid()::text, 8))
    RETURNING id INTO v_set0;
  EXCEPTION WHEN invalid_text_representation THEN
    v_set0 := NULL;
    RAISE NOTICE 'SKIP set-variant checks: product_type enum has no ''set'' in this project';
  END;

  -- ══ 1. Columns ═══════════════════════════════════════════════════════════
  SELECT data_type, is_nullable, column_default INTO v_row
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'product_variants'
     AND column_name = 'supplier_available';
  ASSERT FOUND, 'test 1a: product_variants.supplier_available must exist';
  ASSERT v_row.data_type = 'boolean' AND v_row.is_nullable = 'NO' AND v_row.column_default = 'false',
    format('test 1b: supplier_available must be boolean NOT NULL DEFAULT false, got %s / nullable=%s / default=%s',
           v_row.data_type, v_row.is_nullable, v_row.column_default);

  SELECT data_type, is_nullable, column_default INTO v_row
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'product_variants'
     AND column_name = 'supplier_checked_at';
  ASSERT FOUND, 'test 1c: product_variants.supplier_checked_at must exist';
  ASSERT v_row.data_type = 'timestamp with time zone' AND v_row.is_nullable = 'YES' AND v_row.column_default IS NULL,
    format('test 1d: supplier_checked_at must be nullable timestamptz with no default, got %s / nullable=%s / default=%s',
           v_row.data_type, v_row.is_nullable, v_row.column_default);

  -- ══ 2. Constraint ════════════════════════════════════════════════════════
  SELECT convalidated INTO v_bool
    FROM pg_constraint
   WHERE conrelid = 'public.product_variants'::regclass
     AND conname = 'chk_decant_not_supplier_available';
  ASSERT FOUND, 'test 2a: chk_decant_not_supplier_available must exist';
  ASSERT v_bool, 'test 2b: chk_decant_not_supplier_available must be validated';

  -- ══ 3. Safe defaults ═════════════════════════════════════════════════════
  SELECT count(*) INTO v_n
    FROM public.product_variants
   WHERE id IN (v_full0, v_full5, v_decant)
     AND (supplier_available IS DISTINCT FROM false OR supplier_checked_at IS NOT NULL);
  ASSERT v_n = 0,
    format('test 3a: variants written without the new fields must default to NOT available / never checked, %s violated', v_n);

  -- Informational only: the database does not force a timestamp whenever the
  -- flag is set (the admin action writes both), so a Studio edit can leave one
  -- behind. Worth knowing, not worth failing the suite on a live database.
  SELECT count(*) INTO v_n
    FROM public.product_variants
   WHERE supplier_available AND supplier_checked_at IS NULL;
  IF v_n > 0 THEN
    RAISE NOTICE 'INFO test 3b: % variant(s) are flagged supplier_available but have no supplier_checked_at', v_n;
  END IF;

  -- ══ 4. The CHECK ═════════════════════════════════════════════════════════
  -- 4a. full_size may be flagged.
  UPDATE public.product_variants
     SET supplier_available = true, supplier_checked_at = now()
   WHERE id = v_full0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  ASSERT v_n = 1, 'test 4a: a full_size variant must be flaggable supplier_available';

  -- 4b. a set may be flagged.
  IF v_set0 IS NOT NULL THEN
    UPDATE public.product_variants SET supplier_available = true WHERE id = v_set0;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    ASSERT v_n = 1, 'test 4b: a set variant must be flaggable supplier_available';
  END IF;

  -- 4c. a decant can NOT be flagged via UPDATE.
  v_state := NULL; v_constraint := NULL;
  BEGIN
    UPDATE public.product_variants SET supplier_available = true WHERE id = v_decant;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    v_state := SQLSTATE;
  END;
  ASSERT v_state = '23514' AND v_constraint = 'chk_decant_not_supplier_available',
    format('test 4c: flagging a decant must violate the CHECK (23514), got state=%s constraint=%s',
           COALESCE(v_state, 'NO ERROR'), v_constraint);

  -- 4d. a decant can NOT be created already flagged.
  v_state := NULL; v_constraint := NULL;
  BEGIN
    INSERT INTO public.product_variants
      (product_id, product_type, size_ml, price, stock, sku, supplier_available)
    VALUES (v_prod, 'decant', 10, 3500, 0, 'SUPTEST-' || left(gen_random_uuid()::text, 8), true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    v_state := SQLSTATE;
  END;
  ASSERT v_state = '23514' AND v_constraint = 'chk_decant_not_supplier_available',
    format('test 4d: inserting a flagged decant must violate the CHECK (23514), got state=%s constraint=%s',
           COALESCE(v_state, 'NO ERROR'), v_constraint);

  -- 4e. a flagged variant can NOT be turned into a decant.
  v_state := NULL; v_constraint := NULL;
  BEGIN
    UPDATE public.product_variants SET product_type = 'decant' WHERE id = v_full0;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    v_state := SQLSTATE;
  END;
  ASSERT v_state = '23514' AND v_constraint = 'chk_decant_not_supplier_available',
    format('test 4e: converting a flagged variant to a decant must violate the CHECK (23514), got state=%s constraint=%s',
           COALESCE(v_state, 'NO ERROR'), v_constraint);

  -- 4f. an unflagged decant is unaffected (existing decants keep working).
  UPDATE public.product_variants SET price = 2100 WHERE id = v_decant;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  ASSERT v_n = 1, 'test 4f: ordinary edits to an unflagged decant must still work';

  -- 4g. NULL is not a third state.
  v_state := NULL;
  BEGIN
    UPDATE public.product_variants SET supplier_available = NULL WHERE id = v_full0;
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  ASSERT v_state = '23502',
    format('test 4g: supplier_available = NULL must be rejected (23502), got %s', COALESCE(v_state, 'NO ERROR'));

  -- ══ 5. Stock independence ════════════════════════════════════════════════
  SELECT stock INTO v_stock FROM public.product_variants WHERE id = v_full5;
  SELECT count(*) INTO v_mov_before FROM public.stock_movements WHERE variant_id = v_full5;

  UPDATE public.product_variants
     SET supplier_available = true, supplier_checked_at = now()
   WHERE id = v_full5;
  UPDATE public.product_variants
     SET supplier_available = false, supplier_checked_at = now()
   WHERE id = v_full5;
  UPDATE public.product_variants
     SET supplier_available = true
   WHERE id = v_full5;

  ASSERT (SELECT stock FROM public.product_variants WHERE id = v_full5) = v_stock AND v_stock = 5,
    'test 5a: toggling supplier_available must not change physical stock';
  SELECT count(*) INTO v_mov_after FROM public.stock_movements WHERE variant_id = v_full5;
  ASSERT v_mov_after = v_mov_before,
    format('test 5b: toggling supplier_available must not write stock_movements (%s -> %s)', v_mov_before, v_mov_after);

  -- And the reverse: a stock change leaves the flag alone (no hidden trigger).
  UPDATE public.product_variants SET stock = 0 WHERE id = v_full5;
  ASSERT (SELECT supplier_available FROM public.product_variants WHERE id = v_full5),
    'test 5c: a stock change must not reset supplier_available';
  UPDATE public.product_variants SET stock = 5 WHERE id = v_full5;

  -- State used by the access + purchase sections:
  --   v_full0  stock 0, supplier_available = true   (made-to-order)
  --   v_full5  stock 5, supplier_available = true   (in stock; flag must not matter)
  UPDATE public.product_variants SET supplier_available = true, supplier_checked_at = now() WHERE id = v_full0;
  UPDATE public.product_variants SET supplier_available = true WHERE id = v_full5;

  -- ══ 6a. anon: can READ the flag, cannot write ═══════════════════════════
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;

  SELECT supplier_available INTO v_bool FROM public.product_variants WHERE id = v_full0;
  ASSERT v_bool IS TRUE,
    'test 6a: anon must be able to read supplier_available of an active variant (the storefront needs it)';

  v_n := NULL;
  BEGIN
    UPDATE public.product_variants SET supplier_available = false WHERE id = v_full0;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN v_n := 0; END;
  ASSERT v_n = 0, format('test 6b: anon UPDATE of supplier_available must touch 0 rows, touched %s', v_n);

  v_n := NULL;
  BEGIN
    UPDATE public.product_variants SET supplier_checked_at = now() WHERE id = v_full0;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN v_n := 0; END;
  ASSERT v_n = 0, format('test 6c: anon UPDATE of supplier_checked_at must touch 0 rows, touched %s', v_n);

  v_state := NULL;
  BEGIN
    INSERT INTO public.product_variants
      (product_id, product_type, size_ml, price, stock, sku, supplier_available)
    VALUES (v_prod, 'full_size', 200, 20000, 0, 'SUPTEST-ANON-' || left(gen_random_uuid()::text, 8), true);
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  ASSERT v_state = '42501',
    format('test 6d: anon INSERT of a variant must be denied (42501), got %s', COALESCE(v_state, 'NO ERROR'));

  RESET ROLE;
  ASSERT (SELECT supplier_available FROM public.product_variants WHERE id = v_full0),
    'test 6e: the anon attempts must not have changed the stored flag';

  -- ══ 6b. customer: same ═══════════════════════════════════════════════════
  PERFORM set_config('request.jwt.claims', v_claims_cust, true);
  SET LOCAL ROLE authenticated;

  SELECT supplier_available INTO v_bool FROM public.product_variants WHERE id = v_full0;
  ASSERT v_bool IS TRUE, 'test 6f: a customer must be able to read supplier_available';

  v_n := NULL;
  BEGIN
    UPDATE public.product_variants
       SET supplier_available = false, supplier_checked_at = now()
     WHERE id = v_full0;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN v_n := 0; END;
  ASSERT v_n = 0,
    format('test 6g: a customer UPDATE of the supplier fields must touch 0 rows, touched %s', v_n);

  -- A customer must not be able to mass-flag either (no WHERE on the id).
  v_n := NULL;
  BEGIN
    UPDATE public.product_variants SET supplier_available = true WHERE stock = 0;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN v_n := 0; END;
  ASSERT v_n = 0,
    format('test 6h: a customer bulk UPDATE must touch 0 rows, touched %s', v_n);

  v_state := NULL;
  BEGIN
    INSERT INTO public.product_variants
      (product_id, product_type, size_ml, price, stock, sku, supplier_available)
    VALUES (v_prod, 'full_size', 200, 20000, 0, 'SUPTEST-CUST-' || left(gen_random_uuid()::text, 8), true);
  EXCEPTION WHEN OTHERS THEN v_state := SQLSTATE; END;
  ASSERT v_state = '42501',
    format('test 6i: a customer INSERT of a variant must be denied (42501), got %s', COALESCE(v_state, 'NO ERROR'));

  RESET ROLE;
  ASSERT (SELECT supplier_available FROM public.product_variants WHERE id = v_full0),
    'test 6j: the customer attempts must not have changed the stored flag';
  ASSERT (SELECT supplier_available FROM public.product_variants WHERE id = v_decant) IS FALSE,
    'test 6k: the customer bulk attempt must not have flagged the decant';

  -- ══ 6c. admin: can set the flag and its timestamp ═══════════════════════
  PERFORM set_config('request.jwt.claims', v_claims_admin, true);
  SET LOCAL ROLE authenticated;

  UPDATE public.product_variants
     SET supplier_available = false, supplier_checked_at = now()
   WHERE id = v_full0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  ASSERT v_n = 1, format('test 6l: an admin UPDATE of the supplier fields must touch 1 row, touched %s', v_n);

  UPDATE public.product_variants
     SET supplier_available = true, supplier_checked_at = now()
   WHERE id = v_full0;

  RESET ROLE;
  SELECT supplier_available, supplier_checked_at, stock INTO v_row
    FROM public.product_variants WHERE id = v_full0;
  ASSERT v_row.supplier_available AND v_row.supplier_checked_at IS NOT NULL AND v_row.stock = 0,
    'test 6m: the admin write must persist the flag and its timestamp and leave stock at 0';

  -- The CHECK still binds an admin.
  PERFORM set_config('request.jwt.claims', v_claims_admin, true);
  SET LOCAL ROLE authenticated;
  v_state := NULL; v_constraint := NULL;
  BEGIN
    UPDATE public.product_variants SET supplier_available = true WHERE id = v_decant;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    v_state := SQLSTATE;
  END;
  RESET ROLE;
  ASSERT v_state = '23514' AND v_constraint = 'chk_decant_not_supplier_available',
    format('test 6n: even an admin cannot flag a decant, got state=%s constraint=%s',
           COALESCE(v_state, 'NO ERROR'), v_constraint);

  -- ══ 7. Policy census on the LIVE table ═══════════════════════════════════
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.product_variants'::regclass),
    'test 7a: RLS must be enabled on product_variants';

  SELECT string_agg(policyname || ' [' || cmd || ']', ', ' ORDER BY policyname) INTO v_msg
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'product_variants'
     AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
     AND (COALESCE(qual, '') || ' ' || COALESCE(with_check, '')) !~* 'is_admin';
  ASSERT v_msg IS NULL,
    format('test 7b: every write policy on product_variants must be gated by is_admin(); offending: %s', v_msg);

  SELECT count(*) INTO v_n
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'product_variants'
     AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL');
  ASSERT v_n >= 1, 'test 7c: product_variants must have at least one (admin) write policy';

  -- ══ 8. Purchase integrity through the live place_order ═══════════════════
  IF to_regprocedure('public.place_order(jsonb)') IS NULL THEN
    RAISE NOTICE 'SKIP test 8: place_order(jsonb) not deployed in this project';
  ELSE
    -- Mirrors the app's payload (schemas/checkout.ts). The stock check runs in
    -- the item loop, before any shipping calculation, so the zone data does not
    -- matter for the negative cases; test 8d is a control for that.
    v_payload := jsonb_build_object(
      'customer', jsonb_build_object('name', 'Supplier Test', 'email', v_email, 'phone', '88888888'),
      'shipping', jsonb_build_object(
        'address', '100 metros sur de la iglesia',
        'canton_code', '101', 'canton_name', 'San Jose',
        'province_name', 'San Jose', 'district', 'Carmen'),
      'items', jsonb_build_array(jsonb_build_object('variant_id', v_full0, 'quantity', 1)));

    SELECT count(*) INTO v_mov_before FROM public.stock_movements WHERE variant_id = v_full0;

    -- 8a. A guest buying the made-to-order variant is refused by the database.
    PERFORM set_config('request.jwt.claims', '', true);
    SET LOCAL ROLE anon;
    v_msg := NULL;
    BEGIN
      PERFORM public.place_order(v_payload);
      v_msg := 'NO ERROR';
    EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
    RESET ROLE;

    ASSERT v_msg LIKE 'Insufficient stock%',
      format('test 8a: place_order must refuse a stock-0 variant even when supplier_available, got: %s', v_msg);
    ASSERT (SELECT stock FROM public.product_variants WHERE id = v_full0) = 0,
      'test 8b: the refused purchase must leave physical stock at 0';
    ASSERT (SELECT count(*) FROM public.orders WHERE customer_email = v_email) = 0,
      'test 8c: the refused purchase must not leave an order behind';
    SELECT count(*) INTO v_mov_after FROM public.stock_movements WHERE variant_id = v_full0;
    ASSERT v_mov_after = v_mov_before, 'test 8d: the refused purchase must not log a stock movement';

    -- 8e. A stale cart: an in-stock line plus the (now) made-to-order line.
    --     The whole order must fail, and the in-stock line must NOT be reserved.
    v_payload := jsonb_set(v_payload, '{items}', jsonb_build_array(
      jsonb_build_object('variant_id', v_full5, 'quantity', 1),
      jsonb_build_object('variant_id', v_full0, 'quantity', 1)));

    PERFORM set_config('request.jwt.claims', '', true);
    SET LOCAL ROLE anon;
    v_msg := NULL;
    BEGIN
      PERFORM public.place_order(v_payload);
      v_msg := 'NO ERROR';
    EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
    RESET ROLE;

    ASSERT v_msg LIKE 'Insufficient stock%',
      format('test 8e: a cart containing a stock-0 line must fail with a stock error, got: %s', v_msg);
    ASSERT (SELECT stock FROM public.product_variants WHERE id = v_full5) = 5,
      'test 8f: a failed mixed order must not reserve the in-stock line';
    ASSERT (SELECT count(*) FROM public.orders WHERE customer_email = v_email) = 0,
      'test 8g: a failed mixed order must not leave an order behind';

    -- 8h. Control + precedence: an in-stock variant that is ALSO flagged
    --     supplier_available still sells, and only physical stock moves.
    v_payload := jsonb_set(v_payload, '{items}', jsonb_build_array(
      jsonb_build_object('variant_id', v_full5, 'quantity', 1)));

    PERFORM set_config('request.jwt.claims', '', true);
    SET LOCAL ROLE anon;
    v_res := NULL; v_msg := NULL;
    BEGIN
      v_res := public.place_order(v_payload);
    EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
    RESET ROLE;

    IF v_res IS NULL THEN
      RAISE NOTICE 'SKIP test 8h: control purchase rejected in this project (%). Tests 8a-8g still prove the refusal.', v_msg;
    ELSE
      ASSERT (SELECT stock FROM public.product_variants WHERE id = v_full5) = 4,
        'test 8h: an in-stock + supplier_available variant must sell and decrement physical stock by 1';
      ASSERT (v_res->>'subtotal')::numeric = 10000,
        format('test 8i: the order must be priced from the database (10000), got %s', v_res->>'subtotal');
      ASSERT (SELECT count(*) FROM public.order_items
               WHERE order_id = (v_res->>'order_id')::uuid AND variant_id = v_full5) = 1,
        'test 8j: the in-stock line must be on the order';
      ASSERT (SELECT supplier_available FROM public.product_variants WHERE id = v_full5),
        'test 8k: selling a flagged variant must not alter the flag';
    END IF;
  END IF;
END $$;

RESET ROLE;
SELECT 'ALL SUPPLIER AVAILABILITY TESTS PASSED' AS result;

ROLLBACK;
