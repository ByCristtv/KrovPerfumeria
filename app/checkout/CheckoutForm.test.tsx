import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import CheckoutForm from "./CheckoutForm";
import {
  checkoutFormDefaults,
  checkoutFormSchema,
  type CheckoutFormValues,
} from "@/schemas/checkout";

/**
 * The address section of /checkout, driven the way CheckoutClient drives it.
 *
 * The form is exercised through the real react-hook-form + zod resolver rather
 * than stubbed state, because the behaviour under test IS the interaction
 * between fields: the cascade clears what it invalidates, and the local-delivery
 * opt-in exists only while two other fields hold particular values.
 */
function Host({
  onSubmit = vi.fn(),
  defaults,
}: {
  onSubmit?: (values: CheckoutFormValues) => void;
  defaults?: Partial<CheckoutFormValues["shipping"]>;
}) {
  const form = useForm<CheckoutFormValues>({
    resolver: zodResolver(checkoutFormSchema),
    defaultValues: {
      ...checkoutFormDefaults,
      shipping: { ...checkoutFormDefaults.shipping, ...defaults },
    },
    mode: "onBlur",
  });

  return <CheckoutForm form={form} onSubmit={onSubmit} />;
}

const provinceField = () => screen.getByLabelText(/^Provincia/) as HTMLSelectElement;
const cantonField = () => screen.getByLabelText(/^Cantón/) as HTMLSelectElement;
const districtField = () => screen.getByLabelText(/^Distrito/) as HTMLSelectElement;
const cariariCheckbox = () => screen.queryByRole("checkbox", { name: /Cariari centro/ });

const districtOptions = () =>
  Array.from(districtField().options).map((o) => o.textContent);

/** Drive the cascade the way a customer does: province, then cantón, then district. */
async function chooseAddress(
  user: ReturnType<typeof userEvent.setup>,
  province: string,
  canton: string,
  district: string
) {
  await user.selectOptions(provinceField(), province);
  await user.selectOptions(cantonField(), canton);
  await user.selectOptions(districtField(), district);
}

describe("CheckoutForm — the address cascade", () => {
  it("does not offer a cantón until a province is chosen", () => {
    render(<Host />);
    expect(cantonField()).toBeDisabled();
  });

  it("does not offer a district until a cantón is chosen", () => {
    render(<Host />);
    expect(districtField()).toBeDisabled();
  });

  it("offers a district dropdown, not a free-text box", async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.selectOptions(provinceField(), "7");
    await user.selectOptions(cantonField(), "702");

    expect(districtField().tagName).toBe("SELECT");
    expect(districtOptions()).toContain("Cariari");
  });

  it("narrows districts to the chosen cantón", async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.selectOptions(provinceField(), "7");
    await user.selectOptions(cantonField(), "702");
    expect(districtOptions()).toContain("Guápiles");
    expect(districtOptions()).not.toContain("Carmen");

    await user.selectOptions(cantonField(), "701");
    expect(districtOptions()).not.toContain("Guápiles");
  });

  it("clears the district when the cantón changes under it", async () => {
    const user = userEvent.setup();
    render(<Host />);

    await chooseAddress(user, "7", "702", "Cariari");
    expect(districtField()).toHaveValue("Cariari");

    await user.selectOptions(cantonField(), "701");
    expect(districtField()).toHaveValue("");
  });

  it("clears the cantón and district when the province changes", async () => {
    const user = userEvent.setup();
    render(<Host />);

    await chooseAddress(user, "7", "702", "Cariari");
    await user.selectOptions(provinceField(), "1");

    expect(cantonField()).toHaveValue("");
    expect(districtField()).toHaveValue("");
  });
});

describe("CheckoutForm — the Cariari centro opt-in", () => {
  it("is hidden until an address is chosen", () => {
    render(<Host />);
    expect(cariariCheckbox()).not.toBeInTheDocument();
  });

  it("appears for Limón → Pococí → Cariari", async () => {
    const user = userEvent.setup();
    render(<Host />);

    await chooseAddress(user, "7", "702", "Cariari");

    expect(cariariCheckbox()).toBeInTheDocument();
    expect(cariariCheckbox()).not.toBeChecked();
  });

  it("stays hidden for another district of the same cantón", async () => {
    const user = userEvent.setup();
    render(<Host />);

    await chooseAddress(user, "7", "702", "Guápiles");

    expect(cariariCheckbox()).not.toBeInTheDocument();
  });

  it("stays hidden for the cantón with no district picked yet", async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.selectOptions(provinceField(), "7");
    await user.selectOptions(cantonField(), "702");

    expect(cariariCheckbox()).not.toBeInTheDocument();
  });

  it("stays hidden everywhere else in the country", async () => {
    const user = userEvent.setup();
    render(<Host />);

    await chooseAddress(user, "1", "101", "Carmen");
    expect(cariariCheckbox()).not.toBeInTheDocument();

    await chooseAddress(user, "4", "401", "Heredia");
    expect(cariariCheckbox()).not.toBeInTheDocument();
  });

  it("disappears — and unticks itself — when the address moves away", async () => {
    const user = userEvent.setup();
    render(<Host />);

    await chooseAddress(user, "7", "702", "Cariari");
    await user.click(cariariCheckbox()!);
    expect(cariariCheckbox()).toBeChecked();

    await user.selectOptions(districtField(), "Guápiles");
    expect(cariariCheckbox()).not.toBeInTheDocument();

    // Coming back must not silently restore an opt-in the customer can no
    // longer see they made.
    await user.selectOptions(districtField(), "Cariari");
    expect(cariariCheckbox()).toBeInTheDocument();
    expect(cariariCheckbox()).not.toBeChecked();
  });
});

describe("CheckoutForm — what reaches the submit handler", () => {
  const fillContact = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByLabelText(/Nombre completo/), "María Pérez");
    await user.type(screen.getByLabelText(/Correo electrónico/), "maria@correo.com");
    await user.type(screen.getByLabelText(/Teléfono/), "88888888");
    await user.type(
      screen.getByLabelText(/Señas exactas/),
      "200m sur de la escuela, casa verde"
    );
  };

  it("submits the opt-in when it was ticked", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<Host onSubmit={onSubmit} />);

    await fillContact(user);
    await chooseAddress(user, "7", "702", "Cariari");
    await user.click(cariariCheckbox()!);
    await user.click(screen.getByRole("button", { name: /Continuar al pago/ }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].shipping).toMatchObject({
      canton_code: "702",
      district: "Cariari",
      local_delivery: true,
    });
  });

  it("submits it as false when it was left alone", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<Host onSubmit={onSubmit} />);

    await fillContact(user);
    await chooseAddress(user, "7", "702", "Cariari");
    await user.click(screen.getByRole("button", { name: /Continuar al pago/ }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].shipping.local_delivery).toBe(false);
  });

  it("refuses to submit a district that does not belong to the cantón", async () => {
    // Reachable only by a prefilled legacy address, which the dropdown keeps
    // visible rather than silently rewriting.
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <Host
        onSubmit={onSubmit}
        defaults={{ canton_code: "401", district: "Cariari" }}
      />
    );

    await fillContact(user);
    await user.click(screen.getByRole("button", { name: /Continuar al pago/ }));

    await waitFor(() =>
      expect(
        screen.getByText("Selecciona un distrito válido de Heredia")
      ).toBeInTheDocument()
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
