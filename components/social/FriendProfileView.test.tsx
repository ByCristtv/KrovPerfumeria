import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { FriendProfile, PurchasedFragrance } from "@/types/social";

const { useProfileMock, usePurchasesMock, replaceMock } = vi.hoisted(() => ({
  useProfileMock: vi.fn(),
  usePurchasesMock: vi.fn(),
  replaceMock: vi.fn(),
}));

vi.mock("@/hooks/useFriendProfile", () => ({
  useFriendProfile: () => useProfileMock(),
  useFriendPurchases: () => usePurchasesMock(),
}));
vi.mock("@/hooks/useAuthUser", () => ({
  useAuthUser: () => ({
    user: { id: "me" },
    isLoading: false,
    isAuthenticated: true,
  }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
}));
vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={typeof src === "string" ? src : ""} />
  ),
}));

import FriendProfileView from "./FriendProfileView";

const profile = (over: Partial<FriendProfile> = {}): FriendProfile => ({
  userId: "u2",
  username: "aurora",
  fullName: "Aurora Vega",
  avatarUrl: null,
  experiencePoints: 5200,
  ...over,
});

const fragrance = (over: Partial<PurchasedFragrance> = {}): PurchasedFragrance => ({
  productId: "p1",
  name: "Hawas Ice",
  slug: "hawas-ice",
  brandName: "Rasasi",
  imageUrl: "https://cdn/hawas.jpg",
  ...over,
});

function setup(
  profileState: Partial<{
    profile: FriendProfile | null;
    isLoading: boolean;
    isUnavailable: boolean;
    isError: boolean;
  }> = {},
  purchaseState: Partial<{
    fragrances: PurchasedFragrance[];
    isLoading: boolean;
    isError: boolean;
  }> = {}
) {
  useProfileMock.mockReturnValue({
    profile: profileState.profile ?? null,
    isLoading: profileState.isLoading ?? false,
    isUnavailable: profileState.isUnavailable ?? false,
    isError: profileState.isError ?? false,
    refetch: vi.fn(),
  });
  usePurchasesMock.mockReturnValue({
    fragrances: purchaseState.fragrances ?? [],
    isLoading: purchaseState.isLoading ?? false,
    isError: purchaseState.isError ?? false,
    refetch: vi.fn(),
  });
  return render(<FriendProfileView userId="u2" />);
}

