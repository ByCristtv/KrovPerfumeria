import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Hero from "./Hero";

/**
 * The hero used to mount all four slides at once. They sit at opacity 0, but
 * `next/image` still fetches any image inside the viewport, so ~2.3 MB of
 * source AVIFs raced the first slide — the LCP element. Slides 2–4 now mount
 * only after the page has loaded; these tests pin that AND that the slideshow
 * still rotates afterwards (deferring must not break it).
 */

const slides = (container: HTMLElement) =>
  [...container.querySelectorAll("img")].filter((img) =>
    decodeURIComponent(img.getAttribute("src") ?? "").includes("hero-image")
  );

const isVisible = (img: HTMLElement) => img.className.includes("opacity-100");

function setReadyState(value: DocumentReadyState) {
  Object.defineProperty(document, "readyState", { value, configurable: true });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  // jsdom's own getter is on the prototype; deleting our own-property override restores it.
  delete (document as { readyState?: unknown }).readyState;
});

describe("Hero slideshow", () => {
  it("renders only the first (LCP) slide on the initial render", () => {
    setReadyState("loading");
    const { container } = render(<Hero />);

    expect(slides(container)).toHaveLength(1);
    expect(decodeURIComponent(slides(container)[0].getAttribute("src")!)).toContain("hero-image1");
    expect(isVisible(slides(container)[0])).toBe(true);
  });

  it("mounts the other slides only after the page has loaded", () => {
    setReadyState("loading");
    const { container } = render(<Hero />);

    // Time alone is not enough: the page has not finished loading.
    act(() => vi.advanceTimersByTime(10_000));
    expect(slides(container)).toHaveLength(1);

    act(() => {
      window.dispatchEvent(new Event("load"));
    });
    // …and then a short grace period, so they don't compete with the first paint.
    act(() => vi.advanceTimersByTime(1_000));
    expect(slides(container)).toHaveLength(1);
    act(() => vi.advanceTimersByTime(600));
    expect(slides(container)).toHaveLength(4);
  });

  it("arms immediately when the page is already loaded", () => {
    setReadyState("complete");
    const { container } = render(<Hero />);

    expect(slides(container)).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1_500));
    expect(slides(container)).toHaveLength(4);
  });

  it("still rotates once the slides are mounted", () => {
    setReadyState("complete");
    const { container } = render(<Hero />);

    act(() => vi.advanceTimersByTime(1_500)); // slides mounted
    expect(isVisible(slides(container)[0])).toBe(true);

    act(() => vi.advanceTimersByTime(6_500)); // first rotation
    const [first, second] = slides(container);
    expect(isVisible(first)).toBe(false);
    expect(isVisible(second)).toBe(true);

    act(() => vi.advanceTimersByTime(6_500 * 3)); // wraps back around
    expect(isVisible(slides(container)[0])).toBe(true);
  });

  it("does not rotate before the slides exist (nothing to rotate to)", () => {
    setReadyState("loading");
    const { container } = render(<Hero />);

    act(() => vi.advanceTimersByTime(60_000));
    expect(slides(container)).toHaveLength(1);
    expect(isVisible(slides(container)[0])).toBe(true);
  });

  it("clears its timers on unmount", () => {
    setReadyState("complete");
    const { unmount } = render(<Hero />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the page's one <h1>", () => {
    setReadyState("complete");
    const { container } = render(<Hero />);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });
});
