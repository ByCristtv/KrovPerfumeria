import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { CheckoutError, internalError } from "./errors";
import type {
  CheckoutCustomer,
  CheckoutLineItem,
  CheckoutShipping,
  PaymentProvider,
} from "./types";

type AdminClient = SupabaseClient<Database>;

/** Shape returned by the place_order RPC. */
export interface PlaceOrderResult {
  order_id: string;
  order_number: number;
  subtotal: number;
  shipping_cost: number;
  total: number;
  item_count: number;
  shipping: {
    cost: number;
    zone_code: string;
    zone_name: string;
    free_shipping_applied: boolean;
    free_shipping_threshold: number | null;
  };
}

/** A pending order plus everything needed to decide create-vs-update. */
export interface PendingOrder {
  id: string;
  order_number: number;
  subtotal: number;
  shipping_cost: number;
  total: number;
  order_status: Database["public"]["Enums"]["order_status"];
  payment_status: Database["public"]["Enums"]["payment_status"];
  payment_provider: PaymentProvider | null;
  payment_reference: string | null;
  items: Array<{ variant_id: string | null; quantity: number }>;
}

/** Field set the update path is allowed to touch. */
export interface OrderUpdate {
  customer: CheckoutCustomer;
  shipping: CheckoutShipping;
  notes?: string;
  shipping_cost: number;
  total: number;
  payment_provider: PaymentProvider;
  /** Only written when a new one was minted; undefined leaves the column alone. */
  payment_reference?: string;
}

/**
 * Orders, and only orders. No payment providers, no HTTP, no orchestration —
 * checkoutService composes this with a PaymentProcessor.
 */

/**
 * Place a new order: creates the row, snapshots line items at current prices, and
 * atomically decrements stock. Failure means nothing was created.
 *
 * Runs through the caller's RLS-scoped client (not admin) because place_order is
 * SECURITY DEFINER and reads auth.uid() to attach the order to a logged-in user
 * and clear their server cart. Calling it as service_role would orphan every
 * authenticated order as a guest order.
 */
export async function placeOrder(
  supabase: SupabaseClient<Database>,
  payload: {
    customer: CheckoutCustomer;
    shipping: CheckoutShipping;
    items: CheckoutLineItem[];
    notes?: string;
  }
): Promise<PlaceOrderResult> {
  const { data, error } = await supabase.rpc("place_order", {
    p_payload: payload as unknown as Json,
  });

  if (error) throw translateRpcError(error);
  if (!data) {
    console.error("[checkout] place_order returned no data", { payload });
    throw internalError("place_order returned no data");
  }

  return data as unknown as PlaceOrderResult;
}

/**
 * Load an order plus its line items. Uses the admin client — callers must have
 * already proven authorization (HMAC token or RLS probe), because RLS has no
 * user-UPDATE policy on orders and we need a uniform read either way.
 *
 * Returns null when the order doesn't exist.
 */
export async function loadOrder(
  admin: AdminClient,
  orderId: string
): Promise<PendingOrder | null> {
  const { data, error } = await admin
    .from("orders")
    .select(
      `id, order_number, subtotal, shipping_cost, total,
       order_status, payment_status, payment_provider, payment_reference,
       order_items ( variant_id, quantity )`
    )
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    console.error("[checkout] order load failed", { orderId, error });
    throw internalError("order load failed");
  }
  if (!data) return null;

  return {
    id: data.id,
    order_number: data.order_number,
    subtotal: data.subtotal,
    shipping_cost: data.shipping_cost,
    total: data.total,
    order_status: data.order_status,
    payment_status: data.payment_status,
    // The column is free-text; anything we didn't write is not a provider we can
    // act on, so normalize it to null rather than lying about the type.
    payment_provider: asKnownProvider(data.payment_provider),
    payment_reference: data.payment_reference,
    items: data.order_items ?? [],
  };
}

/**
 * Recompute shipping for a canton against a known subtotal.
 *
 * Read-only (the RPC is STABLE), which is what lets the update path compute the
 * new total and call the payment provider BEFORE writing anything.
 */
export async function calculateShipping(
  supabase: SupabaseClient<Database>,
  cantonCode: string,
  subtotal: number
): Promise<number> {
  const { data, error } = await supabase.rpc("calculate_shipping_cost", {
    p_canton_code: cantonCode,
    p_subtotal: subtotal,
  });

  if (error || !data) {
    console.error("[checkout] calculate_shipping_cost failed", {
      cantonCode,
      subtotal,
      error,
    });
    throw internalError("shipping calculation failed");
  }

  const cost = (data as unknown as { cost: number }).cost;
  if (typeof cost !== "number") {
    throw internalError("shipping calculation returned no cost");
  }
  return cost;
}

/**
 * Apply the customer's edits to an existing pending order.
 *
 * ONE statement by design: every fallible step (shipping calc, provider call)
 * happens before this, so there is no window where the order is updated but its
 * payment is stale. A single UPDATE is atomic, which makes that state unreachable
 * rather than something we'd have to compensate for.
 *
 * Never touches items, stock, or order_status — an edit keeps the same order and
 * the same reservation.
 */
export async function updateOrder(
  admin: AdminClient,
  orderId: string,
  update: OrderUpdate
): Promise<void> {
  const { error } = await admin
    .from("orders")
    .update({
      customer_name: update.customer.name,
      customer_email: update.customer.email,
      customer_phone: update.customer.phone,
      shipping_address: update.shipping.address,
      shipping_canton: update.shipping.canton_name,
      shipping_district: update.shipping.district ?? "",
      shipping_province: update.shipping.province_name,
      shipping_reference: update.shipping.reference ?? null,
      notes: update.notes ?? null,
      shipping_cost: update.shipping_cost,
      total: update.total,
      payment_provider: update.payment_provider,
      ...(update.payment_reference !== undefined && {
        payment_reference: update.payment_reference,
      }),
    })
    .eq("id", orderId);

  if (error) {
    console.error("[checkout] order update failed", { orderId, error });
    throw internalError("order update failed");
  }
}

