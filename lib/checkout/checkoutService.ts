import type { SupabaseClient } from "@supabase/supabase-js";
import { signOrderToken, verifyOrderToken } from "@/lib/orders/tokens";
import type { Database } from "@/types/database";
import { alreadyPaidError, sessionNotFoundError } from "./errors";
import { resolveShippingCost } from "@/lib/shipping/localDelivery";
import {
  calculateShipping,
  cancelOrder,
  itemsMatch,
  loadOrder,
  placeOrder,
  setShippingTotals,
  stampPayment,
  updateOrder,
  type PendingOrder,
} from "./orderService";
import { findProcessorByProvider, getPaymentProcessor } from "./payments/registry";
import type {
  PaymentContext,
  PaymentPreparation,
  PaymentProcessor,
  PaymentRecord,
} from "./payments/types";
import type {
  CheckoutCustomer,
  CheckoutLineItem,
  CheckoutSessionRef,
  CheckoutShipping,
  PaymentMethodId,
} from "./types";

/**
 * Collaborators injected by the caller rather than constructed here, so the
 * service has no opinion about Next, cookies, or how auth was established.
 *
 * `supabase` MUST be the request-scoped RLS client: place_order is SECURITY
 * DEFINER and reads auth.uid() to attach the order to a logged-in user and clear
 * their server cart. `admin` bypasses RLS for writes that no user policy permits
 * (orders has only "Admins can update orders").
 */
export interface CheckoutDeps {
  supabase: SupabaseClient<Database>;
  admin: SupabaseClient<Database>;
}

export interface CheckoutInput {
  customer: CheckoutCustomer;
  shipping: CheckoutShipping;
  items: CheckoutLineItem[];
  notes?: string;
  payment_method: PaymentMethodId;
  /** Present once this checkout has a live pending order. */
  session?: CheckoutSessionRef;
}

export interface CheckoutResult {
  order_id: string;
  order_number: number;
  subtotal: number;
  shipping_cost: number;
  total: number;
  item_count: number;
  order_token: string;
  payment_method: PaymentMethodId;
  /**
   * null means "nothing changed — keep using what you already have". Only ever
   * null on the update path; a fresh order always returns a preparation.
   */
  payment: PaymentPreparation | null;
}

/**
 * The checkout entrypoint. Decides whether this submit continues an existing
 * pending order or starts a new one, then delegates all payment work to a
 * processor resolved from the registry.
 *
 * Contains zero provider-specific logic — adding a payment method must never
 * require an edit to this file.
 */
export async function submitCheckout(
  deps: CheckoutDeps,
  input: CheckoutInput
): Promise<CheckoutResult> {
  const existing = await resolvePendingOrder(deps, input.session);

  if (!existing) {
    return createCheckout(deps, input);
  }

  // The cart changed under us (edited in another tab, or via /cart and back).
  // Item deltas need stock changes place_order can't express, so retire this
  // order — restoring its stock — and place a fresh one. Cancelling FIRST is what
  // preserves the invariant: never two live pending orders for one checkout.
  if (!itemsMatch(existing.items, input.items)) {
    const processor = findProcessorByProvider(existing.payment_provider);
    if (processor) {
      await processor.releasePayment(paymentRecordOf(existing));
    }
    await cancelOrder(deps.admin, existing.id, "Cart changed during checkout");
    return createCheckout(deps, input);
  }

  return updateCheckout(deps, input, existing);
}

/**
 * Resolve the session ref to a *usable* pending order, or null to mean "start a
 * new one".
 *
 * Terminal orders resolve to null rather than an error: if the sweep denied the
 * order while the customer sat idle (30 min), or a payment failed, the right
 * answer is a fresh order — its stock was already restored. Only `paid` is an
 * error, because re-placing would charge them twice.
 */
