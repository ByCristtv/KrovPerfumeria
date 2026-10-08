import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LOCAL_DELIVERY_AREA } from "@/lib/shipping/localDelivery";
import { LANDINGS } from "@/lib/seo/landings";
import { SHOP_LINKS } from "@/components/layout/footer/footerData";
import LocalDelivery from "./LocalDelivery";

describe("LocalDelivery", () => {
  it("states where the shop is, using the same place the delivery rule names", () => {
    render(<LocalDelivery />);
    const heading = screen.getByRole("heading", { level: 2 });

    expect(heading).toHaveTextContent(
      `${LOCAL_DELIVERY_AREA.districtName} de ${LOCAL_DELIVERY_AREA.cantonName}`
    );
    expect(heading).toHaveTextContent("envíos a todo Costa Rica");
  });

  it("only promises what checkout enforces: free in Cariari centro, zone rate elsewhere", () => {
    const { container } = render(<LocalDelivery />);
    const text = container.textContent ?? "";

    expect(text).toContain(`${LOCAL_DELIVERY_AREA.districtName} centro, la entrega de tu pedido es gratis`);
    expect(text).toContain("el costo depende de tu zona");
    expect(text).toContain("tarjeta o SINPE Móvil");
  });

  it("links to the catalog and both landings with descriptive anchor text", () => {
    render(<LocalDelivery />);

    expect(screen.getByRole("link", { name: "perfumes originales" })).toHaveAttribute("href", "/products");
    expect(screen.getByRole("link", { name: "perfumes árabes" })).toHaveAttribute(
      "href",
      LANDINGS["perfumes-arabes"].path
    );
    expect(screen.getByRole("link", { name: "decant" })).toHaveAttribute("href", LANDINGS.decants.path);
  });
});

describe("footer shop links", () => {
  it("pass a crawlable link to every landing from every page", () => {
    const hrefs = SHOP_LINKS.map((link) => link.href);
    for (const landing of Object.values(LANDINGS)) {
      expect(hrefs).toContain(landing.path);
    }
    expect(hrefs).toContain("/products");
  });
});
