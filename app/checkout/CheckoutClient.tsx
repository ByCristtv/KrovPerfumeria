"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import Swal from "sweetalert2";
import CheckoutForm from "./CheckoutForm";
import OnvoPaymentElement from "./OnvoPaymentElement";
import OrderSummary from "./OrderSummary";
import { useCart } from "@/hooks/useCart";
import { useCheckoutExit } from "@/hooks/useCheckoutExit";
import {
  useCheckoutSession,
  type CheckoutSessionState,
} from "@/hooks/useCheckoutSession";
import {
  useCheckoutSubmit,
  type CheckoutSubmitError,
  type CheckoutSubmitResponse,
} from "@/hooks/useCheckoutSubmit";
import { useIsMounted } from "@/hooks/useIsMounted";
import {
  buildCheckoutPayload,
  checkoutFormDefaults,
  checkoutFormSchema,
  type CheckoutFormValues,
} from "@/schemas/checkout";
import { supabase } from "@/lib/supabase/client";
import { getAccountData } from "@/features/account/getAccountData";
import { findCanton, findProvince } from "@/lib/cr-geo";

/**
 * Orchestrates /checkout as a two-phase, single-page flow backed by exactly ONE
 * pending order.
 *
 *   - Phase 1 (form): shipping + payment method → POST /api/checkout/session.
 *   - Phase 2 (payment): read-only recap + the embedded Onvo SDK, or a redirect
 *     to the SINPE instructions page.
 *
 * The order is created on the FIRST submit and reused thereafter: "Editar" goes
 * back to the form while keeping the session reference, so re-submitting updates
 * that same order (same id, same reserved stock) instead of minting #1002, #1003…
 * as it previously did. The server decides create-vs-update; this component just
 * carries the reference.
 *
 * The cart is cleared only once the checkout actually ends (payment success, or
 * the SINPE hand-off) so the recap, OrderSummary, and "Editar" keep working.
 */
