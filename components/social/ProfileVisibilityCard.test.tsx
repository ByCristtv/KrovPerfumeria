import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { eligibilityMock } = vi.hoisted(() => ({ eligibilityMock: vi.fn() }));
vi.mock("@/hooks/useSocialEligibility", () => ({
  useSocialEligibility: () => eligibilityMock(),
}));

import ProfileVisibilityCard from "./ProfileVisibilityCard";

const setup = (
  state: Partial<{
    hasUsername: boolean;
    isProfilePublic: boolean;
    isLoading: boolean;
    isError: boolean;
  }>
) => {
  eligibilityMock.mockReturnValue({
    hasUsername: false,
    isProfilePublic: false,
    isLoading: false,
    isError: false,
    ...state,
  });
  return render(<ProfileVisibilityCard />);
};

describe("ProfileVisibilityCard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("invites a private account to go public, with a real link to /profile", () => {
    setup({ hasUsername: true, isProfilePublic: false });

    expect(screen.getByText(/tus amigos no pueden encontrarte/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /hacer público mi perfil/i })).toHaveAttribute(
      "href",
      "/profile"
    );
  });

  it("asks for a username first when there is none — a switch could not be turned on anyway", () => {
    setup({ hasUsername: false, isProfilePublic: false });

    expect(screen.getByText(/elige un username/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /configurar mi perfil/i })).toHaveAttribute(
      "href",
      "/profile"
    );
    expect(screen.queryByRole("link", { name: /hacer público/i })).not.toBeInTheDocument();
  });

  it("confirms, instead of nagging, when the profile is already public", () => {
    setup({ hasUsername: true, isProfilePublic: true });

    expect(screen.getByText(/tu perfil es público/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /gestionar/i })).toHaveAttribute("href", "/profile");
    expect(screen.queryByText(/no pueden encontrarte/i)).not.toBeInTheDocument();
  });

  it.each([
    ["while the profile is loading", { isLoading: true }],
    ["when the profile could not be read", { isError: true }],
  ])("renders nothing %s — either claim would be a guess", (_name, state) => {
    const { container } = setup(state);
    expect(container).toBeEmptyDOMElement();
  });
});
