import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AvailabilityStatus } from "@/lib/stock";
import StickyPurchaseBar from "./StickyPurchaseBar";

const URL = "https://wa.me/50671434066?text=Hola";

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  );
});

function setup(status: AvailabilityStatus, inquiryUrl: string | null = null) {
  const onAdd = vi.fn();
  render(
    <StickyPurchaseBar
      productName="Lion"
      variantLabel="100 ml · Full size"
      price={21_000}
      status={status}
      onAdd={onAdd}
      inquiryUrl={inquiryUrl}
    />
  );
  return onAdd;
}

// The bar is aria-hidden until the page scrolls, so query with hidden: true.
const button = (name: string | RegExp) =>
  screen.queryByRole("button", { name, hidden: true });
const link = (name: RegExp) => screen.queryByRole("link", { name, hidden: true });

describe("StickyPurchaseBar", () => {
  it("in stock: an Agregar button that adds", () => {
    const onAdd = setup("in_stock");

    fireEvent.click(button("Agregar")!);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(link(/Consultar/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Por encargo/)).not.toBeInTheDocument();
  });

  it("made to order: a Consultar WhatsApp link, no add button, and the state is named", () => {
    const onAdd = setup("made_to_order", URL);

    expect(button("Agregar")).not.toBeInTheDocument();
    expect(button("Agotado")).not.toBeInTheDocument();

    const cta = link(/Consultar/)!;
    expect(cta).toHaveAttribute("href", URL);
    expect(cta).toHaveAttribute("target", "_blank");
    expect(cta.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText(/Por encargo/)).toBeInTheDocument();

    fireEvent.click(cta);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("made to order with no link: no action, and still no add button", () => {
    setup("made_to_order", null);
    expect(link(/Consultar/)).not.toBeInTheDocument();
    expect(button(/Agregar|Agotado/)).not.toBeInTheDocument();
  });

  it("sold out: no bar and no purchase action at all, even if a link is passed", () => {
    const onAdd = setup("sold_out", URL);

    expect(button(/Agregar|Agotado/)).not.toBeInTheDocument();
    expect(link(/Consultar/)).not.toBeInTheDocument();
    expect(screen.queryByText("Lion")).not.toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });
});

describe("StickyPurchaseBar visibility", () => {
  type Callback = (entries: Array<{ isIntersecting: boolean }>) => void;
  let trigger: Callback = () => {};
  const observe = vi.fn();
  const disconnect = vi.fn();

  beforeEach(() => {
    observe.mockClear();
    disconnect.mockClear();
    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn(function (cb: Callback) {
        trigger = cb;
        return { observe, disconnect, unobserve: vi.fn() };
      })
    );
  });

  it("slides in only while the page's own CTA is off-screen", () => {
    const target = document.createElement("div");
    const { container } = render(
      <StickyPurchaseBar
        productName="Lion"
        variantLabel="100 ml · Full size"
        price={21_000}
        status="in_stock"
        onAdd={vi.fn()}
        inquiryUrl={null}
        watchRef={{ current: target }}
      />
    );
    const bar = container.firstElementChild as HTMLElement;
    expect(observe).toHaveBeenCalledWith(target);
    expect(bar).toHaveAttribute("aria-hidden", "true");

    act(() => trigger([{ isIntersecting: false }]));
    expect(bar).toHaveAttribute("aria-hidden", "false");
    expect(document.documentElement).toHaveClass("purchase-bar-open");

    act(() => trigger([{ isIntersecting: true }]));
    expect(bar).toHaveAttribute("aria-hidden", "true");
    expect(document.documentElement).not.toHaveClass("purchase-bar-open");
  });
});
