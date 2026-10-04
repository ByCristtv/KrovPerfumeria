import { describe, expect, it } from "vitest";
import { RANK_THRESHOLDS } from "@/lib/rank";
import { NEUTRAL_RING, RANK_STYLES } from "./rankStyle";

describe("RANK_STYLES", () => {
  it("covers every rank on the ladder, so a new tier cannot render unstyled", () => {
    expect(Object.keys(RANK_STYLES).sort()).toEqual(
      RANK_THRESHOLDS.map((t) => t.rank).sort()
    );
  });

  it("reserves gold for the top two tiers", () => {
    const gold = (rank: keyof typeof RANK_STYLES) => RANK_STYLES[rank].ring.includes("#e0b24a");
    expect(gold("EDP")).toBe(true);
    expect(gold("Parfum")).toBe(true);
    expect(gold("Fraiche")).toBe(false);
    expect(gold("Cologne")).toBe(false);
    expect(gold("EDT")).toBe(false);
  });

  it("gives only the highest tier a glow", () => {
    expect(RANK_STYLES.Parfum.glow).not.toBe("");
    expect(RANK_STYLES.EDP.glow).toBe("");
  });

  it("uses the lowest tier's ring when the rank is unknown", () => {
    expect(NEUTRAL_RING).toBe(RANK_STYLES.Fraiche.ring);
  });
});
