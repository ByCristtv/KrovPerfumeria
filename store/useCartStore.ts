import { create } from "zustand";
import { persist } from "zustand/middleware";
import { CartStore } from "@/types/product";


export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      cart: [],

      setCart: (cart) => set({ cart }),

      addItem: (newItem) => {
        // Defense in depth: nothing KROV cannot ship from its own inventory may
        // enter the cart, whichever UI path (or stale caller) got here. A
        // made-to-order variant has zero units, so it is refused like any
        // sold-out line; the server (place_order) refuses it again at checkout.
        if (!(newItem.stock > 0)) return;

        const { cart } = get();
        const existing = cart.find((i) => i.variant_id === newItem.variant_id);

        if (existing) {
          set({
            cart: cart.map((i) =>
              i.variant_id === newItem.variant_id
                ? { ...i, quantity: Math.min(i.quantity + 1, i.stock) }
                : i
            ),
          });
        } else {
          set({ cart: [...cart, { ...newItem, quantity: 1 }] });
        }
      },

      removeItem: (variantId) => {
        set({ cart: get().cart.filter((i) => i.variant_id !== variantId) });
      },

      updateQuantity: (variantId, quantity) => {
        if (quantity <= 0) {
          set({ cart: get().cart.filter((i) => i.variant_id !== variantId) });
          return;
        }

        set({
          cart: get().cart.map((i) =>
            i.variant_id === variantId
              ? { ...i, quantity: Math.min(quantity, i.stock) }
              : i
          ),
        });
      },

      clearCart: () => set({ cart: [] }),

      getTotalItems: () =>
        get().cart.reduce((acc, item) => acc + item.quantity, 0),

      getTotalPrice: () =>
        get().cart.reduce((acc, item) => acc + item.price * item.quantity, 0),
    }),
    {
      name: "cart-storage"
      
    }
  )
);