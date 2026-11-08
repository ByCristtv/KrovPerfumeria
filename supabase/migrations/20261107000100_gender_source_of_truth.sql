-- ============================================================================
-- Migration: products.gender becomes the single source of truth for gender
-- ============================================================================
--
-- TARGET: run in the TESTING project first (ref phhrvqqlvgapbiodwpwy), pasted
-- into the Supabase Studio SQL editor. Do NOT run it against production until
-- the app code that ships with it has been deployed there (see DEPLOY ORDER).
--
-- WHY
--   A product's audience was stored twice and nothing kept the two in sync:
--     · products.gender            ('masculine' | 'feminine' | 'unisex') —
--                                  what the admin gender dropdown writes and the
--                                  product page shows;
--     · product_categories rows    pointing at the Hombre / Mujer / Unisex
--                                  categories — what the catalog filter read.
--   Editing one left the other stale, so e.g. a product changed to `masculine`
--   kept its Unisex row and kept appearing under "Mujer".
--
--   From this migration on, gender lives ONLY in products.gender. The catalog
--   filter, related products and the admin forms already read/write it there.
--
-- WHAT IT DOES (idempotent — safe to run more than once)
--   1. Creates a backup table that also serves as the mismatch report.
--   2. Backfills products.gender where it is NULL and the product has exactly
--      ONE gender category row, so no information is lost.
--   3. Copies every Hombre/Mujer/Unisex association into the backup, recording
--      whether it agreed with products.gender.
--   4. Deletes those associations from product_categories. Commercial
--      categories (Árabe, Nicho, Diseñador, …) are not touched.
--   5. Adds a guard trigger that rejects NEW gender associations, so the drift
--      cannot come back through Studio or an old client.
--
-- WHAT IT DOES NOT DO
--   · It keeps the three rows in `categories` (hombre / mujer / unisex). Their
--     ids are still the catalog's `?category=<uuid>` identifiers — existing
--     links and bookmarks keep working; the app resolves them to gender values.
--   · It does not change products.gender for any product that already has one.
--     When a gender row disagreed, products.gender wins (that is the field the
--     admin edits). The disagreements are kept in the backup for review.
--
-- DEPLOY ORDER (production, later)
--   1. Deploy the app code first. It no longer reads or writes gender rows.
--   2. Then run this migration. Running it BEFORE the deploy would make the old
--      admin forms fail when a gender category is ticked (step 5's guard).
--
-- ROLLBACK
--   INSERT INTO public.product_categories (product_id, category_id)
--   SELECT product_id, category_id FROM public.product_gender_category_backup
--   ON CONFLICT DO NOTHING;
--   (after dropping trigger trg_reject_gender_product_category)
-- ============================================================================

BEGIN;

-- ── 1. Backup / report table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_gender_category_backup (
  product_id          uuid        NOT NULL,
  category_id         uuid        NOT NULL,
  category_slug       text        NOT NULL,
  -- products.gender at the moment the row was backed up (after step 2).
  product_gender      text,
  -- true when the row said the same thing as products.gender.
  agreed_with_gender  boolean     NOT NULL,
  backed_up_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, category_id)
);

COMMENT ON TABLE public.product_gender_category_backup IS
  'Hombre/Mujer/Unisex product_categories rows removed by migration 20261107000100 (gender now lives in products.gender). Kept for audit and rollback.';

-- Not for the storefront: RLS on, no policies → only service role / Studio.
ALTER TABLE public.product_gender_category_backup ENABLE ROW LEVEL SECURITY;

-- ── 2. Backfill a missing products.gender from a single gender row ──────────
WITH gender_rows AS (
  SELECT pc.product_id,
         min(c.slug) AS slug,
         count(*)    AS n
    FROM public.product_categories pc
    JOIN public.categories c ON c.id = pc.category_id
   WHERE c.slug IN ('hombre', 'mujer', 'unisex')
   GROUP BY pc.product_id
)
UPDATE public.products p
   SET gender = CASE g.slug
                  WHEN 'hombre' THEN 'masculine'
                  WHEN 'mujer'  THEN 'feminine'
                  ELSE 'unisex'
                END
  FROM gender_rows g
 WHERE g.product_id = p.id
   AND g.n = 1
   AND p.gender IS NULL;

