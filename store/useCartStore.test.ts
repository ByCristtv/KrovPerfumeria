import { beforeEach, describe, expect, it } from "vitest";
import type { CartLineItem } from "@/types/product";
import { useCartStore } from "./useCartStore";

const line = (overrides: Partial<Omit<CartLineItem, "quantity">> = {}) => ({
  variant_id: "v1",
  product_name: "Lion",
  product_type: "full_size",
  size_ml: 100,
  price: 21_000,
  image_url: "/placeholder.png",
  stock: 5,
  ...overrides,
});

beforeEach(() => {
  useCartStore.setState({ cart: [] });
});

describe("useCartStore.addItem", () => {
  it("adds an in-stock line with quantity 1", () => {
    useCartStore.getState().addItem(line());
    expect(useCartStore.getState().cart).toEqual([
      expect.objectContaining({ variant_id: "v1", quantity: 1, stock: 5 }),
    ]);
  });

  it("still increments an existing line up to its stock", () => {
    const { addItem } = useCartStore.getState();
    addItem(line({ stock: 2 }));
    addItem(line({ stock: 2 }));
    addItem(line({ stock: 2 }));
    expect(useCartStore.getState().cart[0].quantity).toBe(2);
  });

  it.each([
    ["zero stock (made to order / sold out)", 0],
    ["negative stock", -1],
    ["NaN stock", Number.NaN],
  ])("refuses a line with %s, whatever UI path sent it", (_label, stock) => {
    useCartStore.getState().addItem(line({ stock }));
    expect(useCartStore.getState().cart).toEqual([]);
  });

  it("refusing one line leaves the rest of the cart untouched", () => {
    const { addItem } = useCartStore.getState();
    addItem(line({ variant_id: "ok", stock: 3 }));
    addItem(line({ variant_id: "made-to-order", stock: 0 }));

    expect(useCartStore.getState().cart.map((i) => i.variant_id)).toEqual(["ok"]);
  });
});
