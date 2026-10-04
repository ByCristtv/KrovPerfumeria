-- ============================================================
-- 20261003000300  get_friends — "last purchased" social proof
-- ============================================================
--
-- WHAT
--   Adds two columns to public.get_friends():
--       last_purchased_product  text   -- e.g. 'Eros'
--       last_purchased_brand    text   -- e.g. 'Versace'
--   so each card in the "Tu círculo" grid can say what a friend bought most
--   recently, without a per-friend request (which would be an N+1).
--
-- WHY THIS EXPOSES NOTHING NEW
--   The caller is already allowed to see every fragrance a friend has
--   completed a purchase of: get_friend_purchased_products (migration
--   20260920000100) returns that whole list to any current friend. This returns
--   ONE of those same products, under the SAME completion rule
--   (order_status IN ('received','shipped')) and the SAME friendship gate (the
--   rows come from the caller's own friendships only).
--
--   Still NOT exposed: order ids, quantities, sizes, prices, totals, shipping
--   or payment data, and — deliberately — no timestamp. "Most recent" is how
--   the product is CHOSEN, never something the caller can read back.
--
-- WHY DROP + CREATE
--   Postgres cannot change a function's RETURNS TABLE with CREATE OR REPLACE.
--   The signature (no arguments), body semantics, ordering and privileges are
--   otherwise identical to 20260919000100; the app tolerates the old shape, so
--   running the app BEFORE this migration just hides the line on each card.
--
-- Idempotent: safe to re-run.
-- Apply by pasting into Supabase Studio → SQL Editor (TESTING first, then production).
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS public.get_friends();

CREATE FUNCTION public.get_friends()
RETURNS TABLE (
    friendship_id uuid,
    friend_user_id uuid,
    username text,
    full_name text,
    avatar_url text,
    experience_points integer,
    friends_since timestamptz,
    last_purchased_product text,
    last_purchased_brand text
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
        f.created_at,
        lp.product_name,
        lp.brand_name

    FROM public.friendships f

    JOIN public.profiles p
        ON p.id = CASE
            WHEN f.user_id_1 = v_user_id
                THEN f.user_id_2
            ELSE f.user_id_1
        END

    -- The product from the friend's most recent COMPLETED order. A completed
    -- purchase is one that reached `received` (shipped is the state after it) —
    -- the same rule get_friend_purchased_products uses.
    LEFT JOIN LATERAL (
        SELECT
            pr.name AS product_name,
            b.name  AS brand_name

        FROM public.orders o

        JOIN public.order_items oi
            ON oi.order_id = o.id

        JOIN public.product_variants pv
            ON pv.id = oi.variant_id

        JOIN public.products pr
            ON pr.id = pv.product_id

        JOIN public.brands b
            ON b.id = pr.brand_id

        WHERE o.user_id = p.id
          AND o.order_status::text IN ('received', 'shipped')

        ORDER BY o.created_at DESC, oi.id

        LIMIT 1
    ) lp
        ON true

    WHERE
        f.user_id_1 = v_user_id
        OR
        f.user_id_2 = v_user_id

    ORDER BY lower(p.username) NULLS LAST;
END;
$$;

REVOKE ALL
ON FUNCTION public.get_friends()
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.get_friends()
TO authenticated;

COMMIT;


-- ============================================================
-- Verification — run these after the migration
-- ============================================================

-- 1. The function has the two new columns.
--    Expect: ... last_purchased_product text, last_purchased_brand text
SELECT pg_get_function_result('public.get_friends()'::regprocedure);

-- 2. Privileges: authenticated only.
--    Expect: anon_can_run = false, authed_can_run = true
SELECT has_function_privilege('anon',          'public.get_friends()', 'EXECUTE') AS anon_can_run,
       has_function_privilege('authenticated', 'public.get_friends()', 'EXECUTE') AS authed_can_run;

-- 3. It is still SECURITY DEFINER with a pinned search_path.
--    Expect: prosecdef = true, proconfig contains search_path=public
SELECT prosecdef, proconfig
FROM pg_proc
WHERE oid = 'public.get_friends()'::regprocedure;

-- 4. Called without a session (Studio runs as postgres, where auth.uid() is NULL).
--    Expect: ERROR  authentication_required
SELECT * FROM public.get_friends();