/**
 * Rewrite an order's shipping cost and total, and nothing else.
 *
 * Exists for the free-local-delivery override, which can only be applied AFTER
 * place_order has run: the RPC computes the zone rate itself, and its result is
 * what the override reduces. Deliberately narrower than `updateOrder` — this
 * runs on the create path, where the customer and address were just written by
 * the RPC and must not be re-sent from the request.
 */
export async function setShippingTotals(
  admin: AdminClient,
  orderId: string,
  shippingCost: number,
  total: number
): Promise<void> {
  const { error } = await admin
    .from("orders")
    .update({ shipping_cost: shippingCost, total })
    .eq("id", orderId);

  if (error) {
    console.error("[checkout] shipping override failed", { orderId, error });
    throw internalError("shipping override failed");
  }
}

/** Stamp provider info on a freshly placed order. */
export async function stampPayment(
  admin: AdminClient,
  orderId: string,
  provider: PaymentProvider,
  reference: string | null
): Promise<void> {
  const { error } = await admin
    .from("orders")
    .update({ payment_provider: provider, payment_reference: reference })
    .eq("id", orderId);

  if (error) {
    console.error("[checkout] payment stamp failed", { orderId, error });
    throw internalError("payment stamp failed");
  }
}

/**
 * Release an order's stock and take it out of play.
 *
 * Best-effort: if this fails we log loudly but don't throw. The caller has already
 * decided the order is dead, and an operator has stock_movements + orders rows to
 * reconcile by hand — whereas throwing here would surface an error for an order
 * the customer has already moved on from.
 */
export async function cancelOrder(
  admin: AdminClient,
  orderId: string,
  reason: string
): Promise<void> {
  const { error: restoreErr } = await admin.rpc("restore_variant_stock", {
    p_order_id: orderId,
  });
  if (restoreErr) {
    console.error("[checkout] restore_variant_stock FAILED", {
      orderId,
      reason,
      restoreErr,
    });
  }

  const { error: denyErr } = await admin
    .from("orders")
    .update({
      order_status: "denied",
      payment_status: "failed",
      notes: `Cancelled: ${reason}`,
    })
    .eq("id", orderId);
  if (denyErr) {
    console.error("[checkout] order denial UPDATE FAILED", {
      orderId,
      reason,
      denyErr,
    });
  }
}

/**
 * Do the requested items match what the order already reserved?
 *
 * Compares as a multiset of variant_id → total quantity, so reordering the cart
 * or splitting a line doesn't read as a change. A null variant_id (variant deleted
 * since the order was placed) can never match and forces the cancel-and-replace
 * path, which is the safe answer.
 */
export function itemsMatch(
  orderItems: Array<{ variant_id: string | null; quantity: number }>,
  requested: CheckoutLineItem[]
): boolean {
  const tally = (
    entries: Array<{ variant_id: string | null; quantity: number }>
  ): Map<string, number> | null => {
    const map = new Map<string, number>();
    for (const entry of entries) {
      if (!entry.variant_id) return null;
      map.set(entry.variant_id, (map.get(entry.variant_id) ?? 0) + entry.quantity);
    }
    return map;
  };

  const a = tally(orderItems);
  const b = tally(requested);
  if (!a || !b || a.size !== b.size) return false;

  for (const [variantId, quantity] of a) {
    if (b.get(variantId) !== quantity) return false;
  }
  return true;
}

/** Narrow the free-text payment_provider column to a provider we can act on. */
function asKnownProvider(value: string | null): PaymentProvider | null {
  return value === "onvo" || value === "manual_sinpe" ? value : null;
}

/**
 * Map place_order's RAISE EXCEPTION messages onto codes the client can branch on.
 * Preserved verbatim from the previous route handler — these strings are a
 * contract with the RPC.
 */
function translateRpcError(error: PostgrestError): CheckoutError {
  const msg = error.message ?? "";

  // Full-bottle/set stock ("Insufficient stock …") and the decant ml-pool
  // ("Insufficient decant liquid …") are the same thing to the customer: an item
  // in the cart no longer has enough inventory. Map both to one recoverable code.
  if (/^Insufficient (stock|decant liquid)/i.test(msg)) {
    return new CheckoutError(
      "stock_unavailable",
      "Lo sentimos, ya no hay stock suficiente para uno de los productos del carrito. Por favor actualiza tu carrito.",
      409,
      msg
    );
  }
  if (/no longer (exists|available)/i.test(msg)) {
    return new CheckoutError(
      "variant_unavailable",
      "Uno de los productos ya no está disponible. Por favor revisa tu carrito.",
      410,
      msg
    );
  }
  if (/^items /i.test(msg)) {
    return new CheckoutError(
      "empty_cart",
      "Tu carrito está vacío. Agrega productos para continuar.",
      400,
      msg
    );
  }
  if (/^(customer|shipping)\./i.test(msg)) {
    return new CheckoutError(
      "validation_failed",
      "Datos del pedido incompletos. Por favor revisa el formulario.",
      400,
      msg
    );
  }

  console.error("[checkout] unexpected RPC error", error);
  return internalError(
    process.env.NODE_ENV === "development" ? msg : undefined
  );
}
