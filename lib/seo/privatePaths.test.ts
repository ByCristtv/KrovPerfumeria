import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import robots from "@/app/robots";
import nextConfig from "../../next.config";
import {
  DISALLOWED_PATHS,
  NOINDEX_PATHS,
  isPrivatePath,
} from "./privatePaths";
import { PRODUCTION_URL } from "./site";

// At file level on purpose: `robots()` is called in a `describe` body, which runs
// at collection time, before any beforeEach. Vitest isolates env per file.
vi.stubEnv("NODE_ENV", "production");
vi.stubEnv("NEXT_PUBLIC_APP_URL", "");

describe("private path lists", () => {
  it("cover every private area the project has", () => {
    for (const area of [
      "/admin",
      "/api",
      "/auth",
      "/cart",
      "/checkout",
      "/friends",
      "/login",
      "/orders",
      "/profile",
      "/register",
      "/wholesale",
    ]) {
      expect(NOINDEX_PATHS).toContain(area);
    }
  });

  it("only block crawling for paths that are also noindexed", () => {
    for (const path of DISALLOWED_PATHS) expect(NOINDEX_PATHS).toContain(path);
  });

  it("leave the paths linked from every page crawlable, so their noindex can be read", () => {
    // robots.txt blocking /login would stop Google seeing its `noindex`, and a
    // blocked URL that is linked can still be listed as a bare result.
    for (const linked of ["/cart", "/login", "/register"]) {
      expect(DISALLOWED_PATHS).not.toContain(linked);
      expect(NOINDEX_PATHS).toContain(linked);
    }
  });

  it("isPrivatePath matches the prefix and its subtree, not look-alikes", () => {
    expect(isPrivatePath("/admin")).toBe(true);
    expect(isPrivatePath("/admin/orders/123")).toBe(true);
    expect(isPrivatePath("/checkout/sinpe/abc")).toBe(true);
    expect(isPrivatePath("/products")).toBe(false);
    expect(isPrivatePath("/products/profile-oil")).toBe(false);
    expect(isPrivatePath("/profiles")).toBe(false);
    expect(isPrivatePath("/")).toBe(false);
  });
});

describe("robots.txt", () => {
  const output = robots();
  const rules = Array.isArray(output.rules) ? output.rules : [output.rules];

  it("allows the site, disallows the private areas, and points at the sitemap", () => {
    expect(rules).toHaveLength(1);
    expect(rules[0].userAgent).toBe("*");
    expect(rules[0].allow).toBe("/");
    expect(rules[0].disallow).toEqual([...DISALLOWED_PATHS]);
    expect(output.sitemap).toBe(`${PRODUCTION_URL}/sitemap.xml`);
  });

  it("uses prefixes that really match the bare path, not just its subtree", () => {
    // `/cart/` would not block `/cart` itself — the old rule had that flaw.
    for (const rule of rules[0].disallow as string[]) {
      expect(rule.endsWith("/")).toBe(false);
    }
  });

  it("never blocks the assets a crawler needs to render the page", () => {
    for (const rule of rules[0].disallow as string[]) {
      expect(rule.startsWith("/_next")).toBe(false);
    }
    expect(rules[0].disallow).not.toContain("/");
  });

  it("does not block anything that is meant to rank", () => {
    for (const publicPath of [
      "/",
      "/products",
      "/products/lion",
      "/perfumes-arabes",
      "/decants",
      "/ranking",
      "/howtobuy",
      "/legal/privacidad",
    ]) {
      const blocked = (rules[0].disallow as string[]).some((rule) => publicPath.startsWith(rule));
      expect(blocked, publicPath).toBe(false);
    }
  });
});

describe("X-Robots-Tag safety net (next.config.ts)", () => {
  it("noindexes every private prefix and its whole subtree", async () => {
    const headers = await nextConfig.headers!();

    for (const prefix of NOINDEX_PATHS) {
      const rule = headers.find((h) => h.source === `${prefix}/:path*`);
      expect(rule, prefix).toBeDefined();
      expect(rule!.headers).toEqual([{ key: "X-Robots-Tag", value: "noindex, nofollow" }]);
    }
  });

  it("applies to nothing public", async () => {
    const headers = await nextConfig.headers!();
    for (const { source } of headers) {
      expect(isPrivatePath(source.replace("/:path*", ""))).toBe(true);
    }
  });
});

/* ── The meta-tag layer, checked against the real route tree ─────────────── */

const APP_DIR = path.resolve(process.cwd(), "app");
const NOINDEX_MARKER = /index:\s*false|NOINDEX_/;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const routeOf = (file: string) =>
  "/" + path.relative(APP_DIR, path.dirname(file)).split(path.sep).filter(Boolean).join("/");

/** Does the page, or any layout above it, declare a noindex? */
function declaresNoindex(pageFile: string): boolean {
  const dirs: string[] = [];
  for (let dir = path.dirname(pageFile); dir.startsWith(APP_DIR); dir = path.dirname(dir)) {
    dirs.push(dir);
    if (dir === APP_DIR) break;
  }
  const candidates = [
    pageFile,
    ...dirs.flatMap((dir) => ["layout.tsx", "layout.ts"].map((name) => path.join(dir, name))),
  ];
  return candidates.some(
    (file) => fs.existsSync(file) && NOINDEX_MARKER.test(fs.readFileSync(file, "utf8"))
  );
}

describe("page metadata across the real app/ tree", () => {
  const pages = walk(APP_DIR).filter((file) => /[\\/]page\.tsx$/.test(file));

  it("finds the route tree it is meant to check", () => {
    expect(pages.length).toBeGreaterThan(20);
  });

  it("declares noindex on every private page", () => {
    const missing = pages
      .map((file) => ({ file, route: routeOf(file) }))
      .filter(({ route }) => isPrivatePath(route))
      .filter(({ file }) => !declaresNoindex(file))
      .map(({ route }) => route);

    expect(missing).toEqual([]);
  });

  it("never noindexes the pages that are supposed to rank", () => {
    for (const file of ["page.tsx", "howtobuy/page.tsx", "ranking/page.tsx", "decants/page.tsx", "perfumes-arabes/page.tsx"]) {
      const source = fs.readFileSync(path.join(APP_DIR, file), "utf8");
      expect(NOINDEX_MARKER.test(source), file).toBe(false);
    }
  });

  it("keeps the root layout from pinning a canonical or og:url on every route", () => {
    const layout = fs.readFileSync(path.join(APP_DIR, "layout.tsx"), "utf8");
    // Comments explain the omission; strip them before looking for real config.
    const code = layout.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/canonical/);
    expect(code).not.toMatch(/url:\s*["']\/["']/);
  });
});
