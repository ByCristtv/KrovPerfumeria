import { describe, expect, it } from "vitest";
import {
  NOINDEX_FOLLOW,
  NOINDEX_NOFOLLOW,
  buildPageMetadata,
  truncateDescription,
} from "./metadata";

describe("buildPageMetadata", () => {
  const base = {
    title: "Catálogo",
    description: "Una descripción.",
    path: "/products",
  };

  it("sets canonical, og:url and the social cards together, and they agree", () => {
    const meta = buildPageMetadata(base);

    expect(meta.alternates?.canonical).toBe("/products");
    expect(meta.openGraph?.url).toBe("/products");
    expect(meta.openGraph).toMatchObject({
      type: "website",
      siteName: "KROV Perfumería",
      locale: "es_CR",
      description: "Una descripción.",
    });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("gives social cards the branded title the root template can't reach", () => {
    const meta = buildPageMetadata(base);
    expect(meta.title).toBe("Catálogo");
    expect(meta.openGraph?.title).toBe("Catálogo · KROV Perfumería");
    expect(meta.twitter?.title).toBe("Catálogo · KROV Perfumería");
  });

  it("does not double the brand when the title is already complete", () => {
    const meta = buildPageMetadata({
      ...base,
      title: "Perfumes | KROV Perfumería",
      absoluteTitle: true,
    });
    expect(meta.title).toEqual({ absolute: "Perfumes | KROV Perfumería" });
    expect(meta.openGraph?.title).toBe("Perfumes | KROV Perfumería");
  });

  it("leaves images unset so the site-wide share card still applies", () => {
    const meta = buildPageMetadata(base);
    expect(meta.openGraph).not.toHaveProperty("images");
    expect(meta.twitter).not.toHaveProperty("images");
  });

  it("passes product images through to both cards", () => {
    const meta = buildPageMetadata({
      ...base,
      images: [{ url: "https://cdn.example/a.webp", alt: "A" }],
    });
    expect(meta.openGraph?.images).toEqual([
      { url: "https://cdn.example/a.webp", alt: "A" },
    ]);
    expect(meta.twitter?.images).toEqual(["https://cdn.example/a.webp"]);
  });

  it("names no canonical or og:url on a noindexed page", () => {
    const meta = buildPageMetadata({ ...base, robots: NOINDEX_FOLLOW });

    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.alternates).toBeUndefined();
    expect(meta.openGraph).not.toHaveProperty("url");
  });

  it("treats a string robots directive containing noindex the same way", () => {
    const meta = buildPageMetadata({ ...base, robots: "noindex, follow" });
    expect(meta.alternates).toBeUndefined();
  });

  it("keeps the canonical when robots only tunes snippets", () => {
    const meta = buildPageMetadata({ ...base, robots: { index: true, follow: true } });
    expect(meta.alternates?.canonical).toBe("/products");
  });
});

describe("robots presets", () => {
  it("noindex-follow keeps links followable; noindex-nofollow does not", () => {
    expect(NOINDEX_FOLLOW).toEqual({ index: false, follow: true });
    expect(NOINDEX_NOFOLLOW).toEqual({ index: false, follow: false });
  });
});

describe("truncateDescription", () => {
  it("returns short text unchanged, collapsing whitespace", () => {
    expect(truncateDescription("  hola \n  mundo ")).toBe("hola mundo");
  });

  it("cuts on a word boundary within the limit and ends with an ellipsis", () => {
    const long = "palabra ".repeat(40);
    const out = truncateDescription(long, 60);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/palabr…$/);
  });

  it("does not leave dangling punctuation before the ellipsis", () => {
    const out = truncateDescription("Uno, dos, tres, cuatro, cinco, seis, siete", 20);
    expect(out).not.toMatch(/[,;:.]…$/);
  });
});
