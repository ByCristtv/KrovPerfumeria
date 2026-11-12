/**
 * "Ligar Pedidos" — attaching historical guest orders (user_id IS NULL) to a
 * registered customer's account. Shapes mirror the RPCs in migration
 * 20261110000200_admin_link_orders.sql.
 */

import type { Database } from "@/types/database";

type UserRole = Database["public"]["Enums"]["user_role"];

/** One unlinked order as the admin list shows it. Amounts in CRC. */
export interface UnlinkedOrderRow {
  id: string;
  order_number: number;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  subtotal: number;
  discount: number;
  shipping_cost: number;
  total: number;
  order_status: string;
  payment_status: string;
  payment_provider: string | null;
  source: string;
  created_at: string;
}

/** A registered account the admin may link an order to. */
export interface LinkableCustomer {
  user_id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  role: Extract<UserRole, "customer" | "wholesale">;
  /** profiles.created_at — tells two "María Rodríguez" apart. */
  member_since: string | null;
  experience_points: number;
}

/**
 * What happened to the order's XP when it was linked.
 *   granted          XP added to the customer now (`xp_awarded`, may be 0)
 *   already_granted  this order's XP had been awarded before; nothing added
 *   pending_status   order not received yet; the existing trigger awards it
 *                    to this customer when the order is marked received
 *   not_eligible     cancelled order — it never earns XP
 */
export type LinkXpStatus = "granted" | "already_granted" | "pending_status" | "not_eligible";

export interface LinkOrderResult {
  order_id: string;
  order_number: number;
  order_status: string;
  user_id: string;
  customer_name: string;
  customer_email: string;
  xp_status: LinkXpStatus;
  xp_awarded: number;
  /** Customer balance right after the link. */
  xp_balance: number | null;
}
