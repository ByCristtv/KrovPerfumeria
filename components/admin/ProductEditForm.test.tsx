import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getProductForEdit: vi.fn(),
  updateProduct: vi.fn(),
  notifyHomepageOffers: vi.fn(),
}));

vi.mock("@/features/admin/updateProduct", () => ({
  getProductForEdit: m.getProductForEdit,
  updateProduct: m.updateProduct,
}));
vi.mock("@/features/admin/notifyHomepageOffers", () => ({
  notifyHomepageOffers: m.notifyHomepageOffers,
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    data: [
      { id: "c-arabe", name: "Árabe", slug: "arabe" },
      { id: "c-hombre", name: "Hombre", slug: "hombre" },
    ],
  }),
}));
vi.mock("@/hooks/useBrands", () => ({ useBrands: () => ({ data: [] }) }));
vi.mock("sweetalert2", () => ({ default: { fire: vi.fn() } }));
vi.mock("@/components/admin/ProductImagesManager", () => ({ default: () => null }));
vi.mock("@/components/admin/ui/AdminSelect", () => ({
  default: (props: { options: { label: string }[] }) => (
    <ul data-testid={`select-${props.options.length}`}>
      {props.options.map((o) => (
        <li key={o.label}>{o.label}</li>
      ))}
    </ul>
  ),
}));

import ProductEditForm from "./ProductEditForm";

const PRODUCT = "44444444-4444-4444-8444-444444444444";

function loadProduct(variant: Record<string, unknown> = {}) {
  m.getProductForEdit.mockResolvedValue({
    product: {
      name: "Khamrah",
      brand_id: "b-1",
      description: "Dulce",
      notes_top: "",
      notes_middle: "",
      notes_base: "",
      gender: "unisex",
      concentration: "EDP",
    },
    variant: {
      is_active: true,
      sku: "KH-100",
      price: 30000,
      stock: 3,
      size_ml: 100,
      product_type: "full_size",
      is_on_offer: true,
      offer_price: 25000,
      wholesale_price: null,
      min_wholesale_quantity: null,
      ...variant,
    },
    category_ids: ["c-arabe"],
  });
}

async function renderForm() {
  const client = new QueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <ProductEditForm productId={PRODUCT} variantId="v-1" />
    </QueryClientProvider>
  );
  await screen.findByPlaceholderText("Notas de Salida");
  return view;
}

async function submit(container: HTMLElement) {
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() => expect(m.updateProduct).toHaveBeenCalled());
}

describe("ProductEditForm → homepage revalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.updateProduct.mockResolvedValue(undefined);
    loadProduct();
  });

  it("a changed promotional price asks to revalidate the homepage offers", async () => {
    const { container } = await renderForm();

    fireEvent.change(screen.getByPlaceholderText("Precio Oferta"), {
      target: { value: "22000" },
    });
    await submit(container);

    expect(m.notifyHomepageOffers).toHaveBeenCalledWith({ scope: "offers" });
  });

  it("an unrelated edit (olfactory notes) does not", async () => {
    const { container } = await renderForm();

    fireEvent.change(screen.getByPlaceholderText("Notas de Salida"), {
      target: { value: "Canela" },
    });
    await submit(container);

    // The classifier's `null` is passed through and is a no-op.
    expect(m.notifyHomepageOffers).toHaveBeenCalledWith(null);
  });

  it("a renamed product asks the server to check its offers", async () => {
    loadProduct({ is_on_offer: false, offer_price: null });
    const { container } = await renderForm();

    fireEvent.change(screen.getByDisplayValue("Khamrah"), { target: { value: "Khamrah Qahwa" } });
    await submit(container);

    expect(m.notifyHomepageOffers).toHaveBeenCalledWith({ scope: "product", productId: PRODUCT });
  });

  it("offers commercial categories only — gender is the Género field", async () => {
    await renderForm();

    expect(screen.getByText("Árabe")).toBeInTheDocument();
    expect(screen.queryByText("Hombre")).toBeNull();
  });
});
