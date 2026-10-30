-- ============================================================================
-- 20261029000100_supplier_availability.sql
-- Supplier availability for "Por encargo" (made-to-order) products.
-- ============================================================================
-- WHAT THIS ADDS (public.product_variants only)
--
--   supplier_available   BOOLEAN NOT NULL DEFAULT FALSE
--       TRUE  = KROV manually verified the SUPPLIER had this variant available
--               at its last inspection.
--       FALSE = verified sold out / unavailable at the supplier, OR never
--               verified. The two are deliberately the same value: an
--               unverified product must never be advertised as orderable.
--       This is NOT KROV's inventory. `stock` (and products.decant_stock_ml for
--       decants) keep meaning "units KROV physically owns", untouched.
--
--   supplier_checked_at  TIMESTAMPTZ NULL
--       When an admin last inspected the supplier catalog for this variant.
--       NULL = never inspected. Written by the admin action together with
--       supplier_available; the database does not infer it.
--
--   chk_decant_not_supplier_available
--       CHECK (NOT supplier_available OR product_type <> 'decant')
--       Supplier stock is never decant liquid: a decant is sold from KROV's own
--       shared ml pool (products.decant_stock_ml) and nothing else. Mirrors
--       chk_decant_zero_stock (20260609000100) so the rule holds for every
--       writer (admin UI, Studio, future RPCs), not just for the UI.
--
-- WHAT THE CUSTOMER-FACING STATUS IS (derived, never stored)
--   stock > 0                                  -> available now
--   stock = 0 AND supplier_available           -> "Por encargo" (WhatsApp inquiry)
--   stock = 0 AND NOT supplier_available       -> "Agotado"
--   The derivation lives in application code (lib/stock.ts, Phase 2). There is
--   no status column to drift out of sync with stock.
--
-- SAFE DEFAULT FOR EXISTING DATA
--   Every existing row gets supplier_available = FALSE and supplier_checked_at
--   = NULL. A zero-stock product therefore stays "Agotado" until an admin
--   verifies it at the supplier and flips it. Nothing is advertised as
--   made-to-order by this migration.
--
-- WHAT THIS DELIBERATELY DOES NOT TOUCH
--   * place_order / place_admin_order / decrease_variant_stock. They already
--     reject any line whose stock is below the requested quantity, so a
--     made-to-order (stock 0) variant cannot be bought through the API however
--     the request is forged. supplier_available is not read by any purchase
--     path; supabase/tests/20261029000100_supplier_availability_test.sql proves
--     it against the live function.
--   * RLS. The existing policies already decide this: anyone can SELECT active
--     variants (the storefront must read supplier_available to render the
--     label - it is public by design), and only is_admin() can INSERT / UPDATE /
--     DELETE. There is no customer write policy, so customers cannot flip it.
--     The test suite asserts that against the LIVE policies, because
--     supabase/schema.sql is stale and cannot be trusted for that.
--   * admin_list_product_variants. Its RETURNS TABLE has to change to show the
--     new columns, which means DROP + CREATE; that ships in Phase 4 together
--     with the admin UI that consumes it, so this migration stays purely
--     additive.
--   * Triggers. No trigger resets supplier_available when stock changes: stock
--     > 0 simply takes precedence in the derivation, and the flag is still
--     right if stock later drops back to 0.
--
-- DEPLOY ORDER (important)
--   Additive and backward compatible: the currently deployed code never names
--   the new columns, so applying this first changes nothing for it. The NEW code
--   (Phase 3) selects them, and the catalog / detail queries swallow query
--   errors (empty catalog, 404 on every product) - so apply this migration
--   BEFORE deploying that code, never after.
--
-- Idempotent: safe to re-run. Metadata-only for existing rows (constant
-- default, no table rewrite). Wrapped in one transaction by Studio / `supabase
-- db push`; if any step fails nothing is applied.
-- Depends on: public.product_variants, public.product_type enum.
-- After applying: hand-maintained types/database.ts already carries the two
-- columns; do NOT regenerate over it without reviewing the diff.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. Columns
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS supplier_available  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS supplier_checked_at TIMESTAMPTZ;

COMMENT ON COLUMN public.product_variants.supplier_available IS
  'Supplier availability, manually verified by an admin. NOT KROV inventory (see stock / products.decant_stock_ml). '
  'TRUE = supplier had it at the last inspection (shown as "Por encargo" while stock = 0). '
  'FALSE = supplier sold out OR never verified. Never TRUE for decants.';

COMMENT ON COLUMN public.product_variants.supplier_checked_at IS
  'When an admin last inspected the supplier catalog for this variant. NULL = never inspected.';


-- ────────────────────────────────────────────────────────────────────────────
-- 2. Decants can never be supplier-available
-- ────────────────────────────────────────────────────────────────────────────
-- ADD CONSTRAINT has no IF NOT EXISTS, so guard it to keep the file re-runnable.
-- Every existing row has supplier_available = FALSE, so validation cannot fail.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname  = 'chk_decant_not_supplier_available'
       AND conrelid = 'public.product_variants'::regclass
  ) THEN
    ALTER TABLE public.product_variants
      ADD CONSTRAINT chk_decant_not_supplier_available
      CHECK (NOT supplier_available OR product_type <> 'decant');
  END IF;
END $$;


-- ============================================================================
-- VERIFICATION QUERIES - run after the migration
-- ============================================================================
-- 1. Shape (expect: supplier_available boolean NO 'false';
--                   supplier_checked_at timestamp with time zone YES NULL):
--    SELECT column_name, data_type, is_nullable, column_default
--      FROM information_schema.columns
--     WHERE table_schema = 'public' AND table_name = 'product_variants'
--       AND column_name IN ('supplier_available', 'supplier_checked_at')
--     ORDER BY column_name;
--
-- 2. Constraint present and validated (expect one row, convalidated = true):
--    SELECT conname, convalidated, pg_get_constraintdef(oid)
--      FROM pg_constraint
--     WHERE conrelid = 'public.product_variants'::regclass
--       AND conname = 'chk_decant_not_supplier_available';
--
-- 3. Nothing is advertised as made-to-order yet (expect flagged = 0):
--    SELECT count(*) FILTER (WHERE supplier_available) AS flagged,
--           count(*)                                    AS total_variants
--      FROM public.product_variants;
--
-- 4. Write policies on product_variants are admin-only (expect every row below
--    to mention is_admin(); any other write policy is live drift - review it):
--    SELECT policyname, cmd, roles, qual, with_check
--      FROM pg_policies
--     WHERE schemaname = 'public' AND tablename = 'product_variants'
--     ORDER BY cmd, policyname;
--
-- 5. Run supabase/tests/20261029000100_supplier_availability_test.sql (STAGING
--    / TESTING project first; it rolls back and is also safe on production).
-- ============================================================================


-- ============================================================================
-- ROLLBACK (only if this must be backed out). DROP COLUMN discards every
-- verification flag and timestamp admins have entered since - export them
-- first if they matter:
--     SELECT sku, supplier_available, supplier_checked_at
--       FROM public.product_variants WHERE supplier_checked_at IS NOT NULL;
-- ============================================================================
--   ALTER TABLE public.product_variants
--     DROP CONSTRAINT IF EXISTS chk_decant_not_supplier_available;
--   ALTER TABLE public.product_variants
--     DROP COLUMN IF EXISTS supplier_checked_at,
--     DROP COLUMN IF EXISTS supplier_available;
-- Roll the application code back FIRST (or together): the Phase 3 queries select
-- these columns and would start failing the moment they are dropped.
-- ============================================================================
