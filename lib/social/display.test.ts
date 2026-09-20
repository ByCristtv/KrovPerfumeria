import { describe, expect, it } from "vitest";
import { socialDisplayName, socialInitial } from "./display";

/**
 * The null-username rules. `profiles.username` is nullable and only
 * `search_public_users` filters the nulls out, so every other social surface
 * has to render a person who has none.
 */
describe("socialDisplayName", () => {
  it("prefers the username", () => {
    expect(socialDisplayName("aurora", "Aurora Vega")).toBe("aurora");
  });

  it("falls back to the full name when there is no username", () => {
    expect(socialDisplayName(null, "Aurora Vega")).toBe("Aurora Vega");
  });

  it("falls back to an anonymous label when there is neither", () => {
    expect(socialDisplayName(null, null)).toBe("Usuario sin nombre");
    expect(socialDisplayName(undefined)).toBe("Usuario sin nombre");
  });

  it("treats blank and whitespace-only values as absent", () => {
    expect(socialDisplayName("", "Aurora Vega")).toBe("Aurora Vega");
    expect(socialDisplayName("   ", "Aurora Vega")).toBe("Aurora Vega");
    expect(socialDisplayName("  ", "  ")).toBe("Usuario sin nombre");
  });

  it("trims what it returns", () => {
    expect(socialDisplayName("  aurora  ")).toBe("aurora");
  });

  it("never returns an empty string", () => {
    for (const [u, f] of [
      [null, null],
      ["", ""],
      ["   ", null],
      [undefined, undefined],
    ] as const) {
      expect(socialDisplayName(u, f).length).toBeGreaterThan(0);
    }
  });
});

describe("socialInitial", () => {
  it("uses the first character of the username", () => {
    expect(socialInitial("aurora", "Zoe")).toBe("A");
  });

  it("uses the full name when there is no username", () => {
    expect(socialInitial(null, "Aurora Vega")).toBe("A");
  });

  it('returns "?" when there is nothing to draw', () => {
    // The exact crash this replaces: username.charAt(0) on null.
    expect(socialInitial(null, null)).toBe("?");
    expect(socialInitial(undefined)).toBe("?");
    expect(socialInitial("", "")).toBe("?");
    expect(socialInitial("   ")).toBe("?");
  });

  it("uppercases the initial", () => {
    expect(socialInitial("aurora")).toBe("A");
    expect(socialInitial("ñandu")).toBe("Ñ");
  });

  it("returns one whole glyph for an astral character", () => {
    // charAt(0) would return half a surrogate pair and render as a tofu box.
    expect(socialInitial("🌙luna")).toBe("🌙");
    expect([...socialInitial("🌙luna")]).toHaveLength(1);
  });

  it("always returns exactly one glyph", () => {
    for (const value of ["aurora", "", "   ", "🌙x", null]) {
      expect([...socialInitial(value)]).toHaveLength(1);
    }
  });
});
