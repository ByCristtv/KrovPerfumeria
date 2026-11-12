import type {
  OrderStatusFilter,
  PaymentStatusFilter,
} from "@/features/admin/getOrdersAdminPage";

/**
 * Query-string keys for the /admin/orders filters. Shared by the server pages
 * (parse) and the OrdersFilters client island (build) so the param names live in
 * one place. Search + page keys come from `lib/pagination` (`q` / `page`).
 */
export const STATUS_PARAM = "status";
export const PAYMENT_PARAM = "payment";

export const ORDER_STATUS_FILTERS: OrderStatusFilter[] = [
  "all",
  "pending",
  "received",
  "shipped",
  "denied",
];

export const PAYMENT_STATUS_FILTERS: PaymentStatusFilter[] = [
  "all",
  "pending",
  "paid",
  "failed",
  "refunded",
];

/** A URL value narrowed to one of `allowed`, or `fallback` for anything else. */
export function coerceFilter<T extends string>(value: string, allowed: T[], fallback: T): T {
  return (allowed as string[]).includes(value) ? (value as T) : fallback;
}
