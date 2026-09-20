import { describe, expect, it, vi, beforeEach } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ supabase: { rpc: rpcMock } }));

import {
  getFriendProfile,
  getFriendPurchasedProducts,
} from "./friendProfile";

const profileRow = (over: Record<string, unknown> = {}) => ({
  user_id: "u2",
  username: "aurora",
  full_name: "Aurora Vega",
  avatar_url: "https://lh3.googleusercontent.com/a/x",
  experience_points: 5200,
  ...over,
});

const productRow = (over: Record<string, unknown> = {}) => ({
  product_id: "p1",
  product_name: "Hawas Ice",
  product_slug: "hawas-ice",
  brand_name: "Rasasi",
  image_url: "https://cdn/hawas.jpg",
  ...over,
});

describe("friend profile data access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock.mockResolvedValue({ data: [], error: null });
  });

  describe("getFriendProfile", () => {
    it("reads through the RPC, never the profiles table", async () => {
      // profiles RLS is own-row + admin only; the RPC is the only door.
      await getFriendProfile("u2");
      expect(rpcMock).toHaveBeenCalledWith("get_friend_profile", {
        p_friend_user_id: "u2",
      });
    });

    it("never sends a caller id — the server derives it from auth.uid()", async () => {
      await getFriendProfile("u2");
      expect(Object.keys(rpcMock.mock.calls[0][1])).toEqual([
        "p_friend_user_id",
      ]);
    });

    it("maps the RPC row onto the domain shape", async () => {
      rpcMock.mockResolvedValue({ data: [profileRow()], error: null });

      expect(await getFriendProfile("u2")).toEqual({
        userId: "u2",
        username: "aurora",
        fullName: "Aurora Vega",
        avatarUrl: "https://lh3.googleusercontent.com/a/x",
        experiencePoints: 5200,
      });
    });

    it("exposes no contact, address, order or payment data", async () => {
      // Even if the row somehow carried more, the mapper drops it.
      rpcMock.mockResolvedValue({
        data: [
          profileRow({
            phone: "88880000",
            email: "a@b.c",
            role: "admin",
            total: 50000,
          }),
        ],
        error: null,
      });

      const profile = await getFriendProfile("u2");
      expect(Object.keys(profile!).sort()).toEqual([
        "avatarUrl",
        "experiencePoints",
        "fullName",
        "userId",
        "username",
      ]);
    });

    it("carries no rank field — rank is derived from XP at render time", async () => {
      rpcMock.mockResolvedValue({ data: [profileRow()], error: null });
      expect(await getFriendProfile("u2")).not.toHaveProperty("rank");
    });

    it("normalizes a blank name and avatar to null", async () => {
      rpcMock.mockResolvedValue({
        data: [profileRow({ full_name: "", avatar_url: "" })],
        error: null,
      });
      const profile = await getFriendProfile("u2");
      expect(profile!.fullName).toBeNull();
      expect(profile!.avatarUrl).toBeNull();
    });

    it("returns null for an empty set — a non-friend and a stranger look alike", async () => {
      rpcMock.mockResolvedValue({ data: [], error: null });
      expect(await getFriendProfile("u2")).toBeNull();
    });

    it("propagates the refusal so it can be normalized upstream", async () => {
      rpcMock.mockResolvedValue({
        data: null,
        error: { message: "users_are_not_friends" },
      });
      await expect(getFriendProfile("u2")).rejects.toMatchObject({
        message: "users_are_not_friends",
      });
    });
  });

  describe("getFriendPurchasedProducts", () => {
    it("reads through the projection RPC, never the orders table", async () => {
      // A friendship grants no SELECT on orders; this is the whole point.
      await getFriendPurchasedProducts("u2");
      expect(rpcMock).toHaveBeenCalledWith("get_friend_purchased_products", {
        p_friend_user_id: "u2",
      });
    });

    it("maps the RPC row onto the domain shape", async () => {
      rpcMock.mockResolvedValue({ data: [productRow()], error: null });

      expect(await getFriendPurchasedProducts("u2")).toEqual([
        {
          productId: "p1",
          name: "Hawas Ice",
          slug: "hawas-ice",
          brandName: "Rasasi",
          imageUrl: "https://cdn/hawas.jpg",
        },
      ]);
    });

    it("exposes no order, quantity, price or shipping data", async () => {
      rpcMock.mockResolvedValue({
        data: [
          productRow({
            order_id: "o1",
            order_number: "KROV-1",
            quantity: 3,
            unit_price: 45000,
            total: 135000,
            size_ml: 100,
            shipping_address: "San Jose",
            payment_reference: "onvo_x",
            created_at: "2026-09-01",
          }),
        ],
        error: null,
      });

      const [fragrance] = await getFriendPurchasedProducts("u2");
      expect(Object.keys(fragrance).sort()).toEqual([
        "brandName",
        "imageUrl",
        "name",
        "productId",
        "slug",
      ]);
    });

    it("passes the server's de-duplication through unchanged", async () => {
      // The RPC collapses variants via SELECT DISTINCT. Nothing here re-does
      // it, so a regression in that guarantee would surface rather than hide.
      rpcMock.mockResolvedValue({
        data: [
          productRow({ product_id: "p1", product_name: "Hawas Ice" }),
          productRow({
            product_id: "p2",
            product_name: "Khamrah",
            product_slug: "khamrah",
          }),
        ],
        error: null,
      });

      const fragrances = await getFriendPurchasedProducts("u2");
      expect(fragrances.map((f) => f.name)).toEqual(["Hawas Ice", "Khamrah"]);
    });

    it("treats a missing image as null rather than an empty src", async () => {
      // LEFT JOIN LATERAL yields null when a product has no image row.
      rpcMock.mockResolvedValue({
        data: [productRow({ image_url: null }), productRow({ product_id: "p2", image_url: "" })],
        error: null,
      });
      expect(
        (await getFriendPurchasedProducts("u2")).map((f) => f.imageUrl)
      ).toEqual([null, null]);
    });

    it("returns an empty list for a friend with no qualifying purchases", async () => {
      rpcMock.mockResolvedValue({ data: [], error: null });
      expect(await getFriendPurchasedProducts("u2")).toEqual([]);
    });

    it("propagates the refusal for a non-friend", async () => {
      rpcMock.mockResolvedValue({
        data: null,
        error: { message: "users_are_not_friends" },
      });
      await expect(getFriendPurchasedProducts("u2")).rejects.toMatchObject({
        message: "users_are_not_friends",
      });
    });
  });

  describe("query cost", () => {
    it("costs one request per section regardless of how many fragrances", async () => {
      rpcMock.mockResolvedValue({
        data: Array.from({ length: 25 }, (_, i) =>
          productRow({ product_id: `p${i}`, product_name: `Fragancia ${i}` })
        ),
        error: null,
      });

      await getFriendPurchasedProducts("u2");

      // No per-product image or brand lookup — both arrive on the row.
      expect(rpcMock).toHaveBeenCalledTimes(1);
    });
  });
});
