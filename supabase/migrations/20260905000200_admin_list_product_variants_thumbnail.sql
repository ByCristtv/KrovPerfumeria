-- ============================================================================
-- 20260905000200  admin_list_product_variants -- thumbnail + active-first order
-- ----------------------------------------------------------------------------
-- Two changes to the RPC behind /admin/products:
--
--   1. NEW OUTPUT COLUMN `image_url` -- the variant's main image, so the table
--      can show a small thumbnail instead of the Categorias column.
--
--      Resolution order (first hit wins):
--        a. an image scoped to THIS variant  (product_images.variant_id = pv.id)
--        b. the parent product's main image  (variant_id IS NULL, lowest
--           position -- the same row the public catalog card uses)
--      NULL when the product has no images at all; the UI renders a placeholder.
--
--      (b) is the normal case: image management is parent-scoped today (see
--      features/admin/productImages.ts). (a) is kept because the column exists
--      and older rows may still be variant-scoped -- ignoring it would show the
--      wrong bottle for those.
--
--   2. ORDERING -- ACTIVE VARIANTS FIRST, INACTIVE LAST.
--      `ORDER BY pv.is_active DESC NULLS LAST` before the existing recency
--      tiebreak. This MUST live in the RPC: the panel is paginated server-side
--      (20/page), so sorting a single page in the client would only shuffle
--      rows within that page and leave inactive variants scattered across the
--      catalog. Ordering here pushes every inactive SKU to the last pages.
--
-- Everything else -- the is_admin() gate, search, LIMIT/OFFSET, total_count,
-- wholesale columns -- is byte-for-byte the behaviour of 20260804000400.
--
-- The RETURNS TABLE shape changes, so CREATE OR REPLACE alone raises
-- "cannot change return type of existing function"; DROP first. Safe to
-- re-run. After applying, run `pnpm update-types`.
-- ============================================================================
-- Supersedes: 20260728000200, 20260804000400.
-- ============================================================================

DROP FUNCTION IF EXISTS public.admin_list_product_variants(TEXT, INT, INT);

CREATE OR REPLACE FUNCTION public.admin_list_product_variants(
  p_search TEXT DEFAULT NULL,
  p_limit  INT  DEFAULT 20,
  p_offset INT  DEFAULT 0
) RETURNS TABLE (
  variant_id             UUID,
  product_id             UUID,
  sku                    TEXT,
  size_ml                NUMERIC,
  product_type           public.product_type,
  price                  NUMERIC,
  stock                  INT,
  is_on_offer            BOOLEAN,
  offer_price            NUMERIC,
  is_active              BOOLEAN,
  wholesale_price        NUMERIC,
  min_wholesale_quantity INT,
  name                   TEXT,
  description            TEXT,
  brand                  TEXT,
  categories             JSONB,
  image_url              TEXT,     -- NEW: variant thumbnail
  total_count            BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_search TEXT := NULLIF(TRIM(p_search), '');
  v_like   TEXT;
  v_limit  INT  := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  v_offset INT  := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Insufficient privilege: admin only.';
  END IF;

  -- Escape LIKE metacharacters so "50%" is literal, not a wildcard.
  v_like := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  RETURN QUERY
  SELECT
    pv.id                                          AS variant_id,
    p.id                                           AS product_id,
    pv.sku,
    pv.size_ml,
    pv.product_type,
    pv.price,
    pv.stock,
    pv.is_on_offer,
    pv.offer_price,
    pv.is_active,
    pv.wholesale_price,
    pv.min_wholesale_quantity,
    p.name,
    p.description,
    b.name                                         AS brand,
    COALESCE(
      (
        SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) ORDER BY c.name)
          FROM public.product_categories pc
          JOIN public.categories c ON c.id = pc.category_id
         WHERE pc.product_id = p.id
      ),
      '[]'::jsonb
    )                                              AS categories,
    -- Variant-scoped image if one exists, else the parent's main image.
    COALESCE(
      (
        SELECT pi.url
          FROM public.product_images pi
         WHERE pi.variant_id = pv.id
         ORDER BY pi.position, pi.created_at
         LIMIT 1
      ),
      (
        SELECT pi.url
          FROM public.product_images pi
         WHERE pi.product_id = p.id
           AND pi.variant_id IS NULL
         ORDER BY pi.position, pi.created_at
         LIMIT 1
      )
    )                                              AS image_url,
    COUNT(*) OVER()                                AS total_count
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
  JOIN public.brands   b ON b.id = p.brand_id
  WHERE
    v_search IS NULL
    OR p.name  ILIKE v_like ESCAPE '\'
    OR b.name  ILIKE v_like ESCAPE '\'
    OR pv.sku  ILIKE v_like ESCAPE '\'
  -- Active first, inactive last; newest first within each group.
  ORDER BY pv.is_active DESC NULLS LAST, pv.created_at DESC, pv.id DESC
  LIMIT v_limit OFFSET v_offset;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_product_variants(TEXT, INT, INT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_list_product_variants(TEXT, INT, INT) TO authenticated;


-- ============================================================================
-- VERIFICATION QUERIES -- run after the migration (as an ADMIN user)
-- ============================================================================
-- 1. The new column is in the signature:
--    SELECT pg_get_function_result(
--             'public.admin_list_product_variants(text,int,int)'::regprocedure
--           ) LIKE '%image_url%' AS has_thumbnail;   -- -> true
--
-- 2. Ordering is active-first (run in Studio, which is service_role -- if
--    is_admin() blocks you there, run steps 2-4 from the app instead):
--    SELECT is_active, count(*)
--      FROM public.admin_list_product_variants(NULL, 100, 0)
--     GROUP BY is_active;
--    -- and confirm no active row appears after an inactive one:
--    SELECT bool_and(ok) AS active_first FROM (
--      SELECT is_active <= lag(is_active) OVER (ORDER BY rn) AS ok
--        FROM (SELECT is_active, row_number() OVER () AS rn
--                FROM public.admin_list_product_variants(NULL, 100, 0)) t
--    ) s WHERE ok IS NOT NULL;    -- -> true
--
-- 3. Thumbnails resolve for products that have images:
--    SELECT sku, image_url IS NOT NULL AS has_image
--      FROM public.admin_list_product_variants(NULL, 20, 0);
--
-- 4. Search still works and is still escaped:
--    SELECT count(*) FROM public.admin_list_product_variants('50%', 20, 0);
--    -- -> only SKUs/names literally containing "50%", not everything.
--
-- 5. Grants unchanged (authenticated only; is_admin() does the real gating):
--    SELECT grantee, privilege_type FROM information_schema.routine_privileges
--     WHERE routine_name = 'admin_list_product_variants';
-- ============================================================================
