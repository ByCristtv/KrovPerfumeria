"use client";

import type { AdminCustomerMatch } from "@/types/adminOrder";

interface EmailAccountHintProps {
  /** The account the order is currently linked to, if any (any source). */
  linked: AdminCustomerMatch | null;
  /** Registered account that owns the typed email, if one was found. */
  match: AdminCustomerMatch | null;
  /** The admin explicitly said "don't link" for this email. */
  declined: boolean;
  isChecking: boolean;
  /** The lookup failed — we do NOT know whether the email is registered. */
  isError: boolean;
  onLink: (customer: AdminCustomerMatch) => void;
  onUnlink: () => void;
  onDecline: () => void;
  onUndoDecline: () => void;
}

const displayName = (c: AdminCustomerMatch) =>
  c.full_name?.trim() || c.email;

/**
 * The line under the email field that tells the admin whether this order will
 * belong to a registered account — and lets them decide.
 *
 * Four states, in priority order:
 *   linked   — already attached (picked from the search, or accepted here).
 *   match    — the email is registered but nothing is decided yet. Asks. Leaving
 *              it alone is NOT "no": the database links a confirmed account by
 *              email on its own, so the copy says so and nobody is surprised.
 *   declined — the admin chose not to link; one click to change their mind.
 *   error    — the check failed. Said plainly, because silence would read as
 *              "not registered" and the customer would quietly miss their XP.
 *
 * `role="status"` makes the appearance of a hint audible to screen readers
 * without stealing focus from the field being typed in.
 */
export default function EmailAccountHint({
  linked,
  match,
  declined,
  isChecking,
  isError,
  onLink,
  onUnlink,
  onDecline,
  onUndoDecline,
}: EmailAccountHintProps) {
  if (linked) {
    return (
      <Hint tone="ok" data-testid="email-hint-linked">
        <span>
          Pedido vinculado a la cuenta de{" "}
          <strong className="font-semibold">{displayName(linked)}</strong>
          {" "}({linked.email}). Sumará XP al marcarse como recibido.
        </span>
        <HintButton onClick={onUnlink}>Quitar vínculo</HintButton>
      </Hint>
    );
  }

  if (match && declined) {
    return (
      <Hint tone="muted" data-testid="email-hint-declined">
        <span>
          Este correo es de un usuario registrado, pero el pedido{" "}
          <strong className="font-semibold">no se vinculará</strong> a su cuenta
          y no sumará XP.
        </span>
        <HintButton onClick={onUndoDecline}>Vincular</HintButton>
      </Hint>
    );
  }

  if (match) {
    return (
      <Hint tone="info" data-testid="email-hint-match">
        <span>
          Este correo coincide con el usuario registrado{" "}
          <strong className="font-semibold">{displayName(match)}</strong>.
          ¿Vincular el pedido a esta cuenta? Si no decides, se vinculará
          automáticamente.
        </span>
        <span className="flex shrink-0 gap-2">
          <HintButton primary onClick={() => onLink(match)}>
            Vincular
          </HintButton>
          <HintButton onClick={onDecline}>No vincular</HintButton>
        </span>
      </Hint>
    );
  }

  if (isError) {
    return (
      <Hint tone="warn" data-testid="email-hint-error">
        <span>
          No pudimos verificar si este correo está registrado. Si el cliente
          tiene cuenta, búscalo en el selector de arriba para vincularlo.
        </span>
      </Hint>
    );
  }

  if (isChecking) {
    return (
      <p className="mt-1.5 text-[11px] text-krov-ash" role="status">
        Verificando correo…
      </p>
    );
  }

  return null;
}

type Tone = "ok" | "info" | "warn" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  info: "border-krov-rose/40 bg-krov-rose/10 text-krov-bone",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  muted: "border-krov-smoke bg-white/5 text-krov-ash",
};

function Hint({
  tone,
  children,
  ...rest
}: {
  tone: Tone;
  children: React.ReactNode;
  "data-testid"?: string;
}) {
  return (
    <div
      role="status"
      {...rest}
      className={`mt-2 flex flex-col gap-2 border px-3 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between ${TONE_CLASS[tone]}`}
    >
      {children}
    </div>
  );
}

function HintButton({
  children,
  onClick,
  primary = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        primary
          ? "shrink-0 bg-krov-blood px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-krov-crimson"
          : "shrink-0 border border-krov-smoke px-3 py-1.5 text-xs text-krov-bone transition hover:bg-white/10"
      }
    >
      {children}
    </button>
  );
}
