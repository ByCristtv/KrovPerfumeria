# Manual QA — Social / Friends (MVP 1 – MVP 3)

Migrations:
- `supabase/migrations/20260919000100_social_friends.sql`
- `supabase/migrations/20260920000100_social_purchased_products_completion_rule.sql`

Automated suites (real hooks + real query client against
`test/helpers/fakeSocialBackend.ts`):
- `components/social/friendshipLifecycle.test.tsx` — request lifecycle
- `components/social/friendProfileAccess.test.tsx` — friend-profile authorization

## ⚠ PENDING: run migration 20260920000100

It has **not** been applied yet. Paste it into the Studio SQL editor for the
project `.env.local` points at.

Until it runs, a friend's fragrances **disappear from their profile the moment
you mark their order as shipped** — the original function filtered
`order_status = 'received'` exactly, but the state machine is
`pending -> received -> shipped`, so shipping an order hid it. The migration
widens that to `IN ('received', 'shipped')` and adds a supporting partial
index. The RPC signature does not change, so `types/database.ts` needs no
regeneration.

The automated suite proves the state machine and the cache-invalidation loop.
This document covers the two things it cannot: **two real accounts interacting
through Postgres**, and a **generated-types hazard** that has already destroyed
work once.

---

## ⚠ Before you run `pnpm update-types`

`package.json` points `update-types` at the **production** project
(`xabzbvanmqeplenfoozx`). `.env.local` points the running app at the
**testing** project (`phhrvqqlvgapbiodwpwy`).

The social migration is applied to **testing only**. So regenerating types today
reads a database that has no social schema and **silently deletes** every social
definition from `types/database.ts` — `profiles.is_profile_public` and all ten
social RPCs. The build then fails in `features/social/*`, `lib/social/*` and
`components/account/ProfileView.tsx`.

This already happened once, between MVP 1 and MVP 2.

Pick one before regenerating:

1. **Apply the migration to production**, then regenerate. Preferred — the
   hand-maintained block disappears and the generator produces it naturally.
2. **Repoint the script** at the project the app actually uses:
   `--project-id phhrvqqlvgapbiodwpwy`.
3. Regenerate anyway, then re-add the social block by hand.

To check whether a given project has the functions, without a session:

```bash
curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/search_public_users" -H "apikey: $ANON_KEY" -H "Content-Type: application/json" -d '{"p_query":"aa"}'
```

`42501 permission denied` means the function **exists** (anon simply has no
EXECUTE, which is correct). `PGRST202` means it is **missing**.

---

## What needs two real accounts

Everything below runs through `SECURITY DEFINER` RPCs keyed on `auth.uid()`, so
a single session cannot exercise both sides. Use two browsers (or one plus a
private window) signed in as **A** and **B**.

Both accounts need a username and a public profile: /profile → "Perfil público"
→ set a username and enable the switch. A private account is not discoverable.

### Lifecycle

| # | As | Do | Expect |
|---|----|----|--------|
| 1 | A | /friends → Buscar → type B's username | B appears with **Agregar** |
| 2 | A | Click **Agregar** | Toast "Solicitud enviada"; row becomes **Pendiente** + **Cancelar**, with no reload |
| 3 | A | Click **Agregar** again quickly (step 2 repeated) | Button locks during flight; still exactly one pending request |
| 4 | B | /friends → Solicitudes | A listed with avatar, username, rank + XP; tab shows **(1)** |
| 5 | B | Search A | **Solicitud recibida** + **Responder** (never "Agregar") |
| 6 | A | Click **Cancelar** | Toast; row returns to **Agregar**; B's Solicitudes empties on refetch |
| 7 | A | Send again, then B clicks **Aceptar** | Request leaves B's inbox; A appears in B's **Amigos** |
| 8 | A | Reopen /friends (or switch tabs) | B appears in A's **Amigos**; search shows **Amigos** |
| 9 | A | **Eliminar** on B → confirm in the dialog | B leaves A's list **and** B's list; search shows **Agregar** again |
| 10 | A | Send a request again | Works — removal is not a block |
| 11 | B | Send to A, A clicks **Rechazar** | Request disappears; no friendship; B may send again |

### Edge cases worth one pass each

