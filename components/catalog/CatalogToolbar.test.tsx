import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductFilters } from "@/types/productFilter";

const h = vi.hoisted(() => ({
  push: vi.fn(),
  search: "",
  approved: false,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push }),
  usePathname: () => "/products",
  useSearchParams: () => new URLSearchParams(h.search),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    data: [
      { id: "cat-1", name: "Árabes" },
      { id: "cat-2", name: "Nicho" },
    ],
  }),
}));
vi.mock("@/hooks/useWholesaleStatus", () => ({
  useWholesaleStatus: () => ({ isApproved: h.approved }),
}));

import CatalogToolbar from "./CatalogToolbar";

const toolbar = (filters: ProductFilters = {}) =>
  render(<CatalogToolbar filters={filters} />);

// Anchored: "Limpiar filtros (3)" is a different button.
const toggle = () => screen.getByRole("button", { name: /^filtros/i });
/** The popover. It is always mounted; `aria-controls` points at it. */
const panel = () => document.getElementById("catalog-filters")!;

beforeEach(() => {
  h.push.mockClear();
  h.search = "";
  h.approved = false;
});

// ═════════════════════════════════════════════════════════════════════════════
describe("the filter panel is a popover, not a block in the flow", () => {
  it("is closed by default and the button controls it", () => {
    toolbar();

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(toggle()).toHaveAttribute("aria-controls", "catalog-filters");
    expect(panel()).toBeInTheDocument();
    // `invisible` is what keeps a closed panel out of the tab order and off taps.
    expect(panel().className).toContain("invisible");
    expect(panel().className).toContain("opacity-0");
  });

  it("opens and closes from the button", () => {
    toolbar();

    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(panel().className).toContain("visible");
    expect(panel().className).not.toContain("invisible");
    expect(panel().className).toContain("opacity-100");

    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(panel().className).toContain("invisible");
  });

  it("is out of flow, so opening it can never push the product grid down", () => {
    toolbar();
    const cls = panel().className;

    expect(cls).toContain("absolute");
    expect(cls).toContain("top-full");
    // The positioned parent it hangs from, and that parent is not its sibling's
    // flow: the bar is the only in-flow child.
    expect(panel().parentElement!.className).toContain("relative");
    expect(panel().parentElement!.querySelectorAll(":scope > *")).toHaveLength(2);
  });

  it("animates only opacity and transform — never height, max-height or layout", () => {
    toolbar();
    const cls = panel().className;

    expect(cls).toContain("transition-[opacity,transform,visibility]");
    for (const forbidden of [
      "transition-all",
      "max-h",
      "h-auto",
      "overflow-hidden",
      "transition-[height",
    ]) {
      expect(cls, forbidden).not.toContain(forbidden);
    }
    expect(cls).toContain("motion-reduce:transition-none");
  });

  it("uses no backdrop filter anywhere in the toolbar", () => {
    const { container } = toolbar();
    expect(container.querySelector('[class*="backdrop"]')).toBeNull();
  });

  it("Escape closes it and hands focus back to the button", () => {
    toolbar();
    fireEvent.click(toggle());

    fireEvent.keyDown(document, { key: "Escape" });

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(toggle()).toHaveFocus();
  });

  it("a press outside closes it; a press inside the toolbar does not", () => {
    toolbar();
    fireEvent.click(toggle());

    fireEvent.pointerDown(screen.getByLabelText("Buscar perfumes"));
    expect(toggle()).toHaveAttribute("aria-expanded", "true");

    fireEvent.pointerDown(panel());
    expect(toggle()).toHaveAttribute("aria-expanded", "true");

    fireEvent.pointerDown(document.body);
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });

  it("listens to the document only while it is open", () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    toolbar();
    const count = (spy: typeof add) =>
      spy.mock.calls.filter(([type]) => type === "pointerdown" || type === "keydown").length;

    expect(count(add)).toBe(0);

    fireEvent.click(toggle());
    expect(count(add)).toBe(2);

    fireEvent.click(toggle());
    expect(count(remove)).toBe(2);

    add.mockRestore();
    remove.mockRestore();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("filters still work", () => {
  it("shows the selected values from the URL-driven filters", () => {
    toolbar({ category: "cat-2", productType: "decant", orderBy: "name_desc" });

    expect(screen.getByLabelText("Categoría")).toHaveValue("cat-2");
    expect(screen.getByLabelText("Tipo de producto")).toHaveValue("decant");
    expect(screen.getByLabelText("Ordenar por")).toHaveValue("name_desc");
  });

  it("selecting a category pushes the new URL without scrolling to the top", () => {
    toolbar();
    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "cat-1" } });
    expect(h.push).toHaveBeenCalledWith("/products?category=cat-1", { scroll: false });
  });

  it("a filter change returns to page 1 and keeps the other filters", () => {
    h.search = "type=decant&page=3";
    toolbar({ productType: "decant" });

    fireEvent.change(screen.getByLabelText("Categoría"), { target: { value: "cat-1" } });

    const [url] = h.push.mock.calls[0];
    const params = new URLSearchParams(String(url).split("?")[1]);
    expect(params.get("category")).toBe("cat-1");
    expect(params.get("type")).toBe("decant");
    expect(params.has("page")).toBe(false);
  });

  it("sorting pushes the sort param", () => {
    toolbar();
    fireEvent.change(screen.getByLabelText("Ordenar por"), { target: { value: "price_desc" } });
    expect(h.push).toHaveBeenCalledWith("/products?sort=price_desc", { scroll: false });
  });

  it("the offer switch toggles the offer param on and off", () => {
    const { unmount } = toolbar();
    fireEvent.click(screen.getByRole("switch", { name: /solo en oferta/i }));
    expect(h.push).toHaveBeenLastCalledWith("/products?offer=1", { scroll: false });
    unmount();

    h.search = "offer=1";
    toolbar({ onOffer: true });
    const sw = screen.getByRole("switch", { name: /solo en oferta/i });
    expect(sw).toHaveAttribute("aria-checked", "true");
    fireEvent.click(sw);
    expect(h.push).toHaveBeenLastCalledWith("/products", { scroll: false });
  });

  it("only an approved wholesale buyer sees the wholesale switch", () => {
    const { unmount } = toolbar();
    expect(screen.queryByRole("switch", { name: /mayorista/i })).not.toBeInTheDocument();
    unmount();

    h.approved = true;
    toolbar();
    fireEvent.click(screen.getByRole("switch", { name: /mayorista/i }));
    expect(h.push).toHaveBeenLastCalledWith("/products?wholesale=1", { scroll: false });
  });

  it("shows the active count and clears everything back to /products", () => {
    toolbar({ category: "cat-1", onOffer: true, query: "oud" });

    const clear = screen.getByRole("button", { name: /limpiar filtros \(3\)/i });
    fireEvent.click(clear);

    expect(h.push).toHaveBeenCalledWith("/products", { scroll: false });
    expect(screen.getByLabelText("Buscar perfumes")).toHaveValue("");
  });

  it("selections survive closing and re-opening (they live in the URL, not the panel)", () => {
    toolbar({ category: "cat-2" });

    fireEvent.click(toggle());
    fireEvent.click(toggle());
    fireEvent.click(toggle());

    expect(screen.getByLabelText("Categoría")).toHaveValue("cat-2");
  });

  it("debounces the search into the URL", () => {
    vi.useFakeTimers();
    try {
      toolbar();
      fireEvent.change(screen.getByLabelText("Buscar perfumes"), { target: { value: "oud" } });

      expect(h.push).not.toHaveBeenCalled();
      vi.advanceTimersByTime(450);
      expect(h.push).toHaveBeenCalledWith("/products?q=oud", { scroll: false });
    } finally {
      vi.useRealTimers();
    }
  });
});
