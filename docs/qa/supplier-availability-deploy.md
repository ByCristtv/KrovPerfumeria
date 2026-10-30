# Deploy checklist — Supplier availability ("Por encargo")

Migration: `supabase/migrations/20261029000100_supplier_availability.sql`
Automated DB suite: `supabase/tests/20261029000100_supplier_availability_test.sql`
Prepared against: HEAD `a85b87d` + the uncommitted change set in §1 · 2026-10-29

> **Status: NOT DEPLOYED.** Nothing in this document has been run against
> production. The migration and the DB suite were run on the **TESTING**
> project only (`phhrvqqlvgapbiodwpwy`), where the suite printed
> `ALL SUPPLIER AVAILABILITY TESTS PASSED`. Production is
> `xabzbvanmqeplenfoozx`. Every step below is yours to run, deliberately.

---

## 0. The whole plan on one screen

```
1  Back up           confirm a recent production backup exists
2  Pre-flight        read-only queries on PRODUCTION  (§5.2)
3  Migration         paste the one SQL file in Studio  (§5.3)        ← DATABASE FIRST
4  Verify            4 verification queries + the DB suite (§5.4)
5  Ship the code     commit → push → Vercel builds & deploys (§5.5)  ← CODE SECOND
6  Smoke test        the live-site checks in §8
7  Populate          flag real made-to-order products in /admin/products (§6)
```

**One rule decides everything: the database moves first on the way in, and last
on the way out.**

| Direction | Order |
|---|---|
| Deploy | migration → code |
| Roll back | code → (almost never) migration |

Why the order is not negotiable is in §3.

---

## 1. What ships

One migration, **additive only** — it adds two columns and one CHECK to
`product_variants` and changes nothing else (no RLS, no trigger, no RPC, no
existing column).

| Object | Detail |
|---|---|
| `product_variants.supplier_available` | `BOOLEAN NOT NULL DEFAULT FALSE` |
| `product_variants.supplier_checked_at` | `TIMESTAMPTZ NULL` |
| `chk_decant_not_supplier_available` | `CHECK (NOT supplier_available OR product_type <> 'decant')` |

Application change set (19 modified files and 19 new paths — 20 files counting this
checklist; `git status` is the source of truth):

- **Logic:** `lib/stock.ts` (`resolveAvailability`), `lib/whatsapp/productInquiry.ts`
- **Storefront:** `ProductCard`, `ProductDetailView`, `PurchasePanel`, `InquiryButton`,
  `StockBadge`, `StickyPurchaseBar`, `VariantSelector`, `useProductSelection`,
  `useCartStore`, the catalog/detail queries (`getProducts`, `getProductBySlug`)
- **Admin:** `app/admin/products/actions.ts` (new Server Action),
  `ProductListAdmin`, `AdminProductsView`, `getProductsAdminPage`
- **Types:** `types/product.ts`, `types/database.ts`
- **Tests:** 16 test files (14 new, 2 updated), and the SQL suite above

### Commit hygiene — `types/database.ts` mixes two features

The working copy of `types/database.ts` carries **your uncommitted ONVO webhook
ledger columns** (`processed_webhooks.attempts`, `locked_until`, …) *and* this
feature's six lines. Stage it with `git add -p` if you want them in separate
commits. Do **not** regenerate it with `pnpm update-types` to "tidy up" before
the production migration is applied: the script now targets TESTING
(`--project-id phhrvqqlvgapbiodwpwy`), so it would drop any production-only
shape and, pointed at a project without the columns, delete the supplier fields.

---

## 2. Decisions to make before you deploy

| # | Decision | Recommendation |
|---|---|---|
| 1 | **Footer/contact/SINPE WhatsApp links drop the `506`.** `CONTACT.whatsapp` is `https://wa.me/71434066`; the `wa.me/<country code + number>` format needs `50671434066`. Product inquiries already use the correct number (`INQUIRY_WHATSAPP_NUMBER`), so this does **not** block the feature. | Fix `components/contact/contactData.ts` in a **separate** commit once you confirm the number; the file's "do not edit" comment predates this finding. |
| 2 | **`NEXT_PUBLIC_APP_URL` on Vercel (Production).** It becomes the origin of the product link inside every WhatsApp inquiry (§4). | Set to `https://www.krovperfumeria.com` or leave unset (the code then falls back to that same origin). |
| 3 | **Re-verification cadence.** Supplier stock goes stale. The admin screen shows the date of the last check but nothing enforces freshness. | Pick a rhythm (e.g. weekly) and use **Reconfirmar** (§6). The audit query in §6.4 lists stale rows. |
| 4 | **The sale itself.** A made-to-order customer is never charged on the site. After the supplier confirms, there is no in-app "complete this sale" path. | Operational: register the stock when it arrives (stock panel), then the customer buys online, or you create a manual order. Decide this before you flag products. |

