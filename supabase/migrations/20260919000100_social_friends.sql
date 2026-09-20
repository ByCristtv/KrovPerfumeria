BEGIN;

SET LOCAL search_path = public, extensions;

-- ============================================================
-- KROV PERFUMERY
-- Social network / Friends system
-- ============================================================


-- ============================================================
-- 1. EXTENSION FOR USERNAME SEARCH
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- ============================================================
-- 2. SOCIAL PROFILE PRIVACY
-- ============================================================
--
-- show_in_ranking and is_profile_public are intentionally
-- separated.
--
-- For the initial migration we copy the current ranking
-- visibility so existing public users do not suddenly become
-- private.
-- ============================================================

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_profile_public boolean;

UPDATE public.profiles
SET is_profile_public = show_in_ranking
WHERE is_profile_public IS NULL;

ALTER TABLE public.profiles
ALTER COLUMN is_profile_public SET DEFAULT false;

ALTER TABLE public.profiles
ALTER COLUMN is_profile_public SET NOT NULL;


-- ============================================================
-- 3. USERNAME INTEGRITY + SEARCH INDEXES
-- ============================================================

-- Fail clearly if there are usernames duplicated only by casing
-- before creating the case-insensitive unique index.
DO $$
BEGIN
    IF EXISTS (
        SELECT lower(username)
        FROM public.profiles
        WHERE username IS NOT NULL
        GROUP BY lower(username)
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Cannot create case-insensitive username unique index: duplicated usernames exist.';
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_unique_idx
ON public.profiles (lower(username))
WHERE username IS NOT NULL;


CREATE INDEX IF NOT EXISTS profiles_public_username_search_idx
ON public.profiles
USING gin (lower(username) gin_trgm_ops)
WHERE is_profile_public = true
  AND username IS NOT NULL;


CREATE INDEX IF NOT EXISTS profiles_is_profile_public_idx
ON public.profiles (is_profile_public)
WHERE is_profile_public = true;


-- ============================================================
-- 4. FRIEND REQUESTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.friend_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    sender_id uuid NOT NULL
        REFERENCES public.profiles(id)
        ON DELETE CASCADE,

    receiver_id uuid NOT NULL
        REFERENCES public.profiles(id)
        ON DELETE CASCADE,

    status text NOT NULL DEFAULT 'pending',

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    responded_at timestamptz,

    CONSTRAINT friend_requests_users_different_chk
        CHECK (sender_id <> receiver_id),

    CONSTRAINT friend_requests_status_chk
        CHECK (
            status IN (
                'pending',
                'accepted',
                'rejected',
                'cancelled'
            )
        )
);


-- Prevents:
--
-- A -> B pending
-- B -> A pending
--
-- at the same time.
CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_unique_pending_pair_idx
ON public.friend_requests (
    LEAST(sender_id, receiver_id),
    GREATEST(sender_id, receiver_id)
)
WHERE status = 'pending';


CREATE INDEX IF NOT EXISTS friend_requests_receiver_status_idx
ON public.friend_requests (receiver_id, status, created_at DESC);


CREATE INDEX IF NOT EXISTS friend_requests_sender_status_idx
ON public.friend_requests (sender_id, status, created_at DESC);


-- ============================================================
-- 5. FRIENDSHIPS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.friendships (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id_1 uuid NOT NULL
        REFERENCES public.profiles(id)
        ON DELETE CASCADE,

    user_id_2 uuid NOT NULL
        REFERENCES public.profiles(id)
        ON DELETE CASCADE,

    friend_request_id uuid
        REFERENCES public.friend_requests(id)
        ON DELETE SET NULL,

    created_at timestamptz NOT NULL DEFAULT now(),

    -- Every friendship must always be stored in canonical order.
    CONSTRAINT friendships_pair_order_chk
        CHECK (user_id_1 < user_id_2),

    CONSTRAINT friendships_unique_pair
        UNIQUE (user_id_1, user_id_2)
);


CREATE UNIQUE INDEX IF NOT EXISTS friendships_friend_request_unique_idx
ON public.friendships (friend_request_id)
WHERE friend_request_id IS NOT NULL;


CREATE INDEX IF NOT EXISTS friendships_user_1_idx
ON public.friendships (user_id_1);


CREATE INDEX IF NOT EXISTS friendships_user_2_idx
ON public.friendships (user_id_2);


-- ============================================================
-- 6. UPDATED_AT TRIGGER FOR REQUESTS
-- ============================================================

CREATE OR REPLACE FUNCTION public.social_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS friend_requests_touch_updated_at
ON public.friend_requests;

