import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AdminCustomerMatch, AdminOrderInput } from "@/types/adminOrder";
import type { AdminVariantRow } from "@/types/product";
import type { UserCoupon } from "@/lib/coupons/types";
import { userCoupon } from "@/test/helpers/couponFixtures";

/**
 * The manual-order form, driven the way an admin drives it, for the two rules
 * that live in its state: a coupon belongs to ONE customer (changing the
 * customer drops it), and Cariari ships free the moment it is chosen (and stops
 * the moment it is not). Network-facing hooks are faked at their module edge.
 */

const ANA: AdminCustomerMatch = {
  user_id: "3f1a2b3c-4d5e-4f70-8192-a3b4c5d6e7f8",
  full_name: "Ana Solano",
  email: "ana@correo.com",
  phone: "88881234",
  address: null,
};
const BETO: AdminCustomerMatch = {
  user_id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  full_name: "Beto Mora",
  email: "beto@correo.com",
  phone: "88884321",
  address: null,
};

const VARIANT: AdminVariantRow = {
  variant_id: "5b6c7d8e-9f01-4a2b-8c3d-4e5f6a7b8c9d",
  product_id: "6c7d8e9f-0a1b-4c2d-8e3f-5a6b7c8d9e0f",
  sku: "SAUV-100",
  size_ml: 100,
  product_type: "full_size",
  price: 40_000,
  stock: 5,
  is_on_offer: false,
  offer_price: null,
  is_active: true,
  wholesale_price: null,
  min_wholesale_quantity: null,
  name: "Sauvage",
  brand: "Dior",
} as AdminVariantRow;

const ANA_COUPON = userCoupon("11111111-aaaa-4aaa-8aaa-111111111111", "Cupón Ana", {
  code: "ANA-8",
});
const BETO_COUPON = userCoupon("22222222-bbbb-4bbb-8bbb-222222222222", "Cupón Beto", {
  code: "BETO-12",
  discountValue: 12,
});
const COUPONS: Record<string, UserCoupon[]> = {
  [ANA.user_id]: [ANA_COUPON],
  [BETO.user_id]: [BETO_COUPON],
};

