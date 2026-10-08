import { describe, expect, it, vi } from "vitest";
import { makeProduct } from "@/test/helpers/seoFixtures";
import { serializeJsonLd } from "@/components/seo/JsonLd";
import {
  breadcrumbSchema,
  organizationSchema,
  productGroupSchema,
  webSiteSchema,
  type JsonLdNode,
} from "./jsonLd";
import { productSchemaInput } from "./product";
import { PRODUCTION_URL } from "./site";

// At file level on purpose: the schemas below are built in `describe` bodies,
// which run at collection time, before any beforeEach. Vitest isolates env per file.
vi.stubEnv("NODE_ENV", "production");
vi.stubEnv("NEXT_PUBLIC_APP_URL", "");

interface VariantNode {
  "@type": string;
  size: string;
  offers: {
    "@type": string;
    price: number;
    priceCurrency: string;
    availability: string;
    url: string;
  };
}

const variantsOf = (schema: JsonLdNode) => schema.hasVariant as VariantNode[];

/** Every `url`/`item`/`@id`/`logo` string in a node, recursively. */
function collectUrls(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => collectUrls(n, out));
  else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (["url", "item", "@id", "logo"].includes(key) && typeof value === "string") {
        out.push(value);
      } else collectUrls(value, out);
    }
  }
  return out;
}

describe("organizationSchema", () => {
  const org = organizationSchema();

  it("is an OnlineStore — the subtype Google recommends for e-commerce", () => {
    expect(org["@type"]).toBe("OnlineStore");
  });

  it("carries the real identity: logo, phone and locality", () => {
    expect(org.logo).toBe(`${PRODUCTION_URL}/KrovIcon.png`);
    expect(org.telephone).toBe("+50671434066");
    expect(org.address).toMatchObject({
      "@type": "PostalAddress",
      addressLocality: "Cariari",
      addressRegion: "Limón",
      addressCountry: "CR",
    });
  });

  it("does not invent data the project doesn't have", () => {
    expect(org).not.toHaveProperty("streetAddress");
    expect(org).not.toHaveProperty("geo");
    expect(org).not.toHaveProperty("openingHours");
    expect(org).not.toHaveProperty("aggregateRating");
    expect(org).not.toHaveProperty("review");
    expect(org).not.toHaveProperty("email"); // the footer's address is a placeholder
  });
});

describe("webSiteSchema", () => {
  it("names the site and references the organization", () => {
    const site = webSiteSchema();
    expect(site["@type"]).toBe("WebSite");
    expect(site.inLanguage).toBe("es-CR");
    expect(site.publisher).toEqual({ "@id": organizationSchema()["@id"] });
  });

  it("omits the retired sitelinks search box", () => {
    expect(webSiteSchema()).not.toHaveProperty("potentialAction");
  });
});

describe("productGroupSchema", () => {
  const schema = productGroupSchema(productSchemaInput(makeProduct()));
  const variants = variantsOf(schema);

  it("is a ProductGroup varying by size, not an AggregateOffer", () => {
    expect(schema["@type"]).toBe("ProductGroup");
    expect(schema.variesBy).toEqual(["https://schema.org/size"]);
    expect(JSON.stringify(schema)).not.toContain("AggregateOffer");
  });

  it("gives every variant its own Offer in CRC", () => {
    expect(variants).toHaveLength(3);
    for (const variant of variants) {
      expect(variant["@type"]).toBe("Product");
      expect(variant.offers["@type"]).toBe("Offer");
      expect(variant.offers.priceCurrency).toBe("CRC");
      expect(typeof variant.offers.price).toBe("number");
      expect(variant.offers.price).toBeGreaterThan(0);
    }
  });

  it("states availability per variant, from the real stock rule", () => {
    // Decants have stock 0 on the row; the ml pool makes them sellable.
    expect(variants.map((v) => v.offers.availability)).toEqual([
      "https://schema.org/InStock",
      "https://schema.org/InStock",
      "https://schema.org/InStock",
    ]);

    const soldOut = productGroupSchema(
      productSchemaInput(
        makeProduct({
          decant_stock_ml: 0,
          product_variants: [{ ...makeProduct().product_variants[2], stock: 0 }],
        })
      )
    );
    expect(variantsOf(soldOut)[0].offers.availability).toBe(
      "https://schema.org/OutOfStock"
    );
  });

  it("uses the live offer price, matching the visible page", () => {
    const bottle = variants.find((v) => v.size === "100 ml")!;
    expect(bottle.offers.price).toBe(19_500);
  });

  it("points every URL at the canonical production page, without a query string", () => {
    const urls = collectUrls(schema);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.startsWith(PRODUCTION_URL)).toBe(true);
      expect(url).not.toContain("?");
    }
    expect(schema.url).toBe(`${PRODUCTION_URL}/products/lion`);
  });

  it("describes only real attributes — no ratings, reviews or GTINs", () => {
    const json = JSON.stringify(schema);
    for (const forbidden of ["aggregateRating", "review", "gtin", "mpn", "itemCondition"]) {
      expect(json).not.toContain(forbidden);
    }
    expect(schema.brand).toEqual({ "@type": "Brand", name: "Rayhaan" });
  });

  it("drops absent optional fields instead of emitting empty ones", () => {
    const bare = productGroupSchema(
      productSchemaInput(makeProduct({ brands: null, description: null, product_images: [] }))
    );
    const parsed = JSON.parse(JSON.stringify(bare));
    expect(parsed).not.toHaveProperty("brand");
    expect(parsed).not.toHaveProperty("description");
    expect(parsed).not.toHaveProperty("image");
  });
});

describe("breadcrumbSchema", () => {
  it("numbers the trail from 1 and uses absolute canonical URLs", () => {
    const crumbs = breadcrumbSchema([
      { name: "KROV", path: "/" },
      { name: "Colección", path: "/products" },
      { name: "Lion", path: "/products/lion" },
    ]);
    const items = crumbs.itemListElement as Array<Record<string, unknown>>;

    expect(items.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(items.map((i) => i.item)).toEqual([
      `${PRODUCTION_URL}/`,
      `${PRODUCTION_URL}/products`,
      `${PRODUCTION_URL}/products/lion`,
    ]);
  });
});

describe("serializeJsonLd", () => {
  it("round-trips as valid JSON", () => {
    const nodes: JsonLdNode[] = [organizationSchema(), webSiteSchema()];
    expect(JSON.parse(serializeJsonLd(nodes))).toEqual(JSON.parse(JSON.stringify(nodes)));
  });

  it("cannot be broken out of its <script> by database text", () => {
    const hostile = productGroupSchema(
      productSchemaInput(
        makeProduct({
          name: "</script><script>alert(1)</script>",
          description: "<!-- x --> <img src=x onerror=alert(1)>",
        })
      )
    );
    const out = serializeJsonLd(hostile);

    expect(out).not.toContain("<");
    expect(out.toLowerCase()).not.toContain("</script");
    // …and the original text survives intact once parsed.
    expect(JSON.parse(out).name).toBe("</script><script>alert(1)</script>");
  });
});