CREATE TRIGGER friend_requests_touch_updated_at
BEFORE UPDATE ON public.friend_requests
FOR EACH ROW
EXECUTE FUNCTION public.social_touch_updated_at();


-- ============================================================
-- 7. INTERNAL HELPER: ARE USERS FRIENDS?
-- ============================================================
--
-- SECURITY DEFINER is intentional because this helper is used
-- by protected RPCs and should not depend on caller RLS.
-- ============================================================

CREATE OR REPLACE FUNCTION public.social_are_friends(
    p_user_a uuid,
    p_user_b uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.friendships f
        WHERE
            f.user_id_1 = LEAST(p_user_a, p_user_b)
            AND
            f.user_id_2 = GREATEST(p_user_a, p_user_b)
    );
$$;


REVOKE ALL
ON FUNCTION public.social_are_friends(uuid, uuid)
FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 8. SET SOCIAL PROFILE VISIBILITY
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_social_profile_visibility(
    p_is_public boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
    v_username text;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'authentication_required';
    END IF;

    SELECT username
    INTO v_username
    FROM public.profiles
    WHERE id = v_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'profile_not_found';
    END IF;

    IF p_is_public = true AND v_username IS NULL THEN
        RAISE EXCEPTION 'username_required_for_public_profile';
    END IF;

    UPDATE public.profiles
    SET
        is_profile_public = p_is_public,
        updated_at = now()
    WHERE id = v_user_id;
END;
$$;


-- ============================================================
-- 9. SEND FRIEND REQUEST
-- ============================================================

CREATE OR REPLACE FUNCTION public.send_friend_request(
    p_target_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
    v_existing_request public.friend_requests%ROWTYPE;
    v_request_id uuid;
    v_target_public boolean;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'authentication_required';
    END IF;

    IF p_target_user_id IS NULL THEN
        RAISE EXCEPTION 'target_user_required';
    END IF;

    IF v_user_id = p_target_user_id THEN
        RAISE EXCEPTION 'cannot_add_yourself';
    END IF;


    -- Target must exist and currently be discoverable.
    SELECT is_profile_public
    INTO v_target_public
    FROM public.profiles
    WHERE id = p_target_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'user_not_found';
    END IF;

    IF v_target_public IS NOT TRUE THEN
        RAISE EXCEPTION 'user_profile_is_private';
    END IF;


    -- Already friends.
    IF public.social_are_friends(
        v_user_id,
        p_target_user_id
    ) THEN
        RAISE EXCEPTION 'users_are_already_friends';
    END IF;


    -- Check existing pending request in either direction.
    SELECT fr.*
    INTO v_existing_request
    FROM public.friend_requests fr
    WHERE fr.status = 'pending'
      AND LEAST(fr.sender_id, fr.receiver_id)
          = LEAST(v_user_id, p_target_user_id)
      AND GREATEST(fr.sender_id, fr.receiver_id)
          = GREATEST(v_user_id, p_target_user_id)
    LIMIT 1;


    IF FOUND THEN

        -- Same request already sent: idempotent response.
        IF v_existing_request.sender_id = v_user_id THEN
            RETURN v_existing_request.id;
        END IF;

        -- The other person already sent us a request.
        RAISE EXCEPTION 'incoming_friend_request_exists';
    END IF;


    INSERT INTO public.friend_requests (
        sender_id,
        receiver_id
    )
    VALUES (
        v_user_id,
        p_target_user_id
    )
    RETURNING id INTO v_request_id;

    RETURN v_request_id;
END;
$$;


-- ============================================================
-- 10. CANCEL SENT REQUEST
-- ============================================================

CREATE OR REPLACE FUNCTION public.cancel_friend_request(
    p_request_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
    v_updated_id uuid;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'authentication_required';
    END IF;

    UPDATE public.friend_requests
    SET
        status = 'cancelled',
        responded_at = now()
    WHERE id = p_request_id
      AND sender_id = v_user_id
      AND status = 'pending'
    RETURNING id INTO v_updated_id;

    IF v_updated_id IS NULL THEN
        RAISE EXCEPTION 'pending_sent_request_not_found';
    END IF;
END;
$$;


-- ============================================================
-- 11. REJECT RECEIVED REQUEST
-- ============================================================

CREATE OR REPLACE FUNCTION public.reject_friend_request(
    p_request_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
    v_updated_id uuid;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'authentication_required';
    END IF;

    UPDATE public.friend_requests
    SET
        status = 'rejected',
        responded_at = now()
    WHERE id = p_request_id
      AND receiver_id = v_user_id
      AND status = 'pending'
    RETURNING id INTO v_updated_id;

    IF v_updated_id IS NULL THEN
        RAISE EXCEPTION 'pending_received_request_not_found';
    END IF;
END;
$$;


-- ============================================================
-- 12. ACCEPT FRIEND REQUEST
-- ============================================================

CREATE OR REPLACE FUNCTION public.accept_friend_request(
    p_request_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
    v_request public.friend_requests%ROWTYPE;

    v_user_1 uuid;
    v_user_2 uuid;

    v_friendship_id uuid;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'authentication_required';
    END IF;


    -- Row lock prevents concurrent acceptance/cancellation.
    SELECT *
    INTO v_request
    FROM public.friend_requests
    WHERE id = p_request_id
    FOR UPDATE;


    IF NOT FOUND THEN
        RAISE EXCEPTION 'friend_request_not_found';
    END IF;


    IF v_request.receiver_id <> v_user_id THEN
        RAISE EXCEPTION 'not_request_receiver';
    END IF;


    IF v_request.status <> 'pending' THEN
        RAISE EXCEPTION 'friend_request_is_not_pending';
    END IF;


    v_user_1 := LEAST(
        v_request.sender_id,
        v_request.receiver_id
    );

    v_user_2 := GREATEST(
        v_request.sender_id,
        v_request.receiver_id
    );


    INSERT INTO public.friendships (
        user_id_1,
        user_id_2,
        friend_request_id
    )
    VALUES (
        v_user_1,
        v_user_2,
        v_request.id
    )
    ON CONFLICT (user_id_1, user_id_2)
    DO UPDATE SET
        friend_request_id =
            COALESCE(
                public.friendships.friend_request_id,
                EXCLUDED.friend_request_id
            )
    RETURNING id INTO v_friendship_id;


    UPDATE public.friend_requests
    SET
        status = 'accepted',
        responded_at = now()
    WHERE id = v_request.id;


    RETURN v_friendship_id;
END;
$$;


-- ============================================================
-- 13. REMOVE FRIEND
-- ============================================================

CREATE OR REPLACE FUNCTION public.remove_friend(
    p_friend_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
    v_deleted_id uuid;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'authentication_required';
    END IF;

    IF p_friend_user_id IS NULL
       OR p_friend_user_id = v_user_id THEN
        RAISE EXCEPTION 'invalid_friend_user';
    END IF;


    DELETE FROM public.friendships
    WHERE user_id_1 = LEAST(v_user_id, p_friend_user_id)
      AND user_id_2 = GREATEST(v_user_id, p_friend_user_id)
    RETURNING id INTO v_deleted_id;


    RETURN v_deleted_id IS NOT NULL;
END;
$$;


-- ============================================================
-- 14. SEARCH PUBLIC USERS
-- ============================================================
--
-- Important:
-- Does NOT expose:
--   - full_name
--   - phone
--   - email
--   - address
--   - order data
--
-- relationship_status:
--   none
--   outgoing_pending
--   incoming_pending
--   friends
-- ============================================================

CREATE OR REPLACE FUNCTION public.search_public_users(
    p_query text,
    p_limit integer DEFAULT 20,
    p_offset integer DEFAULT 0
)
RETURNS TABLE (
    user_id uuid,
    username text,
    avatar_url text,
    relationship_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_user_id uuid;
    v_query text;
    v_limit integer;
    v_offset integer;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'authentication_required';
    END IF;

    v_query := trim(COALESCE(p_query, ''));

    -- Avoid huge / meaningless searches.
    IF char_length(v_query) < 2 THEN
        RETURN;
    END IF;

    v_limit := LEAST(
        GREATEST(COALESCE(p_limit, 20), 1),
        50
    );

    v_offset := GREATEST(
        COALESCE(p_offset, 0),
        0
    );


    RETURN QUERY
    SELECT
        p.id AS user_id,
        p.username,
        p.avatar_url,

        CASE

            WHEN EXISTS (
                SELECT 1
                FROM public.friendships f
                WHERE
                    f.user_id_1 = LEAST(v_user_id, p.id)
                    AND
                    f.user_id_2 = GREATEST(v_user_id, p.id)
            )
            THEN 'friends'::text


            WHEN EXISTS (
                SELECT 1
                FROM public.friend_requests fr
                WHERE fr.sender_id = v_user_id
                  AND fr.receiver_id = p.id
                  AND fr.status = 'pending'
            )
            THEN 'outgoing_pending'::text


            WHEN EXISTS (
                SELECT 1
                FROM public.friend_requests fr
                WHERE fr.sender_id = p.id
                  AND fr.receiver_id = v_user_id
                  AND fr.status = 'pending'
            )
            THEN 'incoming_pending'::text


            ELSE 'none'::text

        END AS relationship_status

    FROM public.profiles p

    WHERE p.id <> v_user_id
      AND p.is_profile_public = true
      AND p.username IS NOT NULL
      AND lower(p.username)
            LIKE '%' || lower(v_query) || '%'

    ORDER BY
        CASE
            WHEN lower(p.username) = lower(v_query)
                THEN 0

            WHEN lower(p.username)
                LIKE lower(v_query) || '%'
                THEN 1

            ELSE 2
        END,

        similarity(
            lower(p.username),
            lower(v_query)
        ) DESC,

        lower(p.username)

    LIMIT v_limit
    OFFSET v_offset;
END;
$$;


-- ============================================================
-- 15. RECEIVED FRIEND REQUESTS
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_received_friend_requests()
RETURNS TABLE (
    request_id uuid,
    user_id uuid,
    username text,
    avatar_url text,
    experience_points integer,
    requested_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'authentication_required';
    END IF;


    RETURN QUERY
    SELECT
        fr.id,
        p.id,
        p.username,
        p.avatar_url,
        p.experience_points,
        fr.created_at

    FROM public.friend_requests fr

    JOIN public.profiles p
        ON p.id = fr.sender_id

    WHERE fr.receiver_id = v_user_id
      AND fr.status = 'pending'

    ORDER BY fr.created_at DESC;
END;
$$;


-- ============================================================
-- 16. SENT FRIEND REQUESTS
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_sent_friend_requests()
RETURNS TABLE (
    request_id uuid,
    user_id uuid,
    username text,
    avatar_url text,
    requested_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'authentication_required';
    END IF;


    RETURN QUERY
    SELECT
        fr.id,
        p.id,
        p.username,
        p.avatar_url,
        fr.created_at

    FROM public.friend_requests fr

    JOIN public.profiles p
        ON p.id = fr.receiver_id

    WHERE fr.sender_id = v_user_id
      AND fr.status = 'pending'

    ORDER BY fr.created_at DESC;
END;
$$;


-- ============================================================
-- 17. FRIEND LIST
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_friends()
RETURNS TABLE (
    friendship_id uuid,
    friend_user_id uuid,
    username text,
    full_name text,
    avatar_url text,
    experience_points integer,
    friends_since timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'authentication_required';
    END IF;


    RETURN QUERY
    SELECT
        f.id,

        CASE
            WHEN f.user_id_1 = v_user_id
                THEN f.user_id_2
            ELSE f.user_id_1
        END AS friend_user_id,

        p.username,
        p.full_name,
        p.avatar_url,
        p.experience_points,
        f.created_at

    FROM public.friendships f

    JOIN public.profiles p
        ON p.id = CASE
            WHEN f.user_id_1 = v_user_id
                THEN f.user_id_2
            ELSE f.user_id_1
        END

    WHERE
        f.user_id_1 = v_user_id
        OR
        f.user_id_2 = v_user_id

    ORDER BY lower(p.username) NULLS LAST;
END;
$$;


-- ============================================================
-- 18. FRIEND SOCIAL PROFILE
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_friend_profile(
    p_friend_user_id uuid
)
RETURNS TABLE (
    user_id uuid,
    username text,
    full_name text,
    avatar_url text,
    experience_points integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'authentication_required';
    END IF;


    IF NOT public.social_are_friends(
        v_user_id,
        p_friend_user_id
    ) THEN
        RAISE EXCEPTION 'users_are_not_friends';
    END IF;


    RETURN QUERY
    SELECT
        p.id,
        p.username,
        p.full_name,
        p.avatar_url,
        p.experience_points

    FROM public.profiles p

    WHERE p.id = p_friend_user_id;
END;
$$;


-- ============================================================
-- 19. UNIQUE PRODUCTS PURCHASED BY FRIEND
-- ============================================================
--
-- Does NOT return:
--   order_id
--   quantity
--   unit price
--   totals
--   shipping data
--   payment info
--   exact purchase date
--
-- It only returns unique products/fragrances.
--
-- Current visibility rule:
--     order_status = 'received'
--
-- Change that WHERE condition later if your business rules change.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_friend_purchased_products(
    p_friend_user_id uuid
)
RETURNS TABLE (
    product_id uuid,
    product_name text,
    product_slug text,
    brand_name text,
    image_url text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
BEGIN
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'authentication_required';
    END IF;


    IF NOT public.social_are_friends(
        v_user_id,
        p_friend_user_id
    ) THEN
        RAISE EXCEPTION 'users_are_not_friends';
    END IF;


    RETURN QUERY
    SELECT DISTINCT
        p.id AS product_id,
        p.name AS product_name,
        p.slug AS product_slug,
        b.name AS brand_name,
        img.url AS image_url

    FROM public.orders o

    JOIN public.order_items oi
        ON oi.order_id = o.id

    JOIN public.product_variants pv
        ON pv.id = oi.variant_id

    JOIN public.products p
        ON p.id = pv.product_id

    JOIN public.brands b
        ON b.id = p.brand_id


    LEFT JOIN LATERAL (
        SELECT pi.url

        FROM public.product_images pi

        WHERE pi.product_id = p.id

        ORDER BY
            CASE
                WHEN pi.variant_id = p.featured_variant_id
                    THEN 0

                WHEN pi.variant_id IS NULL
                    THEN 1

                ELSE 2
            END,

            pi.position ASC,
            pi.created_at ASC

        LIMIT 1
    ) img
        ON true


    WHERE o.user_id = p_friend_user_id

      -- Conservative purchase visibility rule.
      AND o.order_status::text = 'received'


    ORDER BY product_name;
END;
$$;


-- ============================================================
-- 20. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.friend_requests
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.friendships
ENABLE ROW LEVEL SECURITY;


-- Users may READ only friend requests in which they participate.
DROP POLICY IF EXISTS
    "friend_requests_select_participant"
ON public.friend_requests;

CREATE POLICY
    "friend_requests_select_participant"
ON public.friend_requests
FOR SELECT
TO authenticated
USING (
    sender_id = auth.uid()
    OR
    receiver_id = auth.uid()
);


-- Users may READ only friendships in which they participate.
DROP POLICY IF EXISTS
    "friendships_select_participant"
ON public.friendships;

CREATE POLICY
    "friendships_select_participant"
ON public.friendships
FOR SELECT
TO authenticated
USING (
    user_id_1 = auth.uid()
    OR
    user_id_2 = auth.uid()
);


-- ============================================================
-- 21. TABLE PRIVILEGES
-- ============================================================
--
-- Authenticated users can read their rows through RLS.
-- They CANNOT directly mutate social tables.
-- Mutations must go through the RPC functions.
-- ============================================================

REVOKE ALL
ON public.friend_requests
FROM anon;

REVOKE ALL
ON public.friendships
FROM anon;


REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON public.friend_requests
FROM authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON public.friendships
FROM authenticated;


GRANT SELECT
ON public.friend_requests
TO authenticated;

GRANT SELECT
ON public.friendships
TO authenticated;


-- ============================================================
-- 22. RPC FUNCTION PRIVILEGES
-- ============================================================

REVOKE ALL
ON FUNCTION public.set_social_profile_visibility(boolean)
FROM PUBLIC, anon;

REVOKE ALL
ON FUNCTION public.send_friend_request(uuid)
FROM PUBLIC, anon;

REVOKE ALL
ON FUNCTION public.cancel_friend_request(uuid)
FROM PUBLIC, anon;

REVOKE ALL
ON FUNCTION public.reject_friend_request(uuid)
FROM PUBLIC, anon;

REVOKE ALL
ON FUNCTION public.accept_friend_request(uuid)
FROM PUBLIC, anon;

REVOKE ALL
ON FUNCTION public.remove_friend(uuid)
FROM PUBLIC, anon;

REVOKE ALL
ON FUNCTION public.search_public_users(text, integer, integer)
FROM PUBLIC, anon;

REVOKE ALL
ON FUNCTION public.get_received_friend_requests()
FROM PUBLIC, anon;

REVOKE ALL
ON FUNCTION public.get_sent_friend_requests()
FROM PUBLIC, anon;

REVOKE ALL
ON FUNCTION public.get_friends()
FROM PUBLIC, anon;

REVOKE ALL
ON FUNCTION public.get_friend_profile(uuid)
FROM PUBLIC, anon;

REVOKE ALL
ON FUNCTION public.get_friend_purchased_products(uuid)
FROM PUBLIC, anon;


GRANT EXECUTE
ON FUNCTION public.set_social_profile_visibility(boolean)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.send_friend_request(uuid)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.cancel_friend_request(uuid)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.reject_friend_request(uuid)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.accept_friend_request(uuid)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.remove_friend(uuid)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.search_public_users(text, integer, integer)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.get_received_friend_requests()
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.get_sent_friend_requests()
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.get_friends()
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.get_friend_profile(uuid)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.get_friend_purchased_products(uuid)
TO authenticated;


COMMIT;