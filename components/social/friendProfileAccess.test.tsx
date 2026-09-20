import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  makeFakeSocialBackend,
  type FakeSocialBackend,
  type FakePurchase,
} from "@/test/helpers/fakeSocialBackend";

/**
 * Friend-profile authorization, end to end.
 *
 * Everything below the component is real — the hooks, the data-access layer,
 * the query keys and a real QueryClient — with only the network replaced by a
 * fake that re-checks the friendship on every call, exactly as the SQL does.
 *
 * These cover the part of MVP 3 that is security rather than UI: that access is
 * re-derived per request and never survives in a cache, and that a denial says
 * nothing about why.
 */

const ME = "me-1";
const AURORA = "u-aurora";

let backend: FakeSocialBackend;

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) =>
      backend.rpc(name, args),
    // getSocialEligibility reads the viewer's own profiles row directly.
    from: (table: string) => backend.from(table),
  },
}));

vi.mock("@/hooks/useAuthUser", () => ({
  useAuthUser: () => ({
    user: { id: ME },
    isLoading: false,
    isAuthenticated: true,
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={typeof src === "string" ? src : ""} />
  ),
}));

import FriendProfileView from "./FriendProfileView";

const profile = (id: string, username: string, isPublic = true) => ({
  id,
  username,
  avatarUrl: null,
  experiencePoints: 5200,
  fullName: "Aurora Vega",
  isPublic,
});

const purchase = (over: Partial<FakePurchase> = {}): FakePurchase => ({
  userId: AURORA,
  productId: "p1",
  productName: "Hawas Ice",
  productSlug: "hawas-ice",
  brandName: "Rasasi",
  imageUrl: "https://cdn/hawas.jpg",
  orderStatus: "received",
  ...over,
});

/** A fresh client each render — no cache is shared between assertions. */
function renderProfile(userId = AURORA) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const utils = render(<FriendProfileView userId={userId} />, { wrapper });
  return { ...utils, client };
}

/** Put ME and AURORA into a friendship directly, as accepting one would. */
function makeFriends() {
  backend.friendships.push({ id: "fr-1", a: [ME, AURORA].sort()[0], b: [ME, AURORA].sort()[1] });
}

