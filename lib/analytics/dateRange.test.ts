import { describe, expect, it } from "vitest";
import {
  addDays,
  daysInclusive,
  describeSalesRange,
  parseIsoDate,
  resolveSalesRange,
  salesRangeKey,
  startOfDayInZone,
  todayInZone,
  toRpcBounds,
  validateCustomRange,
  type ResolvedSalesRange,
} from "./dateRange";

/** Same predicate the SQL applies (analytics_countable_orders), for boundary checks. */
function counts(range: ResolvedSalesRange, createdAt: string): boolean {
  const t = new Date(createdAt).getTime();
  return (!range.from || t >= range.from.getTime()) && (!range.to || t < range.to.getTime());
}

const NOW = new Date("2026-11-14T18:00:00.000Z"); // 12:00 in Costa Rica
const DAY = 24 * 60 * 60 * 1000;

describe("presets", () => {
  it("'all' is unbounded on both sides and sends explicit nulls", () => {
    const r = resolveSalesRange({ kind: "preset", preset: "all" }, NOW);
    expect(r).toEqual({ from: null, to: null });
    // Regression guard for the production bug: both keys must be PRESENT, so
    // PostgREST never falls back to a SQL default for an omitted bound.
    const args = toRpcBounds(r);
    expect(Object.keys(args).sort()).toEqual(["p_from", "p_to"]);
    expect(args).toEqual({ p_from: null, p_to: null });
  });

  it("'all' includes orders older than 90 days (years old, even)", () => {
    const all = resolveSalesRange({ kind: "preset", preset: "all" }, NOW);
    expect(counts(all, "2001-03-15T18:00:00Z")).toBe(true);
    expect(counts(all, new Date(NOW.getTime() - 91 * DAY).toISOString())).toBe(true);
  });

  it.each([
    ["7d", 7],
    ["30d", 30],
    ["90d", 90],
  ] as const)("%s is the last %i × 24 h up to now, open-ended", (preset, days) => {
    const r = resolveSalesRange({ kind: "preset", preset }, NOW);
    expect(r.to).toBeNull();
    expect(r.from?.toISOString()).toBe(new Date(NOW.getTime() - days * DAY).toISOString());

    const justInside = new Date(NOW.getTime() - days * DAY + 60_000).toISOString();
    const exactlyAtStart = new Date(NOW.getTime() - days * DAY).toISOString();
    const justOutside = new Date(NOW.getTime() - days * DAY - 60_000).toISOString();
    expect(counts(r, justInside)).toBe(true);
    expect(counts(r, exactlyAtStart)).toBe(true);
    expect(counts(r, justOutside)).toBe(false);
    expect(counts(r, NOW.toISOString())).toBe(true);
  });

  it("every window is contained in 'all' (Todo can never be smaller)", () => {
    const all = resolveSalesRange({ kind: "preset", preset: "all" }, NOW);
    const ninety = resolveSalesRange({ kind: "preset", preset: "90d" }, NOW);
    const sample = Array.from({ length: 400 }, (_, i) =>
      new Date(NOW.getTime() - i * DAY).toISOString()
    );
    for (const at of sample) {
      if (counts(ninety, at)) expect(counts(all, at)).toBe(true);
    }
  });
});

