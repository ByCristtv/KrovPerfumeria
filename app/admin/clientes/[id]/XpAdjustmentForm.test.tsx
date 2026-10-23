import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { actionMock } = vi.hoisted(() => ({ actionMock: vi.fn() }));
vi.mock("../actions", () => ({ adjustCustomerXpAction: actionMock }));

import XpAdjustmentForm from "./XpAdjustmentForm";

const UID = "11111111-1111-4111-8111-111111111111";

function setup(currentXp = 500) {
  render(<XpAdjustmentForm userId={UID} currentXp={currentXp} />);
  return {
    amount: screen.getByLabelText(/cantidad de xp/i),
    reason: screen.getByLabelText(/motivo/i),
    deduct: screen.getByLabelText(/restar xp/i),
    submit: screen.getByRole("button", { name: /aplicar ajuste/i }),
  };
}

describe("XpAdjustmentForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("previews the new balance and rank", () => {
    const { amount } = setup(500);
    fireEvent.change(amount, { target: { value: "600" } });
    expect(screen.getByText(/nuevo saldo: 1,100 xp · coleccionista/i)).toBeInTheDocument();
  });

  it("blocks an invalid amount without calling the server", () => {
    const { amount, submit } = setup();
    fireEvent.change(amount, { target: { value: "abc" } });
    fireEvent.click(submit);

    expect(screen.getByRole("alert")).toHaveTextContent(/cantidad entera/i);
    expect(actionMock).not.toHaveBeenCalled();
  });

  it("blocks a deduction larger than the balance", () => {
    const { amount, deduct, submit } = setup(100);
    fireEvent.click(deduct);
    fireEvent.change(amount, { target: { value: "150" } });
    fireEvent.click(submit);

    expect(screen.getByRole("alert")).toHaveTextContent(/más xp del disponible/i);
    expect(actionMock).not.toHaveBeenCalled();
  });

  it("submits a valid adjustment and shows the success message", async () => {
    actionMock.mockResolvedValue({
      ok: true,
      message: "Se restaron 50 XP.",
      data: { delta: -50, balance_before: 500, balance_after: 450, rank: "Aficionado" },
    });
    const { amount, reason, deduct, submit } = setup(500);

    fireEvent.click(deduct);
    fireEvent.change(amount, { target: { value: "50" } });
    fireEvent.change(reason, { target: { value: "Devolución" } });
    fireEvent.click(submit);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/se restaron 50 xp/i));
    expect(screen.getByRole("status")).toHaveTextContent(/450 xp \(aficionado\)/i);
    expect(actionMock).toHaveBeenCalledWith(UID, {
      direction: "deduct",
      amount: "50",
      reason: "Devolución",
    });
    expect(amount).toHaveValue("");
  });

  it("shows the server's error message", async () => {
    actionMock.mockResolvedValue({ ok: false, message: "No tienes permiso para realizar esta acción." });
    const { amount, submit } = setup();

    fireEvent.change(amount, { target: { value: "10" } });
    fireEvent.click(submit);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/permiso/i));
  });
});
