"use client";

import { useState, useTransition, type FormEvent } from "react";
import Modal from "@/components/ui/Modal";
import {
  createCouponRewardAction,
  updateCouponRewardAction,
} from "@/app/admin/rewards/actions";
import type { RankLadder } from "@/lib/rank";
import type { DiscountType } from "@/lib/coupons/types";
import type { AdminRewardDefinition } from "@/lib/loyalty/types";
import {
  REWARD_LIMITS,
  validateRewardTerms,
  type RewardField,
  type RewardTermsInput,
} from "@/lib/loyalty/rewardTerms";

/** Pre-fill for a new reward: the store-wide minimum the existing rewards use. */
const DEFAULT_MIN_SUBTOTAL = "20000";

export type RewardFormTarget =
  | { mode: "create"; level: number }
  | { mode: "edit"; reward: AdminRewardDefinition };

interface Props {
  ladder: RankLadder;
  target: RewardFormTarget | null;
  onClose: () => void;
  /** Called after a successful save with the action's message. */
  onSaved: (message: string) => void;
}

function initialTerms(target: RewardFormTarget, ladder: RankLadder): RewardTermsInput {
  if (target.mode === "edit") {
    const r = target.reward;
    return {
      name: r.name,
      description: r.description ?? "",
      discountType: r.discountType,
      discountValue: String(r.discountValue),
      minOrderSubtotal: String(r.minOrderSubtotal),
      maxDiscountAmount: r.maxDiscountAmount === null ? "" : String(r.maxDiscountAmount),
      validDays: r.validDays === null ? "" : String(r.validDays),
    };
  }
  const rank = ladder.find((t) => t.level === target.level)?.rank ?? "";
  return {
    name: rank ? `Cupón ${rank}` : "",
    description: "",
    discountType: "percentage",
    discountValue: "",
    minOrderSubtotal: DEFAULT_MIN_SUBTOTAL,
    maxDiscountAmount: "",
    validDays: "",
  };
}

/**
 * Create or edit ONE coupon reward definition.
 *
 * Rules shown in the form are the ones the database enforces
 * (lib/loyalty/rewardTerms.ts ↔ loyalty_assert_reward_terms). On edit, the rank
 * and the discount type are fixed — they define what the reward IS — and the
 * form says plainly that coupons already handed out keep their own terms.
 */
