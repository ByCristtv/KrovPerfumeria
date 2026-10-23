-- ============================================================================
-- 20261023000100_profiles_privilege_hardening.sql
-- SECURITY FIX: customers could rewrite privileged columns of their own
-- profile (role, experience_points, id, created_at, updated_at, ...) straight
-- through the Supabase API.
-- ============================================================================
-- THE VULNERABILITY (confirmed on production)
--   * `authenticated` holds table-level UPDATE on public.profiles, plus
--     column-level UPDATE on role / experience_points / id / created_at /
--     updated_at.
--   * The UPDATE policies only check `auth.uid() = id` — they decide WHICH row,
--     never WHICH columns. RLS cannot restrict columns.
--   So any signed-in customer could run
--       PATCH /rest/v1/profiles?id=eq.<me>   {"role":"admin"}
--   and become an admin (proxy.ts + is_admin() both trust profiles.role), or
--   set their own XP — which unlocks level coupons (18% off at Maestro) and
--   moves them up the public ranking.
--
-- THE FIX — three independent layers, any one of which blocks the attack
--   1. PRIVILEGES (least privilege). Every table- and column-level write
--      privilege of anon / authenticated is revoked, then `authenticated` gets
--      UPDATE on exactly the columns customers legitimately edit today:
--
--          phone            /profile contact card (browser client, ContactSection)
--          avatar_url       POST /api/profile/avatar (user-bound server client)
--          username         /profile ranking card (updateRankingSettingsAction)
--          show_in_ranking  same action
--
--      Postgres then rejects anything else with 42501 "permission denied"
--      before RLS even runs. New columns added later are NOT editable unless
--      granted here — secure by default.
--   2. GUARD TRIGGER. A BEFORE INSERT/UPDATE trigger rejects any change to a
--      non-allowlisted column when the statement runs as an API role (anon /
--      authenticated). It is a backstop for a future accidental
--      `GRANT UPDATE ON profiles TO authenticated` (e.g. a Studio toggle).
--      SECURITY DEFINER functions run as their owner, so every legitimate
--      privileged writer passes unchanged (list below).
--   3. RLS. All existing policies on profiles (including the duplicate
--      permissive ones) are replaced by one SELECT and one UPDATE policy,
--      scoped TO authenticated, with no INSERT/DELETE policy at all.
--
-- LEGITIMATE WRITERS — all SECURITY DEFINER, all keep working
--   handle_new_user()                 signup: INSERT profile (role 'customer')
--   grant_order_xp() / trigger        order -> received: experience_points
--   reconcile_profile_order_xp()      guest-order claim:  experience_points (via grant_order_xp)
--   admin_adjust_customer_xp()        admin XP add/deduct (is_admin() gate) — 20261022000100
--   review_wholesale_application()    admin role customer <-> wholesale (is_admin() gate)
--   set_social_profile_visibility()   customer: is_profile_public (own row, username rule)
--   grant_level_coupons trigger       reads only
--   service_role (lib/supabase/admin) / Studio (postgres) — not API roles, unaffected
--
-- Columns customers can NO LONGER write directly (all were writable before):
--   role, experience_points, id, created_at, updated_at, full_name,
--   is_profile_public (use set_social_profile_visibility), plus any column the
--   live table has that this repo does not know about.
--   `full_name` is set at signup from auth metadata and no UI edits it; add it
--   to the GRANT below (and to v_allowed in the trigger, and to
--   lib/profile/editableColumns.ts) if a "change your name" feature ships.
--
-- POLICY CLEANUP — what gets dropped and why it is safe
--   Every policy on public.profiles is dropped and the canonical pair below is
--   recreated. Before dropping, each one is printed (RAISE NOTICE), so the Studio
--   output records exactly what was removed.
--     * Write policies (UPDATE / INSERT / DELETE / ALL) are always dropped:
--       they are the vulnerable surface. Customer self-edits are covered by the
--       new UPDATE policy + column grants; every privileged write goes through
--       a SECURITY DEFINER function, which bypasses RLS as the table owner.
--     * SELECT policies are dropped only if they are a recognised duplicate of
--       "own row" or "is_admin()". Any OTHER read policy — e.g. the Supabase
--       starter's "Public profiles are viewable by everyone" USING (true),
--       which would expose every customer's phone number — makes the migration
--       ABORT, so a human decides. Nothing in this codebase reads another
--       user's profile directly (social / ranking / admin reads use SECURITY
--       DEFINER RPCs or the admin policy), so dropping such a policy is safe;
--       to confirm that, run first in the same Studio session/script:
--           SET app.profiles_hardening_drop_unknown_policies = 'on';
--
-- Idempotent: safe to re-run. Wrapped in a single transaction by Studio /
-- `supabase db push`; if any step fails nothing is applied.
-- Depends on: public.profiles, public.is_admin(), public.handle_updated_at().
-- Tests: supabase/tests/20261023000100_profiles_privilege_hardening_test.sql
-- App mirror: lib/profile/editableColumns.ts (keep the allowlists in lock-step)
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. Privileges: revoke every write, then grant the allowlist
-- ────────────────────────────────────────────────────────────────────────────
-- Table-level REVOKE does NOT remove column-level grants, so those are revoked
-- column by column, for every column the live table actually has.

