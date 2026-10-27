-- ============================================================================
-- 20261025000100_onvo_webhook_event_ledger.sql
-- Retry-safe, idempotent processing for ONVO payment webhooks.
-- ============================================================================
-- PROBLEMS THIS FIXES (see app/api/webhooks/onvo/route.ts for the TS side)
--
--   1. processed_webhooks was written BEFORE the handler ran, and every handler
--      failure was answered with HTTP 200. One transient DB error therefore
--      suppressed the event forever: ONVO saw success, our ledger said
--      "processed", and the order was never confirmed.
--
--   2. The idempotency key was data.id — the PAYMENT INTENT id — for every event
--      type. ONVO sends no top-level event id (docs: the body is only `type` +
--      `data`), and a declined card emits `payment-intent.failed` with the intent
--      back in `requires_payment_method`, i.e. still payable. So a decline
--      followed by a successful retry on the same intent was deduplicated as
--      "already processed" and the order never became paid.
--
--   3. Order lookup, validation and update were separate round trips from
--      Next.js (read-check-write), so a concurrent checkout edit or a duplicate
--      delivery could interleave with them.
--
-- DESIGN
--   processed_webhooks becomes a small state machine, one row per idempotency
--   key (the key is built in lib/onvo/webhook/event.ts and is now
--   "<event type>:<intent id>[:<attempt>]"):
--
--       processing ──► processed   business effects + side effects done
--            │    ──► ignored     valid event, intentionally no state change
--            │    ──► rejected    permanent business exception (amount mismatch,
--            │                    unknown order, paid-after-denied …) — never
--            │                    retried, logged for manual review
--            └──► failed          transient/technical failure — RE-CLAIMABLE
--
--   A claim holds a short LEASE (locked_until). A duplicate delivery that
--   arrives while the lease is live is told "in progress" (the route answers
--   409, so ONVO records the delivery as failed); once the lease expires a
--   crashed worker's event can be re-claimed.
--
--   The order transition and the ledger write happen in ONE transaction inside
--   apply_onvo_payment_succeeded / apply_onvo_payment_failed, under a row lock
--   on the order. effects_applied_at records that the order change committed,
--   so a re-claimed event re-runs only the (idempotent) email side effects and
--   never re-applies the order change. The apply_* functions also check it
--   themselves, so even a caller that ignores it cannot apply an event twice.
--
--   ORDER ↔ INTENT ASSOCIATION. The order is resolved from TRUSTED, persisted
--   data: the single order whose payment_reference IS the event's intent id
--   (stamped by our own checkout when it created the intent). The payload's
--   metadata.orderId is untrusted and only cross-checked: if it names a
--   different order the event is refused. An intent that no order references
--   can never change any order — including an already-paid one (that would be
--   a second charge: rejected for manual review, not silently ignored).
--
-- BACKWARD COMPATIBILITY / ROLLOUT
--   Additive only: new nullable/defaulted columns + new functions. Existing rows
--   are kept and marked status='processed' (what the old code assumed). The
--   status and processed_at column DEFAULTS still describe the old code's
--   insert, so the currently deployed route keeps working between applying this
--   migration and deploying the new code. Old rows are keyed by the bare intent
--   id and new rows by "<type>:<intent>", so the two can never collide.
--
-- Idempotent-safe: re-running this migration is a no-op.
-- Depends on: public.processed_webhooks, public.orders,
--             public.restore_variant_stock(uuid) — all exist.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. PROCESSED_WEBHOOKS — lifecycle columns
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.processed_webhooks
  ADD COLUMN IF NOT EXISTS event_type         TEXT,
  ADD COLUMN IF NOT EXISTS status             TEXT NOT NULL DEFAULT 'processed',
  ADD COLUMN IF NOT EXISTS attempts           INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS locked_until       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_intent_id  TEXT,
  ADD COLUMN IF NOT EXISTS order_id           UUID
                             REFERENCES public.orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS outcome            TEXT,
  ADD COLUMN IF NOT EXISTS last_error         TEXT,
  ADD COLUMN IF NOT EXISTS effects_applied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ NOT NULL DEFAULT now();

-- processed_at now means "reached a terminal state". New rows start NULL (the
-- functions below insert it explicitly); the default stays for the old code.
ALTER TABLE public.processed_webhooks ALTER COLUMN processed_at DROP NOT NULL;