export default function RewardFormModal({ ladder, target, onClose, onSaved }: Props) {
  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={target?.mode === "edit" ? "Editar recompensa" : "Nueva recompensa"}
      subtitle={
        target?.mode === "edit"
          ? `${target.reward.code} · se aplica solo a cupones que se entreguen desde ahora`
          : "Cupón que recibe cada cliente al alcanzar el rango"
      }
      maxWidthClassName="max-w-lg"
      closeOnBackdrop={false}
    >
      {target && (
        <RewardForm
          // Fresh state per target.
          key={target.mode === "edit" ? target.reward.id : `new-${target.level}`}
          ladder={ladder}
          target={target}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </Modal>
  );
}

function RewardForm({
  ladder,
  target,
  onClose,
  onSaved,
}: Props & { target: RewardFormTarget }) {
  const editing = target.mode === "edit";
  const [level, setLevel] = useState<number>(editing ? target.reward.level : target.level);
  const [terms, setTerms] = useState<RewardTermsInput>(() => initialTerms(target, ladder));
  const [isActive, setIsActive] = useState(true);
  const [errors, setErrors] = useState<Partial<Record<RewardField, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const set = (field: keyof RewardTermsInput) => (value: string) => {
    setTerms((t) => ({ ...t, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
    setServerError(null);
  };

  function setType(type: DiscountType) {
    setTerms((t) => ({ ...t, discountType: type, maxDiscountAmount: type === "fixed" ? "" : t.maxDiscountAmount }));
    setErrors({});
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const check = validateRewardTerms(terms);
    if (!check.ok) {
      setErrors(check.errors);
      return;
    }

    setServerError(null);
    startTransition(async () => {
      try {
        const result = editing
          ? await updateCouponRewardAction(target.reward.id, {
              terms,
              expectedUpdatedAt: target.reward.updatedAt,
            })
          : await createCouponRewardAction({ level, terms, isActive });
        if (result.ok) {
          onSaved(result.message);
        } else {
          setServerError(result.message);
        }
      } catch {
        setServerError("Error de conexión. No se guardaron cambios.");
      }
    });
  }

  const labelCls = "mb-1.5 block text-[11px] uppercase tracking-wider text-krov-ash";
  const inputCls =
    "w-full rounded-none border border-krov-blood/30 bg-krov-void px-3 py-2.5 text-sm text-krov-bone placeholder:text-krov-dust focus:border-krov-blood focus:outline-none focus:ring-2 focus:ring-krov-blood/40 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-red-500/70";
  const chip = (selected: boolean, disabled: boolean) =>
    `cursor-pointer rounded-none border px-3 py-2 text-center text-sm transition ${
      selected
        ? "border-krov-blood bg-krov-blood/10 text-krov-rose"
        : "border-krov-smoke text-krov-ash hover:border-krov-blood/60"
    } ${disabled ? "cursor-not-allowed opacity-60 hover:border-krov-smoke" : ""}`;

  const percentage = terms.discountType === "percentage";
  const fieldError = (field: RewardField) =>
    errors[field] ? (
      <p id={`reward-${field}-error`} className="mt-1.5 text-xs text-red-300">
        {errors[field]}
      </p>
    ) : null;
  const describedBy = (field: RewardField) => (errors[field] ? `reward-${field}-error` : undefined);

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Recompensa">
      <fieldset disabled={editing}>
        <legend className={labelCls}>Rango</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ladder.map((tier) => (
            <label key={tier.level} className={chip(level === tier.level, editing)}>
              <input
                type="radio"
                name="reward-level"
                value={tier.level}
                checked={level === tier.level}
                onChange={() => setLevel(tier.level)}
                className="sr-only"
              />
              {tier.rank}
            </label>
          ))}
        </div>
        {editing && (
          <p className="mt-1.5 text-xs text-krov-dust">
            El rango no se cambia: para otro rango, crea una recompensa nueva.
          </p>
        )}
      </fieldset>

      <div>
        <label htmlFor="reward-name" className={labelCls}>
          Nombre
        </label>
        <input
          id="reward-name"
          value={terms.name}
          maxLength={REWARD_LIMITS.nameMax}
          onChange={(e) => set("name")(e.target.value)}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={describedBy("name")}
          className={inputCls}
        />
        {fieldError("name")}
      </div>

      <div>
        <label htmlFor="reward-description" className={labelCls}>
          Descripción (opcional)
        </label>
        <textarea
          id="reward-description"
          rows={2}
          value={terms.description}
          maxLength={REWARD_LIMITS.descriptionMax}
          onChange={(e) => set("description")(e.target.value)}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={describedBy("description")}
          className={`${inputCls} resize-y`}
        />
        {fieldError("description")}
      </div>

      <fieldset disabled={editing}>
        <legend className={labelCls}>Tipo de descuento</legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["percentage", "Porcentaje (%)"],
              ["fixed", "Monto fijo (₡)"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className={chip(terms.discountType === value, editing)}>
              <input
                type="radio"
                name="reward-type"
                value={value}
                checked={terms.discountType === value}
                onChange={() => setType(value)}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="reward-value" className={labelCls}>
            {percentage ? "Descuento (%)" : "Descuento (₡)"}
          </label>
          <input
            id="reward-value"
            inputMode="decimal"
            autoComplete="off"
            placeholder={percentage ? "Ej. 12" : "Ej. 5000"}
            value={terms.discountValue}
            onChange={(e) => set("discountValue")(e.target.value)}
            aria-invalid={errors.discountValue ? true : undefined}
            aria-describedby={describedBy("discountValue")}
            className={inputCls}
          />
          {fieldError("discountValue")}
        </div>

        <div>
          <label htmlFor="reward-min" className={labelCls}>
            Compra mínima (₡)
          </label>
          <input
            id="reward-min"
            inputMode="numeric"
            autoComplete="off"
            value={terms.minOrderSubtotal}
            onChange={(e) => set("minOrderSubtotal")(e.target.value)}
            aria-invalid={errors.minOrderSubtotal ? true : undefined}
            aria-describedby={describedBy("minOrderSubtotal")}
            className={inputCls}
          />
          {fieldError("minOrderSubtotal")}
        </div>

        {percentage && (
          <div>
            <label htmlFor="reward-cap" className={labelCls}>
              Tope de descuento (₡, opcional)
            </label>
            <input
              id="reward-cap"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Sin tope"
              value={terms.maxDiscountAmount}
              onChange={(e) => set("maxDiscountAmount")(e.target.value)}
              aria-invalid={errors.maxDiscountAmount ? true : undefined}
              aria-describedby={describedBy("maxDiscountAmount")}
              className={inputCls}
            />
            {fieldError("maxDiscountAmount")}
          </div>
        )}

        <div>
          <label htmlFor="reward-days" className={labelCls}>
            Vigencia (días, opcional)
          </label>
          <input
            id="reward-days"
            inputMode="numeric"
            autoComplete="off"
            placeholder="No vence"
            value={terms.validDays}
            onChange={(e) => set("validDays")(e.target.value)}
            aria-invalid={errors.validDays ? true : undefined}
            aria-describedby={describedBy("validDays")}
            className={inputCls}
          />
          {fieldError("validDays")}
        </div>
      </div>

      {!editing && (
        <label className="flex items-start gap-2.5 text-sm text-krov-ash">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="mt-0.5 accent-krov-blood"
          />
          <span>
            Activa al crearla
            <span className="block text-xs text-krov-dust">
              Se entrega a quienes alcancen el rango a partir de ahora. Los clientes que ya tienen el
              rango no la reciben automáticamente.
            </span>
          </span>
        </label>
      )}

      {editing && target.reward.issuedCount > 0 && (
        <p className="border border-krov-smoke bg-krov-void px-3 py-2 text-xs text-krov-ash">
          {target.reward.issuedCount}{" "}
          {target.reward.issuedCount === 1 ? "cliente ya tiene" : "clientes ya tienen"} este cupón:
          conservan las condiciones con las que lo recibieron.
        </p>
      )}

      {serverError && (
        <p role="alert" className="border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {serverError}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          disabled={isPending}
          className="rounded-none border border-krov-smoke px-4 py-2.5 text-sm text-krov-ash transition hover:text-krov-bone disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-none bg-krov-blood px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-krov-crimson disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Guardando…" : editing ? "Guardar cambios" : "Crear recompensa"}
        </button>
      </div>
    </form>
  );
}
