import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/products" as string | null }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import MobileCartBar, { isCartBarRoute } from "./MobileCartBar";

const root = document.documentElement;

function show(count: number, pathname: string | null = "/products") {
  nav.pathname = pathname;
  return render(<MobileCartBar count={count} />);
}

afterEach(() => {
  nav.pathname = "/products";
  root.classList.remove("has-cart-bar");
});

describe("isCartBarRoute", () => {
  it.each(["/", "/products", "/products/lion", "/decants", "/perfumes-arabes", "/profile", "/ranking", "/orders/123"])(
    "shows on %s (browsing / account pages)",
    (path) => expect(isCartBarRoute(path)).toBe(true)
  );

  it.each([
    "/cart",
    "/checkout",
    "/checkout/sinpe/abc",
    "/login",
    "/register",
    "/auth/callback",
    "/admin",
    "/admin/products",
  ])("is hidden on %s (the cart itself, transactional and admin pages)", (path) =>
    expect(isCartBarRoute(path)).toBe(false)
  );

  it("does not confuse a prefix match with a path segment", () => {
    expect(isCartBarRoute("/cartography")).toBe(true);
    expect(isCartBarRoute("/administracion")).toBe(true);
  });

  it("treats an unknown pathname as the home page", () => {
    expect(isCartBarRoute(null)).toBe(true);
    expect(isCartBarRoute(undefined)).toBe(true);
  });
});

describe("MobileCartBar", () => {
  it("renders nothing while the cart is empty", () => {
    const { container } = show(0);
    expect(container).toBeEmptyDOMElement();
  });

  it("is a link to the cart that says how many items are in it", () => {
    show(3);

    const link = screen.getByRole("link", { name: "Ver carrito, 3 artículos" });
    expect(link).toHaveAttribute("href", "/cart");
    expect(link).toHaveTextContent("Ver carrito");
    expect(link).toHaveTextContent("3 artículos");
  });

  it("uses the singular for one item", () => {
    show(1);
    expect(screen.getByRole("link", { name: "Ver carrito, 1 artículo" })).toHaveTextContent(
      "1 artículo"
    );
  });

  it("is a bottom bar - full width, mobile only, in the brand red - not a floating square", () => {
    show(2);
    const link = screen.getByRole("link");

    for (const cls of ["fixed", "inset-x-0", "bottom-0", "lg:hidden", "bg-krov-blood"]) {
      expect(link.className).toContain(cls);
    }
    expect(link.className).not.toMatch(/\bright-6\b|\bh-14\b|\bw-14\b/);
  });

  it("carries the class the stylesheet uses to slide it away for the sticky purchase bar", () => {
    show(2);
    expect(screen.getByRole("link").className).toContain("cart-bar");
  });

  describe("reserving its space", () => {
    it("marks <html> while visible, so the page can reserve the strip", () => {
      show(2);
      expect(root.classList.contains("has-cart-bar")).toBe(true);
    });

    it("does not mark <html> with an empty cart or on a hidden route", () => {
      show(0);
      expect(root.classList.contains("has-cart-bar")).toBe(false);
      show(2, "/cart");
      expect(root.classList.contains("has-cart-bar")).toBe(false);
    });

    it("clears the mark when the bar goes away", () => {
      const { rerender, unmount } = show(2);
      expect(root.classList.contains("has-cart-bar")).toBe(true);

      rerender(<MobileCartBar count={0} />);
      expect(root.classList.contains("has-cart-bar")).toBe(false);

      rerender(<MobileCartBar count={4} />);
      expect(root.classList.contains("has-cart-bar")).toBe(true);
      unmount();
      expect(root.classList.contains("has-cart-bar")).toBe(false);
    });
  });

  it("is hidden on the cart and checkout pages even with items in the cart", () => {
    for (const path of ["/cart", "/checkout", "/login", "/admin/products"]) {
      const { container, unmount } = show(5, path);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});

/**
 * The bar and the stylesheet agree on three class names. A rename on one side
 * would not fail a type check or a render - it would just quietly break the bar
 * (it would sit on top of the product page's sticky bar, or hide the page end),
 * so the contract is pinned against the real CSS file.
 */
describe("stylesheet contract (app/globals.css)", () => {
  const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

  it("slides the cart bar away while the sticky purchase bar is open", () => {
    expect(css).toMatch(/\.purchase-bar-open\s+\.cart-bar\s*\{[^}]*translateY\(/);
    expect(css).toMatch(/\.purchase-bar-open\s+\.cart-bar\s*\{[^}]*pointer-events:\s*none/);
  });

  it("pads the bar itself for the bottom safe-area inset (home indicator)", () => {
    expect(css).toMatch(
      /\.cart-bar\s*\{[^}]*padding-bottom:[^;]*env\(safe-area-inset-bottom/
    );
  });

  it("reserves the bar's strip - plus the safe-area inset - below lg only", () => {
    expect(css).toMatch(
      /@media\s*\(max-width:\s*1023\.98px\)\s*\{[^}]*html\.has-cart-bar\s+body\s*\{[^}]*padding-bottom:[^;]*env\(safe-area-inset-bottom/
    );
  });

  it("no longer styles the retired floating cart", () => {
    expect(css).not.toContain(".floating-cart");
  });
});
