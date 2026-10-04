import { describe, expect, it } from "vitest";
import {
  formatFriendsSince,
  formatRequestAge,
  normalizeForSearch,
  socialDisplayName,
  socialHandle,
  socialHeadline,
  socialInitial,
} from "./display";

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

describe("socialHeadline", () => {
  it("prefers the full name — the reverse of socialDisplayName", () => {
    expect(socialHeadline("aurora", "Aurora Vega")).toBe("Aurora Vega");
  });

  it("falls back to the username, then to the anonymous label", () => {
    expect(socialHeadline("aurora", null)).toBe("aurora");
    expect(socialHeadline("aurora", "   ")).toBe("aurora");
    expect(socialHeadline(null, null)).toBe("Usuario sin nombre");
  });
});

describe("socialHandle", () => {
  it("prefixes @ and is null when there is no username", () => {
    expect(socialHandle("aurora")).toBe("@aurora");
    expect(socialHandle(null)).toBeNull();
    expect(socialHandle("  ")).toBeNull();
  });
});

describe("normalizeForSearch", () => {
  it("is case- and accent-insensitive", () => {
    expect(normalizeForSearch("Andrés MORA")).toBe("andres mora");
    expect(normalizeForSearch("  Sofía ")).toBe("sofia");
  });
});

describe("formatRequestAge", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

  it("speaks in coarse Spanish units", () => {
    expect(formatRequestAge(ago(0), now)).toBe("hoy");
    expect(formatRequestAge(ago(1), now)).toBe("ayer");
    expect(formatRequestAge(ago(3), now)).toBe("hace 3 días");
    expect(formatRequestAge(ago(7), now)).toBe("hace 1 semana");
    expect(formatRequestAge(ago(15), now)).toBe("hace 2 semanas");
    expect(formatRequestAge(ago(65), now)).toBe("hace 2 meses");
  });

  it("returns null for an unparseable date", () => {
    expect(formatRequestAge("nope", now)).toBeNull();
  });
});

describe("formatFriendsSince", () => {
  it("gives month and year only", () => {
    expect(formatFriendsSince("2026-09-19T10:00:00Z")).toMatch(/2026/);
    expect(formatFriendsSince("2026-09-19T10:00:00Z")).not.toMatch(/19/);
  });

  it("returns null for an unparseable date", () => {
    expect(formatFriendsSince("nope")).toBeNull();
  });
});
