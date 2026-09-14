import { CONTACT } from "@/components/contact/contactData";

/**
 * Single source of truth for footer content.
 *
 * Contact URLs are reused from the canonical `CONTACT` map (contactData.ts).
 * Values marked PLACEHOLDER below do not yet exist anywhere in the project —
 * replace them with the real ones when available (they are intentionally not
 * invented as authoritative).
 */

export const BRAND_STATEMENT =
  "KROV — del ruso кровь, sangre. Lo que llevamos en la sangre nos define, y una fragancia funciona igual: no la usás, te vuelve parte de ella. Perfumes originales y decants para quienes eligen su aroma como eligen su nombre.";

// ---- Contact (Column 4) ----
export const FOOTER_CONTACT = {
  // PLACEHOLDER — no support email is configured in the project yet.
  email: "contacto@krovperfumeria.cr",
  whatsappUrl: CONTACT.whatsapp,
  whatsappDisplay: "+506 7143 4066",
  // PLACEHOLDER — confirm real business hours.
  hours: "Lunes a Sábado · 9:00 AM – 6:00 PM",
  location: "Costa Rica",
} as const;

// ---- Social channels (Column 1). Only configured accounts are shown. ----
export const FOOTER_SOCIALS = [
  { name: "Instagram", url: CONTACT.instagram, icon: "/icons/instagram.svg" },
  { name: "Facebook", url: CONTACT.facebook, icon: "/icons/facebook.svg" },
  { name: "WhatsApp", url: CONTACT.whatsapp, icon: "/icons/whatsapp.svg" },
  { name: "TikTok", url: CONTACT.tiktok, icon: "/icons/TikTok.svg" },
] as const;

type FooterLink = { label: string; href: string };

// ---- Column 2 — Tienda ----
// Links map to real destinations; filter-backed ones use catalog query params.
export const SHOP_LINKS: FooterLink[] = [
  { label: "La colección", href: "/products" },
  { label: "Recién llegados", href: "/" },
];

// ---- Column 3 — Información ----
export const INFO_LINKS: FooterLink[] = [
  { label: "Sobre Nosotros", href: "/about" },
  { label: "Contacto", href: "/contact" },
  { label: "Preguntas Frecuentes", href: "/contact" },
  { label: "Métodos de Pago", href: "/howtobuy" },
  { label: "Envíos", href: "/howtobuy" },
  { label: "Política de Privacidad", href: "/legal/privacidad" },
  { label: "Términos y Condiciones", href: "/legal/terminos" },
];

// ---- Trust indicators (Column 4) ----
export const TRUST_INDICATORS = [
  "100% originales",
  "Pago seguro",
  "Envío nacional",
  "Asesoría uno a uno",
] as const;

// ---- Accepted payment methods (Section 6) ----
export const PAYMENT_METHODS = [
  "Visa",
  "Mastercard",
  "Amex",
  "SINPE Móvil",
] as const;
