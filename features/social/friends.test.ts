import { describe, expect, it, vi, beforeEach } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ supabase: { rpc: rpcMock } }));

import { getFriends, removeFriend } from "./friends";

const row = (over: Record<string, unknown> = {}) => ({
  friendship_id: "f1",
  friend_user_id: "u2",
  username: "aurora",
  full_name: "Aurora Vega",
  avatar_url: "https://lh3.googleusercontent.com/a/x",
  experience_points: 5200,
  friends_since: "2026-09-19T10:00:00Z",
  ...over,
});

describe("friends data access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock.mockResolvedValue({ data: [], error: null });
  });

  describe("getFriends", () => {
    it("reads through the RPC, never the friendships table", async () => {
      await getFriends();
      expect(rpcMock).toHaveBeenCalledWith("get_friends");
    });

    it("maps the RPC row onto the domain shape", async () => {
      rpcMock.mockResolvedValue({ data: [row()], error: null });

      expect(await getFriends()).toEqual([
        {
          friendshipId: "f1",
          userId: "u2",
          username: "aurora",
          fullName: "Aurora Vega",
          avatarUrl: "https://lh3.googleusercontent.com/a/x",
          experiencePoints: 5200,
          friendsSince: "2026-09-19T10:00:00Z",
        },
      ]);
    });

    it("exposes no private contact or order data", async () => {
      rpcMock.mockResolvedValue({
        data: [row({ phone: "88880000", email: "a@b.c", total: 50000 })],
        error: null,
      });

      const [friend] = await getFriends();
      expect(Object.keys(friend).sort()).toEqual([
        "avatarUrl",
        "experiencePoints",
        "friendsSince",
        "friendshipId",
        "fullName",
        "userId",
        "username",
      ]);
    });

    it("normalizes a blank name and avatar to null", async () => {
      rpcMock.mockResolvedValue({
        data: [row({ full_name: "", avatar_url: "" })],
        error: null,
      });
      const [friend] = await getFriends();
      expect(friend.fullName).toBeNull();
      expect(friend.avatarUrl).toBeNull();
    });

    it("returns an empty list for a user with no friends (CASE 10)", async () => {
      rpcMock.mockResolvedValue({ data: [], error: null });
      expect(await getFriends()).toEqual([]);
    });

    it("throws so React Query can show an error state (CASE 12)", async () => {
      rpcMock.mockResolvedValue({
        data: null,
        error: { message: "authentication_required" },
      });
      await expect(getFriends()).rejects.toMatchObject({
        message: "authentication_required",
      });
    });
  });

  describe("removeFriend (CASE 6)", () => {
    it("addresses the friend by user id, so the pair is rebuilt server-side", async () => {
      rpcMock.mockResolvedValue({ data: true, error: null });
      await removeFriend("u2");
      expect(rpcMock).toHaveBeenCalledWith("remove_friend", {
        p_friend_user_id: "u2",
      });
    });

    it("reports true when a friendship was actually removed", async () => {
      rpcMock.mockResolvedValue({ data: true, error: null });
      expect(await removeFriend("u2")).toBe(true);
    });

    it("reports false, not an error, when there was nothing to remove", async () => {
      // Somebody else removed it first; that is a benign outcome.
      rpcMock.mockResolvedValue({ data: false, error: null });
      expect(await removeFriend("u2")).toBe(false);
    });
  });
});
