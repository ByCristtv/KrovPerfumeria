import { describe, expect, it } from "vitest";
import { socialKeys, SOCIAL_INVALIDATIONS } from "./queryKeys";

/**
 * The invalidation policy, tested as data.
 *
 * This is the part of MVP 2 that is easiest to get quietly wrong: forget to
 * invalidate the search and «Agregar» stays on screen for somebody who is now a
 * friend; invalidate everything and accepting a request refetches the catalog.
 */
describe("socialKeys", () => {
  it("keeps MVP 1's search key shape, so no cached entry moved", () => {
    expect(socialKeys.search("aurora")).toEqual(["userSearch", "aurora"]);
  });

  it("makes the search prefix cover every cached term", () => {
    const prefix = socialKeys.searches();
    expect(socialKeys.search("aurora").slice(0, prefix.length)).toEqual([
      ...prefix,
    ]);
    expect(socialKeys.search("borealis").slice(0, prefix.length)).toEqual([
      ...prefix,
    ]);
  });

  it("separates the two request directions", () => {
    expect(socialKeys.receivedRequests()).not.toEqual(socialKeys.sentRequests());
  });
});

describe("SOCIAL_INVALIDATIONS", () => {
  const keyOf = (k: readonly string[]) => k.join("/");
  const keysFor = (m: keyof typeof SOCIAL_INVALIDATIONS) =>
    SOCIAL_INVALIDATIONS[m].map(keyOf);

  it("refreshes search after every relationship change", () => {
    // A search result on screen shows a relationship_status that just changed.
    for (const mutation of Object.keys(SOCIAL_INVALIDATIONS) as Array<
      keyof typeof SOCIAL_INVALIDATIONS
    >) {
      expect(keysFor(mutation)).toContain(keyOf(socialKeys.searches()));
    }
  });

  it("refreshes sent requests when one is created or withdrawn", () => {
    expect(keysFor("sendRequest")).toContain(keyOf(socialKeys.sentRequests()));
    expect(keysFor("cancelRequest")).toContain(keyOf(socialKeys.sentRequests()));
  });

  it("refreshes the inbox and the friends list when a request is accepted", () => {
    expect(keysFor("acceptRequest")).toEqual(
      expect.arrayContaining([
        keyOf(socialKeys.receivedRequests()),
        keyOf(socialKeys.friends()),
      ])
    );
  });

  it("does not touch the friends list on a reject — no friendship is created", () => {
    expect(keysFor("rejectRequest")).toContain(
      keyOf(socialKeys.receivedRequests())
    );
    expect(keysFor("rejectRequest")).not.toContain(keyOf(socialKeys.friends()));
  });

  it("does not touch the request lists on a removal — no request is involved", () => {
    expect(keysFor("removeFriend")).toContain(keyOf(socialKeys.friends()));
    expect(keysFor("removeFriend")).not.toContain(
      keyOf(socialKeys.receivedRequests())
    );
    expect(keysFor("removeFriend")).not.toContain(
      keyOf(socialKeys.sentRequests())
    );
  });

  it("never invalidates a key outside the social domain", () => {
    const allowed = new Set([
      "userSearch",
      "friendRequests",
      "friends",
      "friendProfile",
      "friendProducts",
    ]);
    // `["account", "socialEligibility"]` is the one deliberate exception: the
    // viewer's own profile row. It must stay NARROW - invalidating the bare
    // ["account"] prefix would also drop the profile page's orders and
    // wholesale queries.
    const eligibility = socialKeys.eligibilityAll().join("/");

    for (const keys of Object.values(SOCIAL_INVALIDATIONS)) {
      for (const key of keys) {
        if (key[0] === "account") {
          expect(key.join("/")).toBe(eligibility);
          continue;
        }
        expect(allowed).toContain(key[0]);
      }
    }
  });

  it("refreshes the viewer's own eligibility when a request is sent", () => {
    // A send refused because the VIEWER went private elsewhere has to re-read
    // that, or Buscar keeps offering a box that can only fail.
    expect(keysFor("sendRequest")).toContain(
      keyOf(socialKeys.eligibilityAll())
    );
  });

  it("drops every cached friend profile when a friendship ends", () => {
    // Authorization revocation: those entries were fetched under a friendship
    // that no longer exists, so they must not survive it.
    expect(keysFor("removeFriend")).toEqual(
      expect.arrayContaining([
        keyOf(socialKeys.friendProfiles()),
        keyOf(socialKeys.friendProductsAll()),
      ])
    );
  });

  it("makes the profile prefixes cover every cached friend", () => {
    const prefix = socialKeys.friendProfiles();
    expect(socialKeys.friendProfile("u2").slice(0, prefix.length)).toEqual([
      ...prefix,
    ]);
    const productsPrefix = socialKeys.friendProductsAll();
    expect(
      socialKeys.friendProducts("u2").slice(0, productsPrefix.length)
    ).toEqual([...productsPrefix]);
  });

  it("covers every mutation the module exposes", () => {
    expect(Object.keys(SOCIAL_INVALIDATIONS).sort()).toEqual([
      "acceptRequest",
      "cancelRequest",
      "rejectRequest",
      "removeFriend",
      "sendRequest",
    ]);
  });
});
