// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  hashPayload,
  isMinorUnitAmount,
  isOrderId,
  isTerminalFailure,
  parseOnvoWebhook,
  webhookEventKey,
} from "./event";

const ORDER_ID = "fc006d09-ae68-4f9e-832f-50a458ca5040";

function parseIntent(body: unknown) {
  const result = parseOnvoWebhook(JSON.stringify(body));
  if (!result.ok || result.event.kind !== "payment_intent") {
    throw new Error(`expected a payment_intent event, got ${JSON.stringify(result)}`);
  }
  return result.event;
}

describe("parseOnvoWebhook", () => {
  it("rejects non-JSON bodies", () => {
    expect(parseOnvoWebhook("not json")).toMatchObject({ ok: false, reason: "invalid_json" });
    expect(parseOnvoWebhook("")).toMatchObject({ ok: false, reason: "invalid_json" });
  });

  it("rejects envelopes without type or data", () => {
    expect(parseOnvoWebhook("[]")).toMatchObject({ ok: false, reason: "malformed_event" });
    expect(parseOnvoWebhook(JSON.stringify({ data: {} }))).toMatchObject({
      ok: false,
      reason: "malformed_event",
    });
    expect(
      parseOnvoWebhook(JSON.stringify({ type: "payment-intent.succeeded" }))
    ).toMatchObject({ ok: false, reason: "malformed_event" });
  });

  it("rejects payment-intent events that cannot be keyed (no data.id)", () => {
    const r = parseOnvoWebhook(
      JSON.stringify({ type: "payment-intent.succeeded", data: { amount: 100 } })
    );
    expect(r).toMatchObject({ ok: false, reason: "malformed_event" });
  });

  it("treats other event types as inert, even without data.id", () => {
    expect(
      parseOnvoWebhook(
        JSON.stringify({ type: "subscription.renewal.failed", data: { subscriptionId: "s" } })
      )
    ).toEqual({
      ok: true,
      event: { kind: "inert", type: "subscription.renewal.failed", objectId: null },
    });
    expect(
      parseOnvoWebhook(JSON.stringify({ type: "something.new", data: { id: "x" } }))
    ).toMatchObject({ ok: true, event: { kind: "inert", objectId: "x" } });
  });

  it("extracts the documented succeeded fields", () => {
    const e = parseIntent({
      type: "payment-intent.succeeded",
      data: {
        id: "pi_1",
        amount: 1_890_000,
        currency: "CRC",
        status: "succeeded",
        metadata: { orderId: ORDER_ID, orderNumber: "144" },
        customer: { name: "Private", email: "private@example.com" },
      },
    });
    expect(e).toMatchObject({
      type: "payment-intent.succeeded",
      intentId: "pi_1",
      orderRef: ORDER_ID,
      amount: 1_890_000,
      currency: "CRC",
      intentStatus: "succeeded",
      attemptId: null,
    });
  });

  it("keeps business problems out of the parse result (they are processor rejections)", () => {
    const e = parseIntent({ type: "payment-intent.succeeded", data: { id: "pi_1" } });
    expect(e).toMatchObject({ orderRef: null, amount: null, currency: null });
  });

  it("extracts the attempt id and code from a failed event", () => {
    const e = parseIntent({
      type: "payment-intent.failed",
      data: {
        id: "pi_1",
        status: "requires_payment_method",
        metadata: { orderId: ORDER_ID },
        error: { id: "err_1", code: "declined", message: "Tarjeta declinada" },
      },
    });
    expect(e).toMatchObject({ attemptId: "err_1", errorCode: "declined" });
  });
});

describe("webhookEventKey", () => {
  const succeeded = () =>
    parseIntent({ type: "payment-intent.succeeded", data: { id: "pi_1", amount: 1 } });
  const failed = (errorId?: string, extra: Record<string, unknown> = {}) =>
    parseIntent({
      type: "payment-intent.failed",
      data: { id: "pi_1", ...(errorId && { error: { id: errorId } }), ...extra },
    });

  it("never lets a decline share a key with the success of the same intent", () => {
    // The old key was the bare intent id for both — a decline then suppressed
    // the later success on the same intent.
    expect(webhookEventKey(failed("err_1"))).not.toBe(webhookEventKey(succeeded()));
  });

  it("is stable for redeliveries", () => {
    expect(webhookEventKey(succeeded())).toBe("payment-intent.succeeded:pi_1");
    expect(webhookEventKey(failed("err_1"))).toBe("payment-intent.failed:pi_1:err_1");
  });

  it("distinguishes separate declined attempts on one intent", () => {
    expect(webhookEventKey(failed("err_1"))).not.toBe(webhookEventKey(failed("err_2")));
  });

  it("falls back to the payload hash when the attempt has no id", () => {
    const a = failed(undefined, { note: "a" });
    const b = failed(undefined, { note: "b" });
    expect(webhookEventKey(a)).toBe(`payment-intent.failed:pi_1:sha256-${a.payloadHash}`);
    expect(webhookEventKey(a)).not.toBe(webhookEventKey(b));
    expect(webhookEventKey(a)).toBe(webhookEventKey(failed(undefined, { note: "a" })));
  });
});

describe("rule helpers", () => {
  it("only treats documented end states as terminal failures", () => {
    expect(isTerminalFailure("requires_payment_method")).toBe(false);
    expect(isTerminalFailure("requires_action")).toBe(false);
    expect(isTerminalFailure(null)).toBe(false);
    expect(isTerminalFailure("failed")).toBe(true);
    expect(isTerminalFailure("canceled")).toBe(true);
    expect(isTerminalFailure("CANCELLED")).toBe(true);
  });

  it("accepts only UUID order references", () => {
    expect(isOrderId(ORDER_ID)).toBe(true);
    expect(isOrderId("144")).toBe(false);
    expect(isOrderId("' OR 1=1 --")).toBe(false);
    expect(isOrderId(null)).toBe(false);
  });

  it("accepts only non-negative integer minor-unit amounts", () => {
    expect(isMinorUnitAmount(1_890_000)).toBe(true);
    expect(isMinorUnitAmount(18_900.5)).toBe(false);
    expect(isMinorUnitAmount(-1)).toBe(false);
    expect(isMinorUnitAmount(null)).toBe(false);
  });

  it("hashes payloads deterministically", () => {
    expect(hashPayload("abc")).toBe(hashPayload("abc"));
    expect(hashPayload("abc")).toHaveLength(64);
  });
});
