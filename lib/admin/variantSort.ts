/**
 * Admin variant list ordering.
 *
 * THE CONTRACT: active variants first, inactive variants last, and the order
 * the database chose preserved WITHIN each group (newest first — see the
 * `ORDER BY` in `admin_list_product_variants`).
 *
 * WHERE THE SORT ACTUALLY HAPPENS: in the RPC. `/admin/products` is paginated
 * server-side (20 rows/page), so only the database can push inactive SKUs to
 * the last pages — a client-side sort can never see the rows it does not have.
 *
 * SO WHY THIS EXISTS: it makes the contract executable and testable, and it
 * keeps the rendered page correct even when the RPC has not been upgraded yet
 * (this project applies migrations by hand in the Supabase SQL editor, so the
 * deployed app routinely runs ahead of the database for a while). Once the
 * migration lands, this is a no-op — the rows already arrive sorted.
 */

/** Minimal shape this module needs. Keeps it usable for any row with a status. */
export interface HasActiveFlag {
  is_active: boolean;
}

/** Active sorts before inactive; anything non-boolean is treated as inactive. */
function activeRank(row: HasActiveFlag): number {
  return row.is_active === true ? 0 : 1;
}

/**
 * Return a new array with active rows first and inactive rows last.
 *
 * STABLE: `Array.prototype.sort` is required to be stable (ES2019+), and the
 * comparator returns 0 for same-status rows — so the database's own ordering
 * inside each group survives untouched. Never mutates the input.
 */
export function sortVariantsByStatus<T extends HasActiveFlag>(
  rows: readonly T[]
): T[] {
  return [...rows].sort((a, b) => activeRank(a) - activeRank(b));
}
