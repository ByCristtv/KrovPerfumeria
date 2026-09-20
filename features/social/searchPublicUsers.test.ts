import { describe, expect, it, vi, beforeEach } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ supabase: { rpc: rpcMock } }));

import { searchPublicUsers } from "./searchPublicUsers";

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  user_id: "u2",
  username: "aurora",
  avatar_url: "https://lh3.googleusercontent.com/a/x",
  relationship_status: "none",
  ...over,
});

describe("searchPublicUsers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock.mockResolvedValue({ data: [], error: null });
  });

  describe("what it sends", () => {
    it("calls the search RPC, never the profiles table", async () => {
      // The privacy rule this protects: a client that read `profiles` directly
      // and filtered would be deciding visibility itself.
      await searchPublicUsers("aurora");
      expect(rpcMock).toHaveBeenCalledTimes(1);
      expect(rpcMock.mock.calls[0][0]).toBe("search_public_users");
    });

    it("sends the trimmed term", async () => {
      await searchPublicUsers("  aurora  ");
      expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_query: "aurora" });
    });

    it("defaults the pagination arguments", async () => {
      await searchPublicUsers("aurora");
      expect(rpcMock.mock.calls[0][1]).toMatchObject({
        p_limit: 20,
        p_offset: 0,
      });
    });

    it("forwards an explicit page", async () => {
      await searchPublicUsers("aurora", { limit: 5, offset: 10 });
      expect(rpcMock.mock.calls[0][1]).toMatchObject({
        p_limit: 5,
        p_offset: 10,
      });
    });

    it("does not call the backend below the minimum query length", async () => {
      // CASE 8.
      expect(await searchPublicUsers("a")).toEqual([]);
      expect(await searchPublicUsers("   ")).toEqual([]);
      expect(rpcMock).not.toHaveBeenCalled();
    });
  });

  describe("what it returns", () => {
    it("maps an RPC row onto the domain shape", async () => {
      rpcMock.mockResolvedValue({ data: [row()], error: null });

      expect(await searchPublicUsers("aurora")).toEqual([
        {
          userId: "u2",
          username: "aurora",
          avatarUrl: "https://lh3.googleusercontent.com/a/x",
          relationshipStatus: "none",
        },
      ]);
    });

    it("exposes nothing beyond the RPC's safe projection", async () => {
      // Even if the row somehow carried more, the mapper drops it.
      rpcMock.mockResolvedValue({
        data: [row({ full_name: "Aurora Vega", phone: "88880000" })],
        error: null,
      });

      const [user] = await searchPublicUsers("aurora");
      expect(Object.keys(user).sort()).toEqual([
        "avatarUrl",
        "relationshipStatus",
        "userId",
        "username",
      ]);
    });

    it("narrows every relationship status", async () => {
      // CASES 4-7 at the data layer.
      rpcMock.mockResolvedValue({
        data: [
          row({ user_id: "a", relationship_status: "none" }),
          row({ user_id: "b", relationship_status: "outgoing_pending" }),
          row({ user_id: "c", relationship_status: "incoming_pending" }),
          row({ user_id: "d", relationship_status: "friends" }),
          row({ user_id: "e", relationship_status: "who_knows" }),
        ],
        error: null,
      });

      expect(
        (await searchPublicUsers("aurora")).map((u) => u.relationshipStatus)
      ).toEqual([
        "none",
        "outgoing_pending",
        "incoming_pending",
        "friends",
        "none",
      ]);
    });

    it("treats a blank avatar as no avatar", async () => {
      // The signup trigger writes '' for accounts created without an OAuth
      // picture; an empty src is a failed request, not an absent image.
      rpcMock.mockResolvedValue({
        data: [row({ avatar_url: "" }), row({ user_id: "u3", avatar_url: null })],
        error: null,
      });

      const users = await searchPublicUsers("aurora");
      expect(users.map((u) => u.avatarUrl)).toEqual([null, null]);
    });

    it("returns an empty list when nothing matched", async () => {
      // CASE 9 at the data layer — an empty result is success, not an error.
      rpcMock.mockResolvedValue({ data: [], error: null });
      expect(await searchPublicUsers("zzzz")).toEqual([]);
    });

    it("tolerates a null payload", async () => {
      rpcMock.mockResolvedValue({ data: null, error: null });
      expect(await searchPublicUsers("aurora")).toEqual([]);
    });
  });

  describe("when the RPC fails", () => {
    it("throws so React Query can render an error state", async () => {
      // CASE 10.
      rpcMock.mockResolvedValue({
        data: null,
        error: { message: "permission denied for function" },
      });

      await expect(searchPublicUsers("aurora")).rejects.toMatchObject({
        message: "permission denied for function",
      });
    });
  });
});
