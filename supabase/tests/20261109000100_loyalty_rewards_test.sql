-- ============================================================================
-- DB-LEVEL TEST SUITE -- Loyalty rewards admin (migrations 20261109000100 +
-- 20261109000200)
-- ============================================================================
-- HOW TO RUN
--   Paste this whole file into the Supabase SQL Editor and run it, AFTER
--   applying BOTH migrations.
--
--   Everything happens inside BEGIN ... ROLLBACK: thresholds, rewards, test
--   users and orders never survive the script, whether it passes or fails.
--   Threshold changes inside the transaction DO run the real issuance against
--   the real customers of the project you run it on — and are rolled back with
--   everything else. Assertions only look at the suite's own users.
--
--   PASS  -> the final SELECT prints "ALL LOYALTY REWARDS TESTS PASSED".
--   FAIL  -> the script aborts with `assertion failed` naming the test, and the
--            transaction rolls back.
--
--   It reads the CURRENT ladder and rewards and builds every expectation from
--   them, so it does not assume the seeded 0/1000/5000/10000/18000 values.
--   Requires at least 4 levels with a gap of >= 4 XP between levels 1-4.
--
-- HOW THE CALLER IS FAKED
--   auth.uid() reads request.jwt.claims; act_as() sets it. For the GRANT tests
--   the real Postgres role is switched too (SET LOCAL ROLE authenticated), like
--   PostgREST does. Nothing is stubbed.
--
-- WHAT IS COVERED
--   Thresholds
--    T1  the live ladder is valid (lowest = 0, strictly increasing)
--    T2  customers and guests cannot change thresholds
--    T3  a valid change is saved, stamped (updated_by) and audited
--    T4  lowering a threshold: customers at exactly / above it reach the level
--        and get its active rewards; one XP below does not
--    T5  equal adjacent thresholds are rejected
--    T6  decreasing thresholds are rejected
--    T7  negative and non-integer values are rejected
--    T8  malformed payloads, missing / duplicated / unknown levels are rejected
--    T9  the lowest level must stay at 0
--    T10 an invalid sequence changes NOTHING (atomic)
--    T11 a stale form (another admin saved since) is rejected
--    T12 a save that needs careful ordering (L2 takes L3's old value) works,
--        and the original ladder can be restored
--    T13 the ladder guard rejects a bad ladder written directly (Studio path)
--    T14 API roles can no longer write levels / coupons directly
--    T15 raising a threshold back never revokes an issued coupon
--   Coupon rewards
--    R1  customers cannot create / edit / toggle / delete / back-issue
--    R2  several rewards per level, on different levels, with unique codes
--    R3  invalid terms are rejected (each rule)
--    R4  crossing a level issues every ACTIVE reward of it — inactive ones not
--    R5  issuance is idempotent (repeated triggers, calls, syncs)
--    R6  editing a definition does NOT change coupons already issued, and
--        apply_order_coupon charges the issued (snapshot) terms
--    R7  deactivating stops future issuance; issued copies stay spendable
--    R8  a reward added after a customer reached its level is NOT issued to
--        them automatically; the explicit retroactive operation is, once
--    R9  delete only works for never-issued rewards
--    R10 issued terms are immutable even for direct writes
--    R11 a stale edit is rejected
--    R12 signup unlocks the entry level and its active rewards
--    R13 every admin action is in the audit log
-- ============================================================================

BEGIN;

-- ── helpers (temp functions: they vanish with the session) ──────────────────
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

-- Runs a statement; returns NULL on success or the error message. The failed
-- statement is rolled back (implicit savepoint), which is what T10 relies on.
CREATE OR REPLACE FUNCTION pg_temp.try(p_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $f$;

CREATE OR REPLACE FUNCTION pg_temp.ladder(p_levels INT[], p_xps INT[]) RETURNS JSONB
LANGUAGE sql AS $f$
  SELECT jsonb_agg(jsonb_build_object('level_number', l, 'required_xp', x) ORDER BY l)
    FROM unnest(p_levels, p_xps) AS t(l, x)
$f$;

CREATE OR REPLACE FUNCTION pg_temp.current_xps() RETURNS INT[]
LANGUAGE sql AS $f$
  SELECT array_agg(required_xp ORDER BY level_number) FROM public.levels
$f$;

CREATE OR REPLACE FUNCTION pg_temp.save(p_payload JSONB) RETURNS TEXT
LANGUAGE sql AS $f$
  SELECT pg_temp.try(format('SELECT public.admin_update_level_thresholds(%L::jsonb)', p_payload))
$f$;

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

CREATE OR REPLACE FUNCTION pg_temp.make_order(p_user UUID, p_subtotal NUMERIC) RETURNS UUID
LANGUAGE plpgsql AS $f$
DECLARE v_id UUID;
BEGIN
  INSERT INTO public.orders (
    user_id, customer_name, customer_email, customer_phone,
    shipping_address, shipping_district, shipping_canton, shipping_province,
    shipping_cost, subtotal, total, source, order_status, payment_status
  ) VALUES (
    p_user, 'PG Loyalty', 'pgloyalty@krov.test', '00000000',
    '100m sur', 'Carmen', 'San Jose', 'San Jose',
    0, p_subtotal, p_subtotal, 'web', 'pending', 'pending'
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

DO $$
DECLARE
  v_admin UUID := gen_random_uuid();
  v_a     UUID := gen_random_uuid();   -- one XP below the lowered L2
  v_b     UUID := gen_random_uuid();   -- exactly at it
  v_c     UUID := gen_random_uuid();   -- one XP above it
  v_d     UUID := gen_random_uuid();   -- climbs to L4
  v_e     UUID := gen_random_uuid();   -- climbs to L4 after a deactivation
  v_f     UUID := gen_random_uuid();   -- signs up after an entry-level reward exists

  v_l     INT[];     -- level numbers, ascending
  v_x     INT[];     -- live thresholds, ascending
  v_new   INT[];
  v_mid2  INT;
  v_err   TEXT;
  v_res   JSONB;
  v_n     INT;
  v_m     INT;
  v_audit INT;
  v_row   RECORD;

  v_r10   UUID;  v_r15 UUID;  v_r20 UUID;  v_inactive UUID;  v_fixed UUID;
  v_spare UUID;  v_entry UUID;
  v_uc10  UUID;  v_uc15 UUID;
  v_order UUID;
BEGIN
  -- ══ ARRANGE ═══════════════════════════════════════════════════════════════
  PERFORM pg_temp.make_user(v_admin, 'pgloyalty-admin@krov.test');
  PERFORM pg_temp.make_user(v_a, 'pgloyalty-a@krov.test');
  PERFORM pg_temp.make_user(v_b, 'pgloyalty-b@krov.test');
  PERFORM pg_temp.make_user(v_c, 'pgloyalty-c@krov.test');
  PERFORM pg_temp.make_user(v_d, 'pgloyalty-d@krov.test');
  PERFORM pg_temp.make_user(v_e, 'pgloyalty-e@krov.test');
  UPDATE public.profiles SET role = 'admin' WHERE id = v_admin;

  SELECT array_agg(level_number ORDER BY level_number), array_agg(required_xp ORDER BY level_number)
    INTO v_l, v_x FROM public.levels;

  ASSERT cardinality(v_l) >= 4, 'precondition: at least 4 levels';
  ASSERT v_x[2] - v_x[1] >= 4 AND v_x[3] - v_x[2] >= 4 AND v_x[4] - v_x[3] >= 4,
    'precondition: gaps of >= 4 XP between levels 1-4';
  ASSERT cardinality(v_l) < 5 OR v_x[5] - v_x[4] > 100,
    'precondition: level 5 sits more than 100 XP above level 4';

  SELECT count(*) INTO v_audit FROM public.loyalty_audit_log;

  -- ══ T1. The live ladder is valid ══════════════════════════════════════════
  ASSERT v_x[1] = 0, format('T1a: lowest level must require 0 XP, got %s', v_x[1]);
  FOR i IN 2 .. cardinality(v_x) LOOP
    ASSERT v_x[i] > v_x[i - 1], format('T1b: level %s must exceed level %s', v_l[i], v_l[i - 1]);
  END LOOP;

  -- ══ T2. Only admins ═══════════════════════════════════════════════════════
  PERFORM pg_temp.act_as(v_a);
  v_err := pg_temp.save(pg_temp.ladder(v_l, v_x));
  ASSERT v_err = 'loyalty_forbidden', format('T2a: customer must be refused, got %s', v_err);

  PERFORM pg_temp.act_as_guest();
  v_err := pg_temp.save(pg_temp.ladder(v_l, v_x));
  ASSERT v_err = 'loyalty_forbidden', format('T2b: guest must be refused, got %s', v_err);

  -- ══ T3 + T4. Lower L2 to its midpoint; A/B/C sit around the new boundary ══
  v_mid2 := (v_x[1] + v_x[2]) / 2;
  -- Below the OLD L2, so today they are all on level 1.
  UPDATE public.profiles SET experience_points = v_mid2 - 1 WHERE id = v_a;
  UPDATE public.profiles SET experience_points = v_mid2     WHERE id = v_b;
  UPDATE public.profiles SET experience_points = v_mid2 + 1 WHERE id = v_c;

  ASSERT NOT EXISTS (SELECT 1 FROM public.profile_level_unlocks
                      WHERE user_id IN (v_a, v_b, v_c) AND level_number = v_l[2]),
    'T4 precondition: nobody has reached L2 yet';

  PERFORM pg_temp.act_as(v_admin);
  v_new := v_x;
  v_new[2] := v_mid2;
  v_res := public.admin_update_level_thresholds(pg_temp.ladder(v_l, v_new));
  ASSERT (v_res->>'changed_levels')::INT = 1, format('T3a: 1 level changed, got %s', v_res);
  ASSERT pg_temp.current_xps() = v_new, 'T3b: the new ladder is stored';
  ASSERT (SELECT updated_by FROM public.levels WHERE level_number = v_l[2]) = v_admin,
    'T3c: updated_by is the admin';
  ASSERT (SELECT count(*) FROM public.loyalty_audit_log
           WHERE action = 'levels.update' AND actor_id = v_admin) = 1,
    'T3d: the save is audited';

  ASSERT NOT EXISTS (SELECT 1 FROM public.profile_level_unlocks
                      WHERE user_id = v_a AND level_number = v_l[2]),
    'T4a: one XP below the threshold must NOT reach the level';
  ASSERT EXISTS (SELECT 1 FROM public.profile_level_unlocks
                  WHERE user_id = v_b AND level_number = v_l[2] AND source = 'threshold_change'),
    'T4b: exactly at the threshold reaches the level';
  ASSERT EXISTS (SELECT 1 FROM public.profile_level_unlocks
                  WHERE user_id = v_c AND level_number = v_l[2]),
    'T4c: one XP above the threshold reaches the level';

  SELECT count(*) INTO v_n FROM public.coupons WHERE level_required = v_l[2] AND is_active;
  SELECT count(*) INTO v_m FROM public.user_coupons WHERE user_id = v_b AND level_required = v_l[2];
  ASSERT v_m = v_n, format('T4d: B gets every active L2 reward (%s), got %s', v_n, v_m);
  ASSERT NOT EXISTS (SELECT 1 FROM public.user_coupons WHERE user_id = v_a AND level_required = v_l[2]),
    'T4e: A gets no L2 reward';

  -- ══ T5. Equal adjacent ═════════════════════════════════════════════════════
  v_new := pg_temp.current_xps();
  v_new[3] := v_new[2];
  v_err := pg_temp.save(pg_temp.ladder(v_l, v_new));
  ASSERT v_err = format('levels_not_increasing:%s', v_l[3]), format('T5: got %s', v_err);

  -- ══ T6. Decreasing ════════════════════════════════════════════════════════
  v_new := pg_temp.current_xps();
  v_new[3] := v_new[2] - 1;
  v_err := pg_temp.save(pg_temp.ladder(v_l, v_new));
  ASSERT v_err = format('levels_not_increasing:%s', v_l[3]), format('T6: got %s', v_err);

  -- ══ T7. Negative / non-integer ═════════════════════════════════════════════
  v_err := pg_temp.save(jsonb_set(pg_temp.ladder(v_l, pg_temp.current_xps()), '{1,required_xp}', '-5'));
  ASSERT v_err = format('levels_invalid_value:%s', v_l[2]), format('T7a: negative, got %s', v_err);

  v_err := pg_temp.save(jsonb_set(pg_temp.ladder(v_l, pg_temp.current_xps()), '{1,required_xp}', '1500.5'));
  ASSERT v_err = format('levels_invalid_value:%s', v_l[2]), format('T7b: non-integer, got %s', v_err);

  v_err := pg_temp.save(jsonb_set(pg_temp.ladder(v_l, pg_temp.current_xps()), '{1,required_xp}', '10000001'));
  ASSERT v_err = format('levels_invalid_value:%s', v_l[2]), format('T7c: above the cap, got %s', v_err);

  -- ══ T8. Payload shape ═════════════════════════════════════════════════════
  v_err := pg_temp.save(jsonb_set(pg_temp.ladder(v_l, pg_temp.current_xps()), '{1,required_xp}', '"abc"'));
  ASSERT v_err = 'levels_invalid_payload', format('T8a: string value, got %s', v_err);

  v_err := pg_temp.save('{"level_number": 1}'::jsonb);
  ASSERT v_err = 'levels_invalid_payload', format('T8b: not an array, got %s', v_err);

  v_err := pg_temp.save(pg_temp.ladder(v_l[1:cardinality(v_l) - 1],
                                       (pg_temp.current_xps())[1:cardinality(v_l) - 1]));
  ASSERT v_err = 'levels_incomplete', format('T8c: missing level, got %s', v_err);

  v_err := pg_temp.save(jsonb_set(pg_temp.ladder(v_l, pg_temp.current_xps()), '{2,level_number}', to_jsonb(v_l[2])));
  ASSERT v_err = format('levels_duplicate_level:%s', v_l[2]), format('T8d: duplicate, got %s', v_err);

  v_err := pg_temp.save(jsonb_set(pg_temp.ladder(v_l, pg_temp.current_xps()), '{2,level_number}', '999'));
  ASSERT v_err = 'levels_unknown_level:999', format('T8e: unknown level, got %s', v_err);

  -- ══ T9. Lowest level stays at 0 ═══════════════════════════════════════════
  v_new := pg_temp.current_xps();
  v_new[1] := 1;
  v_err := pg_temp.save(pg_temp.ladder(v_l, v_new));
  ASSERT v_err = 'levels_base_not_zero', format('T9: got %s', v_err);

  -- ══ T10. Atomic: first changes valid, the LAST pair inverted ═════════════
  v_new := pg_temp.current_xps();
  v_new[2] := v_new[2] + 1;                                   -- valid on its own
  v_new[cardinality(v_new)] := v_new[cardinality(v_new) - 1];  -- invalid
  v_err := pg_temp.save(pg_temp.ladder(v_l, v_new));
  ASSERT v_err LIKE 'levels_not_increasing:%', format('T10a: got %s', v_err);
  v_new := v_x;
  v_new[2] := v_mid2;
  ASSERT pg_temp.current_xps() = v_new, 'T10b: a rejected save must leave EVERY level unchanged';

  -- ══ T11. Stale form ═══════════════════════════════════════════════════════
  v_err := pg_temp.try(format(
    'SELECT public.admin_update_level_thresholds(%L::jsonb, %L::timestamptz)',
    pg_temp.ladder(v_l, pg_temp.current_xps()), '2000-01-01T00:00:00Z'));
  ASSERT v_err = 'levels_stale', format('T11a: got %s', v_err);
  v_res := public.admin_update_level_thresholds(
    pg_temp.ladder(v_l, pg_temp.current_xps()),
    (SELECT max(updated_at) FROM public.levels));
  ASSERT (v_res->>'changed_levels')::INT = 0, 'T11b: an up-to-date no-op save succeeds and changes nothing';

  -- ══ T12. Order-sensitive save, then restore the original ladder ══════════
  v_new := pg_temp.current_xps();
  v_new[2] := v_x[3];                         -- L2 takes L3's CURRENT value …
  v_new[3] := (v_x[3] + v_x[4]) / 2;          -- … while L3 moves up
  v_res := public.admin_update_level_thresholds(pg_temp.ladder(v_l, v_new));
  ASSERT (v_res->>'changed_levels')::INT = 2, format('T12a: got %s', v_res);
  ASSERT pg_temp.current_xps() = v_new, 'T12b: stored';

  v_res := public.admin_update_level_thresholds(pg_temp.ladder(v_l, v_x));
  ASSERT pg_temp.current_xps() = v_x, 'T12c: the original ladder is restored';

  -- ══ T15. Raising L2 back revoked nothing ══════════════════════════════════
  SELECT count(*) INTO v_m FROM public.user_coupons WHERE user_id = v_b AND level_required = v_l[2];
  ASSERT v_m = v_n, format('T15: B keeps its L2 rewards after the raise, got %s', v_m);

  -- ══ T13. Ladder guard on a direct write ══════════════════════════════════
  RESET ROLE;
  SET CONSTRAINTS public.trg_levels_enforce_ladder IMMEDIATE;
  -- v_x[2] - 1: below L2 and above L1 — inverted, without a unique collision.
  v_err := pg_temp.try(format('UPDATE public.levels SET required_xp = %s WHERE level_number = %s',
                              v_x[2] - 1, v_l[3]));
  ASSERT v_err = format('levels_not_increasing:%s', v_l[3]), format('T13a: got %s', v_err);
  v_err := pg_temp.try(format('UPDATE public.levels SET required_xp = 5 WHERE level_number = %s', v_l[1]));
  ASSERT v_err = 'levels_base_not_zero', format('T13b: got %s', v_err);
  SET CONSTRAINTS public.trg_levels_enforce_ladder DEFERRED;
  ASSERT pg_temp.current_xps() = v_x, 'T13c: unchanged';

  -- ══ T14. No direct writes through the API roles ═════════════════════════
  PERFORM pg_temp.act_as(v_admin);
  SET LOCAL ROLE authenticated;
  v_err := NULL;
  BEGIN
    UPDATE public.levels SET required_xp = required_xp WHERE level_number = v_l[2];
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  ASSERT v_err = '42501', format('T14a: even an admin cannot UPDATE levels directly, got %s', v_err);
  v_err := NULL;
  BEGIN
    UPDATE public.coupons SET discount_value = 99 WHERE level_required = v_l[2];
  EXCEPTION WHEN OTHERS THEN v_err := SQLSTATE; END;
  ASSERT v_err = '42501', format('T14b: nor coupons, got %s', v_err);
  ASSERT (SELECT count(*) FROM public.levels) = cardinality(v_l), 'T14c: SELECT still works';
  RESET ROLE;

  -- ══ R1. Customers cannot manage rewards ══════════════════════════════════
  PERFORM pg_temp.act_as(v_a);
  v_err := pg_temp.try(format(
    'SELECT public.admin_create_coupon_reward(%s, %L, NULL, %L, 10, 20000)', v_l[4], 'X', 'percentage'));
  ASSERT v_err = 'loyalty_forbidden', format('R1a: create, got %s', v_err);
  v_err := pg_temp.try(format(
    'SELECT public.admin_update_coupon_reward(%L, %L, NULL, 10, 20000)',
    (SELECT id FROM public.coupons LIMIT 1), 'X'));
  ASSERT v_err = 'loyalty_forbidden', format('R1b: update, got %s', v_err);
  v_err := pg_temp.try(format('SELECT public.admin_set_coupon_reward_active(%L, false)',
    (SELECT id FROM public.coupons LIMIT 1)));
  ASSERT v_err = 'loyalty_forbidden', format('R1c: toggle, got %s', v_err);
  v_err := pg_temp.try(format('SELECT public.admin_delete_coupon_reward(%L)',
    (SELECT id FROM public.coupons LIMIT 1)));
  ASSERT v_err = 'loyalty_forbidden', format('R1d: delete, got %s', v_err);
  v_err := pg_temp.try(format('SELECT public.admin_issue_coupon_reward_retroactively(%L, false)',
    (SELECT id FROM public.coupons LIMIT 1)));
  ASSERT v_err = 'loyalty_forbidden', format('R1e: back-issue, got %s', v_err);

  -- ══ R2. Several rewards per level ════════════════════════════════════════
  PERFORM pg_temp.act_as(v_admin);
  v_res := public.admin_create_coupon_reward(v_l[4], 'Cupón 10', NULL, 'percentage', 10, 20000);
  v_r10 := (v_res->>'id')::UUID;
  v_res := public.admin_create_coupon_reward(v_l[4], 'Cupón 15', 'Quince', 'percentage', 15, 20000, 30000, 30);
  v_r15 := (v_res->>'id')::UUID;
  v_res := public.admin_create_coupon_reward(v_l[4], 'Cupón 10 bis', NULL, 'percentage', 10, 25000);
  ASSERT v_res->>'code' <> (SELECT code FROM public.coupons WHERE id = v_r10),
    format('R2a: same level + same value still gets a unique code, got %s', v_res->>'code');
  v_res := public.admin_create_coupon_reward(v_l[4], 'Inactivo', NULL, 'percentage', 30, 0, NULL, NULL, false);
  v_inactive := (v_res->>'id')::UUID;
  v_res := public.admin_create_coupon_reward(v_l[3], 'Fijo', NULL, 'fixed', 5000, 30000);
  v_fixed := (v_res->>'id')::UUID;
  ASSERT v_res->>'code' LIKE '%CRC%', format('R2b: fixed code, got %s', v_res->>'code');

  SELECT count(*) INTO v_n FROM public.coupons WHERE level_required = v_l[4] AND is_active;
  ASSERT v_n >= 3, format('R2c: L4 carries several active rewards, got %s', v_n);
  ASSERT (SELECT created_by FROM public.coupons WHERE id = v_r10) = v_admin, 'R2d: created_by';

  -- ══ R3. Invalid terms ═════════════════════════════════════════════════════
  FOR v_row IN
    SELECT * FROM (VALUES
      ('percentage', '0',     '20000', 'NULL',  'NULL', 'reward_invalid_value'),
      ('percentage', '101',   '20000', 'NULL',  'NULL', 'reward_invalid_value'),
      ('percentage', '12.345','20000', 'NULL',  'NULL', 'reward_invalid_value'),
      ('fixed',      '10.5',  '20000', 'NULL',  'NULL', 'reward_invalid_value'),
      ('fixed',      '5000',  '20000', '1000',  'NULL', 'reward_invalid_max_discount'),
      ('percentage', '10',    '-1',    'NULL',  'NULL', 'reward_invalid_min_subtotal'),
      ('percentage', '10',    '1.5',   'NULL',  'NULL', 'reward_invalid_min_subtotal'),
      ('percentage', '10',    '20000', '0',     'NULL', 'reward_invalid_max_discount'),
      ('percentage', '10',    '20000', 'NULL',  '0',    'reward_invalid_valid_days'),
      ('bogus',      '10',    '20000', 'NULL',  'NULL', 'reward_invalid_type')
    ) AS t(dtype, val, minsub, maxd, days, expected)
  LOOP
    v_err := pg_temp.try(format(
      'SELECT public.admin_create_coupon_reward(%s, %L, NULL, %L, %s, %s, %s, %s)',
      v_l[4], 'Bad', v_row.dtype, v_row.val, v_row.minsub, v_row.maxd, v_row.days));
    ASSERT v_err = v_row.expected,
      format('R3: %s %s min %s max %s days %s -> expected %s, got %s',
             v_row.dtype, v_row.val, v_row.minsub, v_row.maxd, v_row.days, v_row.expected, v_err);
  END LOOP;
  v_err := pg_temp.try(format('SELECT public.admin_create_coupon_reward(%s, %L, NULL, %L, 10, 0)', v_l[4], '   ', 'percentage'));
  ASSERT v_err = 'reward_invalid_name', format('R3: blank name, got %s', v_err);
  v_err := pg_temp.try(format('SELECT public.admin_create_coupon_reward(999, %L, NULL, %L, 10, 0)', 'X', 'percentage'));
  ASSERT v_err = 'reward_invalid_level', format('R3: unknown level, got %s', v_err);

  -- ══ R4. Crossing levels issues every ACTIVE reward ═════════════════════
  RESET ROLE;
  UPDATE public.profiles SET experience_points = v_x[4] WHERE id = v_d;

  SELECT count(*) INTO v_n FROM public.coupons
   WHERE is_active AND level_required IN (SELECT level_number FROM public.levels WHERE required_xp <= v_x[4]);
  SELECT count(*) INTO v_m FROM public.user_coupons WHERE user_id = v_d;
  ASSERT v_m = v_n, format('R4a: D holds every active reward up to L4 (%s), got %s', v_n, v_m);
  ASSERT EXISTS (SELECT 1 FROM public.user_coupons WHERE user_id = v_d AND coupon_id = v_r10)
     AND EXISTS (SELECT 1 FROM public.user_coupons WHERE user_id = v_d AND coupon_id = v_r15),
    'R4b: both new L4 rewards issued independently';
  ASSERT NOT EXISTS (SELECT 1 FROM public.user_coupons WHERE user_id = v_d AND coupon_id = v_inactive),
    'R4c: the inactive reward is NOT issued';
  ASSERT (SELECT count(*) FROM public.profile_level_unlocks WHERE user_id = v_d) = 4,
    'R4d: D has unlocked exactly levels 1-4';

  -- ══ R5. Idempotent ═══════════════════════════════════════════════════════
  PERFORM public.grant_level_coupons(v_d);
  PERFORM public.grant_level_coupons(v_d);
  PERFORM public.sync_level_unlocks('repair');
  UPDATE public.profiles SET experience_points = experience_points + 1 WHERE id = v_d;
  ASSERT (SELECT count(*) FROM public.user_coupons WHERE user_id = v_d) = v_m,
    'R5a: no duplicate coupons';
  ASSERT (SELECT count(*) FROM (SELECT coupon_id FROM public.user_coupons WHERE user_id = v_d
                                 GROUP BY coupon_id HAVING count(*) > 1) s) = 0,
    'R5b: never two copies of one reward';

  -- ══ R6. Editing a definition does not touch issued coupons ════════════════
  SELECT id INTO v_uc10 FROM public.user_coupons WHERE user_id = v_d AND coupon_id = v_r10;
  PERFORM pg_temp.act_as(v_admin);
  v_res := public.admin_update_coupon_reward(v_r10, 'Cupón 11', NULL, 11, 0);
  ASSERT (v_res->>'discount_value')::NUMERIC = 11, 'R6a: definition updated';
  ASSERT (SELECT discount_value FROM public.user_coupons WHERE id = v_uc10) = 10
     AND (SELECT min_order_subtotal FROM public.user_coupons WHERE id = v_uc10) = 20000
     AND (SELECT coupon_name FROM public.user_coupons WHERE id = v_uc10) = 'Cupón 10',
    'R6b: the issued coupon keeps 10% / ₡20,000 / its name';

  PERFORM pg_temp.act_as(v_d);
  v_order := pg_temp.make_order(v_d, 100000);
  v_res := public.apply_order_coupon(v_order, v_uc10);
  ASSERT (v_res->>'discount_amount')::NUMERIC = 10000,
    format('R6c: charged the issued 10%%, not the edited 11%%, got %s', v_res->>'discount_amount');

  -- ══ R7. Deactivation: future only ═════════════════════════════════════════
  SELECT id INTO v_uc15 FROM public.user_coupons WHERE user_id = v_d AND coupon_id = v_r15;
  PERFORM pg_temp.act_as(v_admin);
  v_res := public.admin_set_coupon_reward_active(v_r15, false);
  ASSERT (v_res->>'is_active')::BOOLEAN = false, 'R7a: deactivated';

  PERFORM pg_temp.act_as(v_d);
  v_order := pg_temp.make_order(v_d, 100000);
  v_res := public.apply_order_coupon(v_order, v_uc15);
  ASSERT (v_res->>'discount_amount')::NUMERIC = 15000,
    format('R7b: an issued copy of a retired reward is still spendable, got %s', v_res);

  RESET ROLE;
  UPDATE public.profiles SET experience_points = v_x[4] WHERE id = v_e;
  ASSERT NOT EXISTS (SELECT 1 FROM public.user_coupons WHERE user_id = v_e AND coupon_id = v_r15),
    'R7c: a customer reaching L4 after the deactivation does not get it';
  ASSERT EXISTS (SELECT 1 FROM public.user_coupons WHERE user_id = v_e AND coupon_id = v_r10),
    'R7d: … but does get the still-active one';

  -- ══ R8. New reward vs. customers already at the level ════════════════════
  PERFORM pg_temp.act_as(v_admin);
  v_res := public.admin_create_coupon_reward(v_l[4], 'Cupón 20', NULL, 'percentage', 20, 20000);
  v_r20 := (v_res->>'id')::UUID;

  RESET ROLE;
  UPDATE public.profiles SET experience_points = experience_points + 50 WHERE id = v_d;
  ASSERT NOT EXISTS (SELECT 1 FROM public.user_coupons WHERE user_id = v_d AND coupon_id = v_r20),
    'R8a: no silent retroactive issue, not even on the next XP change';

  PERFORM pg_temp.act_as(v_admin);
  v_res := public.admin_issue_coupon_reward_retroactively(v_r20);          -- dry run
  ASSERT (v_res->>'dry_run')::BOOLEAN AND (v_res->>'issued')::INT = 0
     AND (v_res->>'eligible')::INT >= 2,
    format('R8b: dry run counts D and E without issuing, got %s', v_res);
  ASSERT NOT EXISTS (SELECT 1 FROM public.user_coupons WHERE coupon_id = v_r20),
    'R8c: the dry run issued nothing';
  v_n := (v_res->>'eligible')::INT;

  v_res := public.admin_issue_coupon_reward_retroactively(v_r20, false);
  ASSERT (v_res->>'issued')::INT = v_n, format('R8d: issued to every eligible customer, got %s', v_res);
  ASSERT (SELECT issue_source FROM public.user_coupons WHERE user_id = v_d AND coupon_id = v_r20) = 'retroactive',
    'R8e: marked retroactive';
  v_res := public.admin_issue_coupon_reward_retroactively(v_r20, false);
  ASSERT (v_res->>'issued')::INT = 0, format('R8f: running it again issues nothing, got %s', v_res);
  ASSERT NOT EXISTS (SELECT 1 FROM public.user_coupons WHERE user_id = v_a AND coupon_id = v_r20),
    'R8g: customers below the level are not eligible';

  v_err := pg_temp.try(format('SELECT public.admin_issue_coupon_reward_retroactively(%L, false)', v_inactive));
  ASSERT v_err = 'reward_inactive', format('R8h: inactive reward cannot be back-issued, got %s', v_err);

  -- ══ R9. Delete ══════════════════════════════════════════════════════════
  v_res := public.admin_create_coupon_reward(v_l[cardinality(v_l)], 'Borrador', NULL, 'percentage', 7, 0, NULL, NULL, false);
  v_spare := (v_res->>'id')::UUID;
  v_res := public.admin_delete_coupon_reward(v_spare);
  ASSERT NOT EXISTS (SELECT 1 FROM public.coupons WHERE id = v_spare), 'R9a: never-issued reward deleted';
  v_err := pg_temp.try(format('SELECT public.admin_delete_coupon_reward(%L)', v_r10));
  ASSERT v_err = 'reward_has_issued_coupons', format('R9b: issued reward kept, got %s', v_err);

  -- ══ R10. Issued terms immutable ═══════════════════════════════════════════
  RESET ROLE;
  v_err := pg_temp.try(format('UPDATE public.user_coupons SET discount_value = 99 WHERE id = %L', v_uc10));
  ASSERT v_err = 'user_coupon_terms_immutable', format('R10a: got %s', v_err);
  v_err := pg_temp.try(format('UPDATE public.user_coupons SET level_required = 1 WHERE id = %L', v_uc10));
  ASSERT v_err = 'user_coupon_terms_immutable', format('R10b: got %s', v_err);

  -- ══ R11. Stale edit ═══════════════════════════════════════════════════════
  PERFORM pg_temp.act_as(v_admin);
  v_err := pg_temp.try(format(
    'SELECT public.admin_update_coupon_reward(%L, %L, NULL, 12, 0, NULL, NULL, %L::timestamptz)',
    v_r10, 'X', '2000-01-01T00:00:00Z'));
  ASSERT v_err = 'reward_stale', format('R11: got %s', v_err);

  -- ══ R12. Signup unlocks the entry level ═══════════════════════════════════
  v_res := public.admin_create_coupon_reward(v_l[1], 'Bienvenida', NULL, 'percentage', 5, 20000);
  v_entry := (v_res->>'id')::UUID;
  RESET ROLE;
  PERFORM pg_temp.make_user(v_f, 'pgloyalty-f@krov.test');
  ASSERT EXISTS (SELECT 1 FROM public.profile_level_unlocks
                  WHERE user_id = v_f AND level_number = v_l[1] AND source = 'signup'),
    'R12a: a new account unlocks the entry level';
  ASSERT EXISTS (SELECT 1 FROM public.user_coupons WHERE user_id = v_f AND coupon_id = v_entry),
    'R12b: … and receives its active reward';
  ASSERT NOT EXISTS (SELECT 1 FROM public.user_coupons WHERE user_id = v_a AND coupon_id = v_entry),
    'R12c: existing customers do not (they reached it before the reward existed)';

  -- ══ R13. Audit ════════════════════════════════════════════════════════════
  SELECT count(DISTINCT action) INTO v_n FROM public.loyalty_audit_log WHERE actor_id = v_admin;
  ASSERT v_n = 6, format('R13: levels.update, reward.create/update/deactivate/delete/issue_retroactive, got %s', v_n);
  ASSERT (SELECT count(*) FROM public.loyalty_audit_log) > v_audit, 'R13b: rows were added';
END $$;

SELECT 'ALL LOYALTY REWARDS TESTS PASSED' AS result;

ROLLBACK;
