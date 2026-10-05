import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RewardsRoadmap from "./RewardsRoadmap";

/**
 * Renders the roadmap for a given XP balance. `null` is the signed-out visitor.
 */
const renderRoadmap = (experiencePoints: number | null) =>
  render(<RewardsRoadmap experiencePoints={experiencePoints} />);

/** The rail's tier buttons, in ladder order. */
const tiers = () => screen.getAllByRole("button");

const tier = (rank: string) =>
  tiers().find((button) => within(button).queryByText(rank) !== null)!;

/** The tier whose full terms the detail panel is currently showing. */
const detailRank = () => screen.getByTestId("roadmap-detail-rank").textContent;

/** The named detail region — the roadmap section is a region too. */
const detailPanel = () =>
  screen.getByRole("region", { name: /detalle de la recompensa/i });

/** The viewer's own progress block, above the rail. */
const progressBlock = () => screen.getByTestId("viewer-progress");

describe("RewardsRoadmap — the ladder", () => {
  it("renders every rank, in ascending order", () => {
    renderRoadmap(0);
    expect(tiers().map((b) => within(b).getAllByText(/\w/)[0].textContent)).toEqual(
      ["Aficionado", "Coleccionista", "Conocedor", "Alquimista", "Maestro"]
    );
  });

  it("shows each tier's XP range", () => {
    renderRoadmap(0);
    expect(within(tier("Aficionado")).getByText("0 – 999 XP")).toBeInTheDocument();
    expect(
      within(tier("Coleccionista")).getByText("1,000 – 4,999 XP")
    ).toBeInTheDocument();
    expect(within(tier("Conocedor")).getByText("5,000 – 9,999 XP")).toBeInTheDocument();
    expect(
      within(tier("Alquimista")).getByText("10,000 – 17,999 XP")
    ).toBeInTheDocument();
  });

  it("shows the top tier as open-ended rather than inventing a ceiling", () => {
    renderRoadmap(0);
    expect(within(tier("Maestro")).getByText("18,000+ XP")).toBeInTheDocument();
  });

  it("summarizes each tier's reward on the rail", () => {
    renderRoadmap(0);
    expect(within(tier("Aficionado")).getByText("Sin recompensa")).toBeInTheDocument();
    expect(within(tier("Coleccionista")).getByText("5% de descuento")).toBeInTheDocument();
    expect(within(tier("Conocedor")).getByText("8% de descuento")).toBeInTheDocument();
    expect(within(tier("Alquimista")).getByText("12% de descuento")).toBeInTheDocument();
    expect(within(tier("Maestro")).getByText("18% de descuento")).toBeInTheDocument();
  });
});

describe("RewardsRoadmap — the viewer's tier", () => {
  it.each([
    [0, "Aficionado"],
    [999, "Aficionado"],
    [1_000, "Coleccionista"],
    [4_999, "Coleccionista"],
    [5_000, "Conocedor"],
    [9_999, "Conocedor"],
    [10_000, "Alquimista"],
    [17_999, "Alquimista"],
    [18_000, "Maestro"],
    [64_000, "Maestro"],
  ])("marks %i XP as the %s step", (xp, rank) => {
    renderRoadmap(xp);
    const current = tiers().filter(
      (button) => button.getAttribute("aria-current") === "step"
    );
    expect(current).toHaveLength(1);
    expect(within(current[0]).getByText(rank)).toBeInTheDocument();
  });

  it("badges passed tiers as unlocked and future tiers as locked", () => {
    renderRoadmap(12_000);
    expect(within(tier("Coleccionista")).getByText("Desbloqueado")).toBeInTheDocument();
    expect(within(tier("Conocedor")).getByText("Desbloqueado")).toBeInTheDocument();
    expect(within(tier("Alquimista")).getByText("Tu rango")).toBeInTheDocument();
    expect(within(tier("Maestro")).getByText("Bloqueado")).toBeInTheDocument();
  });

  it("opens on the viewer's own tier", () => {
    renderRoadmap(6_500);
    expect(detailRank()).toBe("Conocedor");
  });
});

