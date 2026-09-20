import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  makeFakeSocialBackend,
  type FakeSocialBackend,
} from "@/test/helpers/fakeSocialBackend";

/**
 * Discovery eligibility, end to end through the real portal.
 *
 * Everything below the components is real — the eligibility hook, the query
 * keys, the data-access layer and a real QueryClient — with only the network
 * replaced. The property under test is not "a gate renders" but "the RPC is
 * never called", which only an integration test can actually show.
 */

const ME = "me-1";
const AURORA = "u-aurora";

let backend: FakeSocialBackend;

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) =>
      backend.rpc(name, args),
    from: (table: string) => backend.from(table),
  },
}));

vi.mock("@/hooks/useAuthUser", () => ({
  useAuthUser: () => ({
    user: { id: ME },
    isLoading: false,
    isAuthenticated: true,
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={typeof src === "string" ? src : ""} />
  ),
}));

const { successToast, errorAlert } = vi.hoisted(() => ({
  successToast: vi.fn(),
  errorAlert: vi.fn(),
}));
vi.mock("@/components/social/socialAlerts", () => ({
  socialSuccessToast: successToast,
  socialErrorAlert: errorAlert,
}));

import FriendsView from "./FriendsView";

const other = (id: string, username: string) => ({
  id,
  username,
  avatarUrl: null,
  experiencePoints: 5200,
  fullName: "Aurora Vega",
  isPublic: true,
});

/**
 * Build the backend WITHOUT rendering, so a test can seed relationships that
 * must already exist when the portal's queries first run.
 *
 * `viewer` is copied rather than passed through: the backend keeps a mutable
 * reference to it, and a test that flips `backend.viewer.isProfilePublic`
 * would otherwise rewrite the shared ELIGIBLE constant for every test after it.
 */
function makeBackend(viewer: {
  username: string | null;
  isProfilePublic: boolean;
}) {
  backend = makeFakeSocialBackend(ME, [other(AURORA, "aurora")], [], {
    ...viewer,
  });
  return backend;
}

function renderPortal() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const utils = render(
    <QueryClientProvider client={client}>
      <FriendsView />
    </QueryClientProvider>
  );
  return { ...utils, client };
}

/** The common case: no pre-existing relationships to seed. */
function setup(viewer: { username: string | null; isProfilePublic: boolean }) {
  makeBackend(viewer);
  return renderPortal();
}

const user = () => userEvent.setup();
const goTo = async (section: RegExp) =>
  user().click(screen.getByRole("radio", { name: section }));

const ELIGIBLE = { username: "yo", isProfilePublic: true };
const NO_USERNAME = { username: null, isProfilePublic: false };
const PRIVATE = { username: "yo", isProfilePublic: false };

