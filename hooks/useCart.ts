import { useMutation } from "@tanstack/react-query";
import { useCartStore } from "@/store/useCartStore";
import { useCallback } from "react";
import { CartLineItem } from "@/types/product";
import * as CartAPI from "@/services/cartService"; 
import { CartItemPayload } from "@/types/cart";

/**
 * The one add-to-cart path: optimistic local add, then (signed-in users) a
 * sync of the resulting cart. Shared by {@link useCart} and {@link useAddToCart}
 * so the two can never disagree. Reads the store at call time, not from a render
 * closure, so it needs no store subscription of its own.
 */
async function addItemAndSync(item: CartItemPayload): Promise<CartLineItem[]> {
  const snapshot = [...useCartStore.getState().cart];
  useCartStore.getState().addItem(item); // Optimistic UI

  const userId = await CartAPI.getAuthUserId();
  if (userId) {
    const updatedCart = useCartStore.getState().cart;
    await CartAPI.syncCartToDB(userId, updatedCart);
  }
  return snapshot;
}

/**
 * Add-to-cart ONLY, for list items such as the catalog's product cards.
 *
 * `useCart()` subscribes to the whole cart store and builds four mutations; a
 * 20-card page therefore ran 20 store subscriptions and 80 mutation observers
 * just to render a "+" button, and every cart change re-rendered every card.
 * This hook holds one mutation and no store subscription, so a card re-renders
 * only for its own reasons. `mutate` is referentially stable.
 */
export function useAddToCart() {
  const { mutate } = useMutation({
    mutationFn: addItemAndSync,
    onError: (_error, _item, context) => {
      if (context) useCartStore.getState().setCart(context as CartLineItem[]);
    },
  });
  return mutate;
}

export function useCart() {
  const store = useCartStore();

  const rollback = useCallback(
    (snapshot: CartLineItem[]) => {
      store.setCart(snapshot);
    },
    [store]
  );

  const addItemMutation = useMutation({
    mutationFn: addItemAndSync,
    onError: (_error, _item, context) => {
      if (context) rollback(context as CartLineItem[]);
    },
  });

  const removeItemMutation = useMutation({
    mutationFn: async (variantId: string) => {
      const snapshot = [...store.cart];
      store.removeItem(variantId); // Optimistic UI

      const userId = await CartAPI.getAuthUserId();
      if (userId) {
        await CartAPI.removeCartItemFromDB(userId, variantId);
      }
      return snapshot;
    },
    onError: (_error, _variantId, context) => {
      if (context) rollback(context as CartLineItem[]);
    },
  });

  const updateQuantityMutation = useMutation({
    mutationFn: async ({ variantId, quantity }: { variantId: string; quantity: number }) => {
      const snapshot = [...store.cart];
      store.updateQuantity(variantId, quantity); // Optimistic UI

      const userId = await CartAPI.getAuthUserId();
      if (userId) {
        if (quantity <= 0) {
          await CartAPI.removeCartItemFromDB(userId, variantId);
        } else {
          const item = store.cart.find((i) => i.variant_id === variantId);
          if (item) {
            await CartAPI.upsertCartItemInDB(userId, variantId, Math.min(quantity, item.stock));
          }
        }
      }
      return snapshot;
    },
    onError: (_error, _vars, context) => {
      if (context) rollback(context as CartLineItem[]);
    },
  });

  const clearCartMutation = useMutation({
    mutationFn: async () => {
      const snapshot = [...store.cart];
      store.clearCart(); // Optimistic UI

      const userId = await CartAPI.getAuthUserId();
      if (userId) {
        await CartAPI.clearCartInDB(userId);
      }
      return snapshot;
    },
    onError: (_error, _vars, context) => {
      if (context) rollback(context as CartLineItem[]);
    },
  });

  // Exportamos los métodos de manera limpia
  return {
    cart: store.cart,
    totalItems: store.getTotalItems(),
    totalPrice: store.getTotalPrice(),
    
    addItem: (item: CartItemPayload) => addItemMutation.mutate(item),
    removeItem: (variantId: string) => removeItemMutation.mutate(variantId),
    
    updateQuantity: (variantId: string, quantity: number) =>
      updateQuantityMutation.mutate({ variantId, quantity }),
      
    incrementQuantity: (variantId: string) => {
      const item = store.cart.find((i) => i.variant_id === variantId);
      if (item && item.quantity < item.stock) {
        updateQuantityMutation.mutate({ variantId, quantity: item.quantity + 1 });
      }
    },
    
    decrementQuantity: (variantId: string) => {
      const item = store.cart.find((i) => i.variant_id === variantId);
      if (item) {
        updateQuantityMutation.mutate({ variantId, quantity: item.quantity - 1 });
      }
    },
    
    clearCart: () => clearCartMutation.mutate(),
    
    isAdding: addItemMutation.isPending,
    isRemoving: removeItemMutation.isPending,
    isUpdating: updateQuantityMutation.isPending,
  };
}