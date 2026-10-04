import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FriendsPortalTabs from "./FriendsPortalTabs";

const setup = (requestCount = 0, value: "friends" | "requests" | "search" = "friends") => {
  const onChange = vi.fn();
  render(<FriendsPortalTabs value={value} onChange={onChange} requestCount={requestCount} />);
  return onChange;
};

const tab = (name: RegExp) => screen.getByRole("radio", { name });

describe("FriendsPortalTabs", () => {
  it("offers the three sections as one radio group", () => {
    setup();
    expect(screen.getByRole("group", { name: /secciones de tu portal social/i })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("marks only the current section as checked", () => {
    setup(0, "requests");
    expect(tab(/amigos/i)).not.toBeChecked();
    expect(tab(/solicitudes/i)).toBeChecked();
    expect(tab(/buscar/i)).not.toBeChecked();
  });

  it("reports a change of section", async () => {
    const onChange = setup();
    await userEvent.setup().click(tab(/buscar/i));
    expect(onChange).toHaveBeenCalledWith("search");
  });

  describe("the active segment is glass, not a solid brand fill", () => {
    it("has no solid magenta background", () => {
      setup();
      const label = tab(/amigos/i).closest("label")!;
      expect(label.className).not.toMatch(/(^|\s)bg-krov-blood(\s|$)/);
      expect(label.className).toMatch(/bg-white\/\[0\.08\]/);
      expect(label.className).toMatch(/border-white\/15/);
    });

    it("shows the glowing underline only on the active segment", () => {
      setup();
      const underline = (name: RegExp) =>
        tab(name).closest("label")!.querySelector("span[aria-hidden].h-px");
      expect(underline(/amigos/i)).toHaveClass("opacity-100");
      expect(underline(/buscar/i)).toHaveClass("opacity-0");
    });
  });

  describe("the pending-requests badge", () => {
    it("is absent with no pending requests", () => {
      setup(0);
      expect(tab(/solicitudes/i).closest("label")).not.toHaveTextContent("0");
      expect(screen.queryByText(/pendiente/i)).not.toBeInTheDocument();
    });

    it("shows the count on Solicitudes, whichever tab is active", () => {
      setup(2, "friends");
      expect(tab(/solicitudes/i).closest("label")).toHaveTextContent("2");
    });

    it("is restated for screen readers instead of read as a bare numeral", () => {
      setup(2);
      expect(tab(/solicitudes/i)).toHaveAccessibleName(/2 pendientes/i);
    });

    it("uses the singular for one", () => {
      setup(1);
      expect(tab(/solicitudes/i)).toHaveAccessibleName(/1 pendiente\b/i);
    });

    it("keeps its ping animation motion-gated", () => {
      setup(3);
      const ping = tab(/solicitudes/i).closest("label")!.querySelector(".motion-safe\\:animate-ping");
      expect(ping).toBeInTheDocument();
    });
  });
});
