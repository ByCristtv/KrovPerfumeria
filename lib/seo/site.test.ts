import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCAL_DELIVERY_AREA } from "@/lib/shipping/localDelivery";
import { PRODUCTION_URL, SITE, absoluteUrl, getSiteUrl } from "./site";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getSiteUrl", () => {
  it("uses the configured origin in development, trimming trailing slashes", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000///");
    expect(getSiteUrl()).toBe("http://localhost:3000");
  });

  it("falls back to localhost in development when unset", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(getSiteUrl()).toBe("http://localhost:3000");
  });

  it("honours a public https origin in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.krovperfumeria.com/");
    expect(getSiteUrl()).toBe("https://staging.krovperfumeria.com");
  });

  it("never lets localhost into a production build", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    expect(getSiteUrl()).toBe(PRODUCTION_URL);
  });

  it("falls back to the production domain when the variable is missing, plain http or malformed", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const value of ["", "http://www.krovperfumeria.com", "not a url", "https://localhost"]) {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", value);
      expect(getSiteUrl()).toBe(PRODUCTION_URL);
    }
  });
});

describe("PRODUCTION_URL", () => {
  it("is the real https www origin, with no trailing slash", () => {
    expect(PRODUCTION_URL).toBe("https://www.krovperfumeria.com");
  });
});

describe("absoluteUrl", () => {
  it("joins with exactly one slash whether or not the path starts with one", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(absoluteUrl("/products")).toBe(`${PRODUCTION_URL}/products`);
    expect(absoluteUrl("products")).toBe(`${PRODUCTION_URL}/products`);
    expect(absoluteUrl("/")).toBe(`${PRODUCTION_URL}/`);
  });
});

describe("SITE", () => {
  it("keeps the meta description inside the SERP limit", () => {
    expect(SITE.description.length).toBeLessThanOrEqual(160);
  });

  it("keeps the home title short enough to avoid truncation", () => {
    expect(SITE.homeTitle.length).toBeLessThanOrEqual(65);
  });

  it("targets Costa Rica in Spanish", () => {
    expect(SITE.lang).toBe("es-CR");
    expect(SITE.locale).toBe("es_CR");
    expect(SITE.currency).toBe("CRC");
  });

  it("publishes the same town the store actually delivers from", () => {
    // The structured-data address must not drift from the shipping rule.
    expect(SITE.address.locality).toBe(LOCAL_DELIVERY_AREA.districtName);
    expect(SITE.address.canton).toBe(LOCAL_DELIVERY_AREA.cantonName);
    expect(SITE.address.region).toBe(LOCAL_DELIVERY_AREA.provinceName);
  });
});