---

## 3. Backward compatibility — which side may be ahead

| | **DB without columns** (before migration) | **DB with columns** (after migration) |
|---|---|---|
| **Old app** (currently deployed) | Works (today). | **Works.** Old code never mentions the columns (`git grep supplier HEAD` finds nothing outside `supabase/`); every write to `product_variants` at HEAD names its columns explicitly; `select("*")` is read-only. New columns default to `false`. |
| **New app** (this change) | **Breaks the storefront** — see below. | Works. |

**Why the migration must go first.** The new catalog and detail queries select
`sku, supplier_available`. Against a database without the column PostgREST
answers `42703`, and both queries are written to swallow errors:

- `getCatalogPage` logs and returns an **empty catalog** (`/products`,
  `/decants`, `/perfumes-arabes`);
- `getProductBySlug` returns `null`, so **every product page is a 404**;
- the **home page** is prerendered at *build* time (`FeaturedCollection` →
  `getProductsPage(0, 8)`), so a Vercel build that runs before the migration
  bakes an empty featured section into `/` until its 5-minute revalidation.

This was reproduced on TESTING before the migration was applied
(`42703: column product_variants.supplier_available does not exist`).

What tolerates a missing migration, by design: the admin products table (shows
"—" and no controls) and the Server Action (answers "Falta aplicar la migración
…"). The storefront does not.

Also unchanged and unaffected: `place_order` and `decrease_variant_stock` (they
refuse any line whose stock is short, and never read the new columns), the ONVO
and SINPE flows, order notifications, loyalty/XP, coupons, and shipping.

**Unverified in this repo:** the `create_new_product` RPC (used by "+ Nuevo
Producto") is not in `supabase/migrations`, so its body cannot be inspected here.
It inserts a variant; because the new columns have defaults it works unless it
uses a *positional* insert with no column list. §5.2 step P4 reads it for you,
and §8 S11 exercises it.

---

## 4. Environment variables

**None are new. Nothing needs to be added, rotated or exposed.**

| Variable | Used by this feature | Action |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `absoluteUrl()` → the product link in the WhatsApp message | Confirm the Production value (decision 2). In production builds it is honored only if it is a public `https` origin; otherwise the code uses `https://www.krovperfumeria.com`. A preview URL *is* a public https origin, so inquiries sent from a preview deployment link to that preview. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | existing public client | unchanged — confirm they point at **production**, not TESTING |

The new admin Server Action uses the signed-in admin's own session through the
request-bound server client. It does **not** use the service-role key, and no
client code imports one.

---

## 5. Runbook

### 5.1 Before you touch production

- [ ] `pnpm test` → all pass (last run: 107 files, 1437 tests)
- [ ] `pnpm lint` → 0 errors
- [ ] `pnpm build` → succeeds (last run: Next 16.2.6, 34/34 static pages)
- [ ] `npx tsc --noEmit` → only the 15 known errors in `app/api/profile/avatar/route.test.ts`
- [ ] A recent **production backup** exists (Supabase dashboard → Database → Backups). Note the timestamp. If your plan has point-in-time recovery, note the time you start.
- [ ] Decisions in §2 made (at least 1 and 2).

### 5.2 Pre-flight on **production** (read-only — nothing is changed)

Paste into the production SQL editor, one block at a time.

```sql
-- P1. The supplier columns must NOT exist yet.            expect: 0 rows
SELECT column_name
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'product_variants'
   AND column_name IN ('supplier_available', 'supplier_checked_at');

-- P2. Write policies on product_variants are admin-only.  expect: every INSERT /
--     UPDATE / DELETE / ALL row mentions is_admin(); no other writer.
SELECT policyname, cmd, roles, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'product_variants'
 ORDER BY cmd, policyname;

-- P3. The purchase gate exists in the LIVE database.      expect: both true
--     (If this errors, a function is missing — STOP and investigate.)
SELECT
  pg_get_functiondef('public.decrease_variant_stock(uuid,integer,uuid)'::regprocedure)
    ILIKE '%Insufficient stock%'        AS stock_guard_present,
  pg_get_functiondef('public.place_order(jsonb)'::regprocedure)
    ILIKE '%decrease_variant_stock%'    AS place_order_uses_it;

-- P4. How create_new_product inserts variants.            expect: an explicit column list,
--     i.e.  INSERT INTO public.product_variants ( … columns … )  — not a bare VALUES (…)
SELECT pg_get_functiondef(p.oid)
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'create_new_product';

-- P5. The enum the new CHECK refers to.                   expect: decant is listed
SELECT unnest(enum_range(NULL::public.product_type));
```

**Go / no-go:** P1 returns no rows · P2 shows no non-admin writer · P3 both `true` ·
P4 uses a column list · P5 lists `decant`. Anything else: stop and ask.

### 5.3 Apply the migration (production)

- [ ] Open `supabase/migrations/20261029000100_supplier_availability.sql`, paste **the
      whole file** into the production SQL editor, run once.
- [ ] It is idempotent (`ADD COLUMN IF NOT EXISTS`, guarded constraint) and
      metadata-only for existing rows (constant default — no table rewrite), so a
      re-run is harmless.

### 5.4 Verify the migration

```sql
-- V1. Shape.   expect: supplier_available boolean NO 'false'; supplier_checked_at
--              timestamp with time zone YES (null)
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'product_variants'
   AND column_name IN ('supplier_available', 'supplier_checked_at')
 ORDER BY column_name;

-- V2. Constraint present and validated.   expect: one row, convalidated = true
SELECT conname, convalidated, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conrelid = 'public.product_variants'::regclass
   AND conname = 'chk_decant_not_supplier_available';

-- V3. Nothing is advertised as made-to-order yet.   expect: flagged = 0
SELECT count(*) FILTER (WHERE supplier_available) AS flagged,
       count(*)                                    AS total_variants
  FROM public.product_variants;
```

- [ ] V1–V3 as expected (V3 `flagged = 0` is the **safe-initialization proof**).
- [ ] Run `supabase/tests/20261029000100_supplier_availability_test.sql` on production.
      It runs inside `BEGIN … ROLLBACK` and leaves nothing behind (same property as
      the guest-XP suite). Expect `ALL SUPPLIER AVAILABILITY TESTS PASSED`; open the
      editor's **Messages/Notices** panel and note any `SKIP` lines. Test 8 (the
      purchase checks) skips *as a whole* only if `place_order` is not deployed; test
      8h — the control purchase of an in-stock flagged variant — skips if that order is
      rejected (e.g. no shipping seed), while the refusal checks 8a–8g still run.
      If **test 7** or **6g–6i** fail, production has a non-admin write policy on
      `product_variants`: do not continue until it is understood.

### 5.5 Ship the code

- [ ] Commit (see "Commit hygiene" in §1). Confirm `git status` shows only intended files.
- [ ] Push / merge as you normally do; Vercel builds. Because the migration is already
      applied, the build-time prerender of `/` sees the columns.
- [ ] Do **not** promote a build that finished *before* step 5.3.

### 5.6 After deploy

Run §8 (smoke tests), then §6 (populate). Watch the Vercel runtime logs for
`42703`, `supplier_` or `Falta aplicar` for the first 15 minutes.

---

## 6. Populating and verifying supplier availability

### 6.1 Safe initial state

Every existing variant becomes `supplier_available = false`,
`supplier_checked_at = NULL` ("Sin verificar"). A zero-stock product therefore stays
**"Agotado"** until you verify it on the supplier's site and flip it. **Nothing is
advertised as made-to-order by the deploy itself** (check V3).

### 6.2 Normal procedure — the admin screen

`/admin/products` → **Proveedor** column (next to **Stock propio**, which is
KROV's own inventory and is never touched by this control).

1. Open the supplier's website and find the perfume and size.
2. In the row, press **Marcar disponible** (supplier has it) or **Marcar agotado**
   (supplier does not). The date under the state is when you checked.
3. Read the **En tienda** line: it is what customers will see.
   *No own stock + supplier available → "Por encargo".* *Own stock > 0 → "En stock"
   whatever the flag says* (physical stock always wins).
4. Re-check later with **Reconfirmar** — it re-stamps the date without changing the answer.

Rules of thumb: only bottles and sets are flagged (decants show "No aplica" — they
sell from the shared ml pool, and the database refuses to flag them); flag only what
you actually saw; a product with no own stock and no recent check should be
"Agotado", not "Por encargo".

### 6.3 Bulk alternative — SQL (Studio)

For many SKUs at once. Always set the date together with the flag.

```sql
UPDATE public.product_variants
   SET supplier_available = true, supplier_checked_at = now()
 WHERE sku IN ('SKU-1', 'SKU-2')          -- the SKUs you verified today
   AND product_type <> 'decant';
```

SQL edits do not call `revalidatePath`; `/products*` pages are dynamic and update
at once, but the cached home page can lag up to 5 minutes (toggling any row in the
admin screen refreshes it immediately).

### 6.4 Audit queries

```sql
-- What every active variant is on the storefront right now.
-- (Mirrors resolveAvailability in lib/stock.ts: stock wins; decants use the pool only.)
SELECT p.slug, pv.sku, pv.product_type, pv.size_ml, pv.stock,
       pv.supplier_available, pv.supplier_checked_at,
       CASE
         WHEN pv.product_type = 'decant' THEN
           CASE WHEN floor(p.decant_stock_ml / pv.size_ml) > 0
                THEN 'in_stock' ELSE 'sold_out' END
         WHEN pv.stock > 0          THEN 'in_stock'
         WHEN pv.supplier_available THEN 'made_to_order'
         ELSE                            'sold_out'
       END AS storefront_state
  FROM public.product_variants pv
  JOIN public.products p ON p.id = pv.product_id
 WHERE pv.is_active AND p.is_active
 ORDER BY storefront_state, p.slug, pv.size_ml;

-- Flags that are old or were set without a date — re-verify these.
SELECT sku, supplier_checked_at, now() - supplier_checked_at AS age
  FROM public.product_variants
 WHERE supplier_available
   AND (supplier_checked_at IS NULL OR supplier_checked_at < now() - interval '7 days')
 ORDER BY supplier_checked_at NULLS FIRST;
```

---

## 7. Rollback and recovery

Because the migration is backward compatible, **rolling the code back never
requires touching the database.**

| Symptom | Likely cause | Fix |
|---|---|---|
| Catalog empty / every product 404 right after deploy | Code is live but the migration is not applied (or went to the wrong project) | Apply §5.3 now — it is idempotent. Dynamic pages recover immediately; the cached home page within ~5 minutes (or redeploy). |
| Admin "Proveedor" shows "—" on every row | Same | Same |
| Toggle answers "Falta aplicar la migración…" | Same | Same |
| A product wrongly shows **Por encargo** | Mistaken flag | Admin: **Marcar agotado** — or the kill switch below |
| Need the feature off storefront-wide, fast | — | **Kill switch** (data only, no deploy) |
| Code defect after deploy | — | Promote the previous deployment in the Vercel dashboard. Leave the database alone (the old app runs fine on the new columns). |
| DB rollback (last resort) | — | Roll the code back **first**, then the block at the bottom of the migration file (`DROP CONSTRAINT`, `DROP COLUMN`). **It discards every flag and date** — export them first. |

**Kill switch** — turns every made-to-order product back into "Agotado":

```sql
-- 0. Export first, so the flags can be restored:
SELECT sku, supplier_available, supplier_checked_at
  FROM public.product_variants WHERE supplier_available;

-- 1. Switch them all off (dates are kept):
UPDATE public.product_variants SET supplier_available = false WHERE supplier_available;
```

Nothing a customer does can create a made-to-order *order*: the inquiry is a link
to WhatsApp, and a forged checkout is refused by the database (stock 0). So there is
no order data to unwind in any of the cases above.

---

## 8. Live-site smoke tests (after §5.5)

Use a real browser on the production domain. **Do not complete a payment** unless
you deliberately choose to (S3 option).

- [ ] **S1 Home** loads and the featured section shows 8 cards.
- [ ] **S2 Catalog** `/products`: cards render, a category filter, search and page 2 work.
- [ ] **S3 In-stock purchase flow.** On a product with stock: the card's **+** and the
      detail page's **Agregar al carrito** both add it; `/cart` shows it with the right
      price; `/checkout` loads. *(Optional, your call: place one real SINPE test order and
      cancel it from `/admin/orders`, to see owner + customer emails unchanged.)*
- [ ] **S4 Sold out.** A zero-stock, unflagged bottle says **Agotado** on the card, the
      detail page and the mobile bar; every control is disabled; no WhatsApp link.
- [ ] **S5 Decants.** A decant's sizes are selectable and one adds to the cart.
- [ ] **S6 Admin screen.** `/admin/products` has **Stock propio** and **Proveedor**.
      Non-decant rows say **Sin verificar**; decants say **No aplica**. A **"—"** means
      the supplier read failed (migration/RLS) — stop.
- [ ] **S7 Made to order, end to end.** Flag one zero-stock bottle (**Marcar disponible**):
      - a toast appears; the row shows **Disponible en proveedor**, today's date, and
        **En tienda: Por encargo**; **Stock propio is unchanged**;
      - its card shows **Por encargo** and a WhatsApp square instead of **+**;
      - its detail page shows the notice, **Consultar disponibilidad**, no quantity
        stepper, and the size is still selectable;
      - the link opens WhatsApp to **+506 7143 4066** with the message prefilled (name,
        size, code, price, canonical product URL on the right domain), and the page
        never claims the message was sent — you still press send in WhatsApp;
      - clicking it changes nothing: cart count, `/admin/orders` and stock are the same,
        and no email arrives;
      - view-source on the page: the offer's `availability` is `OutOfStock`.
      Then leave it flagged if it is real, or **Marcar agotado** if it was a test.
- [ ] **S8 Customer cannot change it.** Signed in as a non-admin, `/admin/products`
      redirects away. And anonymously (use your **production** public anon key; the
      request is a no-op by construction — it writes `false` onto rows that are already
      `false`):
      ```bash
      curl -s -X PATCH "$SUPABASE_URL/rest/v1/product_variants?supplier_available=eq.false" \
        -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
        -H "Content-Type: application/json" -H "Prefer: return=representation" \
        -d '{"supplier_available": false}'
      # expected: []    (zero rows — refused by RLS)
      ```
- [ ] **S9 Phone.** On a real phone: the made-to-order detail page's sticky bar shows
      **Consultar** (a link), the card's WhatsApp square is visible without hovering,
      and tapping opens the WhatsApp app with the message ready.
- [ ] **S10 Nothing leaked into the money path.** After S7, `/admin/orders` has no new
      order and the stock panel shows no new movement.
- [ ] **S11 Product creation.** "+ Nuevo Producto" (or "+ Nueva Variante") still works.
      This is the check for the one RPC that could not be read from the repo (§3). After
      creating a test product, confirm its variant shows **Sin verificar**, then
      deactivate or delete the test product.
- [ ] **S12 Logs.** Vercel runtime logs for 15 minutes: no `42703`, no `supplier_`
      errors.

---

## 9. Known limitations and pre-existing issues (not fixed by this change)

- **Footer/contact/SINPE WhatsApp number lacks `506`** (decision 1).
- `/api/checkout/session` error JSON always includes a raw database `hint`
  (e.g. `"Insufficient stock for variant <uuid>. Available: 0, requested: 1."`), although
  `lib/checkout/errors.ts` says hints are development-only.
- The product edit form writes back the stock it loaded; a sale made while the form is
  open is overwritten on save. This is why supplier availability is **not** in that form.
- Decant lines in a cart hydrated from the server cart get `stock: 0`.
- `place_order` checks the variant's active flag but not the parent product's.
- After a stock error at checkout the cart still holds the refused line.
- `tsc --noEmit` reports 15 errors in `app/api/profile/avatar/route.test.ts`
  (`next build` does not).
- A customer whose cart held a bottle that later becomes made-to-order is refused at
  checkout with the generic "ya no hay stock suficiente" message.

---

## 10. Evidence log — what was actually verified, and where

| Claim | Evidence | Where |
|---|---|---|
| Logic, UI states, admin action, purchase route | 107 files / 1437 tests pass; 40+ deliberate code breakages all caught except one equivalent mutant | local |
| Production build | `pnpm build` passes (34/34 pages) | local, built against TESTING data |
| Migration + RLS + CHECK + refused purchase | DB suite `ALL … PASSED` | **TESTING**, run by you |
| Anonymous writes refused | live `PATCH` → HTTP 200, 0 rows; admin RPC → 401 `42501`; data unchanged | **TESTING** |
| In-stock, sold-out, decant pages; cart add | exercised in a browser; JSON-LD `InStock`/`OutOfStock` read from the DOM | **TESTING** data, dev server |
| Phone layout | 2-column grid, no horizontal scroll, 44×44 card actions, sticky-bar logic | **TESTING** data, 375px emulation (DOM/CSS only — the preview pane was in the background, so animations were frozen) |
| **Not verified live** | "Por encargo" rendered from real data · the `/admin/products` Proveedor screen · `create_new_product` with the new columns · a real WhatsApp hand-off · anything on **production** | — (covered by §5.2 P4 and §8 S6, S7, S9, S11) |

The SQL in this document was not executed by its author (no database access from the
tooling). The verification queries in §5.4 are the ones printed in the migration's
own footer; the audit queries in §6.4 are new — run the first one once on TESTING
before relying on it.
