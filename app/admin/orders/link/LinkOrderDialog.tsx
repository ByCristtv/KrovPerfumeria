"use client";

import { useId, useState, useTransition } from "react";
import Swal from "sweetalert2";
import Modal from "@/components/ui/Modal";
import { formatPrice, formatXp } from "@/lib/format";
import { useLinkableCustomerSearch } from "@/hooks/useLinkableCustomerSearch";
import {
  describeLinkXp,
  matchSignals,
  previewLinkXp,
  type LinkXpPreview,
} from "@/lib/orders/orderLinking";
import { StatusBadge, formatDate } from "../OrdersTable";
import { linkOrderToCustomerAction } from "./actions";
import type { LinkableCustomer, UnlinkedOrderRow } from "@/types/orderLinking";

interface LinkOrderDialogProps {
  order: UnlinkedOrderRow;
  onClose: () => void;
  /** The link happened — or the list is stale and must be reloaded. */
  onDone: () => void;
}

/**
 * "Ligar a cliente": pick the registered account, then confirm.
 *
 * Two steps on purpose. Choosing is reversible and cheap; the link is not
 * (it moves the order into someone's history and may credit XP), so it gets
 * its own screen that says exactly what will and will not change. The confirm
 * button is single-flight (useTransition) and the dialog cannot be dismissed
 * while the request is in the air.
 */
export default function LinkOrderDialog({ order, onClose, onDone }: LinkOrderDialogProps) {
  const listId = useId();
  // Start from the most distinctive detail the order has.
  const [query, setQuery] = useState(order.customer_email ?? order.customer_name);
  const [selected, setSelected] = useState<LinkableCustomer | null>(null);
  const [step, setStep] = useState<"select" | "confirm">("select");
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [pending, startTransition] = useTransition();

  const search = useLinkableCustomerSearch(query);
  const preview = previewLinkXp(order);

  const close = () => {
    if (!pending) onClose();
  };

  const confirm = () => {
    if (!selected || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await linkOrderToCustomerAction(order.id, selected.user_id);
      if (!result.ok) {
        setError(result.message);
        // Someone else linked (or removed) it meanwhile: this dialog can only
        // be wrong now, so offer a reload instead of a retry.
        setStale(result.stale === true);
        return;
      }
      void Swal.fire({
        icon: "success",
        title: "Pedido ligado",
        text: `${result.message} ${describeLinkXp(result.data)}`,
        confirmButtonText: "Listo",
      });
      onDone();
    });
  };

  return (
    <Modal
      open
      onClose={close}
      closeOnBackdrop={!pending}
      title={`Ligar pedido #${order.order_number}`}
      subtitle="Asocia este pedido a la cuenta registrada del cliente."
      maxWidthClassName="max-w-xl"
    >
      <OrderSummary order={order} />

      {step === "select" ? (
        <div className="mt-5">
          <label
            htmlFor={`${listId}-q`}
            className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-krov-ash"
          >
            Buscar cliente registrado
          </label>
          <input
            id={`${listId}-q`}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(null);
            }}
            placeholder="Nombre, correo o teléfono"
            autoComplete="off"
            className="w-full rounded-none border border-krov-blood/30 bg-krov-void px-3 py-2.5 text-sm text-krov-bone placeholder:text-krov-dust focus:border-krov-blood focus:outline-none focus:ring-2 focus:ring-krov-blood/40"
          />

          <div className="mt-3 max-h-72 overflow-y-auto" aria-live="polite">
            {search.isIdle ? (
              <p className="py-3 text-sm text-krov-ash">Escribe al menos 2 caracteres.</p>
            ) : search.isError ? (
              <div role="alert" className="flex items-center justify-between gap-3 py-3 text-sm">
                <span className="text-red-300">No pudimos buscar clientes.</span>
                <button
                  type="button"
                  onClick={search.refetch}
                  className="text-xs text-krov-rose underline underline-offset-4"
                >
                  Reintentar
                </button>
              </div>
            ) : search.isLoading || search.isPending ? (
              <p role="status" className="py-3 text-sm text-krov-ash">
                Buscando…
              </p>
            ) : search.customers.length === 0 ? (
              <p className="py-3 text-sm text-krov-ash">
                No encontramos clientes registrados con ese dato. Prueba con el nombre, el
                correo o el teléfono de su cuenta.
              </p>
            ) : (
              <fieldset className="space-y-2">
                <legend className="sr-only">Elige la cuenta del cliente</legend>
                {search.customers.map((c) => (
                  <CustomerOption
                    key={c.user_id}
                    name={listId}
                    customer={c}
                    order={order}
                    checked={selected?.user_id === c.user_id}
                    onChange={() => setSelected(c)}
                  />
                ))}
              </fieldset>
            )}
          </div>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={close} className={secondaryBtn}>
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => setStep("confirm")}
              disabled={!selected}
              className={primaryBtn}
            >
              Continuar
            </button>
          </div>
        </div>
      ) : (
        selected && (
          <ConfirmStep
            order={order}
            customer={selected}
            preview={preview}
            error={error}
            stale={stale}
            pending={pending}
            onBack={() => {
              setError(null);
              setStep("select");
            }}
            onConfirm={confirm}
            onReload={onDone}
          />
        )
      )}
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function OrderSummary({ order }: { order: UnlinkedOrderRow }) {
  return (
    <div className="border border-krov-smoke bg-krov-void/40 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-krov-bone">{order.customer_name}</span>
        <StatusBadge status={order.order_status} />
      </div>
      <div className="mt-1 text-xs text-krov-ash">
        {[order.customer_phone, order.customer_email].filter(Boolean).join(" · ") ||
          "Sin datos de contacto"}
      </div>
      <div className="mt-1 text-xs text-krov-ash">
        {formatDate(order.created_at)} · Total {formatPrice(order.total)}
      </div>
    </div>
  );
}

