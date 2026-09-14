import type { Metadata } from "next";
import { Bodoni_Moda, Jost } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/footer/Footer";
import FooterGate from "@/components/layout/footer/FooterGate";
import QueryProvider from "@/components/providers/QueryProvider";
import AuthListener from "@/components/auth/AuthListener";
import JsonLd from "@/components/seo/JsonLd";
import { organizationSchema, webSiteSchema } from "@/lib/seo/jsonLd";
import { SITE, getSiteUrl } from "@/lib/seo/site";

/**
 * ── KROV typography ─────────────────────────────────────────────────────────
 *
 * Two families, one contrast. The pairing IS the brand's typographic signature
 * and carries as much recognition as the red does.
 *
 * Bodoni Moda — a Didone. Hairline serifs against fat vertical stems is the
 * highest stroke contrast in type, and on a near-black ground it reads the way
 * skin reads in a fashion editorial. It is set only at display sizes, where
 * that contrast is an asset rather than a legibility problem. Italic is loaded
 * because the emphasised word in every KROV headline is set in it.
 *
 * Jost — a geometric grotesque. Nearly every label in this interface is
 * uppercase at 10–11px with 0.2em+ tracking; a geometric with circular bowls
 * stays crisp at that size where a humanist blurs.
 *
 * Both are exposed as CSS variables rather than classNames, so the ~40
 * components already carrying `style={{ fontFamily: serif }}` pick up the real
 * face without any of them being touched.
 */
const display = Bodoni_Moda({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-krov-display",
});

const sans = Jost({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
  variable: "--font-krov-sans",
});

export const metadata: Metadata = {
  /**
   * The single most important line for SEO in this file. Without it Next emits
   * RELATIVE canonical and OpenGraph URLs, which social scrapers reject outright
   * and which make `alternates.canonical` meaningless.
   */
  metadataBase: new URL(getSiteUrl()),

  title: {
    // Page titles become "Catálogo · KROV Perfumería" automatically.
    default: `${SITE.name} — Perfumes originales en Costa Rica`,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  icons: {
    icon: "/Logo.png", // Busca la imagen dentro de la carpeta public/
    shortcut: "/Logo.png",
  },

  // Home page is the canonical root; every other route sets its own.
  alternates: { canonical: "/" },

  /*
   * Deliberately NO `title`/`description` here.
   *
   * Child routes inherit the parent's `openGraph` object wholesale, so pinning a
   * title at the root made every page share the generic one — /about and
   * /howtobuy were advertising the home page when shared. Omitting it lets Next
   * fall back to each route's own `title`/`description`, while siteName, locale
   * and type still inherit as intended.
   */
  openGraph: {
    type: "website",
    siteName: SITE.name,
    locale: SITE.locale,
    url: "/",
  },

  twitter: {
    card: "summary_large_image",
  },

  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      // Allow full rich previews — the default caps snippet/image size.
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },

  formatDetection: { telephone: false, address: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // lang is es-CR: regional targeting matters for a CR-only storefront.
    <html
      lang={SITE.lang}
      // `data-scroll-behavior` is required by Next 16 whenever the document
      // sets `scroll-behavior: smooth` (globals.css does): without it the router
      // smooth-scrolls on every route change, so a navigation appears to drift
      // rather than land. It silences the dev warning by fixing the cause.
      data-scroll-behavior="smooth"
      className={`h-full antialiased ${display.variable} ${sans.variable}`}
    >
      {/*
        `krov-grain` sits on the body, not on individual sections: the noise has
        to be continuous across the whole document, or the seam between two dark
        sections shows up as a change in texture.
      */}
      <body className="krov-grain min-h-full flex flex-col bg-krov-void text-krov-bone">
        {/*
          Keyboard users otherwise land on a fixed nav with five links before any
          content. Visually hidden until focused, then it appears as a proper
          KROV chip rather than a browser default outline.
        */}
        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-100 focus:bg-krov-blood focus:px-5 focus:py-3 focus:text-[11px] focus:uppercase focus:tracking-[0.24em] focus:text-krov-void"
        >
          Saltar al contenido
        </a>

        {/* Site-wide entity graph. Server-rendered so non-JS crawlers see it. */}
        <JsonLd data={[organizationSchema(), webSiteSchema()]} />

        <QueryProvider>
          <AuthListener />
          <Navbar />
          <main id="contenido" className="flex-1">
            {children}
          </main>
          <FooterGate>
            <Footer />
          </FooterGate>
        </QueryProvider>
      </body>
    </html>
  );
}
