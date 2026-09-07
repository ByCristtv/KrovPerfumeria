/**
 * Which image represents a variant in the admin table.
 *
 * THE RULE (first hit wins):
 *   1. an image scoped to THIS variant  (`product_images.variant_id = variantId`)
 *   2. the parent product's main image  (`variant_id IS NULL`, lowest position)
 *   3. nothing — the caller renders a placeholder
 *
 * (2) is the normal case: image management is parent-scoped today (see
 * `features/admin/productImages.ts`, "the first image is the catalog one"), and
 * it is the very image the public catalog card shows. (1) is honoured because
 * the column still exists and older rows may be variant-scoped — ignoring it
 * would show the wrong bottle for those.
 *
 * This mirrors the `image_url` COALESCE in `admin_list_product_variants`
 * (migration 20260905000200). The RPC is the source of truth for the paginated
 * products table; this function serves the sources that fetch images through
 * PostgREST instead. Both must resolve the same image — the tests pin that.
 */

/** Minimal image shape. `variant_id` null means the image is parent-scoped. */
export interface VariantImageCandidate {
  url: string;
  position: number;
  variant_id?: string | null;
}

/** Lowest `position` first; ties keep the order the database returned. */
function byPosition(a: VariantImageCandidate, b: VariantImageCandidate): number {
  return a.position - b.position;
}

/** Ignore rows that carry no usable URL, so a blank string can't win. */
function hasUrl(image: VariantImageCandidate): boolean {
  return typeof image.url === "string" && image.url.trim().length > 0;
}

/**
 * Resolve the thumbnail for `variantId` from a parent product's image rows.
 * Returns `null` when there is nothing to show. Never mutates the input.
 */
export function resolveVariantThumbnail(
  variantId: string,
  images: readonly VariantImageCandidate[] | null | undefined
): string | null {
  const usable = (images ?? []).filter(hasUrl);
  if (usable.length === 0) return null;

  const own = usable
    .filter((image) => image.variant_id === variantId)
    .sort(byPosition);
  if (own.length > 0) return own[0].url;

  const parent = usable
    .filter((image) => image.variant_id == null)
    .sort(byPosition);
  return parent.length > 0 ? parent[0].url : null;
}
