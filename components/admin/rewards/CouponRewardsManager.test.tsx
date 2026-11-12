import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...(props as object)} />,
}));
vi.mock("sweetalert2", () => ({ default: { fire: vi.fn() } }));
const actions = vi.hoisted(() => ({
  createCouponRewardAction: vi.fn(),
  updateCouponRewardAction: vi.fn(),
  setCouponRewardActiveAction: vi.fn(),
  deleteCouponRewardAction: vi.fn(),
  issueCouponRewardRetroactivelyAction: vi.fn(),
}));
vi.mock("@/app/admin/rewards/actions", () => actions);

import Swal from "sweetalert2";
import CouponRewardsManager from "./CouponRewardsManager";
import { TEST_LADDER } from "@/test/helpers/rankLadder";
import { adminReward } from "@/test/helpers/rewardsFixtures";

const fire = Swal.fire as unknown as ReturnType<typeof vi.fn>;

const rewards = [
  adminReward(2, 5, { name: "Cupón Coleccionista", issuedCount: 40 }),
  adminReward(4, 12, { name: "Cupón 12", issuedCount: 9 }),
  adminReward(4, 15, { name: "Cupón 15", issuedCount: 0, maxDiscountAmount: 30_000, validDays: 30 }),
  adminReward(4, 20, { name: "Cupón 20", issuedCount: 0, isActive: false }),
  adminReward(3, 5_000, { name: "Cupón fijo", discountType: "fixed", minOrderSubtotal: 0, issuedCount: 2 }),
];

const section = (rank: string) =>
  screen.getByRole("heading", { level: 3, name: rank }).closest("section") as HTMLElement;
const card = (name: string) => screen.getByText(name).closest("li") as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  fire.mockResolvedValue({ isConfirmed: true });
});

