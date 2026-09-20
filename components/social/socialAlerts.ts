import Swal from "sweetalert2";
import type { SocialError } from "@/lib/social/errors";

/**
 * Social feedback, on the project's existing notification system.
 *
 * SweetAlert2 is already a dependency and is already how this app confirms and
 * reports (admin tables, checkout, the brand forms) — no new toast library is
 * introduced here.
 *
 * What IS new is that the options live in one place. Every existing call site
 * repeats `confirmButtonColor: "#ff4d74"` and its own timer by hand; the social
 * module has five mutations, and five more copies of that object is how the
 * sixth ends up a different colour. The other ten call sites are deliberately
 * left alone — rewriting them would be an unrelated refactor.
 */

/** krov-rose. Matches every other confirm button in the app. */
const KROV_ROSE = "#ff4d74";

/**
 * A brief, non-blocking success toast.
 *
 * Auto-dismisses and does not steal focus: the user's action already succeeded
 * and the list behind it has updated, so there is nothing to acknowledge.
 */
export function socialSuccessToast(title: string): void {
  void Swal.fire({
    toast: true,
    position: "top-end",
    icon: "success",
    title,
    showConfirmButton: false,
    timer: 2000,
    timerProgressBar: true,
  });
}

/**
 * A failure the user has to read.
 *
 * Takes the NORMALIZED error, so the Spanish message is the only thing that can
 * reach the screen — a raw Postgres string has no path here.
 *
 * Deliberately blocking (no timer): a mutation did not happen, and unlike a
 * success that is not self-evident from the list behind the toast. When the
 * cause was a concurrent change, the message says what changed and the list is
 * already being refetched by useSocialMutation.
 */
export function socialErrorAlert(error: SocialError): void {
  void Swal.fire({
    icon: error.isStale ? "info" : "error",
    title: error.isStale ? "Algo cambió" : "No se pudo completar",
    text: error.message,
    confirmButtonColor: KROV_ROSE,
  });
}