- **Private target.** B turns their profile private, then A (with a stale screen)
  clicks **Agregar** → controlled "Esa persona hizo privado su perfil…" alert,
  and the list refetches. No request is created.
- **Already answered.** B accepts in one window while A cancels in another →
  whichever loses gets "Algo cambió" and its list re-reads. No crash.
- **Existing friendships survive privacy changes.** B goes private → B stays in
  A's Amigos list. Privacy governs *discoverability*, not existing friendships.
- **Mobile.** At 375px the portal tabs fit on one row and request rows wrap the
  two action buttons under the username rather than truncating.

### What must never appear anywhere in /friends

Phone, email, address, order numbers, totals, payment data. Full name appears
**only** in the friends list (`get_friends` returns it; the search and request
RPCs do not).

---

## MVP 3 — friend profile + purchased fragrances

Route: `/friends/[userId]` (the **user id**, not the username — usernames are
editable from /profile, so a username-keyed link would rot when somebody
renames themselves). Reached by clicking a friend's name in the list.

| # | As | Do | Expect |
|---|----|----|--------|
| 12 | A | /friends → Amigos → click B's name | B's profile: avatar, username, full name, rank, XP |
| 13 | A | Read the rank | Same ladder as /ranking and /profile (lib/rank.ts) |
| 14 | A | Look at "Fragancias compradas" | One card per fragrance, with brand + name + image, and a count in the header |
| 15 | A | Click a fragrance | Lands on the real catalog page `/products/<slug>` |
| 16 | A | Click "Eliminar" on the row instead of the name | Removes — it must never navigate, and the name must never remove |

### Privacy checks that matter (FLOW 5 / FLOW 10)

- **Open DevTools → Network while the profile loads.** The two responses
  (`get_friend_profile`, `get_friend_purchased_products`) must contain no
  phone, email, address, order id, order number, quantity, size, unit price,
  total, discount, shipping or payment field. Five columns each, no more.
- **Variants collapse.** If B bought Hawas Ice in 100ml, 10ml and 5ml, A sees
  **one** Hawas Ice card.
- **Shipped orders count.** Mark one of B's orders shipped; its fragrances must
  stay visible. (Requires migration 20260920000100.)
- **Third party.** As C (not B's friend), open `/friends/<B-user-id>` directly.
  Expect the generic "Este perfil no está disponible" panel and **no** profile
  data in the network responses — the RPC refuses, the route does not.
- **Revocation.** With B's profile open as A, have B remove A. Refresh (or
  just revisit): A must lose both the profile and the fragrances. The cache is
  deliberately `staleTime: 0, gcTime: 0` so it cannot outlive the friendship.
- **Privacy ≠ unfriending.** B goes private: A still sees B in Amigos and can
  still open B's profile; C can no longer find B in Buscar.

### Known limitations (by design)

- **Order items with a null `variant_id`** cannot be resolved to a catalog
  product (`product_id`/`slug` only exist through the variant join), so they
  are omitted from the fragrance list rather than rendered without identity.
  No error, no fabricated card.
- **Deactivated products still appear** socially — a purchase happened — but
  their card links to the catalog page, which 404s to the KROV product
  not-found screen because `getProductBySlug` filters `is_active`.
- **A username change** does not break anything: links are keyed on user id.

---

## Realtime — deferred

Not implemented, deliberately. The app has no Realtime anywhere: no
subscription abstraction, no client code, and no migration adds the social
tables to the `supabase_realtime` publication or sets `REPLICA IDENTITY FULL`
(needed before an RLS-filtered DELETE on `friendships` carries enough of the
old row for a viewer to know it concerns them). That is substantial database
configuration plus new client infrastructure for a feature that is already
correct without it.

What covers the gap today: every social query uses a 30s `staleTime` with React
Query's default refetch-on-window-focus, so returning to the tab re-reads; and
the friend profile uses `staleTime: 0, gcTime: 0`, so **authorization** is
re-derived on every visit rather than eventually.

## Still out of scope after MVP 3

Chat, comments, likes, feeds, a follow system, blocking, reporting, wishlists,
gifts, "friends who bought this", recommendations, presence, friend
suggestions, push and email notifications.