async function resolvePendingOrder(
  deps: CheckoutDeps,
  session: CheckoutSessionRef | undefined
): Promise<PendingOrder | null> {
  if (!session) return null;

  // The HMAC is the authorization: order_id alone is guessable-shaped, and 404
  // (not 403) keeps us from confirming someone else's order id exists.
  if (!verifyOrderToken(session.order_id, session.order_token)) {
    throw sessionNotFoundError();
  }

  const order = await loadOrder(deps.admin, session.order_id);
  if (!order) throw sessionNotFoundError();

  if (order.payment_status === "paid") throw alreadyPaidError();

  const isLive =
    order.order_status === "pending" && order.payment_status === "pending";
  return isLive ? order : null;
}

/** Place a new order, reserve stock, and prepare its payment. */
async function createCheckout(
  deps: CheckoutDeps,
  input: CheckoutInput
): Promise<CheckoutResult> {
  const processor = getPaymentProcessor(input.payment_method);

  const placed = await placeOrder(deps.supabase, {
    customer: input.customer,
    shipping: input.shipping,
    items: input.items,
    notes: input.notes,
  });

  /*
   * Free local delivery, applied to the rate place_order just computed.
   *
   * It has to happen HERE, before the payment is prepared, because the payment
   * is created for a specific total — charging the zone rate and refunding it
   * afterwards is not a thing we can do. Eligibility is re-derived from the
   * address, so the customer's checkbox cannot lower the price on its own.
   *
   * The write is ordered before createPayment for the same reason the rest of
   * this function is ordered the way it is: if it throws, the catch below has
   * not yet minted a payment to clean up, and the order is cancelled with its
   * stock restored.
   */
  const shipping = resolveShippingCost(
    placed.shipping_cost,
    input.shipping,
    input.shipping.local_delivery
  );
  /*
   * Derived from place_order's own total by SUBTRACTING the reduction, rather
   * than recomputed as subtotal + shipping. They are identical today — the RPC
   * sets total = subtotal + shipping_cost — but if it ever grows another term
   * (the admin order path already has a discount column), recomputing here
   * would silently drop it. A delta cannot.
   */
  const total = placed.total - (placed.shipping_cost - shipping.cost);

  if (shipping.localDeliveryApplied && shipping.cost !== placed.shipping_cost) {
    try {
      await setShippingTotals(deps.admin, placed.order_id, shipping.cost, total);
    } catch (err) {
      await cancelOrder(deps.admin, placed.order_id, "Shipping override failed");
      throw err;
    }
  }

  const ctx: PaymentContext = {
    order_id: placed.order_id,
    order_number: placed.order_number,
    total,
    customer: input.customer,
  };

  // From here on, anything that fails must release the stock place_order reserved.
  let preparation: PaymentPreparation;
  try {
    preparation = await processor.createPayment(ctx);
  } catch (err) {
    await cancelOrder(deps.admin, placed.order_id, "Payment preparation failed");
    throw err;
  }

  try {
    await stampPayment(
      deps.admin,
      placed.order_id,
      processor.provider,
      referenceOf(preparation)
    );
  } catch (err) {
    await processor.releasePayment({
      provider: processor.provider,
      reference: referenceOf(preparation),
      total,
    });
    await cancelOrder(deps.admin, placed.order_id, "Payment stamp failed");
    throw err;
  }

  return {
    order_id: placed.order_id,
    order_number: placed.order_number,
    subtotal: placed.subtotal,
    shipping_cost: shipping.cost,
    total,
    item_count: placed.item_count,
    order_token: signOrderToken(placed.order_id),
    payment_method: input.payment_method,
    payment: preparation,
  };
}

/**
 * Apply edits to the existing pending order — same order id, same reserved stock.
 *
 * Ordered so that only ONE mutation exists, and every fallible step precedes it:
 *
 *   1. recompute shipping   read-only (calculate_shipping_cost is STABLE)
 *   2. derive new total     pure
 *   3. prepare payment      provider call — may throw
 *   4. single UPDATE        atomic
 *
 * A DB transaction can't span an HTTP call to Onvo, so instead of compensating
 * afterwards we make the bad state unreachable: if step 3 throws, nothing has been
 * written and the order still matches its intent. This works because subtotal
 * cannot change here — items are identical by precondition and unit prices are
 * snapshotted in order_items — so the new total is computable without writing.
 *
 * Note we do NOT reuse the create path's cancelOrder() on failure: nuking a live
 * order and releasing its stock because Onvo hiccuped on an address edit would be
 * a far worse outcome than asking the customer to retry.
 */
