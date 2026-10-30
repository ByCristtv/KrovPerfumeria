import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeVariant } from "@/test/helpers/seoFixtures";
import VariantSelector from "./VariantSelector";

const inStock = makeVariant({ id: "in", size_ml: 100, stock: 4 });
const madeToOrder = makeVariant({ id: "mto", size_ml: 50, stock: 0, supplier_available: true });
const soldOut = makeVariant({ id: "out", size_ml: 30, stock: 0, supplier_available: false });
const unverified = makeVariant({ id: "unv", size_ml: 10, stock: 0 }); // flag absent

function setup(poolMl = 0, selectedId = "in") {
  const onSelect = vi.fn();
  render(
    <VariantSelector
      variants={[inStock, madeToOrder, soldOut, unverified]}
      selectedId={selectedId}
      onSelect={onSelect}
      decantPoolMl={poolMl}
    />
  );
  return onSelect;
}

const size = (ml: number) => screen.getByRole("button", { name: new RegExp(`^${ml} ml`) });

describe("VariantSelector availability", () => {
  it("keeps a made-to-order size selectable and tags it 'Por encargo'", () => {
    const onSelect = setup();

    expect(size(50)).toBeEnabled();
    expect(size(50)).toHaveTextContent("Por encargo");

    fireEvent.click(size(50));
    expect(onSelect).toHaveBeenCalledWith(madeToOrder);
  });

  it("disables a sold-out size and tags it 'Agotado'", () => {
    const onSelect = setup();

    expect(size(30)).toBeDisabled();
    expect(size(30)).toHaveTextContent("Agotado");

    fireEvent.click(size(30));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("treats a size whose supplier flag is missing as sold out, not made to order", () => {
    setup();
    expect(size(10)).toBeDisabled();
    expect(size(10)).toHaveTextContent("Agotado");
    expect(size(10)).not.toHaveTextContent("Por encargo");
  });

  it("leaves an in-stock size enabled with no availability tag", () => {
    setup();
    expect(size(100)).toBeEnabled();
    expect(size(100)).not.toHaveTextContent("Agotado");
    expect(size(100)).not.toHaveTextContent("Por encargo");
  });

  it("decants follow the shared pool only, never the supplier flag", () => {
    const decantFlagged = makeVariant({
      id: "dec",
      size_ml: 5,
      stock: 0,
      product_type: "decant",
      supplier_available: true, // illegal in the DB; must still be ignored
    });
    const onSelect = vi.fn();
    const { rerender } = render(
      <VariantSelector
        variants={[decantFlagged]}
        selectedId=""
        onSelect={onSelect}
        decantPoolMl={0}
      />
    );

    expect(size(5)).toBeDisabled();
    expect(size(5)).toHaveTextContent("Agotado");
    expect(size(5)).not.toHaveTextContent("Por encargo");

    rerender(
      <VariantSelector
        variants={[decantFlagged]}
        selectedId=""
        onSelect={onSelect}
        decantPoolMl={20}
      />
    );
    expect(size(5)).toBeEnabled();
  });
});
