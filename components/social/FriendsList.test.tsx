import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Friend } from "@/types/social";

const { useFriendsMock, removeMutate, useRemoveFriendMock, successToast, errorAlert } =
  vi.hoisted(() => ({
    useFriendsMock: vi.fn(),
    removeMutate: vi.fn(),
    useRemoveFriendMock: vi.fn(),
    successToast: vi.fn(),
    errorAlert: vi.fn(),
  }));

vi.mock("@/hooks/useFriends", () => ({
  useFriends: () => useFriendsMock(),
  useRemoveFriend: (cb: unknown) => useRemoveFriendMock(cb),
}));
vi.mock("@/components/social/socialAlerts", () => ({
  socialSuccessToast: successToast,
  socialErrorAlert: errorAlert,
}));
vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={typeof src === "string" ? src : ""} />
  ),
}));

import FriendsList from "./FriendsList";

const friend = (over: Partial<Friend> = {}): Friend => ({
  friendshipId: "f1",
  userId: "u2",
  username: "aurora",
  fullName: "Aurora Vega",
  avatarUrl: null,
  experiencePoints: 5200,
  friendsSince: "2026-09-19T10:00:00Z",
  ...over,
});

const onGoToSearch = vi.fn();

function setup(
  state: Partial<{
    friends: Friend[];
    isLoading: boolean;
    isError: boolean;
  }> = {},
  removeState: { isPending?: boolean } = {}
) {
  useFriendsMock.mockReturnValue({
    friends: state.friends ?? [],
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    refetch: vi.fn(),
  });
  useRemoveFriendMock.mockReturnValue({
    mutate: removeMutate,
    isPending: removeState.isPending ?? false,
  });
  return render(<FriendsList onGoToSearch={onGoToSearch} />);
}

/** SOCIAL-09 + SOCIAL-10. */
describe("FriendsList", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("the list", () => {
    it("shows username, full name and the rank derived from XP", () => {
      setup({ friends: [friend({ experiencePoints: 5200 })] });

      expect(screen.getByText("aurora")).toBeInTheDocument();
      // 5,200 XP sits in EDT per lib/rank.ts — the one ladder in the codebase.
      expect(screen.getByText(/Aurora Vega/)).toHaveTextContent(/EDT/);
      expect(screen.getByText(/Aurora Vega/)).toHaveTextContent(/5,200 XP/);
    });

    it("omits the name segment when the friend has none", () => {
      setup({ friends: [friend({ fullName: null })] });
      expect(screen.getByText(/EDT/)).not.toHaveTextContent("·  ·");
    });

    it("links the identity area to the friend's profile", () => {
      setup({ friends: [friend({ userId: "u-target" })] });

      expect(
        screen.getByRole("link", { name: /ver el perfil de aurora/i })
      ).toHaveAttribute("href", "/friends/u-target");
    });

    it("keeps the remove button OUTSIDE that link", () => {
      // Nesting the destructive button inside the row link would be invalid
      // HTML and would make every click ambiguous.
      setup({ friends: [friend()] });

      const link = screen.getByRole("link", { name: /ver el perfil/i });
      const remove = screen.getByRole("button", { name: /eliminar a aurora/i });
      expect(link.contains(remove)).toBe(false);
    });
  });

  describe("a friend with no username (CASE 4 / historical data)", () => {
    it("renders without crashing", () => {
      expect(() =>
        setup({ friends: [friend({ username: null })] })
      ).not.toThrow();
    });

    it("falls back to the full name, which get_friends does return", () => {
      setup({ friends: [friend({ username: null, fullName: "Aurora Vega" })] });
      expect(screen.getByText("Aurora Vega")).toBeInTheDocument();
    });

    it("does not repeat the full name as both title and subtitle", () => {
      setup({ friends: [friend({ username: null, fullName: "Aurora Vega" })] });
      expect(screen.getAllByText(/Aurora Vega/)).toHaveLength(1);
    });

    it("falls back to the anonymous label with neither", () => {
      setup({ friends: [friend({ username: null, fullName: null })] });
      expect(screen.getByText("Usuario sin nombre")).toBeInTheDocument();
    });

    it("keeps the profile link and the remove action usable", () => {
      setup({ friends: [friend({ username: null, userId: "u-target" })] });

      expect(
        screen.getByRole("link", { name: /ver el perfil de aurora vega/i })
      ).toHaveAttribute("href", "/friends/u-target");
      expect(
        screen.getByRole("button", { name: /eliminar a aurora vega/i })
      ).toBeEnabled();
    });
  });

  describe("empty and failure states", () => {
    it("shows a useful empty state with a route to search (CASE 10)", async () => {
      const user = userEvent.setup();
      setup({ friends: [] });

      expect(screen.getByText(/aún no tienes amigos/i)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /buscar personas/i }));
      expect(onGoToSearch).toHaveBeenCalled();
    });

    it("shows a skeleton while loading", () => {
      const { container } = setup({ isLoading: true });
      expect(container.querySelector(".krov-skeleton")).toBeInTheDocument();
    });

    it("shows a retry-able error state (CASE 12)", () => {
      setup({ isError: true });
      expect(screen.getByText(/no pudimos cargar tu lista/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /reintentar/i })).toBeEnabled();
    });
  });

  describe("removing a friend (CASE 6)", () => {
    it("asks for confirmation instead of removing on the first click", async () => {
      const user = userEvent.setup();
      setup({ friends: [friend()] });

      await user.click(screen.getByRole("button", { name: /eliminar a aurora/i }));

      expect(removeMutate).not.toHaveBeenCalled();
      expect(await screen.findByRole("dialog")).toHaveTextContent(/aurora/);
    });

    it("names the friend in the confirmation", async () => {
      const user = userEvent.setup();
      setup({ friends: [friend()] });

      await user.click(screen.getByRole("button", { name: /eliminar a aurora/i }));

      expect(await screen.findByRole("dialog")).toHaveTextContent(
        /eliminar a aurora de tus amigos/i
      );
    });

    it("says the friendship can be rebuilt — removal is not a block", async () => {
      const user = userEvent.setup();
      setup({ friends: [friend()] });

      await user.click(screen.getByRole("button", { name: /eliminar a aurora/i }));

      expect(await screen.findByRole("dialog")).toHaveTextContent(
        /volver a enviarle una solicitud/i
      );
    });

    it("removes by the friend's user id once confirmed", async () => {
      const user = userEvent.setup();
      setup({ friends: [friend({ userId: "u-target" })] });

      await user.click(screen.getByRole("button", { name: /eliminar a aurora/i }));
      const dialog = await screen.findByRole("dialog");
      await waitFor(() => expect(dialog).toHaveFocus());
      await user.click(
        screen.getByRole("button", { name: /^eliminar$/i })
      );

      expect(removeMutate).toHaveBeenCalledWith("u-target");
    });

    it("abandons the removal on cancel", async () => {
      const user = userEvent.setup();
      setup({ friends: [friend()] });

      await user.click(screen.getByRole("button", { name: /eliminar a aurora/i }));
      const dialog = await screen.findByRole("dialog");
      await waitFor(() => expect(dialog).toHaveFocus());
      await user.click(screen.getByRole("button", { name: /^cancelar$/i }));

      expect(removeMutate).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      );
    });

    it("locks the row action while a removal is in flight (CASE 7)", () => {
      setup({ friends: [friend()] }, { isPending: true });
      expect(
        screen.getByRole("button", { name: /eliminar a aurora/i })
      ).toBeDisabled();
    });
  });
});
