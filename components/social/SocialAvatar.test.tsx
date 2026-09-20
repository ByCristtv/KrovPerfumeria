import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={typeof src === "string" ? src : ""} />
  ),
}));

import SocialAvatar from "./SocialAvatar";

/**
 * The crash this component caused: `username.charAt(0)` on a null username,
 * which reaches here from every social RPC except `search_public_users`.
 */
describe("SocialAvatar", () => {
  describe("the monogram fallback", () => {
    it("uses the username initial", () => {
      const { container } = render(
        <SocialAvatar username="aurora" avatarUrl={null} />
      );
      expect(container.textContent).toBe("A");
    });

    it("uses the full name when there is no username", () => {
      const { container } = render(
        <SocialAvatar username={null} fullName="Aurora Vega" avatarUrl={null} />
      );
      expect(container.textContent).toBe("A");
    });

    it('renders "?" when there is neither, instead of throwing', () => {
      const { container } = render(
        <SocialAvatar username={null} fullName={null} avatarUrl={null} />
      );
      expect(container.textContent).toBe("?");
    });

    it("does not throw for any combination of missing data", () => {
      for (const [username, fullName] of [
        [null, null],
        [null, undefined],
        ["", ""],
        ["   ", null],
      ] as const) {
        expect(() =>
          render(
            <SocialAvatar
              username={username}
              fullName={fullName}
              avatarUrl={null}
            />
          )
        ).not.toThrow();
      }
    });

    it("stays hidden from assistive tech — the name is real text beside it", () => {
      const { container } = render(
        <SocialAvatar username={null} avatarUrl={null} />
      );
      expect(container.firstElementChild).toHaveAttribute("aria-hidden");
    });
  });

  describe("the image", () => {
    it("renders a configured remote avatar", () => {
      render(
        <SocialAvatar
          username="aurora"
          avatarUrl="https://lh3.googleusercontent.com/a/x"
        />
      );
      expect(screen.getByRole("presentation")).toHaveAttribute(
        "src",
        "https://lh3.googleusercontent.com/a/x"
      );
    });

    it("falls back to the monogram for an unconfigured host", () => {
      // next/image refuses a hostname outside remotePatterns; degrading to the
      // monogram beats a broken image in a list of strangers.
      const { container } = render(
        <SocialAvatar username="aurora" avatarUrl="https://evil.example/a.png" />
      );
      expect(container.textContent).toBe("A");
    });

    it("falls back for the empty string the signup trigger writes", () => {
      const { container } = render(
        <SocialAvatar username="aurora" avatarUrl="" />
      );
      expect(container.textContent).toBe("A");
    });

    it("renders an image even when the username is null", () => {
      // A friend with an avatar but no username must still show the picture.
      render(
        <SocialAvatar
          username={null}
          avatarUrl="https://lh3.googleusercontent.com/a/x"
        />
      );
      expect(screen.getByRole("presentation")).toBeInTheDocument();
    });
  });
});
