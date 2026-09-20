import { describe, expect, it } from "vitest";
import {
  isSearchableQuery,
  normalizeSearchQuery,
  toRelationshipStatus,
  RELATIONSHIP_STATUSES,
  SOCIAL_SEARCH_MIN_LENGTH,
} from "./social";

describe("toRelationshipStatus", () => {
  it("passes every status the RPC can return straight through", () => {
    for (const status of RELATIONSHIP_STATUSES) {
      expect(toRelationshipStatus(status)).toBe(status);
    }
  });

  it("falls back to 'none' for an unknown status", () => {
    // Version skew between a deployed frontend and a newer database must never
    // resolve to the most PERMISSIVE reading.
    expect(toRelationshipStatus("blocked")).toBe("none");
    expect(toRelationshipStatus("")).toBe("none");
  });

  it("falls back to 'none' for null and undefined", () => {
    expect(toRelationshipStatus(null)).toBe("none");
    expect(toRelationshipStatus(undefined)).toBe("none");
  });

  it("never invents a friendship", () => {
    // The one wrong answer: claiming two strangers are friends.
    for (const value of ["FRIENDS", "friend", "amigos", "1", null]) {
      expect(toRelationshipStatus(value)).not.toBe("friends");
    }
  });
});

describe("normalizeSearchQuery", () => {
  it("trims, matching the RPC's own trim()", () => {
    expect(normalizeSearchQuery("  aurora  ")).toBe("aurora");
  });

  it("maps padded and unpadded terms onto one cache key", () => {
    expect(normalizeSearchQuery(" aurora")).toBe(normalizeSearchQuery("aurora "));
  });

  it("collapses a whitespace-only term to empty", () => {
    expect(normalizeSearchQuery("   ")).toBe("");
  });
});

describe("isSearchableQuery", () => {
  it("rejects a term shorter than the backend minimum", () => {
    // CASE 8: below the minimum, nothing should reach the RPC.
    expect(isSearchableQuery("")).toBe(false);
    expect(isSearchableQuery("a")).toBe(false);
  });

  it("rejects a term that is only long enough before trimming", () => {
    expect(isSearchableQuery("  a  ")).toBe(false);
  });

  it("accepts a term at the minimum length", () => {
    expect("au".length).toBe(SOCIAL_SEARCH_MIN_LENGTH);
    expect(isSearchableQuery("au")).toBe(true);
  });

  it("accepts a normal username", () => {
    expect(isSearchableQuery("aurora.cr")).toBe(true);
  });
});
