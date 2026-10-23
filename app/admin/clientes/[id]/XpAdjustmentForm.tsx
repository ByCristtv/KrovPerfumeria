"use client";

import { useState, useTransition, type FormEvent } from "react";
import { adjustCustomerXpAction } from "../actions";
import {
  MAX_XP_ADJUSTMENT,
  MAX_XP_REASON_LENGTH,
  validateXpAdjustment,
  type XpAdjustmentDirection,
} from "@/lib/customers/xpAdjustment";
import { formatXp } from "@/lib/format";
import { getRankFromXP } from "@/lib/rank";

interface Props {
  userId: string;
  currentXp: number;
}

type Feedback = { kind: "success" | "error"; message: string } | null;

/**
 * Admin-only XP add/deduct form. Validates locally for instant feedback, then
 * calls the server action, which re-validates and goes through the admin-gated
 * `admin_adjust_customer_xp` RPC. The action revalidates this route, so the
 * balance, rank and adjustment log above re-render with the new numbers.
 */
export default function XpAdjustmentForm({ userId, currentXp }: Props) {
  const [direction, setDirection] = useState<XpAdjustmentDirection>("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isPending, startTransition] = useTransition();

  const preview = amount.trim()
    ? validateXpAdjustment({ direction, amount, reason }, currentXp)
    : null;
  const nextXp = preview?.ok ? currentXp + preview.delta : null;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const check = validateXpAdjustment({ direction, amount, reason }, currentXp);
    if (!check.ok) {
      setFeedback({ kind: "error", message: check.message });
      return;
    }

    setFeedback(null);
    startTransition(async () => {
      const result = await adjustCustomerXpAction(userId, { direction, amount, reason });
      if (result.ok) {
        setAmount("");
        setReason("");
        const after = result.data
          ? ` Nuevo saldo: ${formatXp(result.data.balance_after)} XP (${result.data.rank}).`
          : "";
        setFeedback({ kind: "success", message: `${result.message}${after}` });
      } else {
        setFeedback({ kind: "error", message: result.message });
      }
    });
  }

  const toggleBase =
    "flex-1 rounded-none border px-4 py-2.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-krov-blood/40";
  const inputCls =
    "w-full rounded-none border border-krov-blood/30 bg-krov-void px-3 py-2.5 text-sm text-krov-bone placeholder:text-krov-dust focus:border-krov-blood focus:outline-none focus:ring-2 focus:ring-krov-blood/40";

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Ajustar XP">
      <fieldset>
        <legend className="mb-1.5 block text-[11px] uppercase tracking-wider text-krov-ash">
          Tipo de ajuste
        </legend>
        <div className="flex gap-2">
          {(
            [
              ["add", "Sumar XP"],
              ["deduct", "Restar XP"],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={`${toggleBase} cursor-pointer text-center ${
                direction === value
                  ? "border-krov-blood bg-krov-blood/10 text-krov-rose"
                  : "border-krov-smoke text-krov-ash hover:border-krov-blood/60"
              }`}
            >
              <input
                type="radio"
                name="direction"
                value={value}
                checked={direction === value}
                onChange={() => setDirection(value)}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label
          htmlFor="xp-amount"
          className="mb-1.5 block text-[11px] uppercase tracking-wider text-krov-ash"
        >
          Cantidad de XP
        </label>
        <input
          id="xp-amount"
          name="amount"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder={`1 – ${formatXp(MAX_XP_ADJUSTMENT)}`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-invalid={preview ? !preview.ok && preview.field === "amount" : undefined}
          className={inputCls}
        />
        <p className="mt-1.5 text-xs text-krov-ash" aria-live="polite">
          {nextXp !== null
            ? `Nuevo saldo: ${formatXp(nextXp)} XP · ${getRankFromXP(nextXp)}`
            : preview && !preview.ok
              ? preview.message
              : `Saldo actual: ${formatXp(currentXp)} XP`}
        </p>
      </div>

      <div>
        <label
          htmlFor="xp-reason"
          className="mb-1.5 block text-[11px] uppercase tracking-wider text-krov-ash"
        >
          Motivo (opcional)
        </label>
        <textarea
          id="xp-reason"
          name="reason"
          rows={2}
          maxLength={MAX_XP_REASON_LENGTH}
          placeholder="Ej. compensación por un pedido retrasado"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={`${inputCls} resize-y`}
        />
      </div>

      {feedback && (
        <p
          role={feedback.kind === "error" ? "alert" : "status"}
          className={`rounded-none border px-3 py-2 text-sm ${
            feedback.kind === "error"
              ? "border-red-500/40 bg-red-500/10 text-red-200"
              : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
          }`}
        >
          {feedback.message}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="inline-flex w-full items-center justify-center rounded-none bg-krov-blood px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-krov-crimson disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? "Aplicando…" : "Aplicar ajuste"}
      </button>
    </form>
  );
}
