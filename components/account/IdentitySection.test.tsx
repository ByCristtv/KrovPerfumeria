import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { actionMock } = vi.hoisted(() => ({ actionMock: vi.fn() }));
vi.mock("@/app/profile/actions", () => ({
  updateRankingSettingsAction: actionMock,
}));

import IdentitySection from "./IdentitySection";

const onSaved = vi.fn();

function renderSection(
  props: {
    username?: string | null;
    showInRanking?: boolean;
    isProfilePublic?: boolean;
  } = {}
) {
  return render(
    <IdentitySection
      fullName="Aurora Solís"
      avatarUrl={null}
      username={props.username ?? null}
      showInRanking={props.showInRanking ?? false}
      // Defaults to the ranking flag: one switch writes both columns, so that
      // is the only combination the section can currently be handed.
      isProfilePublic={props.isProfilePublic ?? props.showInRanking ?? false}
      onSaved={onSaved}
    />
  );
}

const editButton = () => screen.getByRole("button", { name: /editar username/i });

const usernameInput = () => screen.getByLabelText(/^username$/i);

/**
 * Switch the section into edit mode and wait until it has settled.
 *
 * The wait is load-bearing: focus moves to the username field from an effect
 * after the re-render, and typing before it lands would send keystrokes to the
 * wrong element. Waiting for the field to hold focus proves the effect ran.
 */
const openEditor = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(editButton());
  await waitFor(() => expect(usernameInput()).toHaveFocus());
};

const toggle = () =>
  screen.getByRole("checkbox", { name: /aparecer en el ranking/i });

const saveButton = () => screen.getByRole("button", { name: /^guardar$/i });

describe("IdentitySection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actionMock.mockResolvedValue({ ok: true, message: "ok" });
  });

  describe("a user with no username", () => {
    it("shows the empty, hidden state", () => {
      renderSection();
      expect(screen.getByText("Sin username")).toBeInTheDocument();
      expect(screen.getByText("Oculto")).toBeInTheDocument();
    });

    it("disables the opt-in toggle", async () => {
      const user = userEvent.setup();
      renderSection();
      await openEditor(user);

      expect(toggle()).toBeDisabled();
      expect(toggle()).not.toBeChecked();
    });

    it("cannot be opted in by clicking the disabled toggle", async () => {
      const user = userEvent.setup();
      renderSection();
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
      renderSection();
      await openEditor(user);

      await user.type(usernameInput(), "ab");

      expect(toggle()).toBeDisabled();
      expect(screen.getByText(/al menos 3 caracteres/i)).toBeInTheDocument();
      expect(usernameInput()).toHaveAttribute("aria-invalid", "true");
      expect(saveButton()).toBeDisabled();
    });

    it("enables the toggle once the username is valid", async () => {
      const user = userEvent.setup();
      renderSection();
      await openEditor(user);

      await user.type(usernameInput(), "aurora.cr");

      expect(toggle()).toBeEnabled();
      expect(saveButton()).toBeEnabled();
    });

    it("saves the username and the opt-in together", async () => {
      const user = userEvent.setup();
      renderSection();
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
      renderSection();
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
    it("shows the visible state", () => {
      renderSection({ username: "aurora", showInRanking: true });
      expect(screen.getByText("aurora")).toBeInTheDocument();
      expect(screen.getByText("Visible en el ranking")).toBeInTheDocument();
    });

    it("can opt out", async () => {
      const user = userEvent.setup();
      renderSection({ username: "aurora", showInRanking: true });
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
      renderSection({ username: "aurora", showInRanking: true });
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
      renderSection();
      expect(screen.getByText("Oculto")).toBeInTheDocument();
      expect(screen.getByText("Perfil privado")).toBeInTheDocument();
    });

    it("reports the findable state once the profile is public", () => {
      renderSection({ username: "aurora", showInRanking: true });
      expect(screen.getByText("Visible en el ranking")).toBeInTheDocument();
      expect(screen.getByText("Perfil encontrable")).toBeInTheDocument();
    });

    it("reports the two columns independently when they disagree", () => {
      // Not reachable through this section today, but the badges read two
      // different fields; this is what stops a future split from silently
      // rendering one of them as the other.
      renderSection({ username: "aurora", showInRanking: false, isProfilePublic: true });
      expect(screen.getByText("Oculto")).toBeInTheDocument();
      expect(screen.getByText("Perfil encontrable")).toBeInTheDocument();
    });

    it("names both consequences on the switch, not just the ranking", async () => {
      // A privacy control has to say it is a privacy control.
      const user = userEvent.setup();
      renderSection({ username: "aurora", showInRanking: true });
      await openEditor(user);

      expect(toggle()).toHaveAccessibleName(/encuentren/i);
    });

    it("offers a route into the social portal", () => {
      renderSection({ username: "aurora", showInRanking: true });
      expect(
        screen.getByRole("link", { name: /buscar amigos/i })
      ).toHaveAttribute("href", "/friends");
    });
  });

  describe("when saving fails", () => {
    it("surfaces the message and keeps the attempted value", async () => {
      actionMock.mockResolvedValue({
        ok: false,
        message: "Ese nombre de usuario ya está en uso. Prueba con otro.",
      });
      const user = userEvent.setup();
      renderSection({ username: "aurora", showInRanking: true });
      await openEditor(user);

      await user.clear(usernameInput());
      await user.type(usernameInput(), "tomada");
      await user.click(saveButton());

      expect(await screen.findByRole("alert")).toHaveTextContent(/ya está en uso/i);
      // The form stays open with the attempted value, and nothing reports the
      // failed name as saved.
      expect(usernameInput()).toHaveValue("tomada");
      expect(onSaved).not.toHaveBeenCalled();
      expect(screen.queryByText("Guardado")).not.toBeInTheDocument();
    });
  });

  describe("inline editing", () => {
    it("keeps the full name read-only, even while editing", async () => {
      const user = userEvent.setup();
      renderSection({ username: "aurora" });
      await openEditor(user);

      expect(screen.getByText("Aurora Solís")).toBeInTheDocument();
      expect(screen.getByText("(no editable)")).toBeInTheDocument();
      // The only text field on the form is the username.
      expect(screen.getAllByRole("textbox")).toEqual([usernameInput()]);
    });

    it("disables Save until something changes", async () => {
      const user = userEvent.setup();
      renderSection({ username: "aurora", showInRanking: true });
      await openEditor(user);

      expect(saveButton()).toBeDisabled();
      await user.type(usernameInput(), "2");
      expect(saveButton()).toBeEnabled();
    });

    it("cancels with Escape and returns focus to the Edit button", async () => {
      const user = userEvent.setup();
      renderSection({ username: "aurora" });
      await openEditor(user);

      await user.type(usernameInput(), "xyz");
      await user.keyboard("{Escape}");

      expect(screen.queryByLabelText(/^username$/i)).not.toBeInTheDocument();
      expect(screen.getByText("aurora")).toBeInTheDocument();
      await waitFor(() => expect(editButton()).toHaveFocus());
      expect(actionMock).not.toHaveBeenCalled();
    });

    it("saves with Enter, closes the form and confirms", async () => {
      const user = userEvent.setup();
      renderSection({ username: "aurora" });
      await openEditor(user);

      await user.clear(usernameInput());
      await user.type(usernameInput(), "aurora.cr{Enter}");

      expect(actionMock).toHaveBeenCalledWith({
        username: "aurora.cr",
        show_in_ranking: false,
      });
      expect(await screen.findByText("Guardado")).toBeInTheDocument();
      expect(screen.queryByLabelText(/^username$/i)).not.toBeInTheDocument();
    });
  });
});
