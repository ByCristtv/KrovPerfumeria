import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import RankingBoard from "./RankingBoard";
import { getRankInfo } from "@/lib/rank";
import { TEST_LADDER, ladderWith } from "@/test/helpers/rankLadder";
import type { RankingEntry } from "@/types/ranking";

const entry = (
  position: number,
  username: string,
  experiencePoints: number,
  movement?: number | null,
  ladder = TEST_LADDER
): RankingEntry => {
  // What getTopRanking computes server-side from the configured ladder.
  const progress = getRankInfo(experiencePoints, ladder);
  return { position, username, experiencePoints, rank: progress.currentRank, progress, movement };
};

const full = [
  entry(1, "aurora", 21_400),
  entry(2, "alfredo", 12_000),
  entry(3, "maria", 9_650),
  entry(4, "master", 7_300),
  entry(5, "artisan", 5_400),
];

describe("RankingBoard", () => {
  it("keeps podium DOM order 1,2,3 and continues the count from 4", () => {
    render(<RankingBoard entries={full} />);
    const [podium, rest] = screen.getAllByRole("list");

    expect(within(podium).getAllByRole("listitem")).toHaveLength(3);
    expect(podium.textContent).toMatch(/1\. aurora.*2\. alfredo.*3\. maria/);
    expect(rest).toHaveAttribute("start", "4");
    expect(rest.textContent).toMatch(/4\. master.*5\. artisan/);
  });

  it("shows exact XP against the next rank threshold", () => {
    render(<RankingBoard entries={full} />);
    // alfredo: Alquimista (10,000) heading for Maestro (18,000)
    expect(screen.getByText(/12,000 XP/)).toBeInTheDocument();
    expect(screen.getByText(/\/ 18,000/)).toBeInTheDocument();
  });

  it("marks the top rank as maxed instead of inventing a next threshold", () => {
    render(<RankingBoard entries={full} />);
    expect(screen.getByText("Rango máximo")).toBeInTheDocument();
  });

  it("draws no list when there are only podium entries", () => {
    render(<RankingBoard entries={full.slice(0, 2)} />);
    expect(screen.getAllByRole("list")).toHaveLength(1);
  });

  describe("movement", () => {
    it("announces up, down and unchanged", () => {
      render(
        <RankingBoard
          entries={[
            entry(1, "a", 100, 2),
            entry(2, "b", 90, -1),
            entry(3, "c", 80, 0),
          ]}
        />
      );
      expect(screen.getByText("Subió 2 puestos")).toBeInTheDocument();
      expect(screen.getByText("Bajó 1 puesto")).toBeInTheDocument();
      expect(screen.getByText("Sin cambios")).toBeInTheDocument();
    });

    it("renders nothing when there is no previous-day comparison", () => {
      render(<RankingBoard entries={[entry(1, "a", 100), entry(2, "b", 90, null)]} />);
      expect(screen.queryByText(/Subió|Bajó|Sin cambios/)).toBeNull();
    });
  });

  it("measures progress against the ladder it was given (admin-changed thresholds)", () => {
    const ladder = ladderWith([0, 1_000, 5_000, 10_000, 25_000]);
    render(<RankingBoard entries={[entry(1, "aurora", 21_400, undefined, ladder)]} />);
    // 21,400 is no longer Maestro: the meter targets the moved 25,000 threshold.
    expect(screen.getByText(/\/ 25,000/)).toBeInTheDocument();
    expect(screen.queryByText("Rango máximo")).not.toBeInTheDocument();
  });
});
