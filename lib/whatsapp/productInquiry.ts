import { formatPrice } from "@/lib/format";
import { productPath, variantLabel } from "@/lib/seo/product";
import { SITE, absoluteUrl } from "@/lib/seo/site";
import type { ProductTypes } from "@/types/product";

/**
 * WhatsApp availability inquiry for made-to-order ("Por encargo") products.
 *
 * Pure string building - no network, no state. The customer taps a plain
 * `https://wa.me/...` link; WhatsApp opens with the message PREFILLED and the
 * customer decides whether to send it. Nothing here creates an order, reserves
 * stock or pretends a message was sent.
 */

/**
 * Where product inquiries go: +506 7143 4066 in the digits-only international
 * form `wa.me` requires (country code included, no "+", spaces or dashes).
 *
 * Kept separate from `CONTACT.whatsapp` (components/contact/contactData.ts) on
 * purpose: that URL currently reads `wa.me/71434066` - no 506 - and feeds the
 * footer, contact page and SINPE receipt button. Fixing it is a separate,
 * owner-confirmed change; inquiries must not wait for it, nor depend on it.
 */
export const INQUIRY_WHATSAPP_NUMBER = "50671434066";

const WHATSAPP_ORIGIN = "https://wa.me";

/**
 * Everything the message can say about a product. Every field except
 * `productName` is optional: whatever is missing is left OUT of the message
 * rather than filled in with a guess.
 */
export interface ProductInquiryInput {
  productName: string;
  brand?: string | null;
  /** Presentation size; together with `productType` becomes e.g. "100 ml". */
  sizeMl?: number | null;
  productType?: ProductTypes | null;
  /** The variant SKU. */
  sku?: string | null;
  /** The price the customer is looking at (offer price when the offer is live). */
  price?: number | null;
  /** Product slug; the link is always the canonical `/products/<slug>`. */
  slug?: string | null;
}

/**
 * One-line, control-character-free text. Product data is admin-entered, so a
 * stray newline in a name must not be able to add lines (or fake fields) to the
 * customer's message. `\s` also catches the non-breaking spaces `Intl` puts in
 * formatted prices.
 */
function oneLine(value: string | null | undefined): string {
  return (value ?? "").replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim();
}

/**
 * "Rayhaan Lion": brand first, unless the product name already carries it.
 * Same rule as `productDisplayName` in lib/seo/product.ts, so the message names
 * the product the way the page title does.
 */
function displayName(name: string, brand: string): string {
  if (!brand || name.toLowerCase().includes(brand.toLowerCase())) return name;
  return `${brand} ${name}`;
}

function presentation(
  sizeMl: number | null | undefined,
  productType: ProductTypes | null | undefined
): string {
  if (typeof sizeMl !== "number" || !Number.isFinite(sizeMl) || sizeMl <= 0) {
    return "";
  }
  // No type known: say the size and nothing more, rather than assume "Botella".
  return productType
    ? variantLabel({ size_ml: sizeMl, product_type: productType })
    : `${sizeMl} ml`;
}

function publishedPrice(price: number | null | undefined): string {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    return "";
  }
  return oneLine(formatPrice(price));
}

/**
 * The Spanish inquiry text, one `Label: value` line per known fact.
 *
 *   Hola, vi este perfume en KROV Perfumería y quisiera consultar su
 *   disponibilidad para encargo.
 *   Producto: Rayhaan Lion
 *   Presentación: 100 ml
 *   Código: KRV-0042
 *   Precio publicado: ₡21 000
 *   Enlace: https://www.krovperfumeria.com/products/lion
 *   ¿Podrían confirmar si todavía está disponible y cuál sería el plazo
 *   estimado de entrega?
 *
 * (The greeting and the closing question are single lines; they are wrapped
 * above only to fit this comment.)
 */
export function buildProductInquiryMessage(input: ProductInquiryInput): string {
  const name = oneLine(input.productName);
  const brand = oneLine(input.brand);
  const sku = oneLine(input.sku);
  const slug = oneLine(input.slug);

  const facts: Array<[label: string, value: string]> = [
    ["Producto", name ? displayName(name, brand) : ""],
    ["Presentación", presentation(input.sizeMl, input.productType)],
    ["Código", sku],
    ["Precio publicado", publishedPrice(input.price)],
    ["Enlace", slug ? absoluteUrl(productPath(slug)) : ""],
  ];

  return [
    `Hola, vi este perfume en ${SITE.name} y quisiera consultar su disponibilidad para encargo.`,
    ...facts
      .filter(([, value]) => value !== "")
      .map(([label, value]) => `${label}: ${value}`),
    "¿Podrían confirmar si todavía está disponible y cuál sería el plazo estimado de entrega?",
  ].join("\n");
}

/**
 * The `wa.me` link that opens a chat with KROV and the message prefilled.
 * The text is percent-encoded as a whole, so accents, `¿`, `&`, `#`, `?`, `%` and
 * newlines in the message cannot break (or extend) the query string.
 */
export function buildProductInquiryUrl(input: ProductInquiryInput): string {
  return `${WHATSAPP_ORIGIN}/${INQUIRY_WHATSAPP_NUMBER}?text=${encodeURIComponent(
    buildProductInquiryMessage(input)
  )}`;
}
