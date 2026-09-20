import { describe, expect, it } from "vitest";
import { toSocialError } from "./errors";

/**
 * Error normalization. Two properties matter and both are load-bearing:
 * no Postgres text ever reaches a user, and "the world moved on" is
 * distinguishable from "that failed" so the UI knows when to refetch.
 */
describe("toSocialError", () => {
  describe("known domain errors", () => {
    it("maps each documented code to Spanish copy", () => {
      const codes = [
        "authentication_required",
        "cannot_add_yourself",
        "user_profile_is_private",
        "users_are_already_friends",
        "incoming_friend_request_exists",
        "pending_sent_request_not_found",
        "pending_received_request_not_found",
        "friend_request_not_found",
        "not_request_receiver",
        "friend_request_is_not_pending",
        "invalid_friend_user",
      ] as const;

      for (const code of codes) {
        const result = toSocialError({ message: code });
        expect(result.code).toBe(code);
        expect(result.message).not.toBe("");
        // The machine code must never be what the customer reads.
        expect(result.message).not.toContain(code);
      }
    });

    it("matches even when PostgREST prefixes the message", () => {
      const result = toSocialError({
        message: 'error running query: cannot_add_yourself',
      });
      expect(result.code).toBe("cannot_add_yourself");
    });

    it("reads an Error instance as well as a PostgrestError shape", () => {
      expect(toSocialError(new Error("users_are_already_friends")).code).toBe(
        "users_are_already_friends"
      );
    });
  });

  describe("staleness (the refetch signal)", () => {
    it("flags the outcomes caused by somebody else acting first", () => {
      for (const code of [
        "users_are_already_friends",
        "incoming_friend_request_exists",
        "pending_sent_request_not_found",
        "pending_received_request_not_found",
        "friend_request_not_found",
        "friend_request_is_not_pending",
        "user_profile_is_private",
      ]) {
        expect(toSocialError({ message: code }).isStale).toBe(true);
      }
    });

    it("does not flag failures a refetch would not fix", () => {
      for (const code of [
        "authentication_required",
        "cannot_add_yourself",
        "not_request_receiver",
        "invalid_friend_user",
      ]) {
        expect(toSocialError({ message: code }).isStale).toBe(false);
      }
    });
  });

  describe("everything else", () => {
    it("collapses an unrecognized database error to generic copy", () => {
      const result = toSocialError({
        message:
          'duplicate key value violates unique constraint "friend_requests_unique_pending_pair_idx"',
      });
      expect(result.code).toBe("unknown");
      expect(result.message).toMatch(/intenta de nuevo/i);
      expect(result.message).not.toMatch(/constraint|duplicate key/i);
    });

    it("survives null, undefined and non-error values", () => {
      for (const value of [null, undefined, 42, "", {}]) {
        expect(toSocialError(value).code).toBe("unknown");
      }
    });
  });
});