-- Legacy rows: ADD COLUMN stamped received_at with the migration time. Their
-- true receipt time is processed_at (the old code inserted on receipt). Only
-- legacy rows can satisfy this predicate, so a re-run changes nothing.
UPDATE public.processed_webhooks
   SET received_at = processed_at,
       updated_at  = processed_at
 WHERE processed_at IS NOT NULL
   AND received_at > processed_at;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'processed_webhooks_status_check'
       AND conrelid = 'public.processed_webhooks'::regclass
  ) THEN
    ALTER TABLE public.processed_webhooks
      ADD CONSTRAINT processed_webhooks_status_check
      CHECK (status IN ('processing', 'processed', 'ignored', 'rejected', 'failed'));
  END IF;
END $$;

COMMENT ON TABLE public.processed_webhooks IS
  'Webhook idempotency + processing ledger. One row per (provider, event_id idempotency key). status: processing → processed | ignored | rejected (terminal) or failed (re-claimable). Written only through claim_webhook_event / complete_webhook_event / apply_onvo_payment_*.';

-- Ops queries: "what is stuck or failing?" and "every event for this order".
CREATE INDEX IF NOT EXISTS idx_pw_open_status
  ON public.processed_webhooks (status, locked_until)
  WHERE status IN ('processing', 'failed');
