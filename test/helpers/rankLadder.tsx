import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import RankLadderProvider from "@/components/rank/RankLadderProvider";
import { parseRankLadder, type RankLadder } from "@/lib/rank";

/**
 * Test ladder rows — the values seeded by migration 20261005000100 (and still
 * live on TESTING). Tests build every expectation from this fixture, never
 * from a production constant: the real thresholds live only in public.levels.
 */
export const SEED_LEVEL_ROWS = [
  { level_number: 1, name: "Aficionado", required_xp: 0 },
  { level_number: 2, name: "Coleccionista", required_xp: 1_000 },
  { level_number: 3, name: "Conocedor", required_xp: 5_000 },
  { level_number: 4, name: "Alquimista", required_xp: 10_000 },
  { level_number: 5, name: "Maestro", required_xp: 18_000 },
] as const;

export const TEST_LADDER: RankLadder = parseRankLadder([...SEED_LEVEL_ROWS]);

/** A ladder with every threshold replaced, in level order. */
export function ladderWith(thresholds: readonly number[]): RankLadder {
  return parseRankLadder(
    SEED_LEVEL_ROWS.map((row, i) => ({ ...row, required_xp: thresholds[i] }))
  );
}

/** Render inside the provider the root layout mounts. */
export function renderWithLadder(
  ui: ReactElement,
  ladder: RankLadder | null = TEST_LADDER,
  options?: Omit<RenderOptions, "wrapper">
) {
  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <RankLadderProvider ladder={ladder}>{children}</RankLadderProvider>
    ),
    ...options,
  });
}