describe("custom ranges (Costa Rica, UTC-6)", () => {
  const sepToOct = resolveSalesRange({ kind: "custom", start: "2026-09-01", end: "2026-10-01" });

  it("start = 00:00 CR of the start date, end = 00:00 CR of the day after (exclusive)", () => {
    expect(sepToOct.from?.toISOString()).toBe("2026-09-01T06:00:00.000Z");
    expect(sepToOct.to?.toISOString()).toBe("2026-10-02T06:00:00.000Z");
    expect(toRpcBounds(sepToOct)).toEqual({
      p_from: "2026-09-01T06:00:00.000Z",
      p_to: "2026-10-02T06:00:00.000Z",
    });
  });

  it("includes orders on the start date, from its first instant", () => {
    expect(counts(sepToOct, "2026-09-01T00:00:00.000-06:00")).toBe(true);
    expect(counts(sepToOct, "2026-09-01T08:30:00-06:00")).toBe(true);
  });

  it("includes orders late on the end date (23:59:59.999 CR = next day in UTC)", () => {
    expect(counts(sepToOct, "2026-10-01T23:00:00-06:00")).toBe(true);
    expect(counts(sepToOct, "2026-10-01T23:59:59.999-06:00")).toBe(true);
    // That instant is already Oct 2 in UTC — a naive UTC-midnight bound would drop it.
    expect(new Date("2026-10-01T23:59:59.999-06:00").toISOString()).toBe("2026-10-02T05:59:59.999Z");
  });

  it("excludes orders immediately before and after the period", () => {
    expect(counts(sepToOct, "2026-08-31T23:59:59.999-06:00")).toBe(false);
    expect(counts(sepToOct, "2026-10-02T00:00:00.000-06:00")).toBe(false);
  });

  it("a one-day range covers exactly that CR calendar day", () => {
    const day = resolveSalesRange({ kind: "custom", start: "2026-10-01", end: "2026-10-01" });
    expect(day.from?.toISOString()).toBe("2026-10-01T06:00:00.000Z");
    expect(day.to?.toISOString()).toBe("2026-10-02T06:00:00.000Z");
    expect(counts(day, "2026-10-01T00:00:00-06:00")).toBe(true);
    expect(counts(day, "2026-10-01T23:59:59.999-06:00")).toBe(true);
    expect(counts(day, "2026-09-30T23:59:59.999-06:00")).toBe(false);
    expect(counts(day, "2026-10-02T00:00:00-06:00")).toBe(false);
  });

  it("handles month, year and leap-day boundaries", () => {
    expect(resolveSalesRange({ kind: "custom", start: "2026-12-31", end: "2026-12-31" }).to?.toISOString())
      .toBe("2027-01-01T06:00:00.000Z");
    expect(resolveSalesRange({ kind: "custom", start: "2028-02-29", end: "2028-02-29" }).to?.toISOString())
      .toBe("2028-03-01T06:00:00.000Z");
  });

  it("refuses to resolve an invalid range rather than guessing", () => {
    expect(() => resolveSalesRange({ kind: "custom", start: "2026-10-01", end: "2026-09-01" })).toThrow();
    expect(() => resolveSalesRange({ kind: "custom", start: "", end: "2026-09-01" })).toThrow();
    expect(() => resolveSalesRange({ kind: "custom", start: "2026-02-30", end: "2026-03-01" })).toThrow();
  });

  it("produces the same query key for the same dates (cache hit), different for others", () => {
    const again = resolveSalesRange({ kind: "custom", start: "2026-09-01", end: "2026-10-01" });
    expect(salesRangeKey(again)).toEqual(salesRangeKey(sepToOct));
    expect(salesRangeKey(resolveSalesRange({ kind: "preset", preset: "all" }))).toEqual(["-inf", "+inf"]);
  });
});

describe("validateCustomRange", () => {
  const today = "2026-11-14";

  it("accepts a normal range and a one-day range", () => {
    expect(validateCustomRange("2026-09-01", "2026-10-01", today)).toEqual({
      ok: true,
      range: { kind: "custom", start: "2026-09-01", end: "2026-10-01" },
    });
    expect(validateCustomRange(today, today, today).ok).toBe(true);
  });

  it.each([
    ["", "2026-10-01", "start", "Selecciona la fecha de inicio."],
    ["2026-09-01", "", "end", "Selecciona la fecha de fin."],
    ["2026-02-30", "2026-03-01", "start", "La fecha de inicio no es válida."],
    ["2026-09-01", "01/10/2026", "end", "La fecha de fin no es válida."],
    ["2026-10-01", "2026-09-01", "end", "La fecha de fin no puede ser anterior a la de inicio."],
    ["2026-11-15", "2026-11-20", "start", "La fecha de inicio no puede ser futura."],
    ["2026-11-01", "2026-11-15", "end", "La fecha de fin no puede ser futura."],
  ])("rejects start=%j end=%j", (start, end, field, message) => {
    expect(validateCustomRange(start, end, today)).toEqual({ ok: false, field, message });
  });
});

describe("helpers", () => {
  it("todayInZone uses the Costa Rica calendar date, not UTC's", () => {
    // 03:00 UTC on Nov 15 is still 21:00 on Nov 14 in Costa Rica.
    expect(todayInZone(new Date("2026-11-15T03:00:00Z"))).toBe("2026-11-14");
    expect(todayInZone(new Date("2026-11-15T06:00:00Z"))).toBe("2026-11-15");
  });

  it("startOfDayInZone, addDays, daysInclusive, parseIsoDate", () => {
    expect(startOfDayInZone("2026-09-01").toISOString()).toBe("2026-09-01T06:00:00.000Z");
    expect(startOfDayInZone("2026-07-01", "UTC").toISOString()).toBe("2026-07-01T00:00:00.000Z");
    // A DST zone resolves to the right offset on each side of the change.
    expect(startOfDayInZone("2026-01-15", "America/New_York").toISOString()).toBe("2026-01-15T05:00:00.000Z");
    expect(startOfDayInZone("2026-07-15", "America/New_York").toISOString()).toBe("2026-07-15T04:00:00.000Z");
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(daysInclusive("2026-09-01", "2026-10-01")).toBe(31);
    expect(daysInclusive("2026-10-01", "2026-10-01")).toBe(1);
    expect(parseIsoDate("2026-13-01")).toBeNull();
  });

  it("describes the active period", () => {
    expect(describeSalesRange({ kind: "preset", preset: "all" })).toBe("Todo el historial");
    expect(describeSalesRange({ kind: "preset", preset: "7d" })).toBe("Últimos 7 días");
    expect(describeSalesRange({ kind: "custom", start: "2026-09-01", end: "2026-10-01" })).toMatch(
      /^1 .+ 2026 – 1 .+ 2026 \(31 días\)$/
    );
    expect(describeSalesRange({ kind: "custom", start: "2026-10-01", end: "2026-10-01" })).toMatch(
      /\(1 día\)$/
    );
  });
});
