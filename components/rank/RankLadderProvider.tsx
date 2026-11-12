"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { RankLadder } from "@/lib/rank";

/**
 * Hands the rank ladder (loaded from `public.levels` by the root layout) to
 * every client component, so ranks computed in the browser use exactly the
 * thresholds the database and the server use — there is no ladder in the
 * client bundle to drift.
 *
 * `null` means "the ladder could not be loaded": components then render
 * without a rank (XP still shows) instead of guessing one.
 */
const RankLadderContext = createContext<RankLadder | null>(null);

export default function RankLadderProvider({
  ladder,
  children,
}: {
  ladder: RankLadder | null;
  children: ReactNode;
}) {
  return <RankLadderContext.Provider value={ladder}>{children}</RankLadderContext.Provider>;
}

/** The configured ladder, or null while unavailable. */
export function useRankLadder(): RankLadder | null {
  return useContext(RankLadderContext);
}
