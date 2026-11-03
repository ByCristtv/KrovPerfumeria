-- Manual "trending" flag: trending products are listed first in the default
-- catalog order (then by featured-variant price ascending). Additive only:
-- existing rows get FALSE, no other data, RLS or policy is touched.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_trending BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.products.is_trending IS
  'TRUE = pinned to the top of the default catalog order. Toggle manually, e.g. UPDATE public.products SET is_trending = TRUE WHERE slug = ''...'';';
