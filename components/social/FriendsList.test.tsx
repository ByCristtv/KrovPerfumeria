import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
  lastPurchase: null,
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

const menuButton = (name: RegExp) =>
  screen.getByRole("button", { name: new RegExp(`más opciones de ${name.source}`, "i") });

/** Removal is two deliberate steps now: open the "•••" menu, then pick the item. */
async function chooseRemove(
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp = /aurora/
) {
  await user.click(menuButton(name));
  await user.click(await screen.findByRole("menuitem", { name: /eliminar amigo/i }));
}

/** SOCIAL-09 + SOCIAL-10. */
describe("FriendsList", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("the card", () => {
    it("leads with the full name and shows @username under it", () => {
      setup({ friends: [friend()] });

      expect(screen.getByText("Aurora Vega")).toBeInTheDocument();
      expect(screen.getByText("@aurora")).toBeInTheDocument();
    });

    it("shows the rank pill derived from XP, with the XP beside it", () => {
      setup({ friends: [friend({ experiencePoints: 5200 })] });

      // 5,200 XP sits in Conocedor per lib/rank.ts — the one ladder in the codebase.
      expect(screen.getByText("Conocedor")).toBeInTheDocument();
      expect(screen.getByText("5,200 XP")).toBeInTheDocument();
    });

    it("shows the last purchase as social proof when there is one", () => {
      setup({
        friends: [
          friend({ lastPurchase: { productName: "Eros", brandName: "Versace" } }),
        ],
      });

      const snippet = screen.getByText(/última compra/i);
      expect(snippet).toHaveTextContent("Eros");
      expect(snippet).toHaveTextContent("Versace");
    });

    it("omits the brand segment when the product has none", () => {
      setup({
        friends: [friend({ lastPurchase: { productName: "Eros", brandName: null } })],
      });
      expect(screen.getByText(/última compra/i)).not.toHaveTextContent("·");
    });

    it("falls back to how long they've been friends when they have no purchase", () => {
      setup({ friends: [friend({ lastPurchase: null })] });

      expect(screen.queryByText(/última compra/i)).not.toBeInTheDocument();
      expect(screen.getByText(/amigos desde .*2026/i)).toBeInTheDocument();
    });

    it("links the card to the friend's profile with 'Ver perfil'", () => {
      setup({ friends: [friend({ userId: "u-target" })] });

      const link = screen.getByRole("link", { name: /ver el perfil de aurora vega/i });
      expect(link).toHaveAttribute("href", "/friends/u-target");
      expect(link).toHaveTextContent(/ver perfil/i);
    });

    it("has exactly one link per card, so keyboard users get one stop", () => {
      setup({ friends: [friend()] });
      expect(screen.getAllByRole("link")).toHaveLength(1);
    });

    it("no longer shows a delete button on the card face", () => {
      setup({ friends: [friend()] });
      expect(screen.queryByRole("button", { name: /eliminar/i })).not.toBeInTheDocument();
    });

    it("keeps the overflow menu OUTSIDE the profile link", () => {
      // Nesting the menu button inside the link would be invalid HTML and make
      // every click ambiguous.
      setup({ friends: [friend()] });

      const link = screen.getByRole("link", { name: /ver el perfil/i });
      expect(link.contains(menuButton(/aurora/))).toBe(false);
    });
  });

  describe("a friend with no username (CASE 4 / historical data)", () => {
    it("renders without crashing", () => {
      expect(() =>
        setup({ friends: [friend({ username: null })] })
      ).not.toThrow();
    });

    it("leads with the full name, which get_friends does return, and shows no handle", () => {
      setup({ friends: [friend({ username: null, fullName: "Aurora Vega" })] });
      expect(screen.getByText("Aurora Vega")).toBeInTheDocument();
      expect(screen.queryByText(/^@/)).not.toBeInTheDocument();
    });

    it("does not repeat the full name as both title and subtitle", () => {
      setup({ friends: [friend({ username: null, fullName: "Aurora Vega" })] });
      expect(screen.getAllByText("Aurora Vega")).toHaveLength(1);
    });

    it("does not repeat the username when it is the headline", () => {
      setup({ friends: [friend({ username: "aurora", fullName: null })] });
      expect(screen.getAllByText(/aurora/)).toHaveLength(1);
    });

    it("falls back to the anonymous label with neither", () => {
      setup({ friends: [friend({ username: null, fullName: null })] });
      expect(screen.getByText("Usuario sin nombre")).toBeInTheDocument();
    });

    it("keeps the profile link and the remove action usable", async () => {
      const user = userEvent.setup();
      setup({ friends: [friend({ username: null, userId: "u-target" })] });

      expect(
        screen.getByRole("link", { name: /ver el perfil de aurora vega/i })
      ).toHaveAttribute("href", "/friends/u-target");

      await chooseRemove(user, /aurora vega/);
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
    });
  });

  describe("the overflow menu", () => {
    it("is closed until opened, and announces its state", async () => {
      const user = userEvent.setup();
      setup({ friends: [friend()] });

      const trigger = menuButton(/aurora/);
      expect(trigger).toHaveAttribute("aria-haspopup", "menu");
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();

      await user.click(trigger);

      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("menu")).toBeInTheDocument();
    });

    it("offers only Eliminar amigo — there is no block feature to expose", async () => {
      const user = userEvent.setup();
      setup({ friends: [friend()] });

      await user.click(menuButton(/aurora/));

      const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
      expect(items.map((i) => i.textContent)).toEqual(["Eliminar amigo"]);
    });

    it("moves focus to the first item when opened", async () => {
      const user = userEvent.setup();
      setup({ friends: [friend()] });

      await user.click(menuButton(/aurora/));

      await waitFor(() =>
        expect(screen.getByRole("menuitem", { name: /eliminar amigo/i })).toHaveFocus()
      );
    });

    it("closes on Escape and returns focus to the trigger", async () => {
      const user = userEvent.setup();
      setup({ friends: [friend()] });
      const trigger = menuButton(/aurora/);

      await user.click(trigger);
      await user.keyboard("{Escape}");

      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });

    it("closes when something outside is pressed", async () => {
      const user = userEvent.setup();
      setup({ friends: [friend()] });

      await user.click(menuButton(/aurora/));
      await user.click(document.body);

      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("opens from the keyboard with ArrowDown", async () => {
      const user = userEvent.setup();
      setup({ friends: [friend()] });

      menuButton(/aurora/).focus();
      await user.keyboard("{ArrowDown}");

      expect(screen.getByRole("menu")).toBeInTheDocument();
    });
  });

  describe("filtering a long list", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      friend({
        friendshipId: `f${i}`,
        userId: `u${i}`,
        username: `user${i}`,
        fullName: i === 0 ? "Andrés Mora" : `Persona ${i}`,
      })
    );

    it("is not offered for a short list", () => {
      setup({ friends: [friend(), friend({ friendshipId: "f2", userId: "u3" })] });
      expect(screen.queryByLabelText(/filtrar amigos/i)).not.toBeInTheDocument();
    });

    it("narrows the cards as you type, ignoring accents and case", async () => {
      const user = userEvent.setup();
      setup({ friends: many });

      await user.type(screen.getByLabelText(/filtrar amigos/i), "ANDRES");

      expect(screen.getByText("Andrés Mora")).toBeInTheDocument();
      expect(screen.queryByText("Persona 1")).not.toBeInTheDocument();
    });

    it("also matches the username", async () => {
      const user = userEvent.setup();
      setup({ friends: many });

      await user.type(screen.getByLabelText(/filtrar amigos/i), "user3");

      expect(screen.getByText("Persona 3")).toBeInTheDocument();
      expect(screen.queryByText("Persona 2")).not.toBeInTheDocument();
    });

    it("says so when nobody matches, and clears back to the full list", async () => {
      const user = userEvent.setup();
      setup({ friends: many });

      await user.type(screen.getByLabelText(/filtrar amigos/i), "zzzz");
      expect(screen.getByText(/ningún amigo coincide con «zzzz»/i)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /limpiar filtro/i }));
      expect(screen.getByText("Persona 1")).toBeInTheDocument();
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

      await chooseRemove(user);

      expect(removeMutate).not.toHaveBeenCalled();
      expect(await screen.findByRole("dialog")).toHaveTextContent(/aurora/i);
    });

    it("names the friend in the confirmation", async () => {
      const user = userEvent.setup();
      setup({ friends: [friend()] });

      await chooseRemove(user);

      expect(await screen.findByRole("dialog")).toHaveTextContent(
        /eliminar a aurora vega de tus amigos/i
      );
    });

    it("says the friendship can be rebuilt — removal is not a block", async () => {
      const user = userEvent.setup();
      setup({ friends: [friend()] });

      await chooseRemove(user);

      expect(await screen.findByRole("dialog")).toHaveTextContent(
        /volver a enviarle una solicitud/i
      );
    });

    it("removes by the friend's user id once confirmed", async () => {
      const user = userEvent.setup();
      setup({ friends: [friend({ userId: "u-target" })] });

      await chooseRemove(user);
      const dialog = await screen.findByRole("dialog");
      await waitFor(() => expect(dialog).toHaveFocus());
      await user.click(screen.getByRole("button", { name: /^eliminar$/i }));

      expect(removeMutate).toHaveBeenCalledWith("u-target");
    });

    it("abandons the removal on cancel", async () => {
      const user = userEvent.setup();
      setup({ friends: [friend()] });

      await chooseRemove(user);
      const dialog = await screen.findByRole("dialog");
      await waitFor(() => expect(dialog).toHaveFocus());
      await user.click(screen.getByRole("button", { name: /^cancelar$/i }));

      expect(removeMutate).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      );
    });

    it("locks the menu action while a removal is in flight (CASE 7)", async () => {
      const user = userEvent.setup();
      setup({ friends: [friend()] }, { isPending: true });

      await user.click(menuButton(/aurora/));

      expect(screen.getByRole("menuitem", { name: /eliminar amigo/i })).toBeDisabled();
    });
  });
});