-- ── 3. Back up every gender association (with its agreement flag) ───────────
INSERT INTO public.product_gender_category_backup
       (product_id, category_id, category_slug, product_gender, agreed_with_gender)
SELECT pc.product_id,
       pc.category_id,
       c.slug,
       p.gender,
       COALESCE(
         (c.slug = 'hombre' AND p.gender = 'masculine') OR
         (c.slug = 'mujer'  AND p.gender = 'feminine')  OR
         (c.slug = 'unisex' AND p.gender = 'unisex'),
         false
       )
  FROM public.product_categories pc
  JOIN public.categories c ON c.id = pc.category_id
  JOIN public.products   p ON p.id = pc.product_id
 WHERE c.slug IN ('hombre', 'mujer', 'unisex')
ON CONFLICT (product_id, category_id) DO NOTHING;

-- ── 4. Remove the gender associations (commercial ones are untouched) ───────
DELETE FROM public.product_categories pc
 USING public.categories c
 WHERE c.id = pc.category_id
   AND c.slug IN ('hombre', 'mujer', 'unisex');

-- ── 5. Guard: gender can no longer be assigned as a category ────────────────
CREATE OR REPLACE FUNCTION public.reject_gender_product_category()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.categories c
     WHERE c.id = NEW.category_id
       AND c.slug IN ('hombre', 'mujer', 'unisex')
  ) THEN
    RAISE EXCEPTION
      'El género del producto se asigna con el campo "Género", no como categoría.'
      USING ERRCODE = 'check_violation',
            HINT    = 'Gender lives in products.gender (migration 20261107000100).';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reject_gender_product_category ON public.product_categories;
CREATE TRIGGER trg_reject_gender_product_category
  BEFORE INSERT OR UPDATE OF category_id ON public.product_categories
  FOR EACH ROW EXECUTE FUNCTION public.reject_gender_product_category();

COMMIT;

-- ============================================================================
-- VERIFICATION — run these one at a time after the migration.
-- ============================================================================
--
-- V1. No gender associations remain (expect 0):
--   SELECT count(*) AS gender_rows_left
--     FROM public.product_categories pc
--     JOIN public.categories c ON c.id = pc.category_id
--    WHERE c.slug IN ('hombre', 'mujer', 'unisex');
--
-- V2. Mismatch report — the rows that disagreed with products.gender:
--   SELECT p.slug, b.product_gender, b.category_slug, b.backed_up_at
--     FROM public.product_gender_category_backup b
--     JOIN public.products p ON p.id = b.product_id
--    WHERE NOT b.agreed_with_gender
--    ORDER BY p.slug;
--
-- V3. Totals backed up (all removed rows, agreeing or not):
--   SELECT category_slug, agreed_with_gender, count(*)
--     FROM public.product_gender_category_backup
--    GROUP BY 1, 2 ORDER BY 1, 2;
--
-- V4. Products still without a gender (expect 0; any row here needs a manual
--     choice in /admin/products — it had zero or several gender rows):
--   SELECT id, slug FROM public.products WHERE gender IS NULL;
--
-- V5. The three gender categories still exist (URL compatibility, expect 3)
--     and the guard trigger is installed (expect 1):
--   SELECT slug FROM public.categories WHERE slug IN ('hombre', 'mujer', 'unisex');
--   SELECT tgname FROM pg_trigger WHERE tgname = 'trg_reject_gender_product_category';
--
-- V6. Commercial associations are intact (compare with the count before):
--   SELECT c.slug, count(*)
--     FROM public.product_categories pc
--     JOIN public.categories c ON c.id = pc.category_id
--    GROUP BY 1 ORDER BY 1;