CREATE INDEX IF NOT EXISTS idx_pw_order_id
  ON public.processed_webhooks (order_id)
  WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pw_payment_intent
  ON public.processed_webhooks (payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;

-- The webhook resolves orders BY payment_reference (sections 4–6).
CREATE INDEX IF NOT EXISTS idx_orders_payment_reference
  ON public.orders (payment_reference)
  WHERE payment_reference IS NOT NULL;

-- RLS stays enabled with zero policies (20260525000100): service_role and the
-- SECURITY DEFINER functions below are the only way in.


-- ────────────────────────────────────────────────────────────────────────────
-- 2. claim_webhook_event — atomic "may I process this event?"
-- ────────────────────────────────────────────────────────────────────────────
-- Returns JSONB:
--   { claimed: true,  id, attempts, effects_applied, order_id }  → process it
--   { claimed: false, id, status: 'processing' }                 → in flight
--   { claimed: false, id, status: 'processed'|'ignored'|'rejected', outcome }
--                                                                 → duplicate
--
-- Concurrency: two deliveries of the same key race on the UNIQUE constraint.
-- The loser's INSERT waits for the winner's (short) transaction, then hits
-- DO NOTHING and reads the committed row under FOR UPDATE — it sees a live
-- lease and backs off. No path lets two callers both claim a live lease.

CREATE OR REPLACE FUNCTION public.claim_webhook_event(
  p_provider          TEXT,
  p_event_id          TEXT,
  p_event_type        TEXT,
  p_payment_intent_id TEXT DEFAULT NULL,
  p_payload_hash      TEXT DEFAULT NULL,
  p_lease_seconds     INTEGER DEFAULT 120
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row   public.processed_webhooks%ROWTYPE;
  v_lease INTERVAL;
BEGIN
  IF p_provider IS NULL OR p_event_id IS NULL OR p_event_type IS NULL THEN
    RAISE EXCEPTION 'claim_webhook_event: provider, event_id and event_type are required';
  END IF;

  v_lease := make_interval(secs => LEAST(GREATEST(COALESCE(p_lease_seconds, 120), 10), 900));

  INSERT INTO public.processed_webhooks (
    provider, event_id, event_type, status, attempts, locked_until,
    payment_intent_id, payload_hash, received_at, processed_at, updated_at
  ) VALUES (
    p_provider, p_event_id, p_event_type, 'processing', 1, now() + v_lease,
    p_payment_intent_id, p_payload_hash, now(), NULL, now()
  )
  ON CONFLICT (provider, event_id) DO NOTHING
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'claimed', true, 'id', v_row.id, 'attempts', v_row.attempts,
      'effects_applied', false, 'order_id', NULL
    );
  END IF;

  SELECT * INTO v_row
    FROM public.processed_webhooks
   WHERE provider = p_provider
     AND event_id = p_event_id
     FOR UPDATE;

  -- Terminal: a duplicate delivery. Nothing to do, ever.
  IF v_row.status IN ('processed', 'ignored', 'rejected') THEN
    RETURN jsonb_build_object(
      'claimed', false, 'id', v_row.id, 'status', v_row.status,
      'outcome', v_row.outcome, 'order_id', v_row.order_id
    );
  END IF;

  -- Another worker holds a live lease.
  IF v_row.status = 'processing'
     AND v_row.locked_until IS NOT NULL
     AND v_row.locked_until > now() THEN
    RETURN jsonb_build_object(
      'claimed', false, 'id', v_row.id, 'status', 'processing',
      'order_id', v_row.order_id
    );
  END IF;

  -- 'failed', or 'processing' whose lease expired (worker crashed / timed out).
  UPDATE public.processed_webhooks
     SET status            = 'processing',
         attempts          = attempts + 1,
         locked_until      = now() + v_lease,
         event_type        = COALESCE(event_type, p_event_type),
         payment_intent_id = COALESCE(payment_intent_id, p_payment_intent_id),
         payload_hash      = COALESCE(payload_hash, p_payload_hash),
         updated_at        = now()
   WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'claimed', true, 'id', v_row.id, 'attempts', v_row.attempts,
    'effects_applied', v_row.effects_applied_at IS NOT NULL,
    'order_id', v_row.order_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_webhook_event(TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_webhook_event(TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER)
  TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. complete_webhook_event — close out a claimed event
-- ────────────────────────────────────────────────────────────────────────────
-- p_status: 'processed' | 'ignored' | 'rejected' (terminal) or 'failed'
-- (retryable: the lease is dropped so the next delivery re-claims at once).
-- Only a row still in 'processing' is touched, so a terminal row can never be
-- reopened or overwritten by a slow worker. Returns whether a row changed.

CREATE OR REPLACE FUNCTION public.complete_webhook_event(
  p_id      UUID,
  p_status  TEXT,
  p_outcome TEXT DEFAULT NULL,
  p_error   TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('processed', 'ignored', 'rejected', 'failed') THEN
    RAISE EXCEPTION 'complete_webhook_event: invalid status %', p_status;
  END IF;

  UPDATE public.processed_webhooks
     SET status       = p_status,
         outcome      = COALESCE(p_outcome, outcome),
         last_error   = LEFT(p_error, 1000),
         locked_until = NULL,
         processed_at = CASE WHEN p_status = 'failed' THEN processed_at ELSE now() END,
         updated_at   = now()
   WHERE id = p_id
     AND status = 'processing';

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_webhook_event(UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_webhook_event(UUID, TEXT, TEXT, TEXT)
  TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. resolve_onvo_intent_order — which order does this intent belong to?
-- ────────────────────────────────────────────────────────────────────────────
-- The ONLY trusted link between an ONVO payment intent and one of our orders is
-- orders.payment_reference, which our checkout stamps with the intent id it
-- created (lib/checkout/orderService.ts stampPayment / updateOrder). The
-- payload's metadata.orderId (p_order_hint) is untrusted and is used only as a
-- cross-check and, when nothing matches, to link the ledger row for review.
--
-- Returns JSONB { order_id, reason } and, when associated, holds a FOR UPDATE
-- lock on that order for the rest of the caller's transaction:
--   'associated'            exactly one order references the intent (locked)
--   'order_mismatch'        it does, but the payload names a different order
--   'ambiguous_intent'      more than one order references it (data error)
--   'intent_not_associated' no order references it; the hint is a real order
--   'order_not_found'       no order references it and the hint matches none
--
-- Under READ COMMITTED, FOR UPDATE re-checks the WHERE clause after waiting for
-- a concurrent writer, so an order whose payment_reference was changed while
-- we waited (checkout edit → new intent) is correctly NOT returned.

CREATE OR REPLACE FUNCTION public.resolve_onvo_intent_order(
  p_intent_id  TEXT,
  p_order_hint UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id   UUID;
  v_hint UUID;
BEGIN
  IF p_intent_id IS NULL OR btrim(p_intent_id) = '' THEN
    RAISE EXCEPTION 'resolve_onvo_intent_order: intent id is required';
  END IF;

  BEGIN
    SELECT id INTO STRICT v_id
      FROM public.orders
     WHERE payment_reference = p_intent_id
       FOR UPDATE;
  EXCEPTION
    WHEN no_data_found THEN
      v_id := NULL;
    WHEN too_many_rows THEN
      RETURN jsonb_build_object('order_id', NULL, 'reason', 'ambiguous_intent');
  END;

  IF v_id IS NOT NULL THEN
    IF p_order_hint IS NOT NULL AND p_order_hint <> v_id THEN
      RETURN jsonb_build_object('order_id', v_id, 'reason', 'order_mismatch');
    END IF;
    RETURN jsonb_build_object('order_id', v_id, 'reason', 'associated');
  END IF;

  IF p_order_hint IS NOT NULL THEN
    SELECT id INTO v_hint FROM public.orders WHERE id = p_order_hint;
    IF FOUND THEN
      RETURN jsonb_build_object('order_id', v_hint, 'reason', 'intent_not_associated');
    END IF;
  END IF;

  RETURN jsonb_build_object('order_id', NULL, 'reason', 'order_not_found');
END;
$$;

-- Internal helper: callable only by the SECURITY DEFINER functions below
-- (they run as the owner) and service_role.
REVOKE ALL ON FUNCTION public.resolve_onvo_intent_order(TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_onvo_intent_order(TEXT, UUID)
  TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. apply_onvo_payment_succeeded — validate + mark paid, atomically
-- ────────────────────────────────────────────────────────────────────────────
-- Returns JSONB { outcome, reason, order_id, expected_amount? }:
--   outcome 'paid'     reason 'marked_paid'
--                             'already_applied'        THIS event already marked
--                                                       it paid (re-entry after a
--                                                       crash): finish side
--                                                       effects, change nothing
--   outcome 'ignored'  reason 'already_paid'           paid by THIS intent via
--                                                       another path (admin, a
--                                                       legacy-keyed event)
--   outcome 'rejected' reason 'intent_not_associated'  the intent is not the
--                                                       order's payment_reference
--                                                       — never pays the order,
--                                                       even an already-paid one
--                                                       (possible second charge)
--                             'order_mismatch'         payload names another order
--                             'ambiguous_intent'
--                             'order_not_found'
--                             'order_denied'           charged after cancel →
--                                                       MANUAL REFUND
--                             'payment_not_pending'    failed/refunded order
--                             'currency_mismatch'
--                             'amount_mismatch'
--
-- Amount is REQUIRED (the pre-ledger code skipped the check when ONVO omitted
-- it). orders.total is CRC; ONVO amounts are céntimos — the exact conversion
-- the checkout uses (toCentimos: Math.round(total * 100)).
--
-- order_status stays 'pending' per the Phase 1 design — payment_status alone
-- signals "money received"; an admin advances fulfilment.

CREATE OR REPLACE FUNCTION public.apply_onvo_payment_succeeded(
  p_webhook_id UUID,
  p_order_id   UUID,     -- untrusted hint (metadata.orderId); may be NULL
  p_intent_id  TEXT,
  p_amount     BIGINT,
  p_currency   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event    RECORD;
  v_link     JSONB;
  v_order_id UUID;
  v_order    RECORD;
  v_expected BIGINT;
  v_outcome  TEXT;
  v_reason   TEXT;
BEGIN
  IF p_webhook_id IS NULL OR p_intent_id IS NULL
     OR p_amount IS NULL OR p_currency IS NULL THEN
    RAISE EXCEPTION 'apply_onvo_payment_succeeded: webhook id, intent id, amount and currency are required';
  END IF;

  SELECT id, order_id, effects_applied_at INTO v_event
    FROM public.processed_webhooks
   WHERE id = p_webhook_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_onvo_payment_succeeded: webhook event % not found', p_webhook_id;
  END IF;

  -- Re-entry guard: this event's order change already committed. Never apply
  -- it twice, whatever the caller believes.
  IF v_event.effects_applied_at IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'paid', 'reason', 'already_applied',
                              'order_id', v_event.order_id);
  END IF;

  v_link     := public.resolve_onvo_intent_order(p_intent_id, p_order_id);
  v_order_id := (v_link->>'order_id')::UUID;

  IF v_order_id IS NOT NULL THEN
    UPDATE public.processed_webhooks SET order_id = v_order_id, updated_at = now()
     WHERE id = p_webhook_id;
  END IF;

  IF v_link->>'reason' <> 'associated' THEN
    RETURN jsonb_build_object('outcome', 'rejected', 'reason', v_link->>'reason',
                              'order_id', v_order_id);
  END IF;

  -- Already locked by resolve_onvo_intent_order.
  SELECT id, total, payment_status, order_status INTO v_order
    FROM public.orders
   WHERE id = v_order_id;

  v_expected := ROUND(v_order.total * 100)::BIGINT;

  IF v_order.payment_status = 'paid' THEN
    v_outcome := 'ignored';  v_reason := 'already_paid';
  ELSIF v_order.order_status = 'denied' THEN
    v_outcome := 'rejected'; v_reason := 'order_denied';
  ELSIF v_order.payment_status <> 'pending' THEN
    v_outcome := 'rejected'; v_reason := 'payment_not_pending';
  ELSIF upper(p_currency) <> 'CRC' THEN
    v_outcome := 'rejected'; v_reason := 'currency_mismatch';
  ELSIF p_amount <> v_expected THEN
    v_outcome := 'rejected'; v_reason := 'amount_mismatch';
  ELSE
    UPDATE public.orders
       SET payment_status = 'paid',
           paid_at        = now()
     WHERE id = v_order.id;

    UPDATE public.processed_webhooks
       SET effects_applied_at = now(), updated_at = now()
     WHERE id = p_webhook_id;

    v_outcome := 'paid'; v_reason := 'marked_paid';
  END IF;

  RETURN jsonb_build_object(
    'outcome', v_outcome,
    'reason', v_reason,
    'order_id', v_order.id,
    'expected_amount', v_expected
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_onvo_payment_succeeded(UUID, UUID, TEXT, BIGINT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_onvo_payment_succeeded(UUID, UUID, TEXT, BIGINT, TEXT)
  TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 6. apply_onvo_payment_failed — deny + restore stock, atomically
-- ────────────────────────────────────────────────────────────────────────────
-- Returns JSONB { outcome, reason, order_id }:
--   outcome 'failed'   reason 'marked_failed'      stock restored, order denied
--                             'already_applied'    THIS event already did it
--   outcome 'ignored'  reason 'intent_not_associated' / 'order_mismatch' /
--                             'ambiguous_intent' / 'order_not_found'
--                                                   not the order's intent (e.g.
--                                                   superseded by a checkout
--                                                   edit) — nothing at stake
--                             'already_paid'       a success must never be
--                                                   overwritten (out-of-order)
--                             'already_final'      already failed/denied/refunded
--                             'retryable_attempt'  the intent is still payable
--                             'order_shipped'      never auto-deny a shipped order
--
-- p_terminal comes from the event's data.status (lib/onvo/webhook/event.ts):
-- ONVO documents a declined card as `payment-intent.failed` with the intent
-- back in `requires_payment_method` — the customer can retry on the SAME
-- intent from the embedded SDK. Denying the order then would cancel an order
-- the customer is about to pay. Non-terminal failures therefore leave the order
-- pending; the abandoned-order sweep (sweep_abandoned_orders) still releases
-- the stock if the customer gives up.
--
-- Stock restore and the status update commit together. Previously a restore
-- error was logged and the order denied anyway (leaking stock).

CREATE OR REPLACE FUNCTION public.apply_onvo_payment_failed(
  p_webhook_id UUID,
  p_order_id   UUID,     -- untrusted hint (metadata.orderId); may be NULL
  p_intent_id  TEXT,
  p_terminal   BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event    RECORD;
  v_link     JSONB;
  v_order_id UUID;
  v_order    RECORD;
  v_outcome  TEXT;
  v_reason   TEXT;
BEGIN
  IF p_webhook_id IS NULL OR p_intent_id IS NULL OR p_terminal IS NULL THEN
    RAISE EXCEPTION 'apply_onvo_payment_failed: webhook id, intent id and terminal flag are required';
  END IF;

  SELECT id, order_id, effects_applied_at INTO v_event
    FROM public.processed_webhooks
   WHERE id = p_webhook_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_onvo_payment_failed: webhook event % not found', p_webhook_id;
  END IF;

  IF v_event.effects_applied_at IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'failed', 'reason', 'already_applied',
                              'order_id', v_event.order_id);
  END IF;

  v_link     := public.resolve_onvo_intent_order(p_intent_id, p_order_id);
  v_order_id := (v_link->>'order_id')::UUID;

  IF v_order_id IS NOT NULL THEN
    UPDATE public.processed_webhooks SET order_id = v_order_id, updated_at = now()
     WHERE id = p_webhook_id;
  END IF;

  IF v_link->>'reason' <> 'associated' THEN
    RETURN jsonb_build_object('outcome', 'ignored', 'reason', v_link->>'reason',
                              'order_id', v_order_id);
  END IF;

  SELECT id, payment_status, order_status INTO v_order
    FROM public.orders
   WHERE id = v_order_id;

  IF v_order.payment_status = 'paid' THEN
    v_outcome := 'ignored'; v_reason := 'already_paid';
  ELSIF v_order.payment_status <> 'pending' OR v_order.order_status = 'denied' THEN
    v_outcome := 'ignored'; v_reason := 'already_final';
  ELSIF NOT p_terminal THEN
    v_outcome := 'ignored'; v_reason := 'retryable_attempt';
  ELSIF v_order.order_status = 'shipped' THEN
    v_outcome := 'ignored'; v_reason := 'order_shipped';
  ELSE
    -- Idempotent itself (guards on stock_movements), and runs in this
    -- transaction: if it raises, nothing below commits and the event is retried.
    PERFORM public.restore_variant_stock(v_order.id);

    UPDATE public.orders
       SET payment_status = 'failed',
           order_status   = 'denied'
     WHERE id = v_order.id;

    UPDATE public.processed_webhooks
       SET effects_applied_at = now(), updated_at = now()
     WHERE id = p_webhook_id;

    v_outcome := 'failed'; v_reason := 'marked_failed';
  END IF;

  RETURN jsonb_build_object('outcome', v_outcome, 'reason', v_reason,
                            'order_id', v_order.id);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_onvo_payment_failed(UUID, UUID, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_onvo_payment_failed(UUID, UUID, TEXT, BOOLEAN)
  TO service_role;

-- ============================================================================
-- VERIFICATION QUERIES — run after the migration
-- ============================================================================
-- 1. New columns exist and legacy rows are 'processed':
--    SELECT status, COUNT(*) FROM public.processed_webhooks GROUP BY status;
--    → only 'processed' right after applying (all legacy rows)
--
-- 2. The five functions exist and are NOT callable by anon/authenticated:
--    SELECT p.proname,
--           has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon,
--           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed,
--           has_function_privilege('service_role', p.oid, 'EXECUTE')  AS service
--      FROM pg_proc p
--     WHERE p.pronamespace = 'public'::regnamespace
--       AND p.proname IN ('claim_webhook_event', 'complete_webhook_event',
--                         'resolve_onvo_intent_order',
--                         'apply_onvo_payment_succeeded', 'apply_onvo_payment_failed');
--    → 5 rows, anon=false, authed=false, service=true
--
-- 3. Status CHECK constraint is in place:
--    SELECT conname FROM pg_constraint
--     WHERE conrelid = 'public.processed_webhooks'::regclass
--       AND conname = 'processed_webhooks_status_check';
--    → 1 row
--
-- 4. Run the DB test suite (BEGIN … ROLLBACK, safe on prod):
--    supabase/tests/20261025000100_onvo_webhook_event_ledger_test.sql
--    → "ALL ONVO WEBHOOK LEDGER TESTS PASSED"
--
-- 5. Ongoing monitoring — anything stuck, failing or needing manual review:
--    SELECT event_type, event_id, status, outcome, attempts, last_error,
--           order_id, payment_intent_id, received_at, updated_at
--      FROM public.processed_webhooks
--     WHERE provider = 'onvo'
--       AND (status IN ('failed', 'rejected')
--            OR (status = 'processing' AND locked_until < now()))
--     ORDER BY updated_at DESC
--     LIMIT 50;
--
-- 6. Crash window — order change committed, event not closed out yet. These
--    finish on the next delivery of the same event (or lease re-claim); the
--    order itself is already consistent:
--    SELECT event_type, event_id, order_id, attempts, locked_until, effects_applied_at
--      FROM public.processed_webhooks
--     WHERE provider = 'onvo'
--       AND effects_applied_at IS NOT NULL
--       AND status IN ('processing', 'failed');
-- ============================================================================