REVOKE ALL ON public.profiles FROM PUBLIC;
REVOKE ALL ON public.profiles FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.profiles FROM authenticated;

DO $$
DECLARE
  v_col TEXT;
BEGIN
  FOR v_col IN
    SELECT attname
      FROM pg_attribute
     WHERE attrelid = 'public.profiles'::regclass
       AND attnum > 0
       AND NOT attisdropped
  LOOP
    EXECUTE format(
      'REVOKE SELECT (%1$I), INSERT (%1$I), UPDATE (%1$I), REFERENCES (%1$I) '
      'ON public.profiles FROM PUBLIC, anon', v_col);
    EXECUTE format(
      'REVOKE INSERT (%1$I), UPDATE (%1$I), REFERENCES (%1$I) '
      'ON public.profiles FROM authenticated', v_col);
  END LOOP;
END $$;

-- Reads stay table-level; RLS (section 3) decides which rows.
GRANT SELECT ON public.profiles TO authenticated;

-- THE allowlist. Mirrors v_allowed in section 2 and lib/profile/editableColumns.ts.
GRANT UPDATE (phone, avatar_url, username, show_in_ranking)
  ON public.profiles TO authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. Guard trigger — defense in depth against a future over-broad GRANT
-- ────────────────────────────────────────────────────────────────────────────
-- SECURITY INVOKER on purpose: `current_user` must be the role that issued the
-- statement. Inside a SECURITY DEFINER function it is the function owner, so
-- privileged RPCs pass; through PostgREST it is anon / authenticated.
--
-- `updated_at` is excluded from the comparison because set_profiles_updated_at
-- (BEFORE UPDATE, fires first alphabetically) rewrites it on every update; the
-- column grant already stops a client from setting it.

CREATE OR REPLACE FUNCTION public.tg_profiles_guard_privileged_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_allowed CONSTANT TEXT[] :=
    ARRAY['phone', 'avatar_url', 'username', 'show_in_ranking', 'updated_at'];
  v_changed TEXT;
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Profiles are created only by handle_new_user() at signup.
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'profile_insert_not_allowed',
      HINT    = 'Profiles are created by the signup trigger.';
  END IF;

  SELECT string_agg(n.key, ', ' ORDER BY n.key)
    INTO v_changed
    FROM jsonb_each(to_jsonb(NEW) - v_allowed) AS n
   WHERE n.value IS DISTINCT FROM (to_jsonb(OLD) -> n.key);

  IF v_changed IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'profile_column_not_editable',
      DETAIL  = format('Columns not editable by this role: %s', v_changed),
      HINT    = 'XP, role and visibility change only through their dedicated RPCs.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_profiles_guard_privileged_columns() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_profiles_guard_privileged_columns ON public.profiles;
CREATE TRIGGER trg_profiles_guard_privileged_columns
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_profiles_guard_privileged_columns();


-- ────────────────────────────────────────────────────────────────────────────
-- 3. RLS — replace every policy with one SELECT + one UPDATE policy
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
-- NOT `FORCE ROW LEVEL SECURITY`: the SECURITY DEFINER writers above rely on
-- the table owner bypassing RLS.

DO $$
DECLARE
  v_pol         RECORD;
  v_norm        TEXT;
  v_part        TEXT;
  v_recognised  BOOLEAN;
  v_drop_unknown BOOLEAN :=
    COALESCE(current_setting('app.profiles_hardening_drop_unknown_policies', true), '') = 'on';
