import { describe, expect, it, vi, beforeEach, type MockInstance } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useSocialMutation } from "./useSocialMutation";
import { socialKeys } from "@/lib/social/queryKeys";

/**
 * The shared mutation wrapper: invalidation on success, normalization on
 * failure, and — the subtle one — invalidation on a STALE failure too, which is
 * what lets the UI recover from somebody else acting first.
 */
let client: QueryClient;
let invalidateSpy: MockInstance<QueryClient["invalidateQueries"]>;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const invalidatedKeys = () =>
  invalidateSpy.mock.calls.map((call) => {
    const queryKey = call[0]?.queryKey as readonly string[] | undefined;
    return (queryKey ?? []).join("/");
  });

describe("useSocialMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    invalidateSpy = vi.spyOn(client, "invalidateQueries");
  });

  describe("on success", () => {
    it("invalidates exactly the caches that mutation makes stale", async () => {
      const { result } = renderHook(
        () =>
          useSocialMutation<string, string>({
            mutation: "acceptRequest",
            mutationFn: async () => "friendship-1",
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.mutateAsync("req-1");
      });

      expect(invalidatedKeys().sort()).toEqual(
        [
          socialKeys.searches().join("/"),
          socialKeys.receivedRequests().join("/"),
          socialKeys.friends().join("/"),
        ].sort()
      );
    });

    it("never invalidates the whole cache", async () => {
      const { result } = renderHook(
        () =>
          useSocialMutation<string, void>({
            mutation: "sendRequest",
            mutationFn: async () => {},
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.mutateAsync("u2");
      });

      // An argument-less invalidateQueries() would nuke the catalog and cart.
      for (const call of invalidateSpy.mock.calls) {
        expect(call[0]).toHaveProperty("queryKey");
      }
      expect(invalidatedKeys()).not.toContain("");
    });

    it("leaves the friends list alone when a request is rejected", async () => {
      const { result } = renderHook(
        () =>
          useSocialMutation<string, void>({
            mutation: "rejectRequest",
            mutationFn: async () => {},
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.mutateAsync("req-1");
      });

      expect(invalidatedKeys()).not.toContain(socialKeys.friends().join("/"));
    });

    it("reports success upward", async () => {
      const onSuccess = vi.fn();
      const { result } = renderHook(
        () =>
          useSocialMutation<string, string>({
            mutation: "sendRequest",
            mutationFn: async () => "req-1",
            onSuccess,
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.mutateAsync("u2");
      });

      expect(onSuccess).toHaveBeenCalledWith("req-1", "u2");
    });
  });

  describe("on failure (CASE 12)", () => {
    it("hands the caller a normalized Spanish error, not the raw one", async () => {
      const onError = vi.fn();
      const { result } = renderHook(
        () =>
          useSocialMutation<string, void>({
            mutation: "sendRequest",
            mutationFn: async () => {
              throw new Error("cannot_add_yourself");
            },
            onError,
          }),
        { wrapper }
      );

      act(() => result.current.mutate("u2"));
      await waitFor(() => expect(onError).toHaveBeenCalled());

      const [error] = onError.mock.calls[0];
      expect(error.code).toBe("cannot_add_yourself");
      expect(error.message).toMatch(/ti mismo/i);
      expect(error.message).not.toMatch(/cannot_add_yourself/);
    });

    it("does not invalidate for a failure a refetch would not fix", async () => {
      const { result } = renderHook(
        () =>
          useSocialMutation<string, void>({
            mutation: "sendRequest",
            mutationFn: async () => {
              throw new Error("cannot_add_yourself");
            },
          }),
        { wrapper }
      );

      act(() => result.current.mutate("u2"));
      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(invalidateSpy).not.toHaveBeenCalled();
    });

    it("DOES invalidate when the server says the state already moved on", async () => {
      // Someone accepted/cancelled first. The call failed, but the local cache
      // is what is wrong, so the screen must re-read rather than re-offer.
      const { result } = renderHook(
        () =>
          useSocialMutation<string, void>({
            mutation: "cancelRequest",
            mutationFn: async () => {
              throw new Error("pending_sent_request_not_found");
            },
          }),
        { wrapper }
      );

      act(() => result.current.mutate("req-1"));
      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(invalidatedKeys().sort()).toEqual(
        [
          socialKeys.searches().join("/"),
          socialKeys.sentRequests().join("/"),
        ].sort()
      );
    });

    it("does not report success when the RPC failed", async () => {
      const onSuccess = vi.fn();
      const { result } = renderHook(
        () =>
          useSocialMutation<string, void>({
            mutation: "removeFriend",
            mutationFn: async () => {
              throw new Error("boom");
            },
            onSuccess,
          }),
        { wrapper }
      );

      act(() => result.current.mutate("u2"));
      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(onSuccess).not.toHaveBeenCalled();
    });
  });

  describe("in-flight state (CASE 7)", () => {
    it("exposes the variables of the running mutation, for per-row pending UI", async () => {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      const { result } = renderHook(
        () =>
          useSocialMutation<string, void>({
            mutation: "sendRequest",
            mutationFn: async () => {
              await gate;
            },
          }),
        { wrapper }
      );

      act(() => result.current.mutate("u2"));
      await waitFor(() => expect(result.current.isPending).toBe(true));
      expect(result.current.variables).toBe("u2");

      await act(async () => {
        release();
      });
      await waitFor(() => expect(result.current.isPending).toBe(false));
    });
  });
});
