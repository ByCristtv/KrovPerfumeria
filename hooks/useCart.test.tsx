import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const api = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
  syncCartToDB: vi.fn(),
}));
vi.mock("@/services/cartService", () => ({
  getAuthUserId: api.getAuthUserId,
  syncCartToDB: api.syncCartToDB,
  removeCartItemFromDB: vi.fn(),
  upsertCartItemInDB: vi.fn(),
  clearCartInDB: vi.fn(),
}));

import { useAddToCart, useCart } from "./useCart";
import { useCartStore } from "@/store/useCartStore";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const item = (variant_id = "v1", stock = 5) => ({
  variant_id,
  product_name: "Lion",
  product_type: "full_size" as const,
  size_ml: 100,
  price: 21_000,
  image_url: "/placeholder.png",
  stock,
});

beforeEach(() => {
  useCartStore.setState({ cart: [] });
  api.getAuthUserId.mockReset().mockResolvedValue(null);
  api.syncCartToDB.mockReset().mockResolvedValue(undefined);
});

describe("useAddToCart", () => {
  it("adds the item to the cart store", async () => {
    const { result } = renderHook(() => useAddToCart(), { wrapper });

    act(() => result.current(item()));

    await waitFor(() => expect(useCartStore.getState().cart).toHaveLength(1));
    expect(useCartStore.getState().cart[0]).toMatchObject({ variant_id: "v1", quantity: 1, stock: 5 });
  });

  it("still refuses an item with no stock (the store's own guard is untouched)", async () => {
    const { result } = renderHook(() => useAddToCart(), { wrapper });

    act(() => result.current(item("v1", 0)));

    await waitFor(() => expect(api.getAuthUserId).toHaveBeenCalled());
    expect(useCartStore.getState().cart).toHaveLength(0);
  });

  it("syncs the resulting cart for a signed-in user, and not for a guest", async () => {
    const { result } = renderHook(() => useAddToCart(), { wrapper });

    act(() => result.current(item()));
    await waitFor(() => expect(api.getAuthUserId).toHaveBeenCalledTimes(1));
    expect(api.syncCartToDB).not.toHaveBeenCalled();

    api.getAuthUserId.mockResolvedValue("user-1");
    act(() => result.current(item("v2")));
    await waitFor(() => expect(api.syncCartToDB).toHaveBeenCalledTimes(1));
    expect(api.syncCartToDB).toHaveBeenCalledWith(
      "user-1",
      expect.arrayContaining([
        expect.objectContaining({ variant_id: "v1" }),
        expect.objectContaining({ variant_id: "v2" }),
      ])
    );
  });

  it("does NOT re-render when the cart changes (a card must not follow the cart)", async () => {
    let renders = 0;
    const { result } = renderHook(
      () => {
        renders++;
        return useAddToCart();
      },
      { wrapper }
    );
    const first = result.current;
    const before = renders;

    act(() => useCartStore.getState().addItem(item("other")));
    act(() => useCartStore.getState().addItem(item("another")));

    expect(renders).toBe(before);
    expect(result.current).toBe(first); // `mutate` is stable
  });
});

describe("useCart (unchanged contract)", () => {
  it("exposes the cart and still adds through the same path", async () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    expect(result.current.cart).toEqual([]);

    act(() => result.current.addItem(item()));

    await waitFor(() => expect(result.current.cart).toHaveLength(1));
    expect(result.current.totalItems).toBe(1);
    expect(result.current.totalPrice).toBe(21_000);
  });
});