async function updateCheckout(
  deps: CheckoutDeps,
  input: CheckoutInput,
  order: PendingOrder
): Promise<CheckoutResult> {
  const processor = getPaymentProcessor(input.payment_method);

  // Same two steps as the create path: the zone rate, then the local-delivery
  // override on top of it. An edit that moves the address out of Cariari — or
  // unticks the box — recomputes at the standard rate, because eligibility is
  // re-derived from the address every time rather than remembered on the order.
  const zoneCost = await calculateShipping(
    deps.supabase,
    input.shipping.canton_code,
    order.subtotal
  );
  const shipping = resolveShippingCost(
    zoneCost,
    input.shipping,
    input.shipping.local_delivery
  );
  const shippingCost = shipping.cost;
  const total = order.subtotal + shippingCost;

  const ctx: PaymentContext = {
    order_id: order.id,
    order_number: order.order_number,
    total,
    customer: input.customer,
  };
  const previous = paymentRecordOf(order);

  const outcome = await preparePaymentForUpdate(processor, ctx, previous, order);

  try {
    await updateOrder(deps.admin, order.id, {
      customer: input.customer,
      shipping: input.shipping,
      notes: input.notes,
      shipping_cost: shippingCost,
      total,
      payment_provider: processor.provider,
      // Leave payment_reference untouched when we reused the existing payment.
      ...(outcome && {
        payment_reference: referenceOf(outcome) ?? undefined,
      }),
    });
  } catch (err) {
    // The write failed, so the order still holds its OLD total and OLD intent —
    // consistent. Any replacement we just minted is now an orphan; drop it.
    if (outcome) {
      await processor.releasePayment({
        provider: processor.provider,
        reference: referenceOf(outcome),
        total,
      });
    }
    throw err;
  }

  return {
    order_id: order.id,
    order_number: order.order_number,
    subtotal: order.subtotal,
    shipping_cost: shippingCost,
    total,
    item_count: order.items.reduce((sum, item) => sum + item.quantity, 0),
    order_token: signOrderToken(order.id),
    payment_method: input.payment_method,
    payment: outcome,
  };
}

/**
 * Prepare payment for an order being updated. Returns null when the existing
 * payment is still valid and the client should keep what it has.
 *
 * Handles the two shapes an update can take — same method (delegate to the
 * processor's own reuse rule) or a method switch (tear down the old provider's
 * object, stand up the new one) — without either processor knowing the other
 * exists.
 */
async function preparePaymentForUpdate(
  processor: PaymentProcessor,
  ctx: PaymentContext,
  previous: PaymentRecord,
  order: PendingOrder
): Promise<PaymentPreparation | null> {
  const switchedMethod = order.payment_provider !== processor.provider;

  if (!switchedMethod) {
    const result = await processor.updatePayment(ctx, previous);
    return result.changed ? result.preparation : null;
  }

  // Build the replacement before releasing the old one: if this throws, the
  // customer keeps a working payment on their original method.
  const preparation = await processor.createPayment(ctx);
  const outgoing = findProcessorByProvider(order.payment_provider);
  if (outgoing) {
    await outgoing.releasePayment(previous);
  }
  return preparation;
}

function paymentRecordOf(order: PendingOrder): PaymentRecord {
  return {
    // A pre-refactor order with an unrecognized provider normalizes to null; treat
    // it as an Onvo card order, which is what every legacy order actually was.
    provider: order.payment_provider ?? "onvo",
    reference: order.payment_reference,
    total: order.total,
  };
}

/** The provider-side id worth persisting, if this preparation has one. */
function referenceOf(preparation: PaymentPreparation): string | null {
  return preparation.kind === "onvo_card" ? preparation.intent_id : null;
}
