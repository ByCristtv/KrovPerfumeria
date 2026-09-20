import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReceivedFriendRequest } from "@/types/social";

const {
  useReceivedMock,
  acceptMutate,
  rejectMutate,
  useAcceptMock,
  useRejectMock,
} = vi.hoisted(() => ({
  useReceivedMock: vi.fn(),
  acceptMutate: vi.fn(),
  rejectMutate: vi.fn(),
  useAcceptMock: vi.fn(),
  useRejectMock: vi.fn(),
}));

vi.mock("@/hooks/useFriendRequests", () => ({
  useReceivedRequests: () => useReceivedMock(),
  useAcceptFriendRequest: (cb: unknown) => useAcceptMock(cb),
  useRejectFriendRequest: (cb: unknown) => useRejectMock(cb),
}));
vi.mock("@/components/social/socialAlerts", () => ({
  socialSuccessToast: vi.fn(),
  socialErrorAlert: vi.fn(),
}));
vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={typeof src === "string" ? src : ""} />
  ),
}));

import ReceivedRequestsPanel from "./ReceivedRequestsPanel";

const request = (
  over: Partial<ReceivedFriendRequest> = {}
): ReceivedFriendRequest => ({
  requestId: "r1",
  userId: "u2",
  username: "aurora",
  avatarUrl: null,
  experiencePoints: 1200,
  requestedAt: "2026-09-19T10:00:00Z",
  ...over,
});

const onGoToSearch = vi.fn();

function setup(
  state: Partial<{
    requests: ReceivedFriendRequest[];
    isLoading: boolean;
    isError: boolean;
  }> = {},
  flight: { accepting?: string; rejecting?: string } = {}
) {
  useReceivedMock.mockReturnValue({
    requests: state.requests ?? [],
    count: (state.requests ?? []).length,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    refetch: vi.fn(),
  });
  useAcceptMock.mockReturnValue({
    mutate: acceptMutate,
    isPending: !!flight.accepting,
    variables: flight.accepting,
  });
  useRejectMock.mockReturnValue({
    mutate: rejectMutate,
    isPending: !!flight.rejecting,
    variables: flight.rejecting,
  });
  return render(<ReceivedRequestsPanel onGoToSearch={onGoToSearch} />);
}

/** SOCIAL-06 + SOCIAL-07. */
describe("ReceivedRequestsPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("the list (CASE 3)", () => {
    it("shows the sender with accept and reject actions", () => {
      setup({ requests: [request()] });

      expect(screen.getByText("aurora")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /aceptar la solicitud de aurora/i })
      ).toBeEnabled();
      expect(
        screen.getByRole("button", { name: /rechazar la solicitud de aurora/i })
      ).toBeEnabled();
    });

    it("shows the rank the sender's XP implies, from the shared ladder", () => {
      // 1,200 XP is Cologne per lib/rank.ts.
      setup({ requests: [request({ experiencePoints: 1200 })] });
      expect(screen.getByText(/Cologne/)).toHaveTextContent(/1,200 XP/);
    });

    it("renders a row per request", () => {
      setup({
        requests: [
          request({ requestId: "r1", username: "aurora" }),
          request({ requestId: "r2", username: "borealis" }),
        ],
      });
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
    });
  });

  describe("deciding", () => {
    it("accepts by request id (CASE 4)", async () => {
      const user = userEvent.setup();
      setup({ requests: [request({ requestId: "req-42" })] });

      await user.click(screen.getByRole("button", { name: /aceptar/i }));

      expect(acceptMutate).toHaveBeenCalledWith("req-42");
      expect(rejectMutate).not.toHaveBeenCalled();
    });

    it("rejects by request id (CASE 5)", async () => {
      const user = userEvent.setup();
      setup({ requests: [request({ requestId: "req-42" })] });

      await user.click(screen.getByRole("button", { name: /rechazar/i }));

      expect(rejectMutate).toHaveBeenCalledWith("req-42");
      expect(acceptMutate).not.toHaveBeenCalled();
    });

    it("locks BOTH buttons of the row being decided (CASE 7)", () => {
      // Accepting and rejecting the same request at once is the one race the
      // UI can actually cause.
      setup({ requests: [request({ requestId: "r1" })] }, { accepting: "r1" });

      expect(screen.getByRole("button", { name: /aceptar/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /rechazar/i })).toBeDisabled();
    });

    it("leaves other rows interactive while one is deciding", () => {
      setup(
        {
          requests: [
            request({ requestId: "r1", username: "aurora" }),
            request({ requestId: "r2", username: "borealis" }),
          ],
        },
        { accepting: "r1" }
      );

      expect(
        screen.getByRole("button", { name: /aceptar la solicitud de borealis/i })
      ).toBeEnabled();
    });
  });

  describe("a sender with no username (CASE 4)", () => {
    // `get_received_friend_requests` joins profiles WITHOUT a
    // `username IS NOT NULL` filter, so this row is real, not hypothetical.
    it("renders without crashing on the avatar monogram", () => {
      expect(() =>
        setup({ requests: [request({ username: null })] })
      ).not.toThrow();
    });

    it("names them with the anonymous fallback instead of blank", () => {
      setup({ requests: [request({ username: null })] });
      expect(screen.getByText("Usuario sin nombre")).toBeInTheDocument();
    });

    it("keeps Accept and Reject working", () => {
      setup({ requests: [request({ username: null })] });

      expect(
        screen.getByRole("button", { name: /aceptar la solicitud/i })
      ).toBeEnabled();
      expect(
        screen.getByRole("button", { name: /rechazar la solicitud/i })
      ).toBeEnabled();
    });

    it("still acts on the right request id", async () => {
      const user = userEvent.setup();
      setup({ requests: [request({ requestId: "req-7", username: null })] });

      await user.click(screen.getByRole("button", { name: /aceptar/i }));
      expect(acceptMutate).toHaveBeenCalledWith("req-7");
    });
  });

  describe("empty and failure states", () => {
    it("shows a useful empty state with a route to search (CASE 11)", async () => {
      const user = userEvent.setup();
      setup({ requests: [] });

      expect(
        screen.getByText(/no tienes solicitudes pendientes/i)
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /buscar personas/i }));
      expect(onGoToSearch).toHaveBeenCalled();
    });

    it("shows a skeleton while loading", () => {
      const { container } = setup({ isLoading: true });
      expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
    });

    it("shows a retry-able error state (CASE 12)", () => {
      setup({ isError: true });
      expect(
        screen.getByText(/no pudimos cargar tus solicitudes/i)
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /reintentar/i })).toBeEnabled();
    });
  });
});
