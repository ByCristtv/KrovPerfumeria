import { describe, expect, it, vi, beforeEach } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ supabase: { rpc: rpcMock } }));

import {
  acceptFriendRequest,
  cancelFriendRequest,
  getReceivedFriendRequests,
  getSentFriendRequests,
  rejectFriendRequest,
  sendFriendRequest,
} from "./friendRequests";

describe("friend request data access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock.mockResolvedValue({ data: null, error: null });
  });

  describe("the RPC boundary", () => {
    it("routes every mutation through its intended RPC", async () => {
      // The security property: no direct table writes anywhere in this module.
      rpcMock.mockResolvedValue({ data: "id", error: null });

      await sendFriendRequest("u2");
      await cancelFriendRequest("r1");
      await acceptFriendRequest("r1");
      await rejectFriendRequest("r1");

      expect(rpcMock.mock.calls.map((c) => c[0])).toEqual([
        "send_friend_request",
        "cancel_friend_request",
        "accept_friend_request",
        "reject_friend_request",
      ]);
    });

    it("never sends a sender id, because the server derives it from auth.uid()", async () => {
      rpcMock.mockResolvedValue({ data: "id", error: null });
      await sendFriendRequest("u2");

      expect(rpcMock.mock.calls[0][1]).toEqual({ p_target_user_id: "u2" });
    });

    it("addresses request mutations by request id", async () => {
      await cancelFriendRequest("req-1");
      expect(rpcMock.mock.calls[0][1]).toEqual({ p_request_id: "req-1" });
    });
  });

  describe("getReceivedFriendRequests", () => {
    it("maps the RPC row onto the domain shape", async () => {
      rpcMock.mockResolvedValue({
        data: [
          {
            request_id: "r1",
            user_id: "u2",
            username: "aurora",
            avatar_url: "https://lh3.googleusercontent.com/a/x",
            experience_points: 1200,
            requested_at: "2026-09-19T10:00:00Z",
          },
        ],
        error: null,
      });

      expect(await getReceivedFriendRequests()).toEqual([
        {
          requestId: "r1",
          userId: "u2",
          username: "aurora",
          avatarUrl: "https://lh3.googleusercontent.com/a/x",
          experiencePoints: 1200,
          requestedAt: "2026-09-19T10:00:00Z",
        },
      ]);
    });

    it("exposes nothing beyond the safe projection", async () => {
      rpcMock.mockResolvedValue({
        data: [
          {
            request_id: "r1",
            user_id: "u2",
            username: "aurora",
            avatar_url: null,
            experience_points: 0,
            requested_at: "2026-09-19T10:00:00Z",
            phone: "88880000",
            email: "a@b.c",
          },
        ],
        error: null,
      });

      const [row] = await getReceivedFriendRequests();
      expect(Object.keys(row).sort()).toEqual([
        "avatarUrl",
        "experiencePoints",
        "requestId",
        "requestedAt",
        "userId",
        "username",
      ]);
    });

    it("treats a blank avatar as no avatar", async () => {
      rpcMock.mockResolvedValue({
        data: [
          {
            request_id: "r1",
            user_id: "u2",
            username: "aurora",
            avatar_url: "",
            experience_points: 5,
            requested_at: "x",
          },
        ],
        error: null,
      });
      expect((await getReceivedFriendRequests())[0].avatarUrl).toBeNull();
    });

    it("returns an empty list when there are no requests (CASE 11)", async () => {
      rpcMock.mockResolvedValue({ data: [], error: null });
      expect(await getReceivedFriendRequests()).toEqual([]);
    });

    it("throws so React Query can show an error state (CASE 12)", async () => {
      rpcMock.mockResolvedValue({
        data: null,
        error: { message: "authentication_required" },
      });
      await expect(getReceivedFriendRequests()).rejects.toMatchObject({
        message: "authentication_required",
      });
    });
  });

  describe("getSentFriendRequests", () => {
    it("carries the request id needed to cancel", async () => {
      rpcMock.mockResolvedValue({
        data: [
          {
            request_id: "r9",
            user_id: "u5",
            username: "borealis",
            avatar_url: null,
            requested_at: "2026-09-19T10:00:00Z",
          },
        ],
        error: null,
      });

      const [row] = await getSentFriendRequests();
      expect(row.requestId).toBe("r9");
      expect(row.userId).toBe("u5");
    });

    it("does not expose the recipient XP", async () => {
      rpcMock.mockResolvedValue({
        data: [
          {
            request_id: "r9",
            user_id: "u5",
            username: "borealis",
            avatar_url: null,
            requested_at: "x",
            experience_points: 9999,
          },
        ],
        error: null,
      });
      expect(await getSentFriendRequests()).toEqual([
        {
          requestId: "r9",
          userId: "u5",
          username: "borealis",
          avatarUrl: null,
          requestedAt: "x",
        },
      ]);
    });
  });

  describe("mutation results", () => {
    it("returns the new request id from send", async () => {
      rpcMock.mockResolvedValue({ data: "req-new", error: null });
      expect(await sendFriendRequest("u2")).toBe("req-new");
    });

    it("returns the friendship id from accept", async () => {
      rpcMock.mockResolvedValue({ data: "fr-1", error: null });
      expect(await acceptFriendRequest("r1")).toBe("fr-1");
    });

    it("propagates a domain error unchanged for normalization upstream", async () => {
      // CASE 9: the target went private between render and click.
      rpcMock.mockResolvedValue({
        data: null,
        error: { message: "user_profile_is_private" },
      });
      await expect(sendFriendRequest("u2")).rejects.toMatchObject({
        message: "user_profile_is_private",
      });
    });
  });
});
