import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type { AdminOrderInput, AdminOrderResult } from "@/types/adminOrder";
import {
  adminOrderInputSchema,
  firstIssueMessage,
  type AdminOrderInputValidated,
} from "@/schemas/adminOrder";
import type { NotifyResult } from "@/lib/notifications/orderNotifier";

/**
 * The manual-order use case: an admin takes an order over WhatsApp/phone and the
 * store records it on the customer's behalf.
 *
 * Lives outside the Server Action so the business rules — validate, persist,
 * then notify the customer only if there is someone to notify — can be exercised
 * without Next.js, without a database and without Resend. The action around it
 * stays a transport adapter: authorization boundary, cache revalidation, and
 * turning failures into Spanish copy.
 *
 * ORDERING IS THE RULE, NOT AN IMPLEMENTATION DETAIL. The order is persisted
 * first and the email is attempted after, with its outcome reported alongside a
 * successful result rather than folded into it. An email is a side effect of a
 * sale; a sale is never a side effect of an email.
 */

export interface AdminOrderDeps {
  /**
   * Request-scoped client carrying the admin's session. The RPC runs its own
   * is_admin() guard against it — this is what keeps authorization on the
   * server where it belongs, so never swap in the service-role client here.
   */
  supabase: SupabaseClient<Database>;
  /**
   * Sends the customer's confirmation. Injected so tests can assert on it;
   * defaults to the shared notifier, which owns the Resend integration, the
   * template, and the (order_id, type) idempotency claim.
   */
  notifyCustomer?: (orderId: string) => Promise<NotifyResult>;
}

/** Why no confirmation was attempted, when none was. */
export type CustomerNotification =
  | { attempted: false; reason: "no customer email" }
  | ({ attempted: true } & NotifyResult);

export type CreateAdminOrderOutcome =
  | {
      ok: true;
      data: AdminOrderResult;
      /** Never affects `ok` — a failed email leaves a created order created. */
      notification: CustomerNotification;
    }
  | { ok: false; kind: "validation"; message: string }
  | { ok: false; kind: "rpc"; error: PostgrestError };

/**
 * Validate → place → (maybe) confirm.
 *
 * Validation is re-run here even though the form already validated: a Server
 * Action is a public HTTP endpoint in disguise, and the district/cantón
 * coherence check is precisely the kind of rule a hand-built payload would skip.
 */
export async function createAdminOrder(
  deps: AdminOrderDeps,
  rawInput: AdminOrderInput
): Promise<CreateAdminOrderOutcome> {
  const parsed = adminOrderInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, kind: "validation", message: firstIssueMessage(parsed.error) };
  }
  const input: AdminOrderInputValidated = parsed.data;

  const { data, error } = await deps.supabase.rpc("place_admin_order", {
    p_payload: input as unknown as Json,
  });

  if (error) {
    return { ok: false, kind: "rpc", error };
  }

  const result = data as unknown as AdminOrderResult;

  return {
    ok: true,
    data: result,
    notification: await confirmToCustomer(deps, result.order_id, input),
  };
}

/**
 * Send the customer their confirmation — or decide, deliberately, not to.
 *
 * The email field is optional on this form, and the schema has already folded
 * null / undefined / "" / "   " into a single `undefined`. When that is what it
 * holds, the notifier is not called at all: not called and skipped are the same
 * outcome for the customer, but only "not called" leaves no ledger row, no log
 * line that reads like a fault, and no reason for anyone to wonder later whether
 * mail was lost.
 *
 * When there IS an address, every failure mode is absorbed. The notifier already
 * promises never to throw; the try/catch is a second belt for the case where
 * constructing it (a missing RESEND_API_KEY, say) throws before that promise
 * applies. Either way the caller gets ok:true with a recorded reason — the order
 * exists, and no retry of this action may un-exist it.
 */
async function confirmToCustomer(
  deps: AdminOrderDeps,
  orderId: string,
  input: AdminOrderInputValidated
): Promise<CustomerNotification> {
  if (!input.customer.email) {
    return { attempted: false, reason: "no customer email" };
  }

  try {
    const notify = deps.notifyCustomer ?? defaultNotifyCustomer;
    const result = await notify(orderId);

    if (result.status === "failed") {
      // Context only: order id and notification type. Never the recipient
      // address, never the provider key, never the order's contents.
      console.error("[admin/orders] customer confirmation failed", {
        orderId,
        type: "customer_order_confirmation",
        reason: result.reason,
      });
    }
    return { attempted: true, ...result };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown error";
    console.error("[admin/orders] customer confirmation threw", {
      orderId,
      reason,
    });
    return { attempted: true, status: "failed", reason };
  }
}

/**
 * Default sender. Imported lazily because the notifier reaches for the Resend
 * service and the service-role Supabase client, both of which are server-only
 * and would blow up at import time in the jsdom test environment. Tests inject
 * `notifyCustomer`, so this path never runs there.
 */
async function defaultNotifyCustomer(orderId: string): Promise<NotifyResult> {
  const { notifyCustomerOrderConfirmation } = await import(
    "@/lib/notifications/orderNotifier"
  );
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return notifyCustomerOrderConfirmation(orderId, { admin: createAdminClient() });
}