describe("RewardsRoadmap — progress toward the next reward", () => {
  it("names the next rank and the XP still needed", () => {
    renderRoadmap(4_000);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-label", "Progreso hacia Conocedor");
    expect(within(progressBlock()).getByText("1,000 XP")).toBeInTheDocument();
  });

  it("names the reward being worked toward, not just the rank", () => {
    renderRoadmap(4_000);
    // Scoped to the progress block: "8% de descuento" also appears on the Conocedor
    // node of the rail, and matching that one would prove nothing.
    expect(
      within(progressBlock()).getByText(/8% de descuento/)
    ).toBeInTheDocument();
  });

  it("reports partial progress through the current tier", () => {
    // 2,000 XP is 1,000 into Coleccionista's 4,000-wide band → 25%.
    renderRoadmap(2_000);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "25"
    );
  });

  it("reports a full bar and no next rank at the top", () => {
    renderRoadmap(20_000);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(bar).toHaveAttribute("aria-label", "Rango máximo alcanzado");
    expect(screen.getByText(/Alcanzaste el rango máximo/)).toBeInTheDocument();
  });

  it("tells a locked tier's cost from where the viewer actually stands", async () => {
    const user = userEvent.setup();
    renderRoadmap(2_000);

    await user.click(tier("Maestro"));

    // 18,000 − 2,000, not 18,000 and not the next-rank delta.
    expect(within(detailPanel()).getByText("16,000 XP")).toBeInTheDocument();
  });
});

describe("RewardsRoadmap — the signed-out visitor", () => {
  it("still renders the full ladder", () => {
    renderRoadmap(null);
    expect(tiers()).toHaveLength(5);
  });

  it("highlights no tier as current", () => {
    renderRoadmap(null);
    expect(
      tiers().some((button) => button.getAttribute("aria-current") === "step")
    ).toBe(false);
  });

  it("shows no personal progress bar", () => {
    renderRoadmap(null);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("badges nothing as unlocked or locked, since neither is known", () => {
    renderRoadmap(null);
    expect(screen.queryByText("Desbloqueado")).not.toBeInTheDocument();
    expect(screen.queryByText("Bloqueado")).not.toBeInTheDocument();
    expect(screen.queryByText("Tu rango")).not.toBeInTheDocument();
  });

  it("opens on the first tier that actually carries a reward", () => {
    renderRoadmap(null);
    expect(detailRank()).toBe("Coleccionista");
  });
});

describe("RewardsRoadmap — selecting a tier", () => {
  it("swaps the detail panel to the chosen tier", async () => {
    const user = userEvent.setup();
    renderRoadmap(0);

    await user.click(tier("Maestro"));
    expect(detailRank()).toBe("Maestro");

    await user.click(tier("Alquimista"));
    expect(detailRank()).toBe("Alquimista");
  });

  it("shows the chosen tier's full terms, including the amounts", async () => {
    const user = userEvent.setup();
    renderRoadmap(0);

    await user.click(tier("Alquimista"));
    const detail = within(detailPanel()).getByText(/12% de descuento/);
    expect(detail).toHaveTextContent(/compra mínima de/i);

    await user.click(tier("Maestro"));
    expect(
      within(detailPanel()).getByText(/18% de descuento/)
    ).toHaveTextContent(/compra mínima de/i);
  });

  it("marks exactly one tier as pressed at a time", async () => {
    const user = userEvent.setup();
    renderRoadmap(0);

    await user.click(tier("Conocedor"));

    const pressed = tiers().filter(
      (button) => button.getAttribute("aria-pressed") === "true"
    );
    expect(pressed).toHaveLength(1);
    expect(within(pressed[0]).getByText("Conocedor")).toBeInTheDocument();
  });

  it("keeps every tier reachable from the keyboard", async () => {
    const user = userEvent.setup();
    renderRoadmap(0);

    tier("Maestro").focus();
    await user.keyboard("{Enter}");

    expect(detailRank()).toBe("Maestro");
  });
});
