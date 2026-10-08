import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import CatalogHero from "./CatalogHero";
import CatalogLinks from "./CatalogLinks";

describe("CatalogHero", () => {
  it("gives the catalog its one <h1> by default", () => {
    render(<CatalogHero />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Perfumes originales en Costa Rica");
  });

  it("renders the loading skeleton's title WITHOUT a heading", () => {
    // The skeleton streams as the Suspense fallback for every /products/* route;
    // a real <h1> would end up in each product page's initial HTML.
    const { container } = render(<CatalogHero asHeading={false} />);
    expect(container.querySelector("h1")).toBeNull();
    expect(container).toHaveTextContent("Perfumes originales en Costa Rica");
  });

  it("shows an intro only when given one", () => {
    const { rerender } = render(<CatalogHero />);
    expect(document.querySelectorAll("section p").length).toBe(1); // just the eyebrow

    rerender(<CatalogHero intro="Selección de perfumes árabes." />);
    expect(screen.getByText("Selección de perfumes árabes.")).toBeInTheDocument();
  });

  it("renders a breadcrumb whose last item is the current page, not a link", () => {
    render(
      <CatalogHero
        title="Decants"
        crumbs={[{ label: "KROV", href: "/" }, { label: "Decants" }]}
      />
    );
    const nav = screen.getByRole("navigation", { name: "Migas" });

    expect(nav.querySelector('a[href="/"]')).toHaveTextContent("KROV");
    expect(nav.querySelectorAll("a")).toHaveLength(1);
    expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent("Decants");
  });

  it("has no breadcrumb when none is given", () => {
    render(<CatalogHero />);
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});

describe("CatalogLinks", () => {
  it("renders crawlable links with real anchor text", () => {
    render(
      <CatalogLinks
        heading="Sigue explorando"
        links={[
          { href: "/decants", label: "Decants" },
          { href: "/products", label: "Ver todo el catálogo" },
        ]}
      />
    );
    expect(screen.getByRole("link", { name: "Decants" })).toHaveAttribute("href", "/decants");
    expect(screen.getByRole("link", { name: "Ver todo el catálogo" })).toHaveAttribute(
      "href",
      "/products"
    );
  });

  it("renders nothing when there are no links", () => {
    const { container } = render(<CatalogLinks heading="x" links={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
