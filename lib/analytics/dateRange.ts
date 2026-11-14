/**
 * Sales-dashboard date ranges — the ONE place that turns a selection
 * ("30 días", "Todo", "1 sep → 1 oct") into the instants sent to the
 * analytics RPCs (analytics_sales_summary / analytics_sales_best_sellers).
 *
 * Contract with SQL (migration 20261114000100, analytics_countable_orders):
 *   orders count when  created_at >= from  (if from is not null)
 *                 and  created_at <  to    (if to   is not null)
 *   null = unbounded on that side. Both bounds are ALWAYS sent explicitly —
 *   never omitted — so a SQL parameter default can never silently narrow the
 *   period again (that is exactly how "Todo" turned into "last 30 days").
 *
 * Custom ranges are calendar dates in the shop's time zone (Costa Rica, which
 * the admin and the customers live in): start date D → D 00:00 CR, end date
 * E → (E + 1 day) 00:00 CR, exclusive. That makes both dates inclusive — an
 * order at 23:59:59.999 on the end date counts, nothing from the next day
 * does — with no "23:59:59" fudge.
 *
 * Presets keep their original rolling semantics: the last N × 24 h up to now.
 */

/** The shop's business time zone (UTC-6, no DST). Same as admin date labels. */
export const BUSINESS_TIME_ZONE = "America/Costa_Rica";

export type SalesPreset = "7d" | "30d" | "90d" | "all";

/** What the admin selected. Custom dates are "YYYY-MM-DD" calendar dates. */
export type SalesRange =
  | { kind: "preset"; preset: SalesPreset }
  | { kind: "custom"; start: string; end: string };

/** The instants a range resolves to. `null` = unbounded on that side. */
export interface ResolvedSalesRange {
  from: Date | null;
  /** Exclusive upper bound. */
  to: Date | null;
}

export const DEFAULT_SALES_RANGE: SalesRange = { kind: "preset", preset: "30d" };

const DAY_MS = 24 * 60 * 60 * 1000;

const PRESET_DAYS: Record<Exclude<SalesPreset, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

const PRESET_LABELS: Record<SalesPreset, string> = {
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  "90d": "Últimos 90 días",
  all: "Todo el historial",
};

// ─────────────────────────────────────────────────────────────────────────────
// Calendar-date helpers ("YYYY-MM-DD", no time, no zone)
// ─────────────────────────────────────────────────────────────────────────────

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses "YYYY-MM-DD" into parts, or null if malformed or not a real date. */
export function parseIsoDate(value: string): { y: number; m: number; d: number } | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const probe = new Date(Date.UTC(y, m - 1, d));
  // Rejects 2026-02-30, 2026-13-01, … (Date.UTC would roll them over).
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

/** "2026-09-30" + 1 → "2026-10-01". Input must be valid. */
export function addDays(isoDate: string, days: number): string {
  const p = parseIsoDate(isoDate);
  if (!p) throw new Error(`addDays: invalid date "${isoDate}"`);
  return new Date(Date.UTC(p.y, p.m - 1, p.d + days)).toISOString().slice(0, 10);
}

/** Inclusive number of calendar days between two valid dates (same day = 1). */
export function daysInclusive(start: string, end: string): number {
  const a = parseIsoDate(start)!;
  const b = parseIsoDate(end)!;
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY_MS) + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Time-zone conversion
// ─────────────────────────────────────────────────────────────────────────────

function zonedParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    y: get("year"),
    m: get("month"),
    d: get("day"),
    h: get("hour"),
    min: get("minute"),
    s: get("second"),
  };
}

/** Offset (ms) of `timeZone` from UTC at `instant`; Costa Rica → −6 h. */
function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const wallAsUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  const wholeSeconds = instant.getTime() - instant.getUTCMilliseconds();
  return wallAsUtc - wholeSeconds;
}

/**
 * The UTC instant of 00:00 on `isoDate` in `timeZone`.
 * "2026-09-01" in Costa Rica → 2026-09-01T06:00:00.000Z.
 * (Re-checks the offset at the result, so a DST zone would also be right.)
 */
