import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }));
vi.mock("@/features/social/searchPublicUsers", () => ({
  searchPublicUsers: searchMock,
}));

import { useUserSearch } from "./useUserSearch";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    // Retries would turn the CASE 10 assertion into a timing race.
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const user = {
  userId: "u2",
  username: "aurora",
  avatarUrl: null,
  relationshipStatus: "none" as const,
};

describe("useUserSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    searchMock.mockResolvedValue([user]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("the minimum-length gate", () => {
    it("never searches for a term below the minimum", async () => {
      // CASE 8: the point of the gate is that NO request is made.
      const { rerender } = renderHook((q: string) => useUserSearch(q), {
        wrapper,
        initialProps: "a",
      });

      await vi.advanceTimersByTimeAsync(1000);
      rerender("");
      await vi.advanceTimersByTimeAsync(1000);

      expect(searchMock).not.toHaveBeenCalled();
    });

    it("reports the idle state before anything searchable is typed", () => {
      const { result } = renderHook(() => useUserSearch("a"), { wrapper });
      expect(result.current.isIdle).toBe(true);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.users).toEqual([]);
    });

    it("searches once the term is long enough", async () => {
      const { result } = renderHook(() => useUserSearch("au"), { wrapper });

      await vi.advanceTimersByTimeAsync(400);
      await waitFor(() => expect(result.current.users).toEqual([user]));
      expect(searchMock).toHaveBeenCalledWith("au");
      expect(result.current.isIdle).toBe(false);
    });
  });

  describe("debouncing", () => {
    it("collapses a burst of keystrokes into one request", async () => {
      // Starts empty, like the real search box: the debounce only skips the
      // wait for the value the hook MOUNTS with, which is "".
      const { rerender } = renderHook((q: string) => useUserSearch(q), {
        wrapper,
        initialProps: "",
      });

      for (const term of ["a", "au", "aur", "auro", "auror", "aurora"]) {
        await vi.advanceTimersByTimeAsync(50);
        rerender(term);
      }
      await vi.advanceTimersByTimeAsync(500);

      await waitFor(() => expect(searchMock).toHaveBeenCalledTimes(1));
      expect(searchMock).toHaveBeenCalledWith("aurora");
    });

    it("reports pending while typed and searched disagree", async () => {
      const { result, rerender } = renderHook((q: string) => useUserSearch(q), {
        wrapper,
        initialProps: "aurora",
      });

      await vi.advanceTimersByTimeAsync(500);
      await waitFor(() => expect(result.current.isPending).toBe(false));

      rerender("aurorab");
      expect(result.current.isPending).toBe(true);

      await vi.advanceTimersByTimeAsync(500);
      await waitFor(() => expect(result.current.isPending).toBe(false));
    });

    it("updates the results when the term changes", async () => {
      const { result, rerender } = renderHook((q: string) => useUserSearch(q), {
        wrapper,
        initialProps: "aurora",
      });

      await vi.advanceTimersByTimeAsync(500);
      await waitFor(() => expect(result.current.users).toEqual([user]));

      const other = { ...user, userId: "u3", username: "borealis" };
      searchMock.mockResolvedValue([other]);
      rerender("boreal");

      await vi.advanceTimersByTimeAsync(500);
      await waitFor(() => expect(result.current.users).toEqual([other]));
      expect(searchMock).toHaveBeenLastCalledWith("boreal");
    });

    it("treats a padded term as the same search", async () => {
      const { rerender } = renderHook((q: string) => useUserSearch(q), {
        wrapper,
        initialProps: "aurora",
      });
      await vi.advanceTimersByTimeAsync(500);

      rerender("  aurora  ");
      await vi.advanceTimersByTimeAsync(500);

      expect(searchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("failure", () => {
    it("surfaces an error state instead of throwing through the component", async () => {
      // CASE 10.
      searchMock.mockRejectedValue(new Error("rpc down"));
      const { result } = renderHook(() => useUserSearch("aurora"), { wrapper });

      await vi.advanceTimersByTimeAsync(500);
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.users).toEqual([]);
    });
  });

  describe("no matches", () => {
    it("reports an empty, non-error result", async () => {
      // CASE 9.
      searchMock.mockResolvedValue([]);
      const { result } = renderHook(() => useUserSearch("zzzz"), { wrapper });

      await vi.advanceTimersByTimeAsync(500);
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.users).toEqual([]);
      expect(result.current.isError).toBe(false);
      expect(result.current.isIdle).toBe(false);
    });
  });
});