/** SOCIAL-11 + SOCIAL-12. */
describe("FriendProfileView", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("the profile header (FLOW 4)", () => {
    it("shows username, full name, rank and XP", () => {
      setup({ profile: profile({ experiencePoints: 5200 }) });

      expect(
        screen.getByRole("heading", { name: "aurora" })
      ).toBeInTheDocument();
      expect(screen.getByText("Aurora Vega")).toBeInTheDocument();
      // 5,200 XP is EDT on the one ladder in lib/rank.ts.
      expect(screen.getByText("EDT")).toBeInTheDocument();
      expect(screen.getByText(/5,200 XP/)).toBeInTheDocument();
    });

    it("derives rank from XP rather than reading a stored field", () => {
      setup({ profile: profile({ experiencePoints: 18_000 }) });
      expect(screen.getByText("Parfum")).toBeInTheDocument();
    });

    it("omits the full name line when the friend has none", () => {
      setup({ profile: profile({ fullName: null }) });
      expect(screen.queryByText("Aurora Vega")).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "aurora" })).toBeInTheDocument();
    });

    it("offers a way back to the portal", () => {
      setup({ profile: profile() });
      expect(
        screen.getByRole("link", { name: /volver a amigos/i })
      ).toHaveAttribute("href", "/friends");
    });
  });

  describe("unauthorized / unavailable (CASE C, FLOW 6)", () => {
    it("shows one generic panel instead of naming the reason", () => {
      setup({ isUnavailable: true });

      expect(
        screen.getByText(/este perfil no está disponible/i)
      ).toBeInTheDocument();
    });

    it("leaks no profile data while denying access", () => {
      setup({ isUnavailable: true, profile: null });

      expect(screen.queryByText("aurora")).not.toBeInTheDocument();
      expect(screen.queryByText("Aurora Vega")).not.toBeInTheDocument();
      expect(screen.queryByText(/XP/)).not.toBeInTheDocument();
    });

    it("renders no fragrance section for an unavailable profile", () => {
      setup(
        { isUnavailable: true },
        { fragrances: [fragrance()] }
      );
      expect(screen.queryByText("Hawas Ice")).not.toBeInTheDocument();
      expect(
        screen.queryByText(/fragancias compradas/i)
      ).not.toBeInTheDocument();
    });

    it("offers a route back to the friends list", () => {
      setup({ isUnavailable: true });
      expect(
        screen.getByRole("link", { name: /ver mis amigos/i })
      ).toHaveAttribute("href", "/friends");
    });
  });

  describe("purchased fragrances (SOCIAL-12)", () => {
    it("renders a card per fragrance, linking into the real catalog", () => {
      setup(
        { profile: profile() },
        {
          fragrances: [
            fragrance(),
            fragrance({
              productId: "p2",
              name: "Khamrah",
              slug: "khamrah",
              brandName: "Lattafa",
            }),
          ],
        }
      );

      expect(
        screen.getByRole("link", { name: /ver hawas ice de rasasi/i })
      ).toHaveAttribute("href", "/products/hawas-ice");
      expect(
        screen.getByRole("link", { name: /ver khamrah de lattafa/i })
      ).toHaveAttribute("href", "/products/khamrah");
    });

    it("shows brand and product name, and no purchase details (FLOW 5)", () => {
      setup({ profile: profile() }, { fragrances: [fragrance()] });

      expect(screen.getByText("Rasasi")).toBeInTheDocument();
      expect(screen.getByText("Hawas Ice")).toBeInTheDocument();
      // Nothing resembling money, quantity or a size may appear.
      expect(screen.queryByText(/₡/)).not.toBeInTheDocument();
      expect(screen.queryByText(/\bml\b/)).not.toBeInTheDocument();
    });

    it("counts the fragrances on the section header", () => {
      setup(
        { profile: profile() },
        { fragrances: [fragrance(), fragrance({ productId: "p2" })] }
      );
      const header = screen.getByText(/fragancias compradas/i).parentElement!;
      expect(within(header).getByText("2")).toBeInTheDocument();
    });

    it("renders one card per fragrance, trusting the server's de-duplication (FLOW 8)", () => {
      // The RPC already collapsed Hawas Ice 100/10/5ml into one product.
      setup({ profile: profile() }, { fragrances: [fragrance()] });
      expect(screen.getAllByText("Hawas Ice")).toHaveLength(1);
    });

    it("falls back to the shared placeholder when a product has no image", () => {
      // The image is alt="" on purpose - the card's link carries the
      // accessible name - so it is presentational and has no "img" role.
      const { container } = setup(
        { profile: profile() },
        { fragrances: [fragrance({ imageUrl: null })] }
      );
      expect(container.querySelector("img")).toHaveAttribute(
        "src",
        "/placeholder.png"
      );
    });

    it("keeps the product image out of the accessibility tree", () => {
      const { container } = setup(
        { profile: profile() },
        { fragrances: [fragrance()] }
      );
      expect(container.querySelector("img")).toHaveAttribute("alt", "");
    });

    it("shows an empty state, not an error, for no purchases (FLOW 9)", () => {
      setup({ profile: profile() }, { fragrances: [] });
      expect(
        screen.getByText(/aún no tiene fragancias visibles/i)
      ).toBeInTheDocument();
    });

    it("degrades only its own section when the fragrance query fails", () => {
      setup({ profile: profile() }, { isError: true });

      expect(
        screen.getByText(/no pudimos cargar las fragancias/i)
      ).toBeInTheDocument();
      // The identity card is a separate query and stays on screen.
      expect(screen.getByRole("heading", { name: "aurora" })).toBeInTheDocument();
    });

    it("does not block the header on the fragrance query", () => {
      setup({ profile: profile() }, { isLoading: true });
      expect(screen.getByRole("heading", { name: "aurora" })).toBeInTheDocument();
    });
  });

  describe("loading", () => {
    it("shows a skeleton while the profile resolves", () => {
      const { container } = setup({ isLoading: true });
      expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "aurora" })).not.toBeInTheDocument();
    });
  });
});
