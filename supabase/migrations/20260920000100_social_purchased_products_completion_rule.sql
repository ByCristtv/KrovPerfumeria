BEGIN;

SET LOCAL search_path = public, extensions;

-- ============================================================
-- KROV PERFUMERY
-- Social: fix the purchase-completion rule
-- ============================================================
--
-- DEFECT
-- ------
-- `get_friend_purchased_products` (migration 20260919000100) filtered
-- purchases with:
--
--     AND o.order_status::text = 'received'
--
-- But `received` is NOT the terminal state of an order. The state machine in
-- `advance_order_status` (migration 20260525000700) is:
--
--     pending -> received -> shipped
--
-- with `shipped` terminal. So the moment an admin marks a completed order as
-- shipped, every fragrance in it SILENTLY DISAPPEARED from that customer's
-- friend profile — the more complete the order, the less it counted.
--
-- WHAT THE AUTHORITATIVE COMPLETION RULE ACTUALLY IS
-- --------------------------------------------------
-- Reaching `received` is what the business treats as a completed purchase:
-- `grant_order_xp` (migration 20260611000100) awards XP on that transition and
-- records it permanently in `profile_experience_events`. That ledger is
-- append-only — an order that later becomes `shipped` KEEPS its XP. So
-- "completed" means "has reached received", and both `received` and `shipped`
-- satisfy it.
--
-- `pending` and `denied` remain excluded: neither has ever been completed.
--
-- THE CHANGE
-- ----------
-- One WHERE clause. The signature, the projection, the joins, the image
-- LATERAL, the friendship authorization and every GRANT are byte-identical to
-- 20260919000100 — this is CREATE OR REPLACE, so nothing else moves, and no
-- historical migration was edited in place.
--
-- Still NOT exposed, unchanged: order ids, order numbers, quantities, sizes,
-- unit prices, totals, discounts, shipping data, payment data, timestamps.
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

      -- A completed purchase is one that REACHED `received`. `shipped` is the
      -- state after it, not an alternative to it, so both qualify. `pending`
      -- and `denied` never completed and stay excluded.
      AND o.order_status::text IN ('received', 'shipped')


    ORDER BY product_name;
END;
$$;


-- Privileges are re-asserted rather than assumed: CREATE OR REPLACE preserves
-- them, but stating them here means this file is correct even if it is ever
-- replayed against a database that never ran 20260919000100.
REVOKE ALL
ON FUNCTION public.get_friend_purchased_products(uuid)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.get_friend_purchased_products(uuid)
TO authenticated;


-- ============================================================
-- Supporting index
-- ============================================================
--
-- The projection scans a customer's orders by (user_id, order_status). With no
-- index, that is a sequential scan of `orders` on every friend-profile view.
-- Partial, because the two statuses below are the only ones it ever asks for.
-- ============================================================

CREATE INDEX IF NOT EXISTS orders_user_completed_idx
ON public.orders (user_id)
WHERE order_status::text IN ('received', 'shipped');


COMMIT;
