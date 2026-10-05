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
    expect(gold("Alquimista")).toBe(true);
    expect(gold("Maestro")).toBe(true);
    expect(gold("Aficionado")).toBe(false);
    expect(gold("Coleccionista")).toBe(false);
    expect(gold("Conocedor")).toBe(false);
  });

  it("gives only the highest tier a glow", () => {
    expect(RANK_STYLES.Maestro.glow).not.toBe("");
    expect(RANK_STYLES.Alquimista.glow).toBe("");
  });

  it("uses the lowest tier's ring when the rank is unknown", () => {
    expect(NEUTRAL_RING).toBe(RANK_STYLES.Aficionado.ring);
  });
});
