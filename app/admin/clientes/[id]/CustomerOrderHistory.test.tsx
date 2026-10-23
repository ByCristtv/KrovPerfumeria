import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

// OrdersTable (badges) is a client module that imports the router.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import CustomerOrderHistory from "./CustomerOrderHistory";
import type { CustomerOrder } from "@/features/admin/getCustomerAdminDetail";

function order(overrides: Partial<CustomerOrder> = {}): CustomerOrder {
  return {
    id: "o-1",
    order_number: 1001,
    customer_name: "Aurora Vega",
    customer_email: "a@example.com",
    customer_phone: "8888-8888",
    subtotal: 30_000,
    discount: 1_500,
    shipping_cost: 2_900,
    total: 31_400,
    order_status: "received",
    payment_status: "paid",
    source: "web",
    created_at: "2026-10-01T10:00:00Z",
    items: [
      {
        id: "i-1",
        product_name: "Sauvage",
        brand_name: "Dior",
        size_ml: 100,
        quantity: 2,
        unit_price: 15_000,
        line_total: 30_000,
      },
    ],
    xp_earned: 1_400,
    ...overrides,
  };
}

describe("CustomerOrderHistory", () => {
  it("shows an empty state when the customer has no orders", () => {
    render(<CustomerOrderHistory orders={[]} total={0} />);
    expect(screen.getByText(/todavía no tiene pedidos/i)).toBeInTheDocument();
  });

  it("shows an error state when the history failed to load", () => {
    render(<CustomerOrderHistory orders={[]} total={0} loaded={false} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/no pudimos cargar/i);
  });

  it("renders number, status, payment, total and XP for each order", () => {
    render(
      <CustomerOrderHistory
        orders={[order(), order({ id: "o-2", order_number: 1002, order_status: "pending", payment_status: "pending", xp_earned: null })]}
        total={2}
      />
    );

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);

    const first = within(items[0]);
    expect(first.getByText("#1001")).toBeInTheDocument();
    expect(first.getByText("Recibido")).toBeInTheDocument();
    expect(first.getByText("Pagado")).toBeInTheDocument();
    expect(first.getByText("+1,400 XP")).toBeInTheDocument();

    const second = within(items[1]);
    expect(second.getByText("#1002")).toBeInTheDocument();
    expect(second.getAllByText("Pendiente")).toHaveLength(2);
    expect(second.queryByText(/XP$/)).not.toBeInTheDocument();
  });

  it("includes the order lines and a link to the full order", () => {
    render(<CustomerOrderHistory orders={[order()]} total={1} />);

    expect(screen.getByText("Sauvage")).toBeInTheDocument();
    expect(screen.getByText(/Dior · 100 ml/)).toBeInTheDocument();
    expect(screen.getByText("Descuento")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ver pedido completo/i })).toHaveAttribute(
      "href",
      "/admin/orders/o-1"
    );
  });

  it("says when only the most recent orders are shown", () => {
    render(<CustomerOrderHistory orders={[order()]} total={75} />);
    expect(screen.getByText(/1 pedidos más recientes de 75/)).toBeInTheDocument();
  });
});
