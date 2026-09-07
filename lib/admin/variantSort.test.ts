import { describe, it, expect } from "vitest";
import { sortVariantsByStatus } from "./variantSort";

/** Minimal row: a status plus a marker so we can assert on relative order. */
function row(sku: string, is_active: boolean) {
  return { sku, is_active };
}

describe("sortVariantsByStatus", () => {
  it("puts active variants first and inactive last", () => {
    const result = sortVariantsByStatus([
      row("off-1", false),
      row("on-1", true),
      row("off-2", false),
      row("on-2", true),
    ]);

    expect(result.map((r) => r.sku)).toEqual(["on-1", "on-2", "off-1", "off-2"]);
  });

  it("preserves the database's ordering within each status group", () => {
    // The RPC returns newest-first; regrouping must not reshuffle that.
    const result = sortVariantsByStatus([
      row("on-newest", true),
      row("off-newest", false),
      row("on-older", true),
      row("off-older", false),
      row("on-oldest", true),
    ]);

    expect(result.map((r) => r.sku)).toEqual([
      "on-newest",
      "on-older",
      "on-oldest",
      "off-newest",
      "off-older",
    ]);
  });

  it("is a no-op when the rows already arrive active-first", () => {
    // The steady state once migration 20260905000200 is applied.
    const input = [row("a", true), row("b", true), row("c", false)];
    expect(sortVariantsByStatus(input).map((r) => r.sku)).toEqual(["a", "b", "c"]);
  });

  it("never mutates the array it was given", () => {
    const input = [row("off", false), row("on", true)];
    const snapshot = input.map((r) => r.sku);

    sortVariantsByStatus(input);

    expect(input.map((r) => r.sku)).toEqual(snapshot);
  });

  it("returns a new array, not the same reference", () => {
    const input = [row("on", true)];
    expect(sortVariantsByStatus(input)).not.toBe(input);
  });

  it("handles an empty page", () => {
    expect(sortVariantsByStatus([])).toEqual([]);
  });

  it("handles a page that is entirely active or entirely inactive", () => {
    const allOn = [row("a", true), row("b", true)];
    const allOff = [row("x", false), row("y", false)];

    expect(sortVariantsByStatus(allOn).map((r) => r.sku)).toEqual(["a", "b"]);
    expect(sortVariantsByStatus(allOff).map((r) => r.sku)).toEqual(["x", "y"]);
  });

  it("treats a non-boolean status as inactive", () => {
    // `is_active` is NOT NULL in the schema, but a null slipping through a
    // regenerated type or a hand-written fixture must sort down, not up.
    const rows = [
      { sku: "null-status", is_active: null as unknown as boolean },
      { sku: "active", is_active: true },
    ];

    expect(sortVariantsByStatus(rows).map((r) => r.sku)).toEqual([
      "active",
      "null-status",
    ]);
  });

  it("keeps every row it was given", () => {
    const input = [
      row("a", false),
      row("b", true),
      row("c", false),
      row("d", true),
    ];

    expect(sortVariantsByStatus(input)).toHaveLength(input.length);
  });
});
