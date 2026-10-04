import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EmailAccountHint from "./EmailAccountHint";
import type { AdminCustomerMatch } from "@/types/adminOrder";

const ana: AdminCustomerMatch = {
  user_id: "3f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8",
  full_name: "Ana Solano",
  email: "ana@correo.com",
  phone: null,
  address: null,
};

function setup(props: Partial<React.ComponentProps<typeof EmailAccountHint>> = {}) {
  const handlers = {
    onLink: vi.fn(),
    onUnlink: vi.fn(),
    onDecline: vi.fn(),
    onUndoDecline: vi.fn(),
  };
  const utils = render(
    <EmailAccountHint
      linked={null}
      match={null}
      declined={false}
      isChecking={false}
      isError={false}
      {...handlers}
      {...props}
    />
  );
  return { ...utils, ...handlers, user: userEvent.setup() };
}

describe("EmailAccountHint", () => {
  it("renders nothing for an email nobody owns", () => {
    const { container } = setup();
    expect(container).toBeEmptyDOMElement();
  });

  it("asks before linking and names the registered user", async () => {
    const { user, onLink, onDecline } = setup({ match: ana });
    const hint = screen.getByTestId("email-hint-match");
    expect(hint).toHaveTextContent(/usuario registrado/i);
    expect(hint).toHaveTextContent("Ana Solano");

    await user.click(screen.getByRole("button", { name: "Vincular" }));
    expect(onLink).toHaveBeenCalledWith(ana);

    await user.click(screen.getByRole("button", { name: "No vincular" }));
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it("warns that an undecided match is linked automatically", () => {
    setup({ match: ana });
    expect(screen.getByTestId("email-hint-match")).toHaveTextContent(
      /se vincular[áa] autom[áa]ticamente/i
    );
  });

  it("confirms a link and offers to remove it", async () => {
    const { user, onUnlink } = setup({ linked: ana, match: ana });
    expect(screen.getByTestId("email-hint-linked")).toHaveTextContent(/sumará xp/i);
    // linked wins over the question
    expect(screen.queryByTestId("email-hint-match")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /quitar vínculo/i }));
    expect(onUnlink).toHaveBeenCalledTimes(1);
  });

  it("states the consequence of declining and lets the admin change their mind", async () => {
    const { user, onUndoDecline } = setup({ match: ana, declined: true });
    expect(screen.getByTestId("email-hint-declined")).toHaveTextContent(/no sumará xp/i);
    await user.click(screen.getByRole("button", { name: "Vincular" }));
    expect(onUndoDecline).toHaveBeenCalledTimes(1);
  });

  it("reports a failed check instead of implying the email is unregistered", () => {
    setup({ isError: true });
    expect(screen.getByTestId("email-hint-error")).toHaveTextContent(
      /no pudimos verificar/i
    );
  });

  it("shows a quiet checking line while the lookup runs", () => {
    setup({ isChecking: true });
    expect(screen.getByText(/verificando correo/i)).toBeInTheDocument();
  });
});
