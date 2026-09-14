import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import AdminAddressFields from "./AdminAddressFields";
import {
  emptyAddressSelection,
  type AddressSelection,
} from "@/lib/cr-geo/selection";

/**
 * The manual-order address cascade as an admin drives it.
 *
 * Rendered inside a host that owns the selection exactly as the real form does,
 * so what is under test is the sequence of interactions — pick a province, pick
 * a cantón, pick a district, then change your mind higher up — rather than a
 * snapshot of props.
 */
function Host({ onChange }: { onChange?: (next: AddressSelection) => void }) {
  const [value, setValue] = useState<AddressSelection>(emptyAddressSelection);
  return (
    <AdminAddressFields
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

const province = () => screen.getByLabelText("Provincia") as HTMLSelectElement;
const canton = () => screen.getByLabelText("Cantón") as HTMLSelectElement;
const district = () => screen.getByLabelText("Distrito") as HTMLSelectElement;

const districtOptions = () =>
  Array.from(district().options)
    .map((o) => o.value)
    .filter(Boolean);

const cantonOptions = () =>
  Array.from(canton().options)
    .map((o) => o.textContent)
    .filter(Boolean);

describe("AdminAddressFields — the province → cantón → distrito cascade", () => {
  it("offers the district as a select, never a free-text input", () => {
    render(<Host />);
    expect(district().tagName).toBe("SELECT");
  });

  it("disables the cantón until a province is chosen", () => {
    render(<Host />);
    expect(canton()).toBeDisabled();
  });

  it("disables the district until a cantón is chosen", () => {
    render(<Host />);
    expect(district()).toBeDisabled();
  });

  it("offers only the cantones of the chosen province", async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.selectOptions(province(), "7"); // Limón

    expect(cantonOptions()).toEqual([
      "— Selecciona —",
      "Limón",
      "Pococí",
      "Siquirres",
      "Talamanca",
      "Matina",
      "Guácimo",
    ]);
  });

  it("offers only the districts of the chosen cantón", async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.selectOptions(province(), "7");
    await user.selectOptions(canton(), "702"); // Pococí

    expect(district()).toBeEnabled();
    expect(districtOptions()).toEqual([
      "Guápiles",
      "Jiménez",
      "Rita",
      "Roxana",
      "Cariari",
      "Colorado",
      "La Colonia",
    ]);
    // A district of a DIFFERENT cantón is simply not on offer.
    expect(districtOptions()).not.toContain("Carmen");
  });

  it("resets the district when the cantón changes", async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.selectOptions(province(), "7");
    await user.selectOptions(canton(), "702");
    await user.selectOptions(district(), "Cariari");
    expect(district().value).toBe("Cariari");

    await user.selectOptions(canton(), "701"); // Limón

    expect(district().value).toBe("");
    expect(districtOptions()).not.toContain("Cariari");
  });

  it("resets both the cantón and the district when the province changes", async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.selectOptions(province(), "7");
    await user.selectOptions(canton(), "702");
    await user.selectOptions(district(), "Cariari");

    await user.selectOptions(province(), "1"); // San José

    expect(canton().value).toBe("");
    expect(district().value).toBe("");
    expect(district()).toBeDisabled();
  });

  it("reports the selection upward as one coherent value", async () => {
    const user = userEvent.setup();
    const changes: AddressSelection[] = [];
    render(<Host onChange={(next) => changes.push(next)} />);

    await user.selectOptions(province(), "1");
    await user.selectOptions(canton(), "101");
    await user.selectOptions(district(), "Carmen");

    expect(changes.at(-1)).toEqual({
      provinceCode: "1",
      cantonCode: "101",
      district: "Carmen",
    });
  });

  it("only ever yields a district that belongs to the cantón", async () => {
    const user = userEvent.setup();
    const changes: AddressSelection[] = [];
    render(<Host onChange={(next) => changes.push(next)} />);

    await user.selectOptions(province(), "1");
    await user.selectOptions(canton(), "101");

    // Every selectable value is a real district of cantón 101 — there is no
    // path through this UI that produces an arbitrary string.
    for (const option of districtOptions()) {
      await user.selectOptions(district(), option);
    }

    const districts = new Set(changes.map((c) => c.district).filter(Boolean));
    expect(districts.size).toBeGreaterThan(0);
    for (const name of districts) {
      expect(districtOptions()).toContain(name);
    }
  });
});
