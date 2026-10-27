-- ============================================================================
-- DB-LEVEL TEST SUITE -- ONVO webhook event ledger (migration 20261025000100)
-- ============================================================================
-- HOW TO RUN
--   Paste this whole file into the Supabase SQL Editor and run it, AFTER
--   applying 20261025000100_onvo_webhook_event_ledger.sql.
--
--   Everything happens inside BEGIN ... ROLLBACK, so the database is left
--   unchanged whether the suite passes or fails. The test orders and ledger
--   rows never survive the script -- safe to run against the live project.
--
--   PASS  -> the final SELECT prints "ALL ONVO WEBHOOK LEDGER TESTS PASSED".
--   FAIL  -> the script aborts with `assertion failed` naming the test, and the
--            transaction rolls back.
--
-- The functions run exactly as the webhook calls them (the SQL editor is a
-- privileged role, like service_role: auth.uid() is NULL).
--
-- WHAT IS COVERED
--   Ledger
--    1  first claim wins, a live lease blocks a second claim ("in progress")
--    2  an expired lease is re-claimable (crashed worker) and counts attempts
--    3  'failed' is re-claimable; terminal statuses are reported as duplicates
--    4  complete_webhook_event never reopens a terminal row
--   Succeeded
--    5  amount mismatch is rejected, order untouched
--    6  currency mismatch is rejected
--    7  happy path marks paid + stamps effects_applied_at
--    8  already-paid order (same intent, another event) is ignored
--    9  denied order is rejected (manual refund), stays denied
--   10  unknown order is rejected
--   Failed
--   11  retryable attempt leaves the order pending
--   12  an intent the order no longer references leaves it pending
--   13  terminal failure denies the order
--   14  failure arriving after success never downgrades a paid order
--   Order ↔ intent association (trusted payment_reference)
--   16  an UNRELATED intent cannot mark an order paid, even with its orderId
--   17  an unrelated intent on an already-PAID order is rejected, not ignored
--   18  orderId naming a different order than the intent's owner is refused
--   19  no orderId at all: the order is resolved from payment_reference
--   20  an intent referenced by two orders is refused
--   21  an order with no payment_reference cannot be paid by any intent
--   22  an unrelated terminal failure does not deny the order
--   Crash window (order committed paid, event not terminal)
--   15  re-claim after effects applied reports effects_applied + order id
--   23  full sequence: claim → apply (commit) → [crash] → lease expiry →
--       re-claim → apply is a no-op ('already_applied') → complete → duplicate
--   24  the failed-payment apply has the same re-entry guard
--
-- NOT COVERED HERE: true concurrency (needs two sessions). It is guaranteed by
-- the UNIQUE (provider, event_id) constraint + FOR UPDATE and is exercised at
-- the application level in app/api/webhooks/onvo/route.test.ts. The test
-- orders have no line items, so stock restoration itself is a no-op here;
-- restore_variant_stock has its own idempotency guard.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.make_order(
  p_total NUMERIC, p_reference TEXT
) RETURNS UUID
LANGUAGE plpgsql AS $f$
DECLARE v_id UUID;
BEGIN
  INSERT INTO public.orders (
    customer_name, customer_email, customer_phone,
    shipping_address, shipping_district, shipping_canton, shipping_province,
    shipping_cost, subtotal, total, source, order_status, payment_status,
    payment_provider, payment_reference
  ) VALUES (
    'PG Webhook', NULL, '00000000',
    '100m sur', 'Carmen', 'San Jose', 'San Jose',
    0, p_total, p_total, 'web', 'pending', 'pending',
    'onvo', p_reference
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $f$;

CREATE OR REPLACE FUNCTION pg_temp.claim(p_key TEXT, p_type TEXT, p_intent TEXT)
RETURNS JSONB
LANGUAGE sql AS $f$
  SELECT public.claim_webhook_event('onvo-test', p_key, p_type, p_intent, 'hash', 60);
$f$;

DO $$
DECLARE
  v_c        JSONB;
  v_c2       JSONB;
  v_r        JSONB;
  v_order    UUID;
  v_order2   UUID;
  v_paid_at  TIMESTAMPTZ;
  v_row      RECORD;
  v_ok       BOOLEAN;
BEGIN
  -- ── 1. first claim wins; live lease blocks the second ────────────────────
  v_c := pg_temp.claim('t1', 'payment-intent.succeeded', 'pi_t1');
  ASSERT (v_c->>'claimed')::boolean, 'test 1a: first claim must win';
  ASSERT (v_c->>'attempts')::int = 1, 'test 1b: attempts starts at 1';
  v_c2 := pg_temp.claim('t1', 'payment-intent.succeeded', 'pi_t1');
  ASSERT NOT (v_c2->>'claimed')::boolean, 'test 1c: second claim must lose';
  ASSERT v_c2->>'status' = 'processing', 'test 1d: loser sees processing';

  -- ── 2. expired lease is re-claimable ─────────────────────────────────────
  UPDATE public.processed_webhooks SET locked_until = now() - interval '1 second'
   WHERE id = (v_c->>'id')::uuid;
  v_c2 := pg_temp.claim('t1', 'payment-intent.succeeded', 'pi_t1');
  ASSERT (v_c2->>'claimed')::boolean, 'test 2a: expired lease must be re-claimable';
  ASSERT (v_c2->>'attempts')::int = 2, 'test 2b: attempts incremented';
  ASSERT NOT (v_c2->>'effects_applied')::boolean, 'test 2c: no effects applied yet';

  -- ── 3. failed is re-claimable; terminal = duplicate ──────────────────────
  v_ok := public.complete_webhook_event((v_c->>'id')::uuid, 'failed', NULL, 'boom');
  ASSERT v_ok, 'test 3a: complete(failed) must update the row';
  v_c2 := pg_temp.claim('t1', 'payment-intent.succeeded', 'pi_t1');
  ASSERT (v_c2->>'claimed')::boolean, 'test 3b: failed must be re-claimable at once';
  PERFORM public.complete_webhook_event((v_c->>'id')::uuid, 'processed', 'paid', NULL);
  v_c2 := pg_temp.claim('t1', 'payment-intent.succeeded', 'pi_t1');
  ASSERT NOT (v_c2->>'claimed')::boolean, 'test 3c: processed must not be re-claimable';
  ASSERT v_c2->>'status' = 'processed', 'test 3d: duplicate reports processed';
  SELECT * INTO v_row FROM public.processed_webhooks WHERE id = (v_c->>'id')::uuid;
  ASSERT v_row.processed_at IS NOT NULL AND v_row.locked_until IS NULL,
    'test 3e: terminal row has processed_at and no lease';
  ASSERT v_row.last_error IS NULL, 'test 3f: last_error cleared on success';

  -- ── 4. a terminal row is never reopened ──────────────────────────────────
  v_ok := public.complete_webhook_event((v_c->>'id')::uuid, 'failed', NULL, 'late');
  ASSERT NOT v_ok, 'test 4a: complete on a terminal row must be a no-op';
  SELECT status INTO v_row FROM public.processed_webhooks WHERE id = (v_c->>'id')::uuid;
  ASSERT v_row.status = 'processed', 'test 4b: status stays processed';

  -- ── 5. amount mismatch ───────────────────────────────────────────────────
  v_order := pg_temp.make_order(18900, 'pi_t5');
  v_c := pg_temp.claim('t5', 'payment-intent.succeeded', 'pi_t5');
  v_r := public.apply_onvo_payment_succeeded((v_c->>'id')::uuid, v_order, 'pi_t5', 1890000 - 100, 'CRC');
  ASSERT v_r->>'outcome' = 'rejected' AND v_r->>'reason' = 'amount_mismatch',
    format('test 5a: expected amount_mismatch, got %s', v_r);
  ASSERT (SELECT payment_status FROM public.orders WHERE id = v_order) = 'pending',
    'test 5b: order must stay pending';
  ASSERT (SELECT effects_applied_at FROM public.processed_webhooks WHERE id = (v_c->>'id')::uuid) IS NULL,
    'test 5c: no effects recorded';
  ASSERT (SELECT order_id FROM public.processed_webhooks WHERE id = (v_c->>'id')::uuid) = v_order,
    'test 5d: ledger row linked to the order';

  -- ── 6. currency mismatch ─────────────────────────────────────────────────
  v_r := public.apply_onvo_payment_succeeded((v_c->>'id')::uuid, v_order, 'pi_t5', 1890000, 'USD');
  ASSERT v_r->>'reason' = 'currency_mismatch', format('test 6: got %s', v_r);

  -- ── 7. happy path ────────────────────────────────────────────────────────
  v_r := public.apply_onvo_payment_succeeded((v_c->>'id')::uuid, v_order, 'pi_t5', 1890000, 'crc');
  ASSERT v_r->>'outcome' = 'paid' AND v_r->>'reason' = 'marked_paid',
    format('test 7a: expected paid, got %s', v_r);
  ASSERT (v_r->>'order_id')::uuid = v_order, 'test 7b: returns the resolved order';
  SELECT payment_status, order_status, paid_at INTO v_row FROM public.orders WHERE id = v_order;
  ASSERT v_row.payment_status = 'paid' AND v_row.order_status = 'pending' AND v_row.paid_at IS NOT NULL,
    'test 7c: paid, fulfilment untouched';
  v_paid_at := v_row.paid_at;
  ASSERT (SELECT effects_applied_at FROM public.processed_webhooks WHERE id = (v_c->>'id')::uuid) IS NOT NULL,
    'test 7d: effects_applied_at stamped';

  -- ── 8. already paid (same intent, ANOTHER event row) → ignored ───────────
  v_c2 := pg_temp.claim('t8', 'payment-intent.succeeded', 'pi_t5');
  v_r := public.apply_onvo_payment_succeeded((v_c2->>'id')::uuid, v_order, 'pi_t5', 1890000, 'CRC');
  ASSERT v_r->>'outcome' = 'ignored' AND v_r->>'reason' = 'already_paid',
    format('test 8a: got %s', v_r);
  ASSERT (SELECT paid_at FROM public.orders WHERE id = v_order) = v_paid_at,
    'test 8b: paid_at must not move';

  -- ── 14. failed after success never downgrades ────────────────────────────
  v_c2 := pg_temp.claim('t14', 'payment-intent.failed', 'pi_t5');
  v_r := public.apply_onvo_payment_failed((v_c2->>'id')::uuid, v_order, 'pi_t5', true);
  ASSERT v_r->>'outcome' = 'ignored' AND v_r->>'reason' = 'already_paid',
    format('test 14a: got %s', v_r);
  ASSERT (SELECT payment_status FROM public.orders WHERE id = v_order) = 'paid',
    'test 14b: order stays paid';

  -- ── 15. re-claim after effects applied ───────────────────────────────────
  UPDATE public.processed_webhooks SET locked_until = now() - interval '1 second'
   WHERE id = (v_c->>'id')::uuid;
  v_c2 := pg_temp.claim('t5', 'payment-intent.succeeded', 'pi_t5');
  ASSERT (v_c2->>'claimed')::boolean AND (v_c2->>'effects_applied')::boolean,
    format('test 15: expected re-claim with effects_applied, got %s', v_c2);
  ASSERT (v_c2->>'order_id')::uuid = v_order, 'test 15b: re-claim returns order id';

  -- ── 9. denied order → rejected ───────────────────────────────────────────
  v_order := pg_temp.make_order(5000, 'pi_t9');
  UPDATE public.orders SET order_status = 'denied', payment_status = 'failed' WHERE id = v_order;
  v_c := pg_temp.claim('t9', 'payment-intent.succeeded', 'pi_t9');
  v_r := public.apply_onvo_payment_succeeded((v_c->>'id')::uuid, v_order, 'pi_t9', 500000, 'CRC');
  ASSERT v_r->>'outcome' = 'rejected' AND v_r->>'reason' = 'order_denied',
    format('test 9a: got %s', v_r);
  ASSERT (SELECT order_status FROM public.orders WHERE id = v_order) = 'denied',
    'test 9b: order stays denied';

  -- ── 10. unknown order ────────────────────────────────────────────────────
  v_r := public.apply_onvo_payment_succeeded((v_c->>'id')::uuid, gen_random_uuid(), 'pi_x', 100, 'CRC');
  ASSERT v_r->>'outcome' = 'rejected' AND v_r->>'reason' = 'order_not_found',
    format('test 10: got %s', v_r);

  -- ── 11. retryable failed attempt leaves the order pending ────────────────
  v_order := pg_temp.make_order(7000, 'pi_t11');
  v_c := pg_temp.claim('t11', 'payment-intent.failed', 'pi_t11');
  v_r := public.apply_onvo_payment_failed((v_c->>'id')::uuid, v_order, 'pi_t11', false);
  ASSERT v_r->>'reason' = 'retryable_attempt', format('test 11a: got %s', v_r);
  SELECT payment_status, order_status INTO v_row FROM public.orders WHERE id = v_order;
  ASSERT v_row.payment_status = 'pending' AND v_row.order_status = 'pending',
    'test 11b: order must stay payable';

  -- ── 12. intent the order no longer references leaves it pending ──────────
  v_r := public.apply_onvo_payment_failed((v_c->>'id')::uuid, v_order, 'pi_old', true);
  ASSERT v_r->>'outcome' = 'ignored' AND v_r->>'reason' = 'intent_not_associated',
    format('test 12: got %s', v_r);
  ASSERT (SELECT order_status FROM public.orders WHERE id = v_order) = 'pending',
    'test 12b: order stays pending';

  -- ── 13. terminal failure denies the order ────────────────────────────────
  v_r := public.apply_onvo_payment_failed((v_c->>'id')::uuid, v_order, 'pi_t11', true);
  ASSERT v_r->>'outcome' = 'failed' AND v_r->>'reason' = 'marked_failed',
    format('test 13a: got %s', v_r);
  SELECT payment_status, order_status INTO v_row FROM public.orders WHERE id = v_order;
  ASSERT v_row.payment_status = 'failed' AND v_row.order_status = 'denied',
    'test 13b: order failed + denied';

  -- ── 24. failed apply re-entry guard (same event row again) ───────────────
  v_r := public.apply_onvo_payment_failed((v_c->>'id')::uuid, v_order, 'pi_t11', true);
  ASSERT v_r->>'outcome' = 'failed' AND v_r->>'reason' = 'already_applied',
    format('test 24: repeat on the same event must be a no-op, got %s', v_r);
  -- …and a DIFFERENT event for the now-denied order is already_final.
  v_c2 := pg_temp.claim('t24b', 'payment-intent.failed', 'pi_t11');
  v_r := public.apply_onvo_payment_failed((v_c2->>'id')::uuid, v_order, 'pi_t11', true);
  ASSERT v_r->>'reason' = 'already_final', format('test 24b: got %s', v_r);

  -- ════════ Order ↔ intent association ════════════════════════════════════

  -- ── 16. an unrelated intent cannot mark an order paid ────────────────────
  v_order := pg_temp.make_order(18900, 'pi_real_16');
  v_c := pg_temp.claim('t16', 'payment-intent.succeeded', 'pi_attacker_16');
  -- Correct orderId, correct amount and currency — only the intent is foreign.
  v_r := public.apply_onvo_payment_succeeded((v_c->>'id')::uuid, v_order, 'pi_attacker_16', 1890000, 'CRC');
  ASSERT v_r->>'outcome' = 'rejected' AND v_r->>'reason' = 'intent_not_associated',
    format('test 16a: got %s', v_r);
  SELECT payment_status, paid_at INTO v_row FROM public.orders WHERE id = v_order;
  ASSERT v_row.payment_status = 'pending' AND v_row.paid_at IS NULL,
    'test 16b: order must NOT be paid by an unrelated intent';
  SELECT effects_applied_at, order_id INTO v_row FROM public.processed_webhooks WHERE id = (v_c->>'id')::uuid;
  ASSERT v_row.effects_applied_at IS NULL, 'test 16c: no effects recorded';
  ASSERT v_row.order_id = v_order, 'test 16d: ledger linked to the hinted order for review';

  -- ── 17. unrelated intent on an already-PAID order → rejected ─────────────
  UPDATE public.orders SET payment_status = 'paid', paid_at = now() - interval '1 day'
   WHERE id = v_order;
  SELECT paid_at INTO v_paid_at FROM public.orders WHERE id = v_order;
  v_c := pg_temp.claim('t17', 'payment-intent.succeeded', 'pi_second_charge_17');
  v_r := public.apply_onvo_payment_succeeded((v_c->>'id')::uuid, v_order, 'pi_second_charge_17', 1890000, 'CRC');
  ASSERT v_r->>'outcome' = 'rejected' AND v_r->>'reason' = 'intent_not_associated',
    format('test 17a: a second charge must be flagged, not ignored; got %s', v_r);
  ASSERT (SELECT paid_at FROM public.orders WHERE id = v_order) = v_paid_at,
    'test 17b: paid order untouched';

  -- ── 18. orderId names a different order than the intent's owner ──────────
  v_order  := pg_temp.make_order(10000, 'pi_owner_18');
  v_order2 := pg_temp.make_order(10000, 'pi_other_18');
  v_c := pg_temp.claim('t18', 'payment-intent.succeeded', 'pi_owner_18');
  v_r := public.apply_onvo_payment_succeeded((v_c->>'id')::uuid, v_order2, 'pi_owner_18', 1000000, 'CRC');
  ASSERT v_r->>'outcome' = 'rejected' AND v_r->>'reason' = 'order_mismatch',
    format('test 18a: got %s', v_r);
  ASSERT (SELECT payment_status FROM public.orders WHERE id = v_order) = 'pending'
     AND (SELECT payment_status FROM public.orders WHERE id = v_order2) = 'pending',
    'test 18b: neither order may change';
  ASSERT (SELECT order_id FROM public.processed_webhooks WHERE id = (v_c->>'id')::uuid) = v_order,
    'test 18c: ledger linked to the TRUSTED owner';

  -- ── 19. no orderId: resolved from payment_reference ──────────────────────
  v_c := pg_temp.claim('t19', 'payment-intent.succeeded', 'pi_owner_18');
  v_r := public.apply_onvo_payment_succeeded((v_c->>'id')::uuid, NULL, 'pi_owner_18', 1000000, 'CRC');
  ASSERT v_r->>'outcome' = 'paid' AND (v_r->>'order_id')::uuid = v_order,
    format('test 19a: got %s', v_r);
  ASSERT (SELECT payment_status FROM public.orders WHERE id = v_order2) = 'pending',
    'test 19b: the other order is untouched';

  -- ── 20. intent referenced by two orders ──────────────────────────────────
  v_order  := pg_temp.make_order(10000, 'pi_dup_20');
  v_order2 := pg_temp.make_order(10000, 'pi_dup_20');
  v_c := pg_temp.claim('t20', 'payment-intent.succeeded', 'pi_dup_20');
  v_r := public.apply_onvo_payment_succeeded((v_c->>'id')::uuid, v_order, 'pi_dup_20', 1000000, 'CRC');
  ASSERT v_r->>'outcome' = 'rejected' AND v_r->>'reason' = 'ambiguous_intent',
    format('test 20a: got %s', v_r);
  ASSERT (SELECT count(*) FROM public.orders WHERE id IN (v_order, v_order2)
           AND payment_status = 'pending') = 2,
    'test 20b: neither order may change';

  -- ── 21. order without payment_reference ──────────────────────────────────
  v_order := pg_temp.make_order(10000, NULL);
  v_c := pg_temp.claim('t21', 'payment-intent.succeeded', 'pi_any_21');
  v_r := public.apply_onvo_payment_succeeded((v_c->>'id')::uuid, v_order, 'pi_any_21', 1000000, 'CRC');
  ASSERT v_r->>'reason' = 'intent_not_associated', format('test 21: got %s', v_r);
  ASSERT (SELECT payment_status FROM public.orders WHERE id = v_order) = 'pending',
    'test 21b: stays pending';

  -- ── 22. unrelated terminal failure does not deny ─────────────────────────
  v_order := pg_temp.make_order(10000, 'pi_real_22');
  v_c := pg_temp.claim('t22', 'payment-intent.failed', 'pi_foreign_22');
  v_r := public.apply_onvo_payment_failed((v_c->>'id')::uuid, v_order, 'pi_foreign_22', true);
  ASSERT v_r->>'outcome' = 'ignored' AND v_r->>'reason' = 'intent_not_associated',
    format('test 22a: got %s', v_r);
  ASSERT (SELECT order_status FROM public.orders WHERE id = v_order) = 'pending',
    'test 22b: order stays pending';

  -- ════════ Crash window ══════════════════════════════════════════════════

  -- ── 23. claim → apply (COMMIT) → crash → lease expiry → resume ───────────
  v_order := pg_temp.make_order(18900, 'pi_crash_23');
  v_c := pg_temp.claim('t23', 'payment-intent.succeeded', 'pi_crash_23');
  v_r := public.apply_onvo_payment_succeeded((v_c->>'id')::uuid, v_order, 'pi_crash_23', 1890000, 'CRC');
  ASSERT v_r->>'outcome' = 'paid', format('test 23a: got %s', v_r);
  SELECT paid_at INTO v_paid_at FROM public.orders WHERE id = v_order;
  -- [worker dies here: no notifications, no complete_webhook_event]
  SELECT status, effects_applied_at INTO v_row FROM public.processed_webhooks WHERE id = (v_c->>'id')::uuid;
  ASSERT v_row.status = 'processing' AND v_row.effects_applied_at IS NOT NULL,
    'test 23b: crash state = processing + effects applied';

  v_c2 := pg_temp.claim('t23', 'payment-intent.succeeded', 'pi_crash_23');
  ASSERT NOT (v_c2->>'claimed')::boolean AND v_c2->>'status' = 'processing',
    format('test 23c: live lease must block a redelivery, got %s', v_c2);

  UPDATE public.processed_webhooks SET locked_until = now() - interval '1 second'
   WHERE id = (v_c->>'id')::uuid;
  v_c2 := pg_temp.claim('t23', 'payment-intent.succeeded', 'pi_crash_23');
  ASSERT (v_c2->>'claimed')::boolean
     AND (v_c2->>'effects_applied')::boolean
     AND (v_c2->>'order_id')::uuid = v_order,
    format('test 23d: re-claim must report effects_applied + trusted order id, got %s', v_c2);

  -- Even if a caller ignored effects_applied and applied again:
  v_r := public.apply_onvo_payment_succeeded((v_c->>'id')::uuid, v_order, 'pi_crash_23', 1890000, 'CRC');
  ASSERT v_r->>'outcome' = 'paid' AND v_r->>'reason' = 'already_applied'
     AND (v_r->>'order_id')::uuid = v_order,
    format('test 23e: second apply must be a no-op, got %s', v_r);
  ASSERT (SELECT paid_at FROM public.orders WHERE id = v_order) = v_paid_at,
    'test 23f: paid_at must not move';

  v_ok := public.complete_webhook_event((v_c->>'id')::uuid, 'processed', 'resumed_after_apply', NULL);
  ASSERT v_ok, 'test 23g: resumed event closes out';
  v_c2 := pg_temp.claim('t23', 'payment-intent.succeeded', 'pi_crash_23');
  ASSERT NOT (v_c2->>'claimed')::boolean AND v_c2->>'status' = 'processed',
    format('test 23h: afterwards it is a terminal duplicate, got %s', v_c2);
  ASSERT (SELECT attempts FROM public.processed_webhooks WHERE id = (v_c->>'id')::uuid) = 2,
    'test 23i: exactly two attempts recorded';

  RAISE NOTICE 'ALL ONVO WEBHOOK LEDGER TESTS PASSED';
END $$;

SELECT 'ALL ONVO WEBHOOK LEDGER TESTS PASSED' AS result;

-- Nothing above is kept.
ROLLBACK;