BEGIN
  FOR v_pol IN
    SELECT policyname, cmd, roles::text AS roles, permissive, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'profiles'
  LOOP
    IF v_pol.cmd = 'SELECT' THEN
      -- Normalise the deparsed forms — "(auth.uid() = id)",
      -- "(( SELECT auth.uid() AS uid) = id)", "public.is_admin()", casts — down
      -- to "auth.uid=id" / "is_admin". Every OR-branch must be one of those to
      -- count as a duplicate.
      v_norm := regexp_replace(lower(COALESCE(v_pol.qual, '')), '\s+as\s+[a-z_]+', '', 'g');
      v_norm := regexp_replace(v_norm, '\s|\(|\)|select|public\.|::[a-z_]+', '', 'g');
      v_recognised := v_norm <> '';
      FOREACH v_part IN ARRAY string_to_array(v_norm, 'or') LOOP
        IF v_part NOT IN ('auth.uid=id', 'id=auth.uid', 'is_admin') THEN
          v_recognised := FALSE;
        END IF;
      END LOOP;

      IF NOT v_recognised AND NOT v_drop_unknown THEN
        RAISE EXCEPTION
          'profiles hardening aborted: unrecognised read policy "%" (roles %, USING %). '
          'Review it; if it is not needed, run SET app.profiles_hardening_drop_unknown_policies = ''on''; '
          'and re-run this migration.',
          v_pol.policyname, v_pol.roles, v_pol.qual;
      END IF;
    END IF;

    RAISE NOTICE 'dropping profiles policy "%" (% %, roles %, USING %, WITH CHECK %)',
      v_pol.policyname, v_pol.permissive, v_pol.cmd, v_pol.roles, v_pol.qual, v_pol.with_check;
    EXECUTE format('DROP POLICY %I ON public.profiles', v_pol.policyname);
  END LOOP;
END $$;

-- One permissive SELECT policy (own row OR admin) instead of two, which also
-- clears Supabase's "multiple permissive policies" advisor warning. The
-- sub-SELECTs make Postgres evaluate auth.uid() / is_admin() once per
-- statement instead of once per row.
CREATE POLICY "Profiles: read own row, admins read all"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = id OR (SELECT public.is_admin()));

-- Row scope only; WHICH columns is decided by the grants + guard trigger.
CREATE POLICY "Profiles: users update own row"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

-- Intentionally NO INSERT and NO DELETE policy.


-- ============================================================================
-- VERIFICATION QUERIES — run after the migration
-- ============================================================================
-- 1. Effective column privileges of the API roles (expect: authenticated
--    can_select on every column, can_update ONLY on avatar_url / phone /
--    show_in_ranking / username, and anon nothing at all):
--    SELECT a.attname,
--           has_column_privilege('authenticated', 'public.profiles', a.attname, 'SELECT') AS auth_select,
--           has_column_privilege('authenticated', 'public.profiles', a.attname, 'UPDATE') AS auth_update,
--           has_column_privilege('authenticated', 'public.profiles', a.attname, 'INSERT') AS auth_insert,
--           has_column_privilege('anon',          'public.profiles', a.attname, 'SELECT') AS anon_select,
--           has_column_privilege('anon',          'public.profiles', a.attname, 'UPDATE') AS anon_update
--      FROM pg_attribute a
--     WHERE a.attrelid = 'public.profiles'::regclass AND a.attnum > 0 AND NOT a.attisdropped
--     ORDER BY a.attnum;
--
-- 2. Table privileges (expect only authenticated SELECT):
--    SELECT grantee, privilege_type
--      FROM information_schema.role_table_grants
--     WHERE table_schema = 'public' AND table_name = 'profiles'
--       AND grantee IN ('anon', 'authenticated', 'PUBLIC');
--
-- 3. Policies (expect exactly the two above):
--    SELECT policyname, cmd, roles, qual, with_check
--      FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles';
--
-- 4. Guard trigger present:
--    SELECT tgname FROM pg_trigger
--     WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal;
--
-- 5. Every function that writes profiles is SECURITY DEFINER (expect all true):
--    SELECT p.proname, p.prosecdef, pg_get_userbyid(p.proowner) AS owner
--      FROM pg_proc p
--     WHERE p.pronamespace = 'public'::regnamespace
--       AND pg_get_functiondef(p.oid) ~* '(update|insert\s+into)\s+(public\.)?profiles\M'
--     ORDER BY 1;
--
-- 6. Run supabase/tests/20261023000100_profiles_privilege_hardening_test.sql.
-- ============================================================================


-- ============================================================================
-- ROLLBACK (emergency only — RE-OPENS the vulnerability). Restores the old
-- behaviour; the dropped policies are listed in the NOTICE output of the run.
-- ============================================================================
--   DROP TRIGGER IF EXISTS trg_profiles_guard_privileged_columns ON public.profiles;
--   DROP FUNCTION IF EXISTS public.tg_profiles_guard_privileged_columns();
--   DROP POLICY IF EXISTS "Profiles: read own row, admins read all" ON public.profiles;
--   DROP POLICY IF EXISTS "Profiles: users update own row" ON public.profiles;
--   CREATE POLICY "Users can view own profile"   ON public.profiles FOR SELECT USING (auth.uid() = id);
--   CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT USING (public.is_admin());
--   CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE
--     USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
--   GRANT SELECT, UPDATE ON public.profiles TO authenticated;
-- A safer partial rollback (keeps the fix, unblocks one column) is simply:
--   GRANT UPDATE (<column>) ON public.profiles TO authenticated;
--   + add it to v_allowed in tg_profiles_guard_privileged_columns.
-- ============================================================================
