import type { DiscountType } from "@/lib/coupons/types";

/**
 * Validation of a coupon reward definition's terms — the TypeScript mirror of
 * `loyalty_assert_reward_terms` (migration 20261109000200). The database
 * re-validates every write; keep both in lock-step.
 *
 * The discount model is the one `coupons` / `apply_order_coupon` already use:
 *   percentage  > 0 … 100, up to 2 decimals; optional cap in whole colones
 *   fixed       whole colones, 1 … 10,000,000 (a cap makes no sense here)
 *   minimum     whole colones on the goods subtotal, 0 … 10,000,000
 *   validity    optional, 1 … 3,650 days from the moment it is issued
 */

export const REWARD_LIMITS = {
  nameMax: 80,
  descriptionMax: 300,
  amountMax: 10_000_000,
  validDaysMax: 3_650,
} as const;

export type RewardField =
  | "name"
  | "description"
  | "discountType"
  | "discountValue"
  | "minOrderSubtotal"
  | "maxDiscountAmount"
  | "validDays";

/** What the form holds — strings, exactly as typed. */
export interface RewardTermsInput {
  name: string;
  description: string;
  discountType: DiscountType;
  discountValue: string;
  minOrderSubtotal: string;
  /** Empty = no cap. Ignored for fixed discounts (must be empty). */
  maxDiscountAmount: string;
  /** Empty = never expires. */
  validDays: string;
}

/** Validated terms, ready for the RPC. */
export interface RewardTerms {
  name: string;
  description: string | null;
  discountType: DiscountType;
  discountValue: number;
  minOrderSubtotal: number;
  maxDiscountAmount: number | null;
  validDays: number | null;
}

export type RewardTermsValidation =
  | { ok: true; terms: RewardTerms }
  | { ok: false; errors: Partial<Record<RewardField, string>> };

const NUMBER = /^\d+(\.\d+)?$/;

function parseNumber(raw: string): number | null {
  const text = raw.trim();
  if (!NUMBER.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function decimals(n: number): number {
  const [, fraction = ""] = String(n).split(".");
  return fraction.length;
}

export function validateRewardTerms(input: RewardTermsInput): RewardTermsValidation {
  const errors: Partial<Record<RewardField, string>> = {};

  const name = (input.name ?? "").trim();
  if (name.length < 1 || name.length > REWARD_LIMITS.nameMax) {
    errors.name = `Escribe un nombre de 1 a ${REWARD_LIMITS.nameMax} caracteres.`;
  }

  const description = (input.description ?? "").trim();
  if (description.length > REWARD_LIMITS.descriptionMax) {
    errors.description = `Máximo ${REWARD_LIMITS.descriptionMax} caracteres.`;
  }

  const type = input.discountType;
  if (type !== "percentage" && type !== "fixed") {
    errors.discountType = "Elige un tipo de descuento.";
  }

  const value = parseNumber(input.discountValue ?? "");
  if (value === null || value <= 0) {
    errors.discountValue =
      type === "fixed" ? "Ingresa un monto mayor que ₡0." : "Ingresa un porcentaje mayor que 0.";
  } else if (type === "percentage" && (value > 100 || decimals(value) > 2)) {
    errors.discountValue = "El porcentaje debe estar entre 0,01 y 100, con hasta 2 decimales.";
  } else if (type === "fixed" && (!Number.isInteger(value) || value > REWARD_LIMITS.amountMax)) {
    errors.discountValue = "El monto debe ser un número entero de colones (máximo ₡10.000.000).";
  }

  const minimum = parseNumber(input.minOrderSubtotal ?? "");
  if (minimum === null || !Number.isInteger(minimum) || minimum > REWARD_LIMITS.amountMax) {
    errors.minOrderSubtotal = "Ingresa la compra mínima en colones enteros (0 si no tiene mínimo).";
  }

  let cap: number | null = null;
  const capText = (input.maxDiscountAmount ?? "").trim();
  if (capText !== "") {
    cap = parseNumber(capText);
    if (type !== "percentage") {
      errors.maxDiscountAmount = "El tope solo aplica a descuentos porcentuales.";
    } else if (cap === null || !Number.isInteger(cap) || cap < 1 || cap > REWARD_LIMITS.amountMax) {
      errors.maxDiscountAmount = "El tope debe ser un número entero de colones mayor que 0.";
    }
  }

  let days: number | null = null;
  const daysText = (input.validDays ?? "").trim();
  if (daysText !== "") {
    days = parseNumber(daysText);
    if (days === null || !Number.isInteger(days) || days < 1 || days > REWARD_LIMITS.validDaysMax) {
      errors.validDays = `Usa entre 1 y ${REWARD_LIMITS.validDaysMax} días, o déjalo vacío para que no venza.`;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    terms: {
      name,
      description: description === "" ? null : description,
      discountType: type,
      discountValue: value as number,
      minOrderSubtotal: minimum as number,
      maxDiscountAmount: cap,
      validDays: days,
    },
  };
}