describe("CouponRewardsManager — grouping", () => {
  it("renders every rank, each with its own rewards", () => {
    render(<CouponRewardsManager ladder={TEST_LADDER} rewards={rewards} />);
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Aficionado",
      "Coleccionista",
      "Conocedor",
      "Alquimista",
      "Maestro",
    ]);
    expect(within(section("Alquimista")).getAllByRole("listitem")).toHaveLength(3);
    expect(within(section("Alquimista")).getByText(/2 activas/)).toBeInTheDocument();
    expect(within(section("Aficionado")).getByText("Este rango no entrega cupones.")).toBeInTheDocument();
  });

  it("shows each reward's terms and status", () => {
    render(<CouponRewardsManager ladder={TEST_LADDER} rewards={rewards} />);
    expect(card("Cupón 15")).toHaveTextContent("15%");
    expect(card("Cupón 15")).toHaveTextContent(/Tope/);
    expect(card("Cupón 15")).toHaveTextContent("Vence a los 30 días");
    expect(card("Cupón fijo")).toHaveTextContent("Sin compra mínima");
    expect(card("Cupón 20")).toHaveTextContent("Inactiva");
    expect(card("Cupón Coleccionista")).toHaveTextContent("Entregada a 40 clientes");
  });

  it("offers delete only for rewards never issued, and back-issue only for active ones", () => {
    render(<CouponRewardsManager ladder={TEST_LADDER} rewards={rewards} />);
    expect(within(card("Cupón 12")).queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument();
    expect(within(card("Cupón 15")).getByRole("button", { name: "Eliminar" })).toBeInTheDocument();
    expect(within(card("Cupón 20")).queryByRole("button", { name: /Entregar a clientes actuales/ })).not.toBeInTheDocument();
    expect(within(card("Cupón 20")).getByRole("button", { name: "Activar" })).toBeInTheDocument();
  });

  it("has no management controls while read-only", () => {
    render(<CouponRewardsManager ladder={TEST_LADDER} rewards={rewards} readOnly />);
    expect(screen.queryByRole("button", { name: /Agregar cupón/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar" })).not.toBeInTheDocument();
  });
});

describe("CouponRewardsManager — actions", () => {
  it("adds another reward to a rank that already has some", async () => {
    actions.createCouponRewardAction.mockResolvedValue({ ok: true, message: "Recompensa creada." });
    render(<CouponRewardsManager ladder={TEST_LADDER} rewards={rewards} />);

    fireEvent.click(within(section("Alquimista")).getByRole("button", { name: /Agregar cupón/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Alquimista")).toBeChecked();
    fireEvent.change(within(dialog).getByLabelText("Descuento (%)"), { target: { value: "25" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Crear recompensa" }));

    await waitFor(() => expect(actions.createCouponRewardAction).toHaveBeenCalledTimes(1));
    expect(actions.createCouponRewardAction.mock.calls[0][0]).toMatchObject({
      level: 4,
      isActive: true,
      terms: { name: "Cupón Alquimista", discountType: "percentage", discountValue: "25", minOrderSubtotal: "20000" },
    });
  });

  it("validates in the form before calling the server", async () => {
    render(<CouponRewardsManager ladder={TEST_LADDER} rewards={rewards} />);
    fireEvent.click(within(section("Maestro")).getByRole("button", { name: /Agregar cupón/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Descuento (%)"), { target: { value: "150" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Crear recompensa" }));

    expect(await within(dialog).findByText(/entre 0,01 y 100/)).toBeInTheDocument();
    expect(actions.createCouponRewardAction).not.toHaveBeenCalled();
  });

  it("edits the discount with rank and type locked, sending the lock token", async () => {
    actions.updateCouponRewardAction.mockResolvedValue({ ok: true, message: "Recompensa actualizada." });
    render(<CouponRewardsManager ladder={TEST_LADDER} rewards={rewards} />);

    fireEvent.click(within(card("Cupón 12")).getByRole("button", { name: "Editar" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Alquimista")).toBeDisabled();
    expect(within(dialog).getByLabelText("Monto fijo (₡)")).toBeDisabled();
    expect(dialog).toHaveTextContent("9 clientes ya tienen este cupón");

    fireEvent.change(within(dialog).getByLabelText("Descuento (%)"), { target: { value: "14" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(actions.updateCouponRewardAction).toHaveBeenCalledTimes(1));
    const [id, input] = actions.updateCouponRewardAction.mock.calls[0];
    expect(id).toBe(rewards[1].id);
    expect(input).toMatchObject({ terms: { discountValue: "14" }, expectedUpdatedAt: rewards[1].updatedAt });
  });

  it("deactivates after a confirmation that issued coupons stay valid", async () => {
    actions.setCouponRewardActiveAction.mockResolvedValue({ ok: true, message: "ok" });
    render(<CouponRewardsManager ladder={TEST_LADDER} rewards={rewards} />);

    fireEvent.click(within(card("Cupón 12")).getByRole("button", { name: "Desactivar" }));
    await waitFor(() => expect(actions.setCouponRewardActiveAction).toHaveBeenCalledWith(rewards[1].id, false));
    expect((fire.mock.calls[0][0] as { html: string }).html).toMatch(/siguen siendo válidos/);
  });

  it("never deletes without confirmation", async () => {
    fire.mockResolvedValueOnce({ isConfirmed: false });
    render(<CouponRewardsManager ladder={TEST_LADDER} rewards={rewards} />);
    fireEvent.click(within(card("Cupón 15")).getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(fire).toHaveBeenCalled());
    expect(actions.deleteCouponRewardAction).not.toHaveBeenCalled();
  });

  it("back-issues only after showing how many customers will receive it", async () => {
    actions.issueCouponRewardRetroactivelyAction
      .mockResolvedValueOnce({ ok: true, message: "", data: { eligible: 3, issued: 0 } })
      .mockResolvedValueOnce({ ok: true, message: "Se entregó a 3 clientes.", data: { eligible: 3, issued: 3 } });
    render(<CouponRewardsManager ladder={TEST_LADDER} rewards={rewards} />);

    fireEvent.click(within(card("Cupón 15")).getByRole("button", { name: /Entregar a clientes actuales/ }));

    await waitFor(() => expect(actions.issueCouponRewardRetroactivelyAction).toHaveBeenCalledTimes(2));
    expect(actions.issueCouponRewardRetroactivelyAction.mock.calls[0]).toEqual([rewards[2].id, true]);
    expect(actions.issueCouponRewardRetroactivelyAction.mock.calls[1]).toEqual([rewards[2].id, false]);
    expect((fire.mock.calls[0][0] as { html: string }).html).toMatch(/3 clientes/);
  });
});
