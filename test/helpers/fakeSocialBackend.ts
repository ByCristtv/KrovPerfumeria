import { vi } from "vitest";

/**
 * An in-memory stand-in for the social RPCs, faithful to the rules in
 * migration 20260919000100.
 *
 * It exists so the lifecycle can be tested through the REAL hooks, the REAL
 * query client and the REAL components, with only the network replaced. A test
 * that mocks the hooks proves the components call them; this proves the whole
 * loop — mutate, invalidate, refetch, re-render — actually converges.
 *
 * The invariants copied from the SQL, because they are what the UI is trusted
 * to respect:
 *   - one pending request per PAIR, in either direction
 *   - friendship is one symmetric row, never two
 *   - search excludes the caller and every private profile
 *   - a rejected or cancelled request does not block a new one
 *   - the friend profile and the purchased-fragrance projection BOTH re-check
 *     the friendship on every call and raise `users_are_not_friends` otherwise
 *   - a purchase counts once it has reached `received` (so `shipped` counts
 *     too), and variants of one fragrance collapse to a single product
 */

export interface FakeProfile {
  id: string;
  username: string;
  avatarUrl: string | null;
  experiencePoints: number;
  fullName: string | null;
  isPublic: boolean;
}

/** One line of a fake order: which product, bought by whom, in what state. */
export interface FakePurchase {
  userId: string;
  productId: string;
  productName: string;
  productSlug: string;
  brandName: string;
  imageUrl: string | null;
  /** Mirrors public.order_status. */
  orderStatus: "pending" | "received" | "shipped" | "denied";
}

interface FakeRequest {
  id: string;
  senderId: string;
  receiverId: string;
  status: "pending" | "accepted" | "rejected" | "cancelled";
  createdAt: string;
}

interface FakeFriendship {
  id: string;
  a: string;
  b: string;
}

export interface FakeSocialBackend {
  rpc: ReturnType<typeof vi.fn>;
  /**
   * `.from("profiles").select(...).eq("id", ...).maybeSingle()` — the one
   * non-RPC read in the social module, used by `getSocialEligibility` to check
   * the VIEWER's own username and privacy under the own-row RLS policy.
   */
  from: ReturnType<typeof vi.fn>;
  /** The signed-in user's own profile row, which discovery eligibility reads. */
  viewer: { username: string | null; isProfilePublic: boolean };
  profiles: Map<string, FakeProfile>;
  requests: FakeRequest[];
  friendships: FakeFriendship[];
  purchases: FakePurchase[];
  /** Simulate the OTHER person sending the signed-in user a request. */
  receiveRequestFrom: (senderId: string) => string;
  /** Force the next call to a given RPC to fail with a domain error. */
  failNext: (rpcName: string, message: string) => void;
  callCount: (rpcName: string) => number;
}

const pair = (x: string, y: string) => [x, y].sort() as [string, string];

