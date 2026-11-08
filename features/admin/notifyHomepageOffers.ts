import { revalidateHomepageOffersAction } from "@/app/admin/products/actions";
import type { HomepageOfferChange } from "@/lib/admin/homepageOffers";

/**
 * Tell the server that an admin write may have changed the homepage offers.
 *
 * Call it AFTER the write succeeded, with the classification from
 * lib/admin/homepageOffers.ts; `null` (the write cannot affect a slide) is a
 * no-op, so call sites can pass the classifier's result straight through.
 *
 * Best-effort by design: it never throws and is not awaited by the forms, so a
 * failed revalidation can neither undo nor hide a successful save. The
 * homepage's 300 s ISR window still refreshes the hero in that case.
 */
export async function notifyHomepageOffers(change: HomepageOfferChange | null): Promise<void> {
  if (!change) return;
  try {
    const result = await revalidateHomepageOffersAction(change);
    if (!result.ok) {
      console.warn("[homepage offers] revalidation skipped:", result.message);
    }
  } catch (err) {
    console.warn(
      "[homepage offers] revalidation failed; ISR will refresh the homepage:",
      err instanceof Error ? err.message : err
    );
  }
}
