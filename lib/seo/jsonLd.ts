import { FOOTER_CONTACT, PAYMENT_METHODS } from "@/components/layout/footer/footerData";
import { SITE, absoluteUrl, getSiteUrl } from "./site";

/**
 * JSON-LD builders for schema.org structured data.
 *
 * Structured data is what turns a plain blue link into a rich result — price
 * and availability shown directly in Google. Rules every builder here follows:
 *
 *  - It describes only what the page visibly shows. No ratings, reviews,
 *    GTINs or shipping promises are emitted because none exist in the data.
 *  - Money is CRC, availability comes from the same stock rule the storefront
 *    uses, and every URL is absolute and canonical.
 *  - One node per entity per page. The Organization/WebSite pair is emitted by
 *    the root layout; pages reference the organization by `@id`.
 *
 * Everything returns a plain object; render it with `<JsonLd data={...} />`.
 */

/** Loosely typed JSON-LD node — schema.org shapes are open-ended by design. */
export type JsonLdNode = Record<string, unknown>;

const organizationId = () => `${getSiteUrl()}/#organization`;

/** "+506 7143 4066" (as shown in the footer) → "+50671434066". */
function toE164(display: string): string {
  return display.replace(/[^\d+]/g, "");
}

/**
 * Identity of the business itself. Emitted once, site-wide.
 *
 * `OnlineStore` is the subtype Google recommends for e-commerce. It is
 * deliberately NOT a `LocalBusiness`: there is no published street address or
 * opening hours to back one, and the address below is locality-level only.
 */
export function organizationSchema(): JsonLdNode {
  return {
    "@context": "https://schema.org",
    "@type": "OnlineStore",
    "@id": organizationId(),
    name: SITE.name,
    alternateName: SITE.shortName,
    description: SITE.description,
    url: getSiteUrl(),
    logo: absoluteUrl(SITE.logoPath),
    image: absoluteUrl("/opengraph-image"),
    telephone: toE164(FOOTER_CONTACT.whatsappDisplay),
    address: {
      "@type": "PostalAddress",
      addressLocality: SITE.address.locality,
      addressRegion: SITE.address.region,
      addressCountry: SITE.country,
    },
    areaServed: { "@type": "Country", name: "Costa Rica" },
    currenciesAccepted: SITE.currency,
    paymentAccepted: PAYMENT_METHODS.join(", "),
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer service",
      telephone: toE164(FOOTER_CONTACT.whatsappDisplay),
      availableLanguage: "es",
      areaServed: SITE.country,
    },
    // Links the site to its verified social profiles — helps entity resolution.
    sameAs: [SITE.social.instagram, SITE.social.facebook, SITE.social.tiktok],
  };
}

/**
 * Site-level node. `name` + `alternateName` feed Google's site-name display.
 * The sitelinks search box (`SearchAction`) is intentionally absent: Google
 * retired that feature, so the markup would only be dead weight.
 */
export function webSiteSchema(): JsonLdNode {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${getSiteUrl()}/#website`,
    name: SITE.name,
    alternateName: SITE.shortName,
    url: getSiteUrl(),
    inLanguage: SITE.lang,
    publisher: { "@id": organizationId() },
  };
}

export interface ProductVariantSchemaInput {
  sku: string;
  /** Variant-specific name, e.g. "Lion 100 ml". */
  name: string;
  /** Presentation size as the selector shows it, e.g. "100 ml". */
  size: string;
  /** What is charged today (offer price when the offer is live), in CRC. */
  price: number;
  /** Whether the variant can be bought right now (decant-aware). */
  inStock: boolean;
}

export interface ProductGroupSchemaInput {
  /** Stable id of the parent product. */
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  brand?: string | null;
  images: string[];
  variants: ProductVariantSchemaInput[];
}

/**
 * A perfume sold in several sizes is a `ProductGroup` whose variants each carry
 * their own `Offer` — the structure Google documents for merchant listings.
 * (`AggregateOffer` is only accepted for plain product snippets, and a price
 * range with a single availability flag can't say that the 5 ml decant is in
 * stock while the 100 ml bottle is not.)
 *
 * All variants share one canonical URL: the size is chosen on the page, and
 * `?variant=` is a preselection of that same document, not a separate page.
 */
export function productGroupSchema(input: ProductGroupSchemaInput): JsonLdNode {
  const url = absoluteUrl(`/products/${input.slug}`);
  const brand = input.brand
    ? { "@type": "Brand", name: input.brand }
    : undefined;
  const image = input.images.length > 0 ? input.images : undefined;

  return {
    "@context": "https://schema.org",
    "@type": "ProductGroup",
    "@id": `${url}#product`,
    name: input.name,
    description: input.description ?? undefined,
    url,
    image,
    brand,
    productGroupID: input.id,
    variesBy: ["https://schema.org/size"],
    hasVariant: input.variants.map((variant) => ({
      "@type": "Product",
      sku: variant.sku,
      name: variant.name,
      size: variant.size,
      url,
      image,
      brand,
      offers: {
        "@type": "Offer",
        url,
        priceCurrency: SITE.currency,
        price: variant.price,
        availability: variant.inStock
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
        seller: { "@id": organizationId() },
      },
    })),
  };
}

/**
 * Breadcrumb trail. The names must mirror the breadcrumb the page actually
 * renders — Google compares them.
 */
export function breadcrumbSchema(
  crumbs: Array<{ name: string; path: string }>
): JsonLdNode {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}