export function makeFakeSocialBackend(
  meId: string,
  others: FakeProfile[],
  purchases: FakePurchase[] = [],
  // Discovery-eligible by default, so every lifecycle test that predates the
  // eligibility gate keeps describing the same situation it always did.
  viewer: { username: string | null; isProfilePublic: boolean } = {
    username: "yo",
    isProfilePublic: true,
  }
): FakeSocialBackend {
  const profiles = new Map(others.map((p) => [p.id, p]));
  const requests: FakeRequest[] = [];
  const friendships: FakeFriendship[] = [];
  const failures = new Map<string, string>();
  const calls = new Map<string, number>();
  let seq = 0;

  const nextId = (prefix: string) => prefix + "-" + String(++seq);

  const areFriends = (x: string, y: string) => {
    const [a, b] = pair(x, y);
    return friendships.some((f) => f.a === a && f.b === b);
  };

  const pendingBetween = (x: string, y: string) =>
    requests.find(
      (r) =>
        r.status === "pending" &&
        ((r.senderId === x && r.receiverId === y) ||
          (r.senderId === y && r.receiverId === x))
    );

  const relationshipWith = (otherId: string) => {
    if (areFriends(meId, otherId)) return "friends";
    const pending = pendingBetween(meId, otherId);
    if (!pending) return "none";
    return pending.senderId === meId ? "outgoing_pending" : "incoming_pending";
  };

  const rpc = vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
    calls.set(name, (calls.get(name) ?? 0) + 1);

    const forced = failures.get(name);
    if (forced) {
      failures.delete(name);
      return { data: null, error: { message: forced } };
    }

    switch (name) {
      case "search_public_users": {
        const query = String(args.p_query ?? "").trim().toLowerCase();
        if (query.length < 2) return { data: [], error: null };
        const rows = [...profiles.values()]
          .filter(
            (p) =>
              p.id !== meId &&
              p.isPublic &&
              p.username.toLowerCase().includes(query)
          )
          .map((p) => ({
            user_id: p.id,
            username: p.username,
            avatar_url: p.avatarUrl,
            relationship_status: relationshipWith(p.id),
          }));
        return { data: rows, error: null };
      }

      case "send_friend_request": {
        const target = String(args.p_target_user_id);
        const profile = profiles.get(target);
        if (!profile) return { data: null, error: { message: "user_not_found" } };
        if (target === meId)
          return { data: null, error: { message: "cannot_add_yourself" } };
        if (!profile.isPublic)
          return { data: null, error: { message: "user_profile_is_private" } };
        if (areFriends(meId, target))
          return { data: null, error: { message: "users_are_already_friends" } };

        const existing = pendingBetween(meId, target);
        if (existing) {
          // Idempotent for the same sender; the reverse direction is refused.
          if (existing.senderId === meId) return { data: existing.id, error: null };
          return {
            data: null,
            error: { message: "incoming_friend_request_exists" },
          };
        }

        const created: FakeRequest = {
          id: nextId("req"),
          senderId: meId,
          receiverId: target,
          status: "pending",
          createdAt: new Date().toISOString(),
        };
        requests.push(created);
        return { data: created.id, error: null };
      }

      case "cancel_friend_request": {
        const found = requests.find(
          (r) =>
            r.id === args.p_request_id &&
            r.senderId === meId &&
            r.status === "pending"
        );
        if (!found)
          return {
            data: null,
            error: { message: "pending_sent_request_not_found" },
          };
        found.status = "cancelled";
        return { data: null, error: null };
      }

      case "reject_friend_request": {
        const found = requests.find(
          (r) =>
            r.id === args.p_request_id &&
            r.receiverId === meId &&
            r.status === "pending"
        );
        if (!found)
          return {
            data: null,
            error: { message: "pending_received_request_not_found" },
          };
        found.status = "rejected";
        return { data: null, error: null };
      }

      case "accept_friend_request": {
        const found = requests.find((r) => r.id === args.p_request_id);
        if (!found)
          return { data: null, error: { message: "friend_request_not_found" } };
        if (found.receiverId !== meId)
          return { data: null, error: { message: "not_request_receiver" } };
        if (found.status !== "pending")
          return {
            data: null,
            error: { message: "friend_request_is_not_pending" },
          };

        const [a, b] = pair(found.senderId, found.receiverId);
        const friendship: FakeFriendship = { id: nextId("fr"), a, b };
        friendships.push(friendship);
        found.status = "accepted";
        return { data: friendship.id, error: null };
      }

      case "remove_friend": {
        const [a, b] = pair(meId, String(args.p_friend_user_id));
        const index = friendships.findIndex((f) => f.a === a && f.b === b);
        if (index === -1) return { data: false, error: null };
        friendships.splice(index, 1);
        return { data: true, error: null };
      }

      case "get_received_friend_requests": {
        const rows = requests
          .filter((r) => r.receiverId === meId && r.status === "pending")
          .map((r) => {
            const p = profiles.get(r.senderId)!;
            return {
              request_id: r.id,
              user_id: p.id,
              username: p.username,
              avatar_url: p.avatarUrl,
              experience_points: p.experiencePoints,
              requested_at: r.createdAt,
            };
          });
        return { data: rows, error: null };
      }

      case "get_sent_friend_requests": {
        const rows = requests
          .filter((r) => r.senderId === meId && r.status === "pending")
          .map((r) => {
            const p = profiles.get(r.receiverId)!;
            return {
              request_id: r.id,
              user_id: p.id,
              username: p.username,
              avatar_url: p.avatarUrl,
              requested_at: r.createdAt,
            };
          });
        return { data: rows, error: null };
      }

      case "get_friends": {
        const rows = friendships
          .filter((f) => f.a === meId || f.b === meId)
          .map((f) => {
            const otherId = f.a === meId ? f.b : f.a;
            const p = profiles.get(otherId)!;
            return {
              friendship_id: f.id,
              friend_user_id: p.id,
              username: p.username,
              full_name: p.fullName,
              avatar_url: p.avatarUrl,
              experience_points: p.experiencePoints,
              friends_since: new Date().toISOString(),
            };
          });
        return { data: rows, error: null };
      }

      case "get_friend_profile": {
        const target = String(args.p_friend_user_id);
        // The authorization that matters: re-checked on EVERY call, never
        // cached, and identical for a stranger and an ex-friend.
        if (!areFriends(meId, target))
          return { data: null, error: { message: "users_are_not_friends" } };

        const p = profiles.get(target);
        if (!p) return { data: [], error: null };

        return {
          data: [
            {
              user_id: p.id,
              username: p.username,
              full_name: p.fullName,
              avatar_url: p.avatarUrl,
              experience_points: p.experiencePoints,
            },
          ],
          error: null,
        };
      }

      case "get_friend_purchased_products": {
        const target = String(args.p_friend_user_id);
        if (!areFriends(meId, target))
          return { data: null, error: { message: "users_are_not_friends" } };

        // Completion rule per migration 20260920000100: an order counts once
        // it has REACHED received, so shipped counts too.
        const completed = purchases.filter(
          (row) =>
            row.userId === target &&
            (row.orderStatus === "received" || row.orderStatus === "shipped")
        );

        // SELECT DISTINCT on the product: every variant of one fragrance
        // collapses to a single row.
        const byProduct = new Map<string, FakePurchase>();
        for (const row of completed) {
          if (!byProduct.has(row.productId)) byProduct.set(row.productId, row);
        }

        const rows = [...byProduct.values()]
          .sort((a, b) => a.productName.localeCompare(b.productName))
          .map((row) => ({
            product_id: row.productId,
            product_name: row.productName,
            product_slug: row.productSlug,
            brand_name: row.brandName,
            image_url: row.imageUrl,
          }));

        return { data: rows, error: null };
      }

      default:
        throw new Error("fake backend: unhandled rpc " + name);
    }
  });

  const from = vi.fn((table: string) => {
    if (table !== "profiles") {
      throw new Error("fake backend: unhandled table " + table);
    }
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({
        data: {
          username: viewer.username,
          is_profile_public: viewer.isProfilePublic,
        },
        error: null,
      }),
    };
    return builder;
  });

  return {
    rpc,
    from,
    viewer,
    profiles,
    requests,
    friendships,
    purchases,
    receiveRequestFrom(senderId: string) {
      const created: FakeRequest = {
        id: nextId("req"),
        senderId,
        receiverId: meId,
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      requests.push(created);
      return created.id;
    },
    failNext(rpcName: string, message: string) {
      failures.set(rpcName, message);
    },
    callCount(rpcName: string) {
      return calls.get(rpcName) ?? 0;
    },
  };
}
