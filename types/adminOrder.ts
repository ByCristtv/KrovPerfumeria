/**
 * Shared types for the admin manual-order flow (orders taken via WhatsApp /
 * Instagram / phone). The `AdminOrderInput` shape mirrors the JSON contract of
 * the `place_admin_order` Postgres RPC.
 */

export type AdminShippingMethod = "delivery" | "pickup";

export interface AdminOrderItemInput {
  variant_id: string;
  quantity: number;
}

export interface AdminOrderCustomerInput {
  name: string;
  phone: string;
  /** Optional — many manual customers only give a phone number. */
  email?: string;
  /**
   * Explicit link to a registered account (picked from the customer search, or
   * accepted from the "this email is registered" hint). The order is then owned
   * by that account and earns it XP once received.
   */
  user_id?: string;
  /**
   * `false` = the admin saw the registered-email hint and declined the link.
   * Suppresses the database's automatic email-based link too. Omit it for the
   * default: the database links a confirmed account whose email matches.
   */
  link_account?: boolean;
}

export interface AdminOrderShippingInput {
  /** Free-text señas, e.g. "200m sur de la iglesia". */
  address: string;
  /** CR canton code — drives the shipping-cost lookup. */
  canton_code: string;
  canton_name: string;
  province_name: string;
  district?: string;
  reference?: string;
}

export interface AdminOrderInput {
  customer: AdminOrderCustomerInput;
  shipping: AdminOrderShippingInput;
  items: AdminOrderItemInput[];
  shipping_method: AdminShippingMethod;
  /** Optional flat discount in CRC. */
  discount?: number;
  notes?: string;
}

export interface AdminOrderResult {
  order_id: string;
  order_number: number;
  subtotal: number;
  shipping_cost: number;
  discount: number;
  total: number;
  item_count: number;
  /** Account the order ended up on (explicit or resolved by email); null = guest. */
  user_id: string | null;
}

/** A registered customer as the admin order form sees them. */
export interface AdminCustomerMatch {
  user_id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  /** Saved delivery address, if the customer has one. province/canton are CODES. */
  address: AdminCustomerAddress | null;
}

export interface AdminCustomerAddress {
  province: string;
  canton: string;
  district: string;
  exact_address: string;
  reference: string | null;
}
