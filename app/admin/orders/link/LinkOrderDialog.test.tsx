import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LinkableCustomer, UnlinkedOrderRow } from "@/types/orderLinking";

/**
 * The "Ligar a cliente" dialog: search → pick → confirm, with the confirmation
 * telling the admin the truth about XP, and the confirm button single-flight.
 */

const ORDER: UnlinkedOrderRow = {
  id: "11111111-1111-4111-8111-111111111111",
  order_number: 1042,
  customer_name: "Ana Solano",
  customer_email: null,
  customer_phone: "8888-1234",
  subtotal: 42_900,
  discount: 0,
  shipping_cost: 2_900,
  total: 45_800,
  order_status: "shipped",
  payment_status: "paid",
  payment_provider: null,
  source: "admin",
  created_at: "2026-03-01T15:00:00Z",
};

const ANA: LinkableCustomer = {
  user_id: "22222222-2222-4222-8222-222222222222",
  full_name: "Ana Solano Rojas",
  email: "ana@correo.com",
  phone: "+50688881234",
  role: "customer",
  member_since: "2026-10-01T00:00:00Z",
  experience_points: 150,
};
const OTHER: LinkableCustomer = {
  ...ANA,
  user_id: "33333333-3333-4333-8333-333333333333",
  full_name: "Ana Solís",
  email: "ana.solis@correo.com",
  phone: null,
};

const { linkMock, fireMock, searchState } = vi.hoisted(() => ({
  linkMock: vi.fn(),
  fireMock: vi.fn().mockResolvedValue({}),
  searchState: { customers: [] as LinkableCustomer[] },
}));

vi.mock("./actions", () => ({ linkOrderToCustomerAction: linkMock }));
vi.mock("sweetalert2", () => ({ default: { fire: fireMock } }));
vi.mock("@/hooks/useLinkableCustomerSearch", () => ({
  useLinkableCustomerSearch: (q: string) => ({
    customers: q.trim().length >= 2 ? searchState.customers : [],
    isLoading: false,
    isError: false,
    isIdle: q.trim().length < 2,
    isPending: false,
    refetch: () => {},
  }),
}));

import LinkOrderDialog from "./LinkOrderDialog";

function setup(order: UnlinkedOrderRow = ORDER) {
  const onClose = vi.fn();
  const onDone = vi.fn();
  render(<LinkOrderDialog order={order} onClose={onClose} onDone={onDone} />);
  return { onClose, onDone, user: userEvent.setup() };
}

beforeEach(() => {
  linkMock.mockReset();
  fireMock.mockClear();
  searchState.customers = [ANA, OTHER];
});

describe("LinkOrderDialog", () => {
  it("prefills the search, hints which account shares the phone, and needs a pick to continue", async () => {
    setup();
    expect(screen.getByLabelText("Buscar cliente registrado")).toHaveValue("Ana Solano");
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
    // +50688881234 and 8888-1234 are the same number.
    expect(screen.getAllByText("Mismo teléfono")).toHaveLength(1);
  });

  it("confirms with what will change, links once, reports XP and refreshes", async () => {
    linkMock.mockResolvedValue({
      ok: true,
      message: "Pedido #1042 ligado a Ana Solano Rojas.",
      data: {
        order_id: ORDER.id,
        order_number: 1042,
        order_status: "shipped",
        user_id: ANA.user_id,
        customer_name: "Ana Solano Rojas",
        customer_email: ANA.email,
        xp_status: "granted",
        xp_awarded: 2_100,
        xp_balance: 2_250,
      },
    });
    const { user, onDone } = setup();

    await user.click(screen.getByRole("radio", { name: /Ana Solano Rojas/ }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(screen.getByText(/Sumará 2,100 XP a la cuenta ahora/)).toBeInTheDocument();
    expect(screen.getByText(/No cambia nada más/)).toBeInTheDocument();

    const confirm = screen.getByRole("button", { name: "Confirmar y ligar" });
    await user.click(confirm);

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(linkMock).toHaveBeenCalledTimes(1);
    expect(linkMock).toHaveBeenCalledWith(ORDER.id, ANA.user_id);
    expect(fireMock.mock.calls[0][0].text).toMatch(/Se otorgaron 2,100 XP/);
  });

  it("says XP comes later for a pending order", async () => {
    const { user } = setup({ ...ORDER, order_status: "pending" });
    await user.click(screen.getByRole("radio", { name: /Ana Solano Rojas/ }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByText(/Aún no suma XP: está pendiente/)).toBeInTheDocument();
  });

  it("warns when neither the phone nor the email matches the chosen account", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("radio", { name: /Ana Solís/ }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByText(/Ni el teléfono ni el correo del pedido coinciden/)).toBeInTheDocument();
  });

  it("turns a lost race into a reload, not a retry", async () => {
    linkMock.mockResolvedValue({
      ok: false,
      message: "Este pedido ya fue ligado a una cuenta (quizá por otro administrador). Actualiza la lista.",
      stale: true,
    });
    const { user, onDone } = setup();

    await user.click(screen.getByRole("radio", { name: /Ana Solano Rojas/ }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));
    await user.click(screen.getByRole("button", { name: "Confirmar y ligar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/ya fue ligado/);
    expect(screen.getByRole("button", { name: "Confirmar y ligar" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Actualizar la lista" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(fireMock).not.toHaveBeenCalled();
  });
});
