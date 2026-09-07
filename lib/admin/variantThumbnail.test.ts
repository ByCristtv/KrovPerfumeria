import { describe, it, expect } from "vitest";
import { resolveVariantThumbnail } from "./variantThumbnail";

const VARIANT = "variant-1";
const OTHER_VARIANT = "variant-2";

describe("resolveVariantThumbnail", () => {
  it("uses the parent product's first image — the normal case", () => {
    // Images are parent-scoped today (features/admin/productImages.ts), and the
    // lowest position is the one the public catalog card shows.
    const url = resolveVariantThumbnail(VARIANT, [
      { url: "https://cdn/second.jpg", position: 1, variant_id: null },
      { url: "https://cdn/main.jpg", position: 0, variant_id: null },
    ]);

    expect(url).toBe("https://cdn/main.jpg");
  });

  it("prefers an image scoped to this variant over the parent's", () => {
    const url = resolveVariantThumbnail(VARIANT, [
      { url: "https://cdn/parent.jpg", position: 0, variant_id: null },
      { url: "https://cdn/mine.jpg", position: 5, variant_id: VARIANT },
    ]);

    expect(url).toBe("https://cdn/mine.jpg");
  });

  it("orders variant-scoped images by position too", () => {
    const url = resolveVariantThumbnail(VARIANT, [
      { url: "https://cdn/mine-b.jpg", position: 3, variant_id: VARIANT },
      { url: "https://cdn/mine-a.jpg", position: 1, variant_id: VARIANT },
    ]);

    expect(url).toBe("https://cdn/mine-a.jpg");
  });

  it("ignores images belonging to a sibling variant", () => {
    const url = resolveVariantThumbnail(VARIANT, [
      { url: "https://cdn/sibling.jpg", position: 0, variant_id: OTHER_VARIANT },
      { url: "https://cdn/parent.jpg", position: 1, variant_id: null },
    ]);

    expect(url).toBe("https://cdn/parent.jpg");
  });

  it("returns null when only a sibling's image exists", () => {
    const url = resolveVariantThumbnail(VARIANT, [
      { url: "https://cdn/sibling.jpg", position: 0, variant_id: OTHER_VARIANT },
    ]);

    expect(url).toBeNull();
  });

  it("returns null when the product has no images", () => {
    expect(resolveVariantThumbnail(VARIANT, [])).toBeNull();
  });

  it("tolerates a missing or null image relation", () => {
    expect(resolveVariantThumbnail(VARIANT, null)).toBeNull();
    expect(resolveVariantThumbnail(VARIANT, undefined)).toBeNull();
  });

  it("skips rows with a blank url so an empty src never reaches next/image", () => {
    const url = resolveVariantThumbnail(VARIANT, [
      { url: "   ", position: 0, variant_id: null },
      { url: "https://cdn/real.jpg", position: 1, variant_id: null },
    ]);

    expect(url).toBe("https://cdn/real.jpg");
  });

  it("treats a missing variant_id key as parent-scoped", () => {
    // PostgREST omits the column when a caller doesn't select it.
    const url = resolveVariantThumbnail(VARIANT, [
      { url: "https://cdn/parent.jpg", position: 0 },
    ]);

    expect(url).toBe("https://cdn/parent.jpg");
  });

  it("does not mutate the caller's array", () => {
    const images = [
      { url: "https://cdn/b.jpg", position: 2, variant_id: null },
      { url: "https://cdn/a.jpg", position: 1, variant_id: null },
    ];

    resolveVariantThumbnail(VARIANT, images);

    expect(images.map((i) => i.url)).toEqual([
      "https://cdn/b.jpg",
      "https://cdn/a.jpg",
    ]);
  });
});
