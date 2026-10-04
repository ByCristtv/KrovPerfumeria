-- ============================================================
-- 20261003000100  avatars bucket — profile photo uploads
-- ============================================================
--
-- WHAT
--   Makes the `avatars` bucket usable for the /profile photo upload
--   (app/api/profile/avatar/route.ts) and replaces its storage policies.
--
-- LAYOUT
--   Every object is  profile-photos/<user_id>/<uuid>.webp
--   A user's RLS reach is exactly their own folder, `profile-photos/<their uid>/`.
--
-- WHY THE EXISTING SETUP DID NOT FIT
--   · The bucket was PRIVATE. Avatars are shown to OTHER users (friends list,
--     search results, friend profile), so they need a stable public URL; a
--     signed URL would expire inside someone else's cached page.
--   · The old policies required the FIRST folder to be the user's id
--     (`<uid>/file`), but the app nests them under `profile-photos/`, so every
--     upload would have been refused by RLS.
--
-- WHAT IT ENFORCES (defense in depth — the route handler already validates
-- and re-encodes; these hold even if someone calls Storage directly)
--   · Only `image/webp`, at most 500 KB, per object (bucket-level limits).
--   · A user can INSERT / UPDATE / DELETE (and SELECT, to list their folder for
--     cleanup) only objects whose path is exactly
--     `profile-photos/<their own uid>/<file>` — one level deep, no nesting, and
--     never another user's folder or the bucket root.
--   · Reads of a public bucket's objects by URL need no policy.
--
-- RE-RUNNING: if an earlier revision of this file (flat names
-- `profile-photos/<uid>_<uuid>.webp`) was already applied, just run this one
-- again — it drops those policies by name and recreates them. Objects uploaded
-- under the flat layout are not moved; they were never referenced by a profile
-- in production, and any leftovers can be deleted from the Storage UI.
--
-- Idempotent: safe to re-run.
-- Apply by pasting into Supabase Studio → SQL Editor. This app currently runs
-- against the TESTING project; apply to production before deploying.
-- ============================================================

BEGIN;

-- ── Bucket ──────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', TRUE, 512000, ARRAY['image/webp'])
ON CONFLICT (id) DO UPDATE
SET public             = TRUE,
    file_size_limit    = 512000,
    allowed_mime_types = ARRAY['image/webp'];

-- ── Policies ────────────────────────────────────────────────
-- Retire the folder-per-user policies from schema.sql…
DROP POLICY IF EXISTS "Users upload own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users read own avatar"   ON storage.objects;
DROP POLICY IF EXISTS "Users update own avatar" ON storage.objects;

-- …and (re)create the ones that match `profile-photos/<uid>/<file>`.
--
-- storage.foldername('profile-photos/<uid>/<file>.webp') = {profile-photos, <uid>}
-- so [1] is the shared folder, [2] must be the caller's id, and the array length
-- of 2 rules out deeper nesting.

DROP POLICY IF EXISTS "Users upload own profile photo" ON storage.objects;
CREATE POLICY "Users upload own profile photo"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND array_length(storage.foldername(name), 1) = 2
    AND (storage.foldername(name))[1] = 'profile-photos'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users read own profile photo" ON storage.objects;
CREATE POLICY "Users read own profile photo"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND array_length(storage.foldername(name), 1) = 2
    AND (storage.foldername(name))[1] = 'profile-photos'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- USING gates which existing rows can be touched; WITH CHECK stops an update
-- from moving an object INTO someone else's folder.
DROP POLICY IF EXISTS "Users update own profile photo" ON storage.objects;
CREATE POLICY "Users update own profile photo"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND array_length(storage.foldername(name), 1) = 2
    AND (storage.foldername(name))[1] = 'profile-photos'
    AND (storage.foldername(name))[2] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND array_length(storage.foldername(name), 1) = 2
    AND (storage.foldername(name))[1] = 'profile-photos'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users delete own profile photo" ON storage.objects;
CREATE POLICY "Users delete own profile photo"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND array_length(storage.foldername(name), 1) = 2
    AND (storage.foldername(name))[1] = 'profile-photos'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

COMMIT;


-- ============================================================
-- Verification — run these after the migration
-- ============================================================

-- 1. Bucket is public, capped at 500 KB, webp only.
--    Expect: public = true, file_size_limit = 512000, allowed_mime_types = {image/webp}
SELECT id, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id = 'avatars';

-- 2. Exactly four profile-photo policies, one per command.
--    Expect: 4 rows — DELETE / INSERT / SELECT / UPDATE, all role {authenticated}
SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename  = 'objects'
  AND policyname LIKE '%own profile photo'
ORDER BY cmd;

-- 3. No old avatar policies left (folder-per-user ones, or any from the flat layout).
--    Expect: 0
SELECT count(*) AS old_policies_left
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename  = 'objects'
  AND policyname IN ('Users upload own avatar', 'Users read own avatar', 'Users update own avatar');

-- 4. Predicates mention the profile-photos folder and the caller's uid.
SELECT policyname, with_check, qual
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename  = 'objects'
  AND policyname LIKE '%own profile photo'
ORDER BY policyname;

-- 5. Behavioural check of the path predicate itself (no auth needed):
--    Expect: {profile-photos,<uid>} → 2 elements; a nested path → 3; a root file → empty.
SELECT storage.foldername('profile-photos/abc/file.webp')   AS own_shape,
       storage.foldername('profile-photos/abc/x/file.webp') AS nested,
       storage.foldername('file.webp')                       AS root_file;