const { createMock, rpcMock, pushMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  rpcMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock("sweetalert2", () => ({ default: { fire: vi.fn().mockResolvedValue({}) } }));
vi.mock("@/lib/supabase/client", () => ({ supabase: { rpc: rpcMock } }));
vi.mock("@/hooks/useAdminProducts", () => ({
  useAdminProducts: () => ({ data: [VARIANT], isLoading: false }),
}));
vi.mock("@/hooks/useRegisteredEmailMatch", () => ({
  useRegisteredEmailMatch: () => ({
    match: null,
    isChecking: false,
    isError: false,
    onBlur: () => {},
  }),
}));
vi.mock("@/hooks/useCustomerSearch", () => ({
  useCustomerSearch: (q: string) => ({
    customers: q.trim().length >= 2 ? [ANA, BETO] : [],
    isLoading: false,
    isError: false,
    isIdle: q.trim().length < 2,
    isPending: false,
    refetch: () => {},
  }),
}));
vi.mock("@/hooks/useCustomerCoupons", () => ({
  useCustomerCoupons: (userId: string | null) => ({
    data: userId ? COUPONS[userId] : undefined,
    isPending: !userId,
    isSuccess: Boolean(userId),
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/app/admin/orders/actions", () => ({ createAdminOrderAction: createMock }));

import AdminOrderCreateView from "./AdminOrderCreateView";

const summary = () => screen.getByRole("heading", { name: "Resumen" }).closest("section")!;

async function pickCustomer(user: ReturnType<typeof userEvent.setup>, who: AdminCustomerMatch) {
  const box = screen.getByRole("combobox", { name: /buscar cliente/i });
  await user.clear(box);
  await user.type(box, "co");
  const option = screen.getByRole("option", { name: new RegExp(who.full_name!) });
  await user.pointer({ target: option, keys: "[MouseLeft>]" }); // mousedown picks
}

async function addProduct(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText(/Buscar por nombre, marca o SKU/), "Sauv");
  await user.click(screen.getByRole("button", { name: /Sauvage/ }));
}

async function chooseAddress(
  user: ReturnType<typeof userEvent.setup>,
  district: string
) {
  await user.selectOptions(screen.getByLabelText("Provincia"), "7");
  await user.selectOptions(screen.getByLabelText("Cantón"), "702");
  await user.selectOptions(screen.getByLabelText("Distrito"), district);
}

beforeEach(() => {
  createMock.mockReset();
  pushMock.mockReset();
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: { cost: 2_900 }, error: null });
});

describe("AdminOrderCreateView — coupons belong to the selected customer", () => {
  it("shows the selected customer's coupons and applies one to the summary", async () => {
    const user = userEvent.setup();
    render(<AdminOrderCreateView />);

    expect(screen.getByText(/Selecciona un cliente registrado para ver sus cupones/)).toBeInTheDocument();

    await pickCustomer(user, ANA);
    await addProduct(user);
    await user.click(screen.getByRole("radio", { name: /Cupón Ana/ }));

    const s = within(summary());
    expect(s.getByText("ANA-8")).toBeInTheDocument();
    // 8% of ₡40.000
    expect(s.getByText(/−₡\s?3[.,\s]?200/)).toBeInTheDocument();
    // The manual discount input is replaced while a coupon is applied.
    expect(s.queryByLabelText("Descuento manual")).not.toBeInTheDocument();
  });

  it("clears the coupon when the admin switches to another customer", async () => {
    const user = userEvent.setup();
    render(<AdminOrderCreateView />);

    await pickCustomer(user, ANA);
    await addProduct(user);
    await user.click(screen.getByRole("radio", { name: /Cupón Ana/ }));
    expect(within(summary()).getByText("ANA-8")).toBeInTheDocument();

    await pickCustomer(user, BETO);

    expect(within(summary()).queryByText("ANA-8")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Cupón Ana/ })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Cupón Beto/ })).not.toBeChecked();
    expect(within(summary()).getByLabelText("Descuento manual")).toBeInTheDocument();
    // A switch is not a "coupon vanished" situation.
    expect(screen.queryByText(/ya no está disponible para este cliente/)).not.toBeInTheDocument();
  });

  it("says so when the picked coupon stops being spendable (spent elsewhere)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AdminOrderCreateView />);

    await pickCustomer(user, ANA);
    await addProduct(user);
    await user.click(screen.getByRole("radio", { name: /Cupón Ana/ }));

    // A refetch now reports it as used on another order.
    COUPONS[ANA.user_id] = [{ ...ANA_COUPON, status: "used" }];
    rerender(<AdminOrderCreateView />);

    expect(screen.getByRole("alert")).toHaveTextContent(/ya no está disponible para este cliente/);
    expect(within(summary()).queryByText("ANA-8")).not.toBeInTheDocument();
    COUPONS[ANA.user_id] = [ANA_COUPON];
  });

  it("sends the coupon id (and no manual discount) on submit", async () => {
    createMock.mockResolvedValue({ ok: false, message: "x" });
    const user = userEvent.setup();
    render(<AdminOrderCreateView />);

    await pickCustomer(user, ANA);
    await user.type(screen.getByPlaceholderText("Nombre del cliente"), "{selectall}Ana Solano");
    await user.clear(screen.getByPlaceholderText("8888-8888"));
    await user.type(screen.getByPlaceholderText("8888-8888"), "88881234");
    await chooseAddress(user, "Guápiles");
    await user.type(screen.getByPlaceholderText(/200m sur de la iglesia/), "Casa verde frente al parque");
    await addProduct(user);
    await user.click(screen.getByRole("radio", { name: /Cupón Ana/ }));
    await user.click(screen.getByRole("button", { name: "Crear pedido" }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    const input = createMock.mock.calls[0][0] as AdminOrderInput;
    expect(input.user_coupon_id).toBe(ANA_COUPON.id);
    expect(input.customer.user_id).toBe(ANA.user_id);
    expect(input.discount).toBeUndefined();
  });
});

describe("AdminOrderCreateView — free shipping to Cariari, Pococí", () => {
  it("drops shipping to ₡0 for Cariari and restores the zone rate elsewhere", async () => {
    const user = userEvent.setup();
    render(<AdminOrderCreateView />);
    await addProduct(user);

    await chooseAddress(user, "Guápiles");
    await waitFor(() => expect(within(summary()).getByText(/₡\s?2[.,\s]?900/)).toBeInTheDocument());
    expect(within(summary()).queryByText(/entrega local/i)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Distrito"), "Cariari");
    const s = within(summary());
    expect(s.getByText("Gratis")).toBeInTheDocument();
    expect(s.getByText(/Envío gratis · entrega local Cariari, Pococí/)).toBeInTheDocument();
    // Total = subtotal only.
    expect(s.getAllByText(/₡\s?40[.,\s]?000/).length).toBeGreaterThanOrEqual(2);

    await user.selectOptions(screen.getByLabelText("Distrito"), "Guápiles");
    expect(within(summary()).queryByText(/entrega local/i)).not.toBeInTheDocument();
    expect(within(summary()).getByText(/₡\s?2[.,\s]?900/)).toBeInTheDocument();
  });
});