describe("discovery eligibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("CASE 1 — no username", () => {
    it("still opens the portal", async () => {
      setup(NO_USERNAME);
      expect(
        await screen.findByRole("radio", { name: /amigos/i })
      ).toBeInTheDocument();
    });

    it("keeps Amigos and Solicitudes usable", async () => {
      // Seeded before the render: the requests query runs on mount.
      makeBackend(NO_USERNAME).receiveRequestFrom(AURORA);
      renderPortal();

      // Friends section loads (empty, but working).
      expect(
        await screen.findByText(/aún no tienes amigos/i)
      ).toBeInTheDocument();

      await goTo(/solicitudes/i);
      expect(
        await screen.findByRole("button", { name: /aceptar la solicitud/i })
      ).toBeEnabled();
    });

    it("gates Buscar with the username onboarding state", async () => {
      setup(NO_USERNAME);
      await goTo(/buscar/i);

      expect(
        await screen.findByText(/elige tu nombre de usuario/i)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/necesitas un nombre de usuario/i)
      ).toBeInTheDocument();
    });

    it("offers a route to the profile editing flow", async () => {
      setup(NO_USERNAME);
      await goTo(/buscar/i);

      expect(
        await screen.findByRole("link", { name: /configurar mi perfil/i })
      ).toHaveAttribute("href", "/profile");
    });

    it("renders no search box at all", async () => {
      setup(NO_USERNAME);
      await goTo(/buscar/i);
      await screen.findByText(/elige tu nombre de usuario/i);

      expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    });

    it("executes NO search RPC", async () => {
      setup(NO_USERNAME);
      await goTo(/buscar/i);
      await screen.findByText(/elige tu nombre de usuario/i);

      // The panel is not mounted, so its hooks cannot fire.
      expect(backend.callCount("search_public_users")).toBe(0);
      expect(backend.callCount("get_sent_friend_requests")).toBe(0);
    });
  });

  describe("CASE 2 — username but private", () => {
    it("keeps existing friends and requests usable", async () => {
      makeBackend(PRIVATE).receiveRequestFrom(AURORA);
      renderPortal();

      await goTo(/solicitudes/i);
      expect(
        await screen.findByRole("button", { name: /rechazar la solicitud/i })
      ).toBeEnabled();
    });

    it("gates Buscar with the privacy state", async () => {
      setup(PRIVATE);
      await goTo(/buscar/i);

      expect(
        await screen.findByText(/tu perfil está privado/i)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/activa tu perfil público/i)
      ).toBeInTheDocument();
    });

    it("reassures that existing relationships still work", async () => {
      setup(PRIVATE);
      await goTo(/buscar/i);

      expect(
        await screen.findByText(/tus amigos actuales.*siguen funcionando/i)
      ).toBeInTheDocument();
    });

    it("points at the existing privacy control rather than repeating it", async () => {
      setup(PRIVATE);
      await goTo(/buscar/i);

      expect(
        await screen.findByRole("link", { name: /hacer público mi perfil/i })
      ).toHaveAttribute("href", "/profile");
      // No duplicated username field or toggle.
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    });

    it("executes NO search RPC", async () => {
      setup(PRIVATE);
      await goTo(/buscar/i);
      await screen.findByText(/tu perfil está privado/i);

      expect(backend.callCount("search_public_users")).toBe(0);
    });
  });

  describe("CASE 3 — username + public", () => {
    it("renders the normal search experience", async () => {
      setup(ELIGIBLE);
      await goTo(/buscar/i);

      expect(
        await screen.findByRole("searchbox", { name: /buscar personas/i })
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/elige tu nombre de usuario/i)
      ).not.toBeInTheDocument();
    });

    it("searches and can send a new request", async () => {
      setup(ELIGIBLE);
      await goTo(/buscar/i);

      const box = await screen.findByRole("searchbox", {
        name: /buscar personas/i,
      });
      await user().type(box, "auro");

      const add = await screen.findByRole(
        "button",
        { name: /enviar solicitud de amistad a aurora/i },
        { timeout: 3000 }
      );
      await user().click(add);

      expect(await screen.findByText("Pendiente")).toBeInTheDocument();
      expect(
        backend.requests.filter((r) => r.status === "pending")
      ).toHaveLength(1);
    });
  });

  describe("CASE 6 — stale frontend, sender became private", () => {
    it("reports the refusal and shows no false pending state", async () => {
      setup(ELIGIBLE);
      await goTo(/buscar/i);

      const box = await screen.findByRole("searchbox", {
        name: /buscar personas/i,
      });
      await user().type(box, "auro");

      const add = await screen.findByRole(
        "button",
        { name: /enviar solicitud/i },
        { timeout: 3000 }
      );

      // Between render and click, this user went private in another tab.
      backend.failNext("send_friend_request", "social_public_profile_required");

      await user().click(add);

      await waitFor(() => expect(errorAlert).toHaveBeenCalled());
      const [error] = errorAlert.mock.calls[0];
      expect(error.code).toBe("social_public_profile_required");
      expect(error.message).toMatch(/privado/i);

      // The three things that must NOT happen.
      expect(successToast).not.toHaveBeenCalled();
      expect(backend.requests).toHaveLength(0);
      expect(screen.queryByText("Pendiente")).not.toBeInTheDocument();
    });

    it("re-reads the viewer's own eligibility after such a refusal", async () => {
      setup(ELIGIBLE);
      await goTo(/buscar/i);

      const box = await screen.findByRole("searchbox", {
        name: /buscar personas/i,
      });
      await user().type(box, "auro");
      const add = await screen.findByRole(
        "button",
        { name: /enviar solicitud/i },
        { timeout: 3000 }
      );

      // The refusal is true: their profile really is private now.
      backend.viewer.isProfilePublic = false;
      backend.failNext("send_friend_request", "social_public_profile_required");

      await user().click(add);

      // The gate closes behind them instead of leaving a box that can only fail.
      expect(
        await screen.findByText(/tu perfil está privado/i)
      ).toBeInTheDocument();
    });

    it("maps a missing-username refusal to actionable Spanish", async () => {
      setup(ELIGIBLE);
      await goTo(/buscar/i);

      const box = await screen.findByRole("searchbox", {
        name: /buscar personas/i,
      });
      await user().type(box, "auro");
      const add = await screen.findByRole(
        "button",
        { name: /enviar solicitud/i },
        { timeout: 3000 }
      );

      backend.failNext("send_friend_request", "social_username_required");
      await user().click(add);

      await waitFor(() => expect(errorAlert).toHaveBeenCalled());
      const [error] = errorAlert.mock.calls[0];
      expect(error.message).toMatch(/nombre de usuario/i);
      expect(error.message).not.toMatch(/social_username_required/);
      expect(successToast).not.toHaveBeenCalled();
    });
  });
});
