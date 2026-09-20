import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Navbar is a client component wired to auth, cart, admin role and the router.
 * None of that is what these tests are about, so every collaborator is stubbed
 * down to the smallest thing that renders — leaving the navigation MODEL
 * (which entries exist, what they are called, where the wordmark points) as the
 * only thing under test.
 */
const { pathnameMock, isAdminMock, authMock } = vi.hoisted(() => ({
  pathnameMock: vi.fn(() => "/products"),
  isAdminMock: vi.fn(() => false),
  authMock: vi.fn(() => ({ isAuthenticated: false, isLoading: false })),
}));

vi.mock("next/navigation", () => ({ usePathname: () => pathnameMock() }));
vi.mock("@/hooks/useIsAdmin", () => ({ useIsAdmin: () => isAdminMock() }));
vi.mock("@/hooks/useAuthUser", () => ({ useAuthUser: () => authMock() }));
vi.mock("@/hooks/useIsMounted", () => ({ useIsMounted: () => true }));
vi.mock("@/store/useCartStore", () => ({
  // The real store is called with a selector; honour that contract so the
  // component's `state.cart.reduce(...)` runs for real against an empty cart.
  useCartStore: (selector: (state: { cart: never[] }) => unknown) =>
    selector({ cart: [] }),
}));
// next/image needs a loader/config that only exists inside a Next build.
vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={typeof src === "string" ? src : ""} />
  ),
}));

import Navbar from "./Navbar";

/** The wordmark link — the sole home affordance now that "Inicio" is gone. */
const logoLink = () => screen.getByRole("link", { name: /KROV Perfumería/i });

describe("Navbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pathnameMock.mockReturnValue("/products");
    isAdminMock.mockReturnValue(false);
    authMock.mockReturnValue({ isAuthenticated: false, isLoading: false });
  });

  describe("the removed Home entry", () => {
    it("renders no Inicio link", () => {
      render(<Navbar />);
      expect(
        screen.queryByRole("link", { name: /^inicio$/i })
      ).not.toBeInTheDocument();
    });

    it("renders no Home link either", () => {
      render(<Navbar />);
      expect(
        screen.queryByRole("link", { name: /^home$/i })
      ).not.toBeInTheDocument();
    });

    it("still exposes exactly one link to /, and it is the wordmark", () => {
      render(<Navbar />);
      const homeLinks = screen
        .getAllByRole("link")
        .filter((link) => link.getAttribute("href") === "/");

      expect(homeLinks).toHaveLength(1);
      expect(homeLinks[0]).toBe(logoLink());
    });
  });

  describe("the wordmark as the home affordance", () => {
    it("routes to the home page", () => {
      render(<Navbar />);
      expect(logoLink()).toHaveAttribute("href", "/");
    });

    it("carries an accessible name, since the mark is an image", () => {
      render(<Navbar />);
      expect(logoLink()).toHaveAccessibleName(/inicio/i);
    });

    it("is marked as the current page while the visitor is home", () => {
      pathnameMock.mockReturnValue("/");
      render(<Navbar />);
      expect(logoLink()).toHaveAttribute("aria-current", "page");
    });

    it("is not marked current on any other route", () => {
      pathnameMock.mockReturnValue("/ranking");
      render(<Navbar />);
      expect(logoLink()).not.toHaveAttribute("aria-current");
    });
  });

  describe("the ranking entry", () => {
    it('is labelled "Ranking y Premios"', () => {
      render(<Navbar />);
      expect(
        screen.getAllByRole("link", { name: "Ranking y Premios" }).length
      ).toBeGreaterThan(0);
    });

    it("points at /ranking", () => {
      render(<Navbar />);
      for (const link of screen.getAllByRole("link", {
        name: "Ranking y Premios",
      })) {
        expect(link).toHaveAttribute("href", "/ranking");
      }
    });

    it("no longer renders under the old bare label", () => {
      render(<Navbar />);
      expect(
        screen.queryByRole("link", { name: /^ranking$/i })
      ).not.toBeInTheDocument();
    });

    it("is marked as the current page on /ranking", () => {
      pathnameMock.mockReturnValue("/ranking");
      render(<Navbar />);
      for (const link of screen.getAllByRole("link", {
        name: "Ranking y Premios",
      })) {
        expect(link).toHaveAttribute("aria-current", "page");
      }
    });
  });

  describe("the mobile drawer", () => {
    it("mirrors the desktop entries, without an Inicio row", async () => {
      const user = userEvent.setup();
      render(<Navbar />);

      await user.click(screen.getByRole("button", { name: /abrir menú/i }));

      // The drawer is the list that carries the editorial index numerals.
      const drawer = screen.getAllByRole("list").at(-1)!;
      const labels = within(drawer)
        .getAllByRole("link")
        .map((link) => link.textContent?.replace(/^\d+/, "").trim());

      expect(labels).toEqual([
        "Perfumes",
        "Ranking y Premios",
        "Cómo comprar",
      ]);
    });
  });
});