describe("friend profile access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    backend = makeFakeSocialBackend(ME, [profile(AURORA, "aurora")], [
      purchase(),
    ]);
  });

  describe("an authorized friend (FLOW 4)", () => {
    it("renders the profile and the fragrances", async () => {
      makeFriends();
      renderProfile();

      expect(
        await screen.findByRole("heading", { name: "aurora" })
      ).toBeInTheDocument();
      expect(await screen.findByText("Hawas Ice")).toBeInTheDocument();
      expect(screen.getByText("EDT")).toBeInTheDocument();
    });

    it("asks the database on every visit rather than trusting a cache", async () => {
      makeFriends();
      const first = renderProfile();
      await screen.findByRole("heading", { name: "aurora" });
      const callsAfterFirst = backend.callCount("get_friend_profile");
      first.unmount();

      renderProfile();
      await screen.findByRole("heading", { name: "aurora" });

      expect(backend.callCount("get_friend_profile")).toBeGreaterThan(
        callsAfterFirst
      );
    });
  });

  describe("a non-friend (FLOW 10 / CASE C)", () => {
    it("is denied the profile", async () => {
      // No friendship row exists.
      renderProfile();

      expect(
        await screen.findByText(/este perfil no está disponible/i)
      ).toBeInTheDocument();
    });

    it("leaks nothing about the account while denying", async () => {
      renderProfile();
      await screen.findByText(/este perfil no está disponible/i);

      expect(screen.queryByText("aurora")).not.toBeInTheDocument();
      expect(screen.queryByText("Aurora Vega")).not.toBeInTheDocument();
      expect(screen.queryByText(/XP/)).not.toBeInTheDocument();
    });

    it("is denied the purchased fragrances too", async () => {
      renderProfile();
      await screen.findByText(/este perfil no está disponible/i);

      expect(screen.queryByText("Hawas Ice")).not.toBeInTheDocument();
    });

    it("looks identical for an account that does not exist", async () => {
      // The denial must not be usable to probe which ids are real.
      renderProfile("u-does-not-exist");

      expect(
        await screen.findByText(/este perfil no está disponible/i)
      ).toBeInTheDocument();
    });
  });

  describe("the friendship ends while the profile is open (CASE C, FLOW 6)", () => {
    it("loses access on the next read", async () => {
      makeFriends();
      const { client } = renderProfile();
      await screen.findByRole("heading", { name: "aurora" });

      // The other person removes the friendship from their own session.
      backend.friendships.length = 0;

      // Anything that re-reads — a refocus, a remount, an invalidation.
      await client.invalidateQueries();

      expect(
        await screen.findByText(/este perfil no está disponible/i)
      ).toBeInTheDocument();
      expect(screen.queryByText("Hawas Ice")).not.toBeInTheDocument();
    });

    it("does not keep serving the profile from cache", async () => {
      makeFriends();
      const first = renderProfile();
      await screen.findByRole("heading", { name: "aurora" });
      first.unmount();

      backend.friendships.length = 0;

      // A fresh visit must re-derive authorization, not reuse the old answer.
      renderProfile();
      expect(
        await screen.findByText(/este perfil no está disponible/i)
      ).toBeInTheDocument();
    });
  });

  describe("privacy does not end a friendship (CASE A, FLOW 7)", () => {
    it("keeps the friend profile reachable after they go private", async () => {
      makeFriends();
      backend.profiles.get(AURORA)!.isPublic = false;

      renderProfile();

      // Privacy governs DISCOVERY, not an existing friendship.
      expect(
        await screen.findByRole("heading", { name: "aurora" })
      ).toBeInTheDocument();
      expect(await screen.findByText("Hawas Ice")).toBeInTheDocument();
    });
  });

  describe("the purchase projection", () => {
    it("counts a shipped order, not only a received one", async () => {
      // Regression guard for migration 20260920000100: `shipped` is the state
      // AFTER received, so shipping an order must not hide its fragrances.
      makeFriends();
      backend.purchases.length = 0;
      backend.purchases.push(purchase({ orderStatus: "shipped" }));

      renderProfile();

      expect(await screen.findByText("Hawas Ice")).toBeInTheDocument();
    });

    it("ignores pending and denied orders", async () => {
      makeFriends();
      backend.purchases.length = 0;
      backend.purchases.push(
        purchase({ productId: "p9", productName: "Pendiente", orderStatus: "pending" }),
        purchase({ productId: "p8", productName: "Rechazada", orderStatus: "denied" })
      );

      renderProfile();

      expect(
        await screen.findByText(/aún no tiene fragancias visibles/i)
      ).toBeInTheDocument();
    });

    it("collapses every variant of one fragrance into a single card (FLOW 8)", async () => {
      makeFriends();
      backend.purchases.length = 0;
      // Hawas Ice bought in 100ml, 10ml and 5ml, plus one Khamrah.
      backend.purchases.push(
        purchase(),
        purchase(),
        purchase(),
        purchase({
          productId: "p2",
          productName: "Khamrah",
          productSlug: "khamrah",
          brandName: "Lattafa",
        })
      );

      renderProfile();

      await screen.findByText("Hawas Ice");
      expect(screen.getAllByText("Hawas Ice")).toHaveLength(1);
      expect(screen.getAllByText("Khamrah")).toHaveLength(1);
    });

    it("shows an empty state for a friend with no qualifying purchases (FLOW 9)", async () => {
      makeFriends();
      backend.purchases.length = 0;

      renderProfile();

      expect(
        await screen.findByRole("heading", { name: "aurora" })
      ).toBeInTheDocument();
      expect(
        await screen.findByText(/aún no tiene fragancias visibles/i)
      ).toBeInTheDocument();
    });

    it("costs one request for the whole grid (no N+1)", async () => {
      makeFriends();
      backend.purchases.length = 0;
      for (let i = 0; i < 12; i++) {
        backend.purchases.push(
          purchase({
            productId: `p${i}`,
            productName: `Fragancia ${i}`,
            productSlug: `f-${i}`,
          })
        );
      }

      renderProfile();
      await screen.findByText("Fragancia 0");

      await waitFor(() =>
        expect(backend.callCount("get_friend_purchased_products")).toBe(1)
      );
    });
  });
});
