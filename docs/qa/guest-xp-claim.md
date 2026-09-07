# Manual QA — Guest XP claim

Migration: `supabase/migrations/20260905000100_guest_order_xp_claim.sql`
Automated DB suite: `supabase/tests/20260905000100_guest_order_xp_claim_test.sql`

The automated suite proves the logic. This document covers the one thing it
cannot: the **real signup + email-confirmation round trip through GoTrue**, which
only happens when a person actually clicks the link in their inbox.

---

## What the feature does

A guest checks out. Their order reaches `received`, but they have no account, so
`grant_order_xp` refuses it (`reason: 'guest_order'`) — there is no profile to
credit. Later they register with the same email and confirm it. The claim
trigger reassigns the orders **and now also grants the XP those orders earned**.

XP rule is unchanged: `floor(total / 1000) * 50`, once per order, only for
orders in `received`.

## What is safe to do, and what is not

| | |
|---|---|
| Safe | Running the automated suite against production. It is wrapped in `BEGIN … ROLLBACK` and leaves nothing behind. |
| Safe | Running `SELECT * FROM public.backfill_guest_order_xp();` — it only ever grants XP that was already earned, and re-running it is a no-op. |
| Safe | Calling `reconcile_profile_order_xp(<user>)` any number of times. |
| **Not safe** | Deleting a test order *after* it granted XP. `profile_experience_events` cascades on delete, but `profiles.experience_points` does **not** — the balance is left inflated. Step 6 below corrects it. |

---

## Pre-flight

Apply the migration, then confirm the new body is live:

```sql
SELECT pg_get_functiondef('public.claim_guest_orders(uuid,text)'::regprocedure)
         LIKE '%reconcile_profile_order_xp%' AS is_upgraded;   -- must be true
```

Then run the automated suite (paste the whole test file into the SQL editor).
It must end with `ALL GUEST-XP TESTS PASSED`. If it does not, stop here — the
manual run below will not tell you anything the suite has not already.

Finally, repair anything the old code left behind:

```sql
SELECT * FROM public.backfill_guest_order_xp();
```

Rows returned = profiles whose pre-existing claimed orders had never been paid
out. Run it a second time; it must return **0 rows**.

---

## The manual run

Use an email address you actually control and that has **never** been registered
in this project.

### 1. Create the guest purchase

Either check out as a guest in the app with that email, or seed one directly:

```sql
INSERT INTO public.orders (
  user_id, customer_name, customer_email, customer_phone,
  shipping_address, shipping_district, shipping_canton, shipping_province,
  subtotal, total, source, order_status
) VALUES (
  NULL, 'QA Guest', 'YOUR-EMAIL@example.com', '00000000',
  '100m sur', 'Carmen', 'San Jose', 'San Jose',
  5000, 5000, 'web', 'received'
) RETURNING id;
```

`shipping_district` is `NOT NULL` — an insert without it fails.

Expected: **5 000 → 250 XP**, and no XP event yet:

```sql
SELECT * FROM public.profile_experience_events
 WHERE order_id = '<the id you just got>';   -- 0 rows
```

### 2. Register — but do NOT confirm yet

Sign up in the app with that email. Then check:

```sql
SELECT user_id FROM public.orders WHERE customer_email = 'YOUR-EMAIL@example.com';
```

Expected: **still `NULL`.**

> This is the security property, not a bug. Anyone can type anyone's address
> into a signup form. Claiming before confirmation would hand an attacker the
> victim's shipping address, phone and order history. Ownership is proven by
> `email_confirmed_at`, nothing else.

### 3. Confirm the email

Click the link in the inbox.

### 4. Verify

```sql
SELECT o.id, o.user_id, e.xp_earned, p.experience_points
  FROM public.orders o
  LEFT JOIN public.profile_experience_events e ON e.order_id = o.id
  LEFT JOIN public.profiles p ON p.id = o.user_id
 WHERE o.customer_email = 'YOUR-EMAIL@example.com';
```

Expected: `user_id` set, `xp_earned = 250`, and the balance includes it.

Then open the account page in the app: the order appears in the history and the
rank card shows the XP (250 XP = **Fraiche**, 750 short of Cologne — see
`lib/rank.ts`).

### 5. Prove it cannot double-pay

```sql
SELECT public.reconcile_profile_order_xp('<user-id>');            -- 0
SELECT public.claim_guest_orders('<user-id>', 'YOUR-EMAIL@example.com');  -- 0
SELECT experience_points FROM public.profiles WHERE id = '<user-id>';    -- 250
```

### 6. Clean up

```sql
-- Deleting the order cascades its XP event but NOT the balance, so correct
-- the balance in the same statement batch.
DELETE FROM public.orders WHERE customer_email = 'YOUR-EMAIL@example.com';

UPDATE public.profiles
   SET experience_points = experience_points - 250
 WHERE id = '<user-id>';
```

Delete the test user from **Authentication → Users** in the dashboard.

Confirm the ledger is consistent again:

```sql
SELECT p.id, p.experience_points, COALESCE(SUM(e.xp_earned), 0) AS from_events
  FROM public.profiles p
  LEFT JOIN public.profile_experience_events e ON e.user_id = p.id
 GROUP BY p.id, p.experience_points
HAVING p.experience_points <> COALESCE(SUM(e.xp_earned), 0);   -- 0 rows
```

---

## If something goes wrong

The XP step is wrapped in an exception handler precisely so it can never abort a
signup. A failure is therefore **silent to the user** and logged as a warning.
Check the Postgres logs (Dashboard → Logs → Postgres) for:

```
claim_guest_orders: XP reconciliation failed for <uuid> (<sqlstate>): <message>
reconcile_profile_order_xp: no profile for <uuid>, skipping
```

Nothing is lost when this happens — the orders are still claimed, and
`backfill_guest_order_xp()` settles the XP whenever it is next run.