function CustomerOption({
  name,
  customer,
  order,
  checked,
  onChange,
}: {
  name: string;
  customer: LinkableCustomer;
  order: UnlinkedOrderRow;
  checked: boolean;
  onChange: () => void;
}) {
  const id = `${name}-${customer.user_id}`;
  const signals = matchSignals(order, customer);
  return (
    <label
      htmlFor={id}
      className={`flex cursor-pointer items-start gap-3 border p-3 transition-colors ${
        checked ? "border-krov-blood bg-krov-blood/10" : "border-krov-smoke hover:border-krov-blood/50"
      }`}
    >
      <input
        id={id}
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="mt-1 h-4 w-4 shrink-0 accent-krov-blood"
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium text-krov-bone">
            {customer.full_name?.trim() || "Sin nombre"}
          </span>
          {customer.role === "wholesale" && <Tag>Mayorista</Tag>}
          {signals.phone && <Tag tone="match">Mismo teléfono</Tag>}
          {signals.email && <Tag tone="match">Mismo correo</Tag>}
        </span>
        <span className="mt-0.5 block truncate text-xs text-krov-ash">
          {[customer.email, customer.phone].filter(Boolean).join(" · ")}
        </span>
        <span className="mt-0.5 block text-[11px] text-krov-ash">
          {customer.member_since ? `Cliente desde ${formatShortDate(customer.member_since)} · ` : ""}
          {formatXp(customer.experience_points)} XP
        </span>
      </span>
    </label>
  );
}

function ConfirmStep({
  order,
  customer,
  preview,
  error,
  stale,
  pending,
  onBack,
  onConfirm,
  onReload,
}: {
  order: UnlinkedOrderRow;
  customer: LinkableCustomer;
  preview: LinkXpPreview;
  error: string | null;
  stale: boolean;
  pending: boolean;
  onBack: () => void;
  onConfirm: () => void;
  onReload: () => void;
}) {
  const signals = matchSignals(order, customer);
  const displayName = customer.full_name?.trim() || customer.email;

  return (
    <div className="mt-5 space-y-4 text-sm">
      <p className="text-krov-bone">
        El pedido <span className="font-mono text-krov-rose">#{order.order_number}</span> pasará
        a la cuenta de <span className="font-semibold">{displayName}</span>{" "}
        <span className="text-krov-ash">({customer.email})</span>.
      </p>

      <ul className="space-y-1.5 text-xs leading-relaxed text-krov-ash">
        <li>· Aparecerá en el historial de pedidos del cliente.</li>
        <li>
          · {xpPreviewText(preview)}
        </li>
        <li>
          · No cambia nada más: productos, montos, envío, datos de contacto, pago, estado y
          fecha quedan igual.
        </li>
      </ul>

      {!signals.phone && !signals.email && (
        <p className="border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
          Ni el teléfono ni el correo del pedido coinciden con esta cuenta. Verifica que sea la
          misma persona antes de confirmar.
        </p>
      )}

      {error && (
        <div role="alert" className="border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
          {error}
          {stale && (
            <button
              type="button"
              onClick={onReload}
              className="ml-2 text-krov-rose underline underline-offset-4"
            >
              Actualizar la lista
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onBack} disabled={pending} className={secondaryBtn}>
          Volver
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending || stale}
          aria-busy={pending}
          className={primaryBtn}
        >
          {pending ? "Ligando…" : "Confirmar y ligar"}
        </button>
      </div>
    </div>
  );
}

export function xpPreviewText(preview: LinkXpPreview): string {
  switch (preview.kind) {
    case "now":
      return preview.xp > 0
        ? `Sumará ${formatXp(preview.xp)} XP a la cuenta ahora (estimado).`
        : `No suma XP: tiene menos de ${formatPrice(1000)} en productos.`;
    case "later":
      return `Aún no suma XP: está pendiente. Los ${formatXp(preview.xp)} XP se otorgarán cuando lo marques como Recibido.`;
    case "never":
      return "No suma XP: el pedido está cancelado.";
  }
}

function Tag({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "match" }) {
  return (
    <span
      className={`border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${
        tone === "match"
          ? "border-emerald-500/50 text-emerald-300"
          : "border-krov-smoke text-krov-ash"
      }`}
    >
      {children}
    </span>
  );
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const primaryBtn =
  "rounded-none bg-krov-blood px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-krov-crimson disabled:cursor-not-allowed disabled:opacity-50";
const secondaryBtn =
  "rounded-none border border-krov-smoke px-4 py-2.5 text-sm text-krov-bone transition hover:border-krov-blood/50 disabled:opacity-50";
