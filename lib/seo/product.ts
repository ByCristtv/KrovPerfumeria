import { formatPrice } from "@/lib/format";
import { isInStock } from "@/lib/stock";
import type { ProductDetailData, ProductVariant } from "@/types/product";
import type { ProductGroupSchemaInput } from "./jsonLd";
import { truncateDescription } from "./metadata";
import { SITE } from "./site";

/**
 * Everything SEO needs to know about a product, derived from the same
 * `ProductDetailData` the page renders. Nothing here is hand-written per
 * product: titles, descriptions, prices and availability all come from the
 * database row, so the metadata updates the moment the product does.
 */

export function productPath(slug: string): string {
  return `/products/${slug}`;
}

/**
 * A product the page can actually render. The detail page 404s when a product
 * has no active variant, so metadata, the sitemap and structured data must make
 * the same call — otherwise the 404 ships with a contradictory `index` signal.
 */
export function isListableProduct(
  product: ProductDetailData | null
): product is ProductDetailData {
  return product !== null && product.product_variants.length > 0;
}

const CONCENTRATION_LABELS: Record<string, string> = {
  EDP: "Eau de Parfum",
  EDT: "Eau de Toilette",
  EDC: "Eau de Cologne",
};

/** "EDP" → "Eau de Parfum"; anything unrecognised is shown as stored. */
export function concentrationLabel(raw: string | null | undefined): string {
  const value = raw?.trim() ?? "";
  if (!value) return "";
  return CONCENTRATION_LABELS[value.toUpperCase().replace(/\./g, "")] ?? value;
}

/** "Rayhaan Lion" — brand first, unless the product name already carries it. */
export function productDisplayName(product: ProductDetailData): string {
  const brand = product.brands?.name?.trim() ?? "";
  if (!brand || product.name.toLowerCase().includes(brand.toLowerCase())) {
    return product.name;
  }
  return `${brand} ${product.name}`;
}

/**
 * Search title: "Rayhaan Lion Eau de Parfum". Brand + name + concentration is
 * how people search for a fragrance; the root template adds the store name.
 */
export function productTitle(product: ProductDetailData): string {
  const name = productDisplayName(product);
  const concentration = concentrationLabel(product.concentration);
  if (!concentration || name.toLowerCase().includes(concentration.toLowerCase())) {
    return name;
  }
  return `${name} ${concentration}`;
}

/** What a variant is charged right now — the offer price when the offer is live. */
export function effectivePrice(variant: ProductVariant): number {
  return variant.is_on_offer && variant.offer_price != null
    ? variant.offer_price
    : variant.price;
}

/** Cheapest variant that can be bought today, or null when nothing is in stock. */
export function lowestAvailablePrice(product: ProductDetailData): number | null {
  const prices = product.product_variants
    .filter((variant) => isInStock(variant, product.decant_stock_ml))
    .map(effectivePrice);
  return prices.length > 0 ? Math.min(...prices) : null;
}

const SHIPPING_CTA = "Compra online con envío a todo Costa Rica.";

/**
 * Meta description from the product's own text, then — only as far as the
 * 160-character budget allows — a live "desde" price and the shipping line.
 * Products without a description fall back to a factual sentence built from
 * the brand, name and concentration.
 */
export function productDescription(product: ProductDetailData): string {
  const base =
    product.description?.replace(/\s+/g, " ").trim() ||
    `${productTitle(product)}: perfume original disponible en ${SITE.name}.`;

  const price = lowestAvailablePrice(product);
  const extras = [
    price !== null ? `Desde ${formatPrice(price)}.` : "",
    SHIPPING_CTA,
  ].filter(Boolean);

  let description = base;
  for (const extra of extras) {
    const next = `${description} ${extra}`;
    if (next.length > 160) break;
    description = next;
  }
  return truncateDescription(description);
}

export interface ProductImage {
  url: string;
  alt: string;
}

/**
 * Product images in gallery order (by `position`), with alt text falling back
 * to the product name the way the gallery does. Images belong to the parent
 * product and are shared by every variant.
 */
export function productImages(
  product: ProductDetailData,
  max = 6
): ProductImage[] {
  const fallbackAlt = productDisplayName(product);
  return [...product.product_images]
    .filter((image) => Boolean(image.url))
    .sort((a, b) => a.position - b.position)
    .slice(0, max)
    .map((image) => ({
      url: image.url,
      alt: image.alt_text?.trim() || fallbackAlt,
    }));
}

/** Variant label as the selector shows it: "100 ml" or "5 ml · Decant". */
export function variantLabel(variant: ProductVariant): string {
  const size = `${variant.size_ml} ml`;
  if (variant.product_type === "decant") return `${size} · Decant`;
  if (variant.product_type === "set") return `${size} · Set`;
  return size;
}

/**
 * Decant stock lives in the parent's shared ml pool, not on the variant row, so
 * `variant.stock > 0` is wrong for them (it is always 0). `isInStock` is the
 * single rule the cart, checkout and detail page already use.
 */
export function variantInStock(
  product: ProductDetailData,
  variant: ProductVariant
): boolean {
  return isInStock(variant, product.decant_stock_ml);
}

/**
 * Map a product row to the `ProductGroup` input. Prices and availability go
 * through the same helpers the page uses, so structured data cannot disagree
 * with what a visitor sees; images and the description are the visible ones.
 */
export function productSchemaInput(
  product: ProductDetailData
): ProductGroupSchemaInput {
  const variants = [...product.product_variants]
    .sort((a, b) => a.size_ml - b.size_ml)
    .map((variant) => ({
      sku: variant.id,
      name: `${product.name} ${variantLabel(variant)}`,
      size: `${variant.size_ml} ml`,
      price: effectivePrice(variant),
      inStock: variantInStock(product, variant),
    }));

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    brand: product.brands?.name ?? null,
    images: productImages(product).map((image) => image.url),
    variants,
  };
}
