-- ============================================================
-- 20261003000200  avatar upload rate limit
-- ============================================================
--
-- WHAT
--   public.claim_avatar_upload_slot() — called by /api/profile/avatar BEFORE it
--   parses or decodes anything. Allows 5 uploads per user per rolling 10 minutes.
--
-- WHY IN THE DATABASE
--   The app runs on Vercel: each request can hit a different serverless instance
--   and instances are recycled constantly, so an in-memory counter would limit
--   nothing. A table is the one place all instances agree.
--
-- DESIGN
--   · SECURITY DEFINER, derives the user from auth.uid(); there is no user id
--     parameter to forge, and the LIMIT and WINDOW are constants INSIDE the
--     function — the caller is the user's own session, so a parameter would be
--     a limit the user could raise.
--   · Atomic: a per-user advisory lock serialises concurrent claims, so ten
--     parallel requests can't all read "4 so far" and all be let through.
--   · Rolling window: a refused claim records nothing, so the oldest attempt
--     ages out and the user is let back in on schedule. `retry_after_seconds`
--     says exactly when.
--   · The attempts table has RLS enabled and NO policies and no grants: it is
--     reachable only through this function. Rows older than a day are pruned on
--     each claim, so the table stays tiny without a cron job.
--
-- Idempotent: safe to re-run.
-- Apply by pasting into Supabase Studio → SQL Editor (TESTING first, then production).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.avatar_upload_attempts (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS avatar_upload_attempts_user_created_idx
  ON public.avatar_upload_attempts (user_id, created_at DESC);

ALTER TABLE public.avatar_upload_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.avatar_upload_attempts FROM PUBLIC, anon, authenticated;


CREATE OR REPLACE FUNCTION public.claim_avatar_upload_slot()
RETURNS TABLE (allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_limit  CONSTANT integer  := 5;
  c_window CONSTANT interval := interval '10 minutes';
  v_uid    uuid := auth.uid();
  v_count  integer;
  v_oldest timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '28000';
  END IF;

  -- Serialise this user's claims for the rest of the transaction.
  PERFORM pg_advisory_xact_lock(hashtextextended('avatar_upload:' || v_uid::text, 0));

  -- Housekeeping: nothing older than the window matters, a day is generous.
  DELETE FROM public.avatar_upload_attempts a
  WHERE a.user_id = v_uid
    AND a.created_at < now() - interval '1 day';

  SELECT count(*), min(a.created_at)
    INTO v_count, v_oldest
  FROM public.avatar_upload_attempts a
  WHERE a.user_id = v_uid
    AND a.created_at > now() - c_window;

  IF v_count >= c_limit THEN
    RETURN QUERY
    SELECT false,
           GREATEST(1, ceil(extract(epoch FROM (v_oldest + c_window - now())))::integer);
    RETURN;
  END IF;

  INSERT INTO public.avatar_upload_attempts (user_id) VALUES (v_uid);

  RETURN QUERY SELECT true, 0;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_avatar_upload_slot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_avatar_upload_slot() TO authenticated;

COMMIT;


-- ============================================================
-- Verification — run these after the migration
-- ============================================================

-- 1. The function exists, is SECURITY DEFINER, and only `authenticated` may run it.
--    Expect: prosecdef = true; has_function_privilege: anon = false, authenticated = true
SELECT p.prosecdef,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_can_run,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed_can_run
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'claim_avatar_upload_slot';

-- 2. The attempts table is locked down.
--    Expect: rowsecurity = true; and the next query returns 0 rows (no policies)
SELECT relrowsecurity AS rowsecurity
FROM pg_class
WHERE oid = 'public.avatar_upload_attempts'::regclass;

SELECT count(*) AS policies
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'avatar_upload_attempts';

-- 3. Neither client role can touch the table directly.
--    Expect: both false
SELECT has_table_privilege('anon',          'public.avatar_upload_attempts', 'SELECT,INSERT') AS anon_access,
       has_table_privilege('authenticated', 'public.avatar_upload_attempts', 'SELECT,INSERT') AS authed_access;

-- 4. Calling it without a session is refused.
--    (Studio runs as `postgres`, where auth.uid() is NULL.)
--    Expect: ERROR  authentication_required
SELECT * FROM public.claim_avatar_upload_slot();
