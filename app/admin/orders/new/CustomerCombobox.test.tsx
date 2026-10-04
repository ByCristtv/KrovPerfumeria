import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AdminCustomerMatch } from "@/types/adminOrder";

const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }));
vi.mock("@/app/admin/orders/customerActions", () => ({
  searchCustomersAction: searchMock,
  findCustomerByEmailAction: vi.fn(),
}));

import CustomerCombobox from "./CustomerCombobox";

const ana: AdminCustomerMatch = {
  user_id: "3f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8",
  full_name: "Ana Solano",
  email: "ana@correo.com",
  phone: "88881234",
  address: null,
};
const beto: AdminCustomerMatch = {
  user_id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  full_name: null,
  email: "beto@correo.com",
  phone: null,
  address: null,
};

function setup(onSelect = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(
    <QueryClientProvider client={client}>
      <CustomerCombobox onSelect={onSelect} />
    </QueryClientProvider>
  );
  const input = screen.getByRole("combobox", { name: /buscar cliente/i });
  return { user, input, onSelect };
}

/** Type, then let the 300ms debounce and the query settle. */
async function typeAndSettle(
  user: ReturnType<typeof userEvent.setup>,
  input: HTMLElement,
  text: string
) {
  await user.type(input, text);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
}

describe("CustomerCombobox", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    searchMock.mockReset();
    searchMock.mockResolvedValue({ ok: true, data: [ana, beto] });
  });
  afterEach(() => vi.useRealTimers());

  it("does not search until the minimum length is typed", async () => {
    const { user, input } = setup();
    await typeAndSettle(user, input, "a");
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("debounces a burst of typing into a single search", async () => {
    const { user, input } = setup();
    await typeAndSettle(user, input, "ana");
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock).toHaveBeenCalledWith("ana");
  });

  it("lists matches and falls back to the email when a customer has no name", async () => {
    const { user, input } = setup();
    await typeAndSettle(user, input, "co");
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("Ana Solano");
    expect(options[1]).toHaveTextContent("Sin nombre");
    expect(options[1]).toHaveTextContent("beto@correo.com");
  });

  it("selects with the mouse and clears the box", async () => {
    const { user, input, onSelect } = setup();
    await typeAndSettle(user, input, "ana");
    await user.click(await screen.findByRole("option", { name: /ana solano/i }));
    expect(onSelect).toHaveBeenCalledWith(ana);
    expect(input).toHaveValue("");
  });

  it("is operable from the keyboard: ArrowDown moves, Enter picks", async () => {
    const { user, input, onSelect } = setup();
    await typeAndSettle(user, input, "co");
    await screen.findAllByRole("option");

    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", expect.stringMatching(/opt-1$/));

    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(beto);
  });

  it("Escape closes the list without selecting", async () => {
    const { user, input, onSelect } = setup();
    await typeAndSettle(user, input, "co");
    await screen.findAllByRole("option");
    await user.keyboard("{Escape}");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("says when nobody matches", async () => {
    searchMock.mockResolvedValue({ ok: true, data: [] });
    const { user, input } = setup();
    await typeAndSettle(user, input, "zzz");
    expect(await screen.findByText(/sin clientes registrados/i)).toBeInTheDocument();
  });

  it("shows a failure as a failure — with a retry — never as 'no customers'", async () => {
    searchMock.mockResolvedValue({ ok: false, message: "boom" });
    const { user, input } = setup();
    await typeAndSettle(user, input, "ana");

    expect(await screen.findByText(/no pudimos buscar clientes/i)).toBeInTheDocument();
    expect(screen.queryByText(/sin clientes registrados/i)).not.toBeInTheDocument();

    searchMock.mockResolvedValue({ ok: true, data: [ana] });
    await user.click(screen.getByRole("button", { name: /reintentar/i }));
    expect(await screen.findByRole("option", { name: /ana solano/i })).toBeInTheDocument();
  });
});
