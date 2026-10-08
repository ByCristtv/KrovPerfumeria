# SEO — how it works and how to keep it right

Production origin: `https://www.krovperfumeria.com` · language `es-CR` · currency `CRC`.

## Where things live

| Concern | File |
| --- | --- |
| Site identity, origin, description | `lib/seo/site.ts` |
| Per-page metadata (title, canonical, og:url, cards, robots) | `lib/seo/metadata.ts` → `buildPageMetadata` |
| JSON-LD builders (OnlineStore, WebSite, ProductGroup, BreadcrumbList) | `lib/seo/jsonLd.ts`, rendered by `components/seo/JsonLd.tsx` |
| Product title / description / images / schema input | `lib/seo/product.ts` |
| Catalog URL rules (which views are indexable) | `lib/seo/catalog.ts` |
| Curated landings (`/perfumes-arabes`, `/decants`) | `lib/seo/landings.ts` |
| Sitemap rules / route | `lib/seo/sitemap.ts` / `app/sitemap.ts` |
| Private paths (robots.txt, `X-Robots-Tag`, tests) | `lib/seo/privatePaths.ts` |
| robots.txt | `app/robots.ts` |
| Tests | `lib/seo/*.test.ts`, `components/home/Hero.test.tsx`, `components/catalog/CatalogHero.test.tsx` |

## Rules worth knowing

- **Every indexable page sets its own metadata through `buildPageMetadata`.** The root layout deliberately has no `canonical` and no `og:url`: Next merges metadata shallowly, so anything set there is inherited by every route that doesn't override it (it once made `/legal/*` canonical to the home page).
- **Environment.** `NEXT_PUBLIC_APP_URL` is honoured in development. In production it is used only if it is a public `https` origin; otherwise the production domain above is used, so `localhost` can never reach a canonical, the sitemap or JSON-LD. Optional: `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` emits the Search Console HTML-tag verification.
- **Structured data describes only what the page shows.** Prices are the live price (offer price while the offer is on), availability uses `lib/stock.ts` (decant stock lives in the parent's ml pool, not on the variant), and no ratings, reviews, GTINs, street address, hours or email are emitted because the project has none. Don't add them without real data.
- **Product pages.** A product with no active variant renders the 404 page, so its metadata is `noindex` and it is left out of the sitemap. Keep `isListableProduct` as the single definition.
- **Catalog URLs.** `/products` and `?page=N` index and self-canonicalise. Any URL with `q`, `category`, `type`, `offer`, `wholesale` or `sort` is `noindex, follow`. Tracking params are ignored (canonical points at the clean URL).
- **Landings** are filtered views of the real catalog, not hand-written pages. A landing with no products is `noindex` and not in the sitemap. To add one, add an entry to `LANDINGS`, a route file next to `app/decants/page.tsx`, and it is picked up by the footer, the sitemap and the tests.
- **Private routes** are protected in three layers (`privatePaths.ts`): an `X-Robots-Tag: noindex` header from `next.config.ts` (covers everything, including route handlers), a `noindex` meta on each page, and a `robots.txt` Disallow. `/cart`, `/login` and `/register` are intentionally **not** disallowed: they are linked from every page, and a crawler blocked by robots.txt never sees their `noindex`, so the URL could still be listed. A test fails if a private page is added without a `noindex`.
- **Loading skeletons must not contain an `<h1>`.** They are streamed as the Suspense fallback and end up in the initial HTML of the routes they wrap (`app/products/loading.tsx` wraps every product page).

## Checks

```bash
pnpm exec tsc --noEmit && pnpm lint && pnpm test && pnpm build
```

After `pnpm build && pnpm start`, spot-check `/robots.txt`, `/sitemap.xml`, and the `<head>` of `/`, `/products`, `/products/<slug>`, `/decants` (`curl -s <url> | grep -E "canonical|og:url|robots"`).

External tools (not automatable here): Google Rich Results Test and Schema Markup Validator for the JSON-LD, Search Console's URL Inspection and Page Indexing report, PageSpeed Insights / CrUX for Core Web Vitals.
