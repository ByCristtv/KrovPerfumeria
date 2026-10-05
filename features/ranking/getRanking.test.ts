import { describe, it, expect, vi, beforeEach } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ supabase: { rpc: rpcMock } }));

import { getTopRanking } from "./getRanking";
import { RANKING_TOP_COUNT } from "@/types/ranking";

type Row = {
  rank_position: number;
  username: string;
  experience_points: number;
};

function rows(...values: Array<[number, string, number]>): Row[] {
  return values.map(([rank_position, username, experience_points]) => ({
    rank_position,
    username,
    experience_points,
  }));
}

describe("getTopRanking", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks the database for the top 10 by default", () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    void getTopRanking();
    expect(rpcMock).toHaveBeenCalledWith("get_ranking_top", {
      p_limit: RANKING_TOP_COUNT,
    });
  });

  it("derives each entry's rank from the shared XP thresholds", async () => {
    // One entry per tier, so a change to RANK_THRESHOLDS surfaces here rather
    // than silently relabelling the leaderboard.
    rpcMock.mockResolvedValue({
      data: rows(
        [1, "parfum_user", 18_000],
        [2, "edp_user", 10_000],
        [3, "edt_user", 5_000],
        [4, "cologne_user", 1_000],
        [5, "fraiche_user", 0]
      ),
      error: null,
    });

    const result = await getTopRanking();

    expect(result.status).toBe("ok");
    expect(result.status === "ok" && result.entries.map((e) => e.rank)).toEqual([
      "Maestro",
      "Alquimista",
      "Conocedor",
      "Coleccionista",
      "Aficionado",
    ]);
  });

  it("uses the position the database computed, not the array index", async () => {
    // Guards the tie-break contract: ordering and numbering are the RPC's job.
    rpcMock.mockResolvedValue({
      data: rows([1, "a", 500], [2, "b", 500], [3, "c", 500]),
      error: null,
    });

    const result = await getTopRanking();

    expect(result.status === "ok" && result.entries.map((e) => e.position)).toEqual([
      1, 2, 3,
    ]);
  });

  it("preserves the order the database returned", async () => {
    rpcMock.mockResolvedValue({
      data: rows([1, "top", 9_000], [2, "mid", 3_000], [3, "low", 10]),
      error: null,
    });

    const result = await getTopRanking();

    expect(result.status === "ok" && result.entries.map((e) => e.username)).toEqual([
      "top",
      "mid",
      "low",
    ]);
  });

  it("exposes only position, username, XP and rank", async () => {
    rpcMock.mockResolvedValue({
      data: rows([1, "aurora", 2_400]),
      error: null,
    });

    const result = await getTopRanking();

    expect(result.status === "ok" && result.entries[0]).toEqual({
      position: 1,
      username: "aurora",
      experiencePoints: 2_400,
      rank: "Coleccionista",
    });
  });

  it("returns an empty board when nobody has opted in", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const result = await getTopRanking();
    expect(result).toEqual({ status: "ok", entries: [] });
  });

  it("treats a null payload as an empty board", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const result = await getTopRanking();
    expect(result).toEqual({ status: "ok", entries: [] });
  });

  it("reports an error state without throwing or leaking the message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'relation "profiles" does not exist' },
    });

    const result = await getTopRanking();

    expect(result).toEqual({ status: "error" });
    // The detail belongs in the server log, not in the returned value.
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("passes an explicit limit through", () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    void getTopRanking(3);
    expect(rpcMock).toHaveBeenCalledWith("get_ranking_top", { p_limit: 3 });
  });
});