export function startOfDayInZone(isoDate: string, timeZone: string = BUSINESS_TIME_ZONE): Date {
  const p = parseIsoDate(isoDate);
  if (!p) throw new Error(`startOfDayInZone: invalid date "${isoDate}"`);
  const wallAsUtc = Date.UTC(p.y, p.m - 1, p.d);
  let instant = wallAsUtc - timeZoneOffsetMs(new Date(wallAsUtc), timeZone);
  const offsetAtResult = timeZoneOffsetMs(new Date(instant), timeZone);
  instant = wallAsUtc - offsetAtResult;
  return new Date(instant);
}

/** Today's calendar date in the business time zone, "YYYY-MM-DD". */
export function todayInZone(now: Date = new Date(), timeZone: string = BUSINESS_TIME_ZONE): string {
  const p = zonedParts(now, timeZone);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

export type CustomRangeField = "start" | "end";

export type CustomRangeValidation =
  | { ok: true; range: Extract<SalesRange, { kind: "custom" }> }
  | { ok: false; field: CustomRangeField; message: string };

/**
 * Validates a custom range typed/picked by the admin. `today` is the business
 * zone's current date (todayInZone()). Rules: both dates required and real,
 * no future dates, end on or after start (same day = a one-day range).
 */
export function validateCustomRange(
  start: string,
  end: string,
  today: string
): CustomRangeValidation {
  if (!start) return { ok: false, field: "start", message: "Selecciona la fecha de inicio." };
  if (!parseIsoDate(start)) return { ok: false, field: "start", message: "La fecha de inicio no es válida." };
  if (!end) return { ok: false, field: "end", message: "Selecciona la fecha de fin." };
  if (!parseIsoDate(end)) return { ok: false, field: "end", message: "La fecha de fin no es válida." };
  // ISO dates compare correctly as strings.
  if (start > today) return { ok: false, field: "start", message: "La fecha de inicio no puede ser futura." };
  if (end > today) return { ok: false, field: "end", message: "La fecha de fin no puede ser futura." };
  if (end < start) {
    return { ok: false, field: "end", message: "La fecha de fin no puede ser anterior a la de inicio." };
  }
  return { ok: true, range: { kind: "custom", start, end } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolution → RPC bounds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves a selection to instants. Presets are relative to `now` (call this
 * once per selection and memoize, so query keys stay stable between renders).
 * Throws on an invalid custom range — callers validate before applying.
 */
export function resolveSalesRange(range: SalesRange, now: Date = new Date()): ResolvedSalesRange {
  if (range.kind === "custom") {
    if (!parseIsoDate(range.start) || !parseIsoDate(range.end) || range.end < range.start) {
      throw new Error(`resolveSalesRange: invalid custom range ${range.start} → ${range.end}`);
    }
    return {
      from: startOfDayInZone(range.start),
      to: startOfDayInZone(addDays(range.end, 1)),
    };
  }
  if (range.preset === "all") return { from: null, to: null };
  return { from: new Date(now.getTime() - PRESET_DAYS[range.preset] * DAY_MS), to: null };
}

/** RPC arguments. Both keys always present; null means unbounded. */
export function toRpcBounds(resolved: ResolvedSalesRange): {
  p_from: string | null;
  p_to: string | null;
} {
  return {
    p_from: resolved.from ? resolved.from.toISOString() : null,
    p_to: resolved.to ? resolved.to.toISOString() : null,
  };
}

/** Stable react-query key segment shared by every sales query. */
export function salesRangeKey(resolved: ResolvedSalesRange): [string, string] {
  const { p_from, p_to } = toRpcBounds(resolved);
  return [p_from ?? "-inf", p_to ?? "+inf"];
}

// ─────────────────────────────────────────────────────────────────────────────
// Labels
// ─────────────────────────────────────────────────────────────────────────────

/** "1 sept 2026" — formats the calendar date itself, independent of zones. */
export function formatIsoDate(isoDate: string): string {
  const p = parseIsoDate(isoDate);
  if (!p) return isoDate;
  return new Intl.DateTimeFormat("es-CR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(p.y, p.m - 1, p.d)));
}

/** Human description of the active period, shown above the KPIs. */
export function describeSalesRange(range: SalesRange): string {
  if (range.kind === "preset") return PRESET_LABELS[range.preset];
  const days = daysInclusive(range.start, range.end);
  const span = days === 1 ? "1 día" : `${days.toLocaleString("es-CR")} días`;
  return range.start === range.end
    ? `${formatIsoDate(range.start)} (${span})`
    : `${formatIsoDate(range.start)} – ${formatIsoDate(range.end)} (${span})`;
}