export default function CheckoutClient() {
  const router = useRouter();

  // SSR-safe mount guard — cart and session both hydrate client-side.
  const mounted = useIsMounted();
  const { cart, clearCart } = useCart();
  const submit = useCheckoutSubmit();
  const { session, save, clear } = useCheckoutSession();
  const { exit, hasExited } = useCheckoutExit();

  // Phase 2 iff we hold a session with a prepared card payment. "Editar" drops
  // this without dropping the session — that's the whole point.
  const [showPayment, setShowPayment] = useState(() => session !== null);

  // Bounds the stale-reference self-heal to a single retry so a persistently
  // rejected session can never spin.
  const retriedRef = useRef(false);

  const form = useForm<CheckoutFormValues>({
    resolver: zodResolver(checkoutFormSchema),
    defaultValues: checkoutFormDefaults,
    mode: "onBlur",
  });

  const watchedCantonCode = form.watch("shipping.canton_code");
  const watchedDistrict = form.watch("shipping.district");
  const watchedLocalDelivery = form.watch("shipping.local_delivery");

  // Prefill form with logged-in user's saved data.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { profile, address } = await getAccountData(user.id);
      if (cancelled) return;
      form.reset({
        customer: {
          name: user.user_metadata?.full_name ?? "",
          email: user.email ?? "",
          phone: profile?.phone ?? "",
        },
        shipping: {
          canton_code: address?.canton ?? "",
          district: address?.district ?? "",
          address: address?.exact_address ?? "",
          reference: address?.references ?? "",
          // Never prefilled from a saved address: the opt-in is a statement
          // about this order, and the customer has to make it each time.
          local_delivery: false,
        },
        notes: "",
        payment_method: checkoutFormDefaults.payment_method,
      });
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "You landed on /checkout with nothing to check out" → bounce to /cart.
  //
  // This guard MUST NOT fire while we're leaving on purpose. Finishing a checkout
  // clears the cart and the session, which is exactly the shape this condition
  // matches — so without the hasExited check it would fire mid-exit and its
  // `replace("/cart")` would supersede the in-flight `push("/orders/…")`, landing
  // a paying customer on an empty cart. hasExited is a ref, so it is already true
  // in the same commit that the cleared state arrives.
  useEffect(() => {
    if (hasExited.current) return;
    if (mounted && cart.length === 0 && !session) {
      router.replace("/cart");
    }
  }, [mounted, cart.length, router, session, hasExited]);

  if (!mounted || hasExited.current || (cart.length === 0 && !session)) {
    // Nothing to show before hydration, or while the exit navigation is in
    // flight — avoids flashing an empty form.
    return null;
  }

  /**
   * Finish the checkout and leave. Order of operations no longer matters: the
   * destination URL is fully built by the caller before any state is touched, and
   * the bounce guard above is disabled for good by `exit`.
   */
  const finish = (destination: string) => {
    exit(destination, () => {
      clear();
      clearCart();
    });
  };

  const onSuccess = (result: CheckoutSubmitResponse) => {
    retriedRef.current = false;

    // `payment: null` means nothing payment-relevant changed — keep the
    // preparation we already hold so the mounted SDK survives the edit.
    const payment = result.payment ?? session?.payment ?? null;
    const next: CheckoutSessionState = {
      order_id: result.order_id,
      order_token: result.order_token,
      method: result.payment_method,
      payment,
    };
    save(next);

    if (payment?.kind === "manual_sinpe") {
      // SINPE is a hand-off, not an in-page step: the order stays pending until
      // an admin validates the transfer, but this checkout is over.
      finish(payment.instructions_path);
      return;
    }

    setShowPayment(true);
  };

  const onError = async (error: CheckoutSubmitError, values: CheckoutFormValues) => {
    // Our stored reference outlived its order. Both cases below are recoverable
    // without bothering the customer — clear it and act.
    if (error.code === "already_paid") {
      // Same terminal transition as a successful payment, so it goes through the
      // same one-way exit — clearing state here without disabling the bounce
      // guard would strand the customer on /cart exactly as it did on success.
      if (session) {
        finish(
          `/orders/${session.order_id}?token=${encodeURIComponent(session.order_token)}`
        );
      }
      return;
    }

    if (error.code === "not_found" && !retriedRef.current) {
      // Bogus/foreign token, or the order is gone. Start clean, once.
      retriedRef.current = true;
      clear();
      void performSubmit(values, undefined);
      return;
    }

    // Stock/availability issues are recoverable by editing the cart; everything
    // else is just "try again".
    const isStockIssue =
      error.code === "stock_unavailable" || error.code === "variant_unavailable";

    await Swal.fire({
      icon: isStockIssue ? "warning" : "error",
      title: isStockIssue ? "Stock cambió" : "No pudimos procesar tu pedido",
      text: error.message,
      confirmButtonText: isStockIssue ? "Ir al carrito" : "Cerrar",
    });

    if (isStockIssue) {
      clear();
      router.push("/cart");
    }
  };

  const performSubmit = (
    values: CheckoutFormValues,
    ref: { order_id: string; order_token: string } | undefined
  ) => {
    let payload;
    try {
      payload = buildCheckoutPayload(values, cart, ref);
    } catch (err) {
      // buildCheckoutPayload only throws on a canton_code outside the CR-geo
      // dataset, which the form schema already prevents — defensive only.
      console.error("[checkout] payload build failed", err);
      void Swal.fire({
        icon: "error",
        title: "Error preparando el pedido",
        text: "Por favor verifica los datos e intenta de nuevo.",
      });
      return;
    }

    submit.mutate(payload, {
      onSuccess,
      onError: (error) => void onError(error, values),
    });
  };

  // Sending the session reference (when we have one) is what makes this an
  // update rather than a new order.
  const handleSubmit = (values: CheckoutFormValues) =>
    performSubmit(
      values,
      session
        ? { order_id: session.order_id, order_token: session.order_token }
        : undefined
    );

  // Back to the form — the session (and its order) intentionally survives.
  const handleEditShipping = () => setShowPayment(false);

  // Onvo confirmed the charge client-side. The webhook remains the source of
  // truth for paid state; this just advances the UI.
  const handlePaymentSuccess = () => {
    if (!session) return;
    finish(
      `/orders/${session.order_id}?token=${encodeURIComponent(session.order_token)}`
    );
  };

  const cardPayment =
    session?.payment?.kind === "onvo_card" ? session.payment : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 lg:gap-8 items-start">
      {showPayment && cardPayment ? (
        <PaymentPhase
          values={form.getValues()}
          payment={cardPayment}
          onEdit={handleEditShipping}
          onSuccess={handlePaymentSuccess}
        />
      ) : (
        <CheckoutForm
          form={form}
          onSubmit={handleSubmit}
          isSubmitting={form.formState.isSubmitting || submit.isPending}
        />
      )}
      {/* The summary needs the whole address, not just the cantón: free local
          delivery depends on the district and the opt-in as well. */}
      <OrderSummary
        cantonCode={watchedCantonCode || undefined}
        district={watchedDistrict}
        localDelivery={watchedLocalDelivery}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — read-only shipping recap + embedded Onvo payment element.
// ─────────────────────────────────────────────────────────────────────────────

function PaymentPhase({
  values,
  payment,
  onEdit,
  onSuccess,
}: {
  values: CheckoutFormValues;
  payment: { intent_id: string; customer_id: string; public_key: string };
  onEdit: () => void;
  onSuccess: () => void;
}) {
  const canton = findCanton(values.shipping.canton_code);
  const province = canton ? findProvince(canton.provinceCode) : undefined;

  return (
    <div className="space-y-6">
      {/* ──────── Shipping recap ──────── */}
      <section className="rounded-none border border-krov-smoke bg-krov-coal p-5 sm:p-6">
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-krov-bone">
              Datos de envío
            </h3>
            <p className="text-xs text-krov-dust mt-0.5">
              Revisa que todo esté correcto antes de pagar.
            </p>
          </div>
          <button
            type="button"
            onClick={onEdit}
            className="shrink-0 text-sm text-krov-rose underline underline-offset-4 hover:text-krov-blush"
          >
            Editar
          </button>
        </header>
        <dl className="text-sm text-krov-ash space-y-1.5">
          <RecapRow label="Nombre" value={values.customer.name} />
          <RecapRow label="Correo" value={values.customer.email} />
          <RecapRow label="Teléfono" value={values.customer.phone} />
          <RecapRow
            label="Provincia / Cantón"
            value={`${province?.name ?? "—"} / ${canton?.name ?? "—"}`}
          />
          {values.shipping.district && (
            <RecapRow label="Distrito" value={values.shipping.district} />
          )}
          <RecapRow label="Señas" value={values.shipping.address} />
          {values.shipping.reference && (
            <RecapRow label="Referencia" value={values.shipping.reference} />
          )}
          {values.shipping.local_delivery && (
            <RecapRow label="Envío" value="Cariari centro — entrega gratis" />
          )}
          {values.notes && <RecapRow label="Notas" value={values.notes} />}
        </dl>
      </section>

      {/* ──────── Payment ──────── */}
      <section className="rounded-none border border-krov-smoke bg-krov-coal p-5 sm:p-6">
        <header className="mb-4">
          <h3 className="text-base font-semibold text-krov-bone">Pago</h3>
          <p className="text-xs text-krov-dust mt-0.5">
            Ingresa los datos de tu tarjeta. El pago es seguro y procesado por
            ONVO.
          </p>
        </header>
        {/* Keyed on the intent so a total change (which mints a new intent)
            remounts the SDK; an edit that reuses the intent leaves it alone. */}
        <OnvoPaymentElement
          key={payment.intent_id}
          publicKey={payment.public_key}
          paymentIntentId={payment.intent_id}
          customerId={payment.customer_id}
          onSuccess={onSuccess}
        />
      </section>
    </div>
  );
}

function RecapRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:gap-3">
      <dt className="text-krov-dust sm:w-36 shrink-0">{label}</dt>
      <dd className="text-krov-bone break-words">{value}</dd>
    </div>
  );
}
