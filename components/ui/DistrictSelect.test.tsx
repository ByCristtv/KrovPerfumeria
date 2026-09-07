import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import DistrictSelect from "./DistrictSelect";

/**
 * A minimal host that owns the cantón/district pair the way both real forms do,
 * so the cascade is exercised as state transitions rather than as prop snapshots.
 */
function Host({
  initialCanton = "",
  initialDistrict = "",
  onDistrictChange,
}: {
  initialCanton?: string;
  initialDistrict?: string;
  onDistrictChange?: (value: string) => void;
}) {
  const [canton, setCanton] = useState(initialCanton);
  const [district, setDistrict] = useState(initialDistrict);

  return (
    <>
      <label htmlFor="canton">Cantón</label>
      <select
        id="canton"
        value={canton}
        onChange={(e) => {
          setCanton(e.target.value);
          // The rule both real forms implement: a new cantón invalidates the
          // district below it.
          setDistrict("");
        }}
      >
        <option value="">—</option>
        <option value="702">Pococí</option>
        <option value="101">San José</option>
        <option value="401">Heredia</option>
      </select>

      <label htmlFor="district">Distrito</label>
      <DistrictSelect
        id="district"
        cantonCode={canton}
        value={district}
        onChange={(value) => {
          setDistrict(value);
          onDistrictChange?.(value);
        }}
      />
    </>
  );
}

const districtField = () =>
  screen.getByLabelText("Distrito") as HTMLSelectElement;

const optionLabels = () =>
  Array.from(districtField().options).map((o) => o.textContent);

describe("DistrictSelect — before a cantón is chosen", () => {
  it("is disabled", () => {
    render(<Host />);
    expect(districtField()).toBeDisabled();
  });

  it("says which field to fill first rather than showing an empty list", () => {
    render(<Host />);
    expect(optionLabels()).toEqual(["Selecciona el cantón primero"]);
  });
});

describe("DistrictSelect — cascading from the cantón", () => {
  it("offers only the chosen cantón's districts", async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.selectOptions(screen.getByLabelText("Cantón"), "702");

    expect(districtField()).toBeEnabled();
    expect(optionLabels()).toContain("Cariari");
    expect(optionLabels()).toContain("Guápiles");
    expect(optionLabels()).not.toContain("Carmen");
  });

  it("swaps the options when the cantón changes", async () => {
    const user = userEvent.setup();
    render(<Host />);
    const cantonField = screen.getByLabelText("Cantón");

    await user.selectOptions(cantonField, "702");
    expect(optionLabels()).toContain("Cariari");

    await user.selectOptions(cantonField, "101");
    expect(optionLabels()).not.toContain("Cariari");
    expect(optionLabels()).toContain("Carmen");
  });

  it("clears a district that belonged to the previous cantón", async () => {
    const user = userEvent.setup();
    render(<Host initialCanton="702" initialDistrict="Cariari" />);

    expect(districtField()).toHaveValue("Cariari");

    await user.selectOptions(screen.getByLabelText("Cantón"), "101");

    // The regression this guards: keeping "Cariari" selected under San José,
    // which would submit an address that does not exist.
    expect(districtField()).toHaveValue("");
  });

  it("reports the selected district by name", async () => {
    const onDistrictChange = vi.fn();
    const user = userEvent.setup();
    render(<Host initialCanton="702" onDistrictChange={onDistrictChange} />);

    await user.selectOptions(districtField(), "Cariari");

    expect(onDistrictChange).toHaveBeenCalledWith("Cariari");
  });
});

describe("DistrictSelect — a saved value arriving from a profile", () => {
  it("preselects a district that matches the cantón", () => {
    render(<Host initialCanton="702" initialDistrict="Cariari" />);
    expect(districtField()).toHaveValue("Cariari");
  });

  it("preselects despite differences in case and accents", () => {
    render(<Host initialCanton="101" initialDistrict="san sebastian" />);
    // Canonicalised to the dataset's spelling, not left as an unknown value.
    expect(districtField()).toHaveValue("San Sebastián");
    expect(optionLabels()).not.toContain("san sebastian (no reconocido)");
  });

  it("keeps an unrecognised legacy value visible instead of dropping it", () => {
    render(<Host initialCanton="702" initialDistrict="Barrio Los Ángeles" />);

    // Silently falling back to "" would rewrite the customer's stored address
    // the next time they saved the form.
    expect(districtField()).toHaveValue("Barrio Los Ángeles");
    expect(optionLabels()).toContain("Barrio Los Ángeles (no reconocido)");
  });

  it("flags a district saved under a different cantón as unrecognised", () => {
    render(<Host initialCanton="401" initialDistrict="Cariari" />);
    expect(optionLabels()).toContain("Cariari (no reconocido)");
  });

  it("lets the customer replace an unrecognised value with a real district", async () => {
    const user = userEvent.setup();
    render(<Host initialCanton="702" initialDistrict="Barrio Los Ángeles" />);

    await user.selectOptions(districtField(), "Cariari");

    expect(districtField()).toHaveValue("Cariari");
  });
});

describe("DistrictSelect — a cantón with no districts on record", () => {
  it("disables the field and says so, rather than showing an empty menu", () => {
    // Not reachable from the real dataset today (every cantón has districts),
    // but the accessor can legitimately return none, and the field must degrade
    // rather than look broken.
    render(
      <DistrictSelect cantonCode="999" value="" onChange={() => {}} />
    );
    const field = screen.getByRole("combobox") as HTMLSelectElement;
    expect(field).toBeDisabled();
    expect(Array.from(field.options).map((o) => o.textContent)).toEqual([
      "No hay distritos para este cantón",
    ]);
  });
});
