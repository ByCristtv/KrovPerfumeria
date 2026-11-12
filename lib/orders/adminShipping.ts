import {
  isLocalDeliveryArea,
  type LocalDeliveryAddress,
} from "@/lib/shipping/localDelivery";
import type { AdminShippingMethod } from "@/types/adminOrder";

/**
 * Shipping rules specific to MANUAL (admin) orders.
 *
 * The web checkout treats Cariari as opt-in ("Cariari centro" checkbox),
 * because only the customer knows whether they are in the town itself. A
 * manual order is different: the store is talking to the customer and has
 * decided that every Cariari delivery ships free. So here the SAME area rule
 * (`isLocalDeliveryArea`: cantón code 702 + the dataset's Cariari district,
 * resolved through that cantón) switches the waiver on by itself.
 *
 * This one function is called by BOTH the form (to show ₡0 the moment the
 * admin picks the district) and the server use case (to tell the RPC). That is
 * what keeps the screen and the saved order from ever disagreeing: there is no
 * second copy of the rule to drift.
 */
export function isAdminFreeLocalDelivery(
  method: AdminShippingMethod,
  address: LocalDeliveryAddress
): boolean {
  // Pickup is already free; the waiver is a delivery concept.
  return method === "delivery" && isLocalDeliveryArea(address);
}

export type AdminShippingQuote =
  | { status: "pickup"; cost: 0 }
  | { status: "local_delivery"; cost: 0 }
  | { status: "zone"; cost: number }
  /** No zone rate yet: no cantón, empty cart, still loading, or the lookup failed. */
  | { status: "unknown"; cost: null };

/**
 * What the summary should charge for shipping, given the zone rate the
 * `calculate_shipping_cost` RPC returned (or null while there is none).
 *
 * The zone rate keeps being fetched for Cariari too, so moving the district
 * elsewhere in Pococí restores the normal price instantly instead of leaving a
 * stale ₡0 behind.
 */
export function quoteAdminShipping(
  method: AdminShippingMethod,
  address: LocalDeliveryAddress,
  zoneCost: number | null
): AdminShippingQuote {
  if (method === "pickup") return { status: "pickup", cost: 0 };
  if (isAdminFreeLocalDelivery(method, address)) {
    return { status: "local_delivery", cost: 0 };
  }
  return zoneCost === null
    ? { status: "unknown", cost: null }
    : { status: "zone", cost: zoneCost };
}
