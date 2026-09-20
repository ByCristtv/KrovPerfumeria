import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { actionMock } = vi.hoisted(() => ({ actionMock: vi.fn() }));
vi.mock("@/app/profile/actions", () => ({
  updateRankingSettingsAction: actionMock,
}));

import RankingSettingsCard from "./RankingSettingsCard";

const onSaved = vi.fn();

function renderCard(
  props: {
    username?: string | null;
    showInRanking?: boolean;
    isProfilePublic?: boolean;
  } = {}
) {
  return render(
    <RankingSettingsCard
      username={props.username ?? null}
      showInRanking={props.showInRanking ?? false}
      // Defaults to the ranking flag: one switch writes both columns, so that
      // is the only combination the card can currently be handed.
      isProfilePublic={props.isProfilePublic ?? props.showInRanking ?? false}
      onSaved={onSaved}
    />
  );
}

/**
 * Open the edit modal and wait until it has settled.
 *
 * The wait is load-bearing, not defensive: Modal moves focus to its panel from
 * inside a requestAnimationFrame. Typing before that frame runs means the rAF
 * lands mid-keystroke and pulls focus off the input, silently dropping the rest
 * of the characters. In a browser the frame fires ~16ms after open, long before
 * a person types; in jsdom the two interleave, which is what made this suite
 * flaky. Waiting for the panel to hold focus proves the frame already ran.
 */
const openEditor = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /editar|configurar/i }));
  await waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());
};

const toggle = () =>
  screen.getByRole("checkbox", { name: /aparecer en el ranking/i });

const usernameInput = () => screen.getByLabelText(/nombre de usuario/i);

const saveButton = () => screen.getByRole("button", { name: /^guardar$/i });

describe("RankingSettingsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMock.mockResolvedValue({ ok: true, message: "ok" });
  });

  describe("a user with no username", () => {
    it("shows the empty, hidden state on the card", () => {
      renderCard();
      expect(screen.getByText("Sin nombre de usuario")).toBeInTheDocument();
      expect(screen.getByText("Oculto")).toBeInTheDocument();
    });

    it("disables the opt-in toggle", async () => {
      const user = userEvent.setup();
      renderCard();
      await openEditor(user);

      expect(toggle()).toBeDisabled();
      expect(toggle()).not.toBeChecked();
    });

    it("cannot be opted in by clicking the disabled toggle", async () => {
      const user = userEvent.setup();
      renderCard();
      await openEditor(user);

      await user.click(toggle());

      expect(toggle()).not.toBeChecked();
      await user.click(saveButton());
      expect(actionMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ show_in_ranking: true })
      );
    });
  });

  describe("entering a username", () => {
    it("keeps the toggle disabled while the username is invalid", async () => {
      const user = userEvent.setup();
      renderCard();
      await openEditor(user);

      await user.type(usernameInput(), "ab");

      expect(toggle()).toBeDisabled();
      expect(
        screen.getByText(/al menos 3 caracteres/i)
      ).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
    });

    it("enables the toggle once the username is valid", async () => {
      const user = userEvent.setup();
      renderCard();
      await openEditor(user);

      await user.type(usernameInput(), "aurora.cr");

      expect(toggle()).toBeEnabled();
      expect(saveButton()).toBeEnabled();
    });

    it("saves the username and the opt-in together", async () => {
      const user = userEvent.setup();
      renderCard();
      await openEditor(user);

      await user.type(usernameInput(), "aurora.cr");
      await user.click(toggle());
      await user.click(saveButton());

      expect(actionMock).toHaveBeenCalledWith({
        username: "aurora.cr",
        show_in_ranking: true,
      });
      expect(onSaved).toHaveBeenCalled();
    });

    it("allows saving a username without opting in", async () => {
      const user = userEvent.setup();
      renderCard();
      await openEditor(user);

      await user.type(usernameInput(), "aurora");
      await user.click(saveButton());

      expect(actionMock).toHaveBeenCalledWith({
        username: "aurora",
        show_in_ranking: false,
      });
    });
  });

  describe("an opted-in user", () => {
    it("shows the visible state on the card", () => {
      renderCard({ username: "aurora", showInRanking: true });
      expect(screen.getByText("aurora")).toBeInTheDocument();
      expect(screen.getByText("Visible en el ranking")).toBeInTheDocument();
    });

    it("can opt out", async () => {
      const user = userEvent.setup();
      renderCard({ username: "aurora", showInRanking: true });
      await openEditor(user);

      expect(toggle()).toBeChecked();
      await user.click(toggle());
      await user.click(saveButton());

      expect(actionMock).toHaveBeenCalledWith({
        username: "aurora",
        show_in_ranking: false,
      });
    });

    it("clearing the username turns the opt-in off in the same save", async () => {
      // The invalid combination is never sent: the toggle drops to disabled and
      // unchecked the moment the field empties.
      const user = userEvent.setup();
      renderCard({ username: "aurora", showInRanking: true });
      await openEditor(user);

      await user.clear(usernameInput());

      expect(toggle()).toBeDisabled();
      expect(toggle()).not.toBeChecked();

      await user.click(saveButton());

      expect(actionMock).toHaveBeenCalledWith({
        username: "",
        show_in_ranking: false,
      });
    });
  });

  describe("social profile visibility", () => {
    it("reports the private state alongside the ranking state", () => {
      renderCard();
      expect(screen.getByText("Oculto")).toBeInTheDocument();
      expect(screen.getByText("Perfil privado")).toBeInTheDocument();
    });

    it("reports the findable state once the profile is public", () => {
      renderCard({ username: "aurora", showInRanking: true });
      expect(screen.getByText("Visible en el ranking")).toBeInTheDocument();
      expect(screen.getByText("Perfil encontrable")).toBeInTheDocument();
    });

    it("reports the two columns independently when they disagree", () => {
      // Not reachable through this card today, but the badges read two
      // different fields — this is what stops a future split from silently
      // rendering one of them as the other.
      renderCard({ username: "aurora", showInRanking: false, isProfilePublic: true });
      expect(screen.getByText("Oculto")).toBeInTheDocument();
      expect(screen.getByText("Perfil encontrable")).toBeInTheDocument();
    });

    it("names both consequences on the switch, not just the ranking", async () => {
      // A privacy control has to say it is a privacy control.
      const user = userEvent.setup();
      renderCard({ username: "aurora", showInRanking: true });
      await openEditor(user);

      expect(toggle()).toHaveAccessibleName(/encuentren/i);
    });

    it("offers a route into the social portal", () => {
      renderCard({ username: "aurora", showInRanking: true });
      expect(
        screen.getByRole("link", { name: /buscar amigos/i })
      ).toHaveAttribute("href", "/friends");
    });
  });

  describe("when saving fails", () => {
    it("surfaces the message and preserves the previously saved value", async () => {
      actionMock.mockResolvedValue({
        ok: false,
        message: "Ese nombre de usuario ya está en uso. Prueba con otro.",
      });
      const user = userEvent.setup();
      renderCard({ username: "aurora", showInRanking: true });
      await openEditor(user);

      await user.clear(usernameInput());
      await user.type(usernameInput(), "tomada");
      await user.click(saveButton());

      expect(await screen.findByRole("alert")).toHaveTextContent(/ya está en uso/i);
      // Modal stays open with the attempted value, and the card behind it still
      // reflects what the database holds.
      expect(usernameInput()).toHaveValue("tomada");
      expect(onSaved).not.toHaveBeenCalled();
      expect(screen.getByText("Visible en el ranking")).toBeInTheDocument();
    });
  });
});
