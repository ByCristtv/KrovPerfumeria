import { formatXp } from "@/lib/format";
import type { RankLadder, UserRank } from "@/lib/rank";

/**
 * Validation of an admin's proposed XP thresholds — the TypeScript mirror of
 * `admin_update_level_thresholds` (migration 20261109000200). The database
 * re-checks everything and is the authority; this exists so the form can explain
 * a problem before the round trip. Change both together.
 *
 *   * every rank, exactly once (the form always submits the whole ladder);
 *   * whole numbers from 0 to {@link MAX_REQUIRED_XP};
 *   * the entry rank is fixed at 0 — every customer starts there;
 *   * each rank strictly above the one before it: min_xp(n) > min_xp(n-1).
 */

export const MAX_REQUIRED_XP = 10_000_000;

/** One row of the editor: the rank and whatever the admin typed. */
export interface ThresholdDraft {
  level: number;
  rank: UserRank;
  /** Raw input. Strings are trimmed; thousands separators are NOT accepted. */
  value: string | number;
}

export type ThresholdIssue =
  | "required"
  | "not_integer"
  | "negative"
  | "too_large"
  | "base_not_zero"
  | "not_above_previous";

export interface ThresholdRowResult {
  level: number;
  rank: UserRank;
  /** Parsed value, or null when the input is not a usable number. */
  value: number | null;
  issue: ThresholdIssue | null;
  /** Spanish, ready to show under the field. */
  message: string | null;
}

export interface ThresholdValidation {
  ok: boolean;
  rows: ThresholdRowResult[];
  /** The payload for the RPC — only when `ok`. */
  payload: { level_number: number; required_xp: number }[] | null;
}

type ParseIssue = Exclude<ThresholdIssue, "base_not_zero" | "not_above_previous">;

function parseValue(raw: string | number): { value: number | null; issue: ParseIssue | null } {
  const text = typeof raw === "number" ? String(raw) : raw.trim();
  if (text === "") return { value: null, issue: "required" };
  if (!/^-?\d+(\.\d+)?$/.test(text)) return { value: null, issue: "not_integer" };

  const value = Number(text);
  if (!Number.isFinite(value)) return { value: null, issue: "not_integer" };
  if (value < 0) return { value, issue: "negative" };
  if (!Number.isInteger(value)) return { value, issue: "not_integer" };
  if (value > MAX_REQUIRED_XP) return { value, issue: "too_large" };
  return { value, issue: null };
}

/**
 * Validate the whole proposed ladder. Rows come back in progression order,
 * each with its own issue, so the form can mark exactly the field to fix — and,
 * for an ordering conflict, name the rank it collides with.
 */
export function validateThresholds(drafts: readonly ThresholdDraft[]): ThresholdValidation {
  const ordered = [...drafts].sort((a, b) => a.level - b.level);

  const rows: ThresholdRowResult[] = [];
  // The last rank whose value is usable, to compare the next one against.
  let previous: { rank: UserRank; value: number } | null = null;

  ordered.forEach((draft, index) => {
    const { value, issue } = parseValue(draft.value);
    let finalIssue: ThresholdIssue | null = issue;
    let message: string | null = issue ? FIELD_MESSAGES[issue] : null;

    if (!finalIssue && value !== null) {
      if (index === 0 && value !== 0) {
        finalIssue = "base_not_zero";
        message = `${draft.rank} es el rango inicial y siempre requiere 0 XP.`;
      } else if (index > 0 && previous && value <= previous.value) {
        finalIssue = "not_above_previous";
        message =
          value === previous.value
            ? `Debe ser mayor que ${previous.rank} (${formatXp(previous.value)} XP): dos rangos no pueden pedir la misma XP. Sube ${draft.rank} o baja ${previous.rank}.`
            : `Debe ser mayor que ${previous.rank} (${formatXp(previous.value)} XP). Sube ${draft.rank} o baja ${previous.rank}.`;
      }
    }

    rows.push({ level: draft.level, rank: draft.rank, value, issue: finalIssue, message });

    // Keep comparing against the last value we could read, so one bad field
    // does not hide a second, independent conflict further up the ladder.
    if (value !== null && issue === null) previous = { rank: draft.rank, value };
  });

  const ok = rows.length > 0 && rows.every((row) => row.issue === null);
  return {
    ok,
    rows,
    payload: ok
      ? rows.map((row) => ({ level_number: row.level, required_xp: row.value as number }))
      : null,
  };
}

const FIELD_MESSAGES: Record<ParseIssue, string> = {
  required: "Ingresa la XP mínima.",
  not_integer: "Usa un número entero de XP, sin decimales ni separadores.",
  negative: "La XP no puede ser negativa.",
  too_large: `El máximo permitido es ${formatXp(MAX_REQUIRED_XP)} XP.`,
};

/** Drafts pre-filled from the stored ladder — the editor's starting point. */
export function draftsFromLadder(ladder: RankLadder): ThresholdDraft[] {
  return ladder.map((tier) => ({ level: tier.level, rank: tier.rank, value: String(tier.minXP) }));
}

/** One line per changed rank, for the confirmation dialog. */
export interface ThresholdChange {
  level: number;
  rank: UserRank;
  from: number;
  to: number;
}

export function diffThresholds(
  ladder: RankLadder,
  payload: readonly { level_number: number; required_xp: number }[]
): ThresholdChange[] {
  const changes: ThresholdChange[] = [];
  for (const tier of ladder) {
    const next = payload.find((p) => p.level_number === tier.level);
    if (next && next.required_xp !== tier.minXP) {
      changes.push({ level: tier.level, rank: tier.rank, from: tier.minXP, to: next.required_xp });
    }
  }
  return changes;
}
