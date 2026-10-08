import { CONTACT } from "@/components/contact/contactData";

/**
 * Canonical site identity — one place for everything search engines and social
 * scrapers read.
 *
 * `siteUrl` is the linchpin: Next needs an absolute origin to resolve canonical
 * URLs, OpenGraph images, and sitemap entries. Without `metadataBase` set from
 * it, Next emits relative OG image paths, which every social scraper rejects.
 */
export const SITE = {
  name: "KROV Perfumería",
  /** Used in <title> templates. Kept short so titles don't get truncated in SERPs. */
  shortName: "KROV",
  /**
   * Home <title>, keyword-first. Google shows roughly the first 60 characters,
   * so the search-relevant words come before the brand.
   */
  homeTitle: "Perfumes originales y árabes en Costa Rica | KROV Perfumería",
  /**
   * Home / site-wide meta description. Kept under 160 characters (SERP cut-off)
   * and limited to claims the storefront actually backs up: nationwide shipping,
   * card or SINPE Móvil, and the free local delivery in Cariari centro (see
   * lib/shipping/localDelivery.ts).
   */
  description:
    "Compra perfumes originales, perfumes árabes y decants en Costa Rica. Envío a todo el país, pago con tarjeta o SINPE Móvil y entrega gratis en Cariari centro.",
  locale: "es_CR",
  lang: "es-CR",
  country: "CR",
  currency: "CRC",
  /** Square brand mark (2000×2000) — Organization.logo must be ≥112×112. */
  logoPath: "/KrovIcon.png",
  /**
   * Where the shop is based. Cariari centro is where the store itself delivers
   * (lib/shipping/localDelivery.ts), so it is the shop's own town. Deliberately
   * locality-level only: no street address is published anywhere in the project,
   * and structured data must not invent one.
   */
  address: {
    locality: "Cariari",
    canton: "Pococí",
    region: "Limón",
  },
  social: {
    instagram: CONTACT.instagram,
    facebook: CONTACT.facebook,
    tiktok: CONTACT.tiktok,
    whatsapp: CONTACT.whatsapp,
  },
} as const;

/**
 * The real production origin (no trailing slash). The fallback of last resort in
 * production builds, so a missing env var can never leak `localhost` into
 * canonical URLs, the sitemap or structured data.
 */
export const PRODUCTION_URL = "https://www.krovperfumeria.com";

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

/** A usable public origin: https, and not a loopback/dev host. */
function isPublicHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname !== "localhost" &&
      !url.hostname.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

/**
 * Absolute origin, no trailing slash.
 *
 *  - Development: `NEXT_PUBLIC_APP_URL` (or localhost) so local links work.
 *  - Production: `NEXT_PUBLIC_APP_URL` only when it is a real public https
 *    origin; otherwise {@link PRODUCTION_URL}. `.env.local` pins the variable to
 *    http://localhost:3000, and a `next build` run on a developer machine (or a
 *    host that forgot to set it) must not bake that into canonicals.
 */
export function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (process.env.NODE_ENV !== "production") {
    return stripTrailingSlashes(configured || "http://localhost:3000");
  }

  return configured && isPublicHttpsOrigin(configured)
    ? stripTrailingSlashes(configured)
    : PRODUCTION_URL;
}

/** Build an absolute URL for a site-relative path. */
export function absoluteUrl(path: string): string {
  return `${getSiteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
