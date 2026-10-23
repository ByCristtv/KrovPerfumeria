import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OffersCarousel, { OFFER_ROTATION_MS } from "./OffersCarousel";
import type { FeaturedOffer } from "@/types/product";

function offer(n: number): FeaturedOffer {
  return {
    productId: `p${n}`,
    variantId: `v${n}`,
    name: `Perfume ${n}`,
    brand: "Lattafa",
    description: null,
    productType: "full_size",
    sizeMl: 100,
    price: 50000,
    offerPrice: 40000,
    discountPercent: 20,
    imageUrl: `https://x/${n}.webp`,
    imageAlt: `Perfume ${n}`,
    href: `/products/perfume-${n}?variant=v${n}`,
  };
}

const offers = [offer(1), offer(2), offer(3)];

let reducedMotion = false;

function activeSlideName(container: HTMLElement) {
  const active = container.querySelector("article[aria-hidden='false']");
  return active?.querySelector("h3")?.textContent;
}

beforeEach(() => {
  vi.useFakeTimers();
  reducedMotion = false;
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("reduce") && reducedMotion,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
  Object.defineProperty(document, "readyState", { value: "loading", configurable: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (document as { readyState?: unknown }).readyState;
  delete (document as { visibilityState?: unknown }).visibilityState;
});

describe("OffersCarousel", () => {
  it("renders nothing without offers", () => {
    const { container } = render(<OffersCarousel offers={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows prices, the saving and a CTA to the product route", () => {
    render(<OffersCarousel offers={[offer(1)]} />);
    expect(screen.getByText("−20%")).toBeInTheDocument();
    expect(screen.getByText(/40\s?000/)).toBeInTheDocument();
    expect(screen.getByText(/50\s?000/)).toHaveClass("line-through");
    expect(screen.getByRole("link", { name: "Ver oferta: Perfume 1" })).toHaveAttribute(
      "href",
      "/products/perfume-1?variant=v1"
    );
  });

  it("a single offer has no controls and never rotates", () => {
    render(<OffersCarousel offers={[offer(1)]} />);
    expect(screen.queryByLabelText("Oferta siguiente")).toBeNull();
    expect(screen.queryByLabelText(/Pausar/)).toBeNull();
    act(() => vi.advanceTimersByTime(OFFER_ROTATION_MS * 3));
    expect(screen.getByRole("heading", { name: "Perfume 1" })).toBeInTheDocument();
  });

  it("auto-advances and loops back to the first offer", () => {
    const { container } = render(<OffersCarousel offers={offers} />);
    expect(activeSlideName(container)).toBe("Perfume 1");

    act(() => vi.advanceTimersByTime(OFFER_ROTATION_MS));
    expect(activeSlideName(container)).toBe("Perfume 2");

    // One act per tick: each slide change re-arms the timer in an effect.
    act(() => vi.advanceTimersByTime(OFFER_ROTATION_MS));
    act(() => vi.advanceTimersByTime(OFFER_ROTATION_MS));
    expect(activeSlideName(container)).toBe("Perfume 1");
  });

  it("navigates with arrows and dots, and re-arms the timer after a manual move", () => {
    const { container } = render(<OffersCarousel offers={offers} />);

    act(() => vi.advanceTimersByTime(OFFER_ROTATION_MS - 1000));
    fireEvent.click(screen.getByLabelText("Oferta anterior"));
    expect(activeSlideName(container)).toBe("Perfume 3");

    // The old timer would have fired 1s from now; the fresh one must not.
    act(() => vi.advanceTimersByTime(1500));
    expect(activeSlideName(container)).toBe("Perfume 3");

    fireEvent.click(screen.getByLabelText("Ver oferta 2 de 3: Perfume 2"));
    expect(activeSlideName(container)).toBe("Perfume 2");
    expect(screen.getByLabelText("Ver oferta 2 de 3: Perfume 2")).toHaveAttribute(
      "aria-current",
      "true"
    );
  });

  it("pause stops rotation; play resumes it", () => {
    const { container } = render(<OffersCarousel offers={offers} />);
    fireEvent.click(screen.getByLabelText("Pausar la rotación de ofertas"));
    act(() => vi.advanceTimersByTime(OFFER_ROTATION_MS * 3));
    expect(activeSlideName(container)).toBe("Perfume 1");

    fireEvent.click(screen.getByLabelText("Reanudar la rotación de ofertas"));
    act(() => vi.advanceTimersByTime(OFFER_ROTATION_MS));
    expect(activeSlideName(container)).toBe("Perfume 2");
  });

  it("starts paused for visitors who prefer reduced motion", () => {
    reducedMotion = true;
    const { container } = render(<OffersCarousel offers={offers} />);
    expect(screen.getByLabelText("Reanudar la rotación de ofertas")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(OFFER_ROTATION_MS * 3));
    expect(activeSlideName(container)).toBe("Perfume 1");
  });

  it("does not rotate while the tab is hidden", () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    const { container } = render(<OffersCarousel offers={offers} />);
    act(() => vi.advanceTimersByTime(OFFER_ROTATION_MS * 3));
    expect(activeSlideName(container)).toBe("Perfume 1");
  });

  it("swipes left/right on touch", () => {
    const { container } = render(<OffersCarousel offers={offers} />);
    const track = container.querySelector("article")!.parentElement!;

    fireEvent.pointerDown(track, { pointerType: "touch", clientX: 200, clientY: 100 });
    fireEvent.pointerUp(track, { pointerType: "touch", clientX: 100, clientY: 110 });
    expect(activeSlideName(container)).toBe("Perfume 2");

    fireEvent.pointerDown(track, { pointerType: "touch", clientX: 100, clientY: 100 });
    fireEvent.pointerUp(track, { pointerType: "touch", clientX: 200, clientY: 100 });
    expect(activeSlideName(container)).toBe("Perfume 1");

    // Mostly vertical: not a swipe.
    fireEvent.pointerDown(track, { pointerType: "touch", clientX: 100, clientY: 100 });
    fireEvent.pointerUp(track, { pointerType: "touch", clientX: 150, clientY: 300 });
    expect(activeSlideName(container)).toBe("Perfume 1");
  });

  it("mounts only the first slide's image up front", () => {
    const { container } = render(<OffersCarousel offers={offers} />);
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("hides inactive slides from assistive tech and focus", () => {
    const { container } = render(<OffersCarousel offers={offers} />);
    const slides = container.querySelectorAll("article");
    expect(slides[0]).toHaveAttribute("aria-hidden", "false");
    expect(slides[1]).toHaveAttribute("aria-hidden", "true");
    expect(slides[1]).toHaveAttribute("inert");
  });

  it("clears its timers on unmount", () => {
    const { unmount } = render(<OffersCarousel offers={offers} />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
