import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  makeFakeSocialBackend,
  type FakeSocialBackend,
} from "@/test/helpers/fakeSocialBackend";

/**
 * The friendship lifecycle, end to end.
 *
 * Everything below the components is REAL: the hooks, the data-access layer,
 * the query keys, the invalidation policy and a real QueryClient. Only the
 * network is replaced, by a fake that enforces the same invariants the SQL
 * does. That is what makes these tests worth more than the unit suites — they
 * prove the mutate → invalidate → refetch → re-render loop actually converges,
 * which is the property the whole MVP rests on and the one no unit test sees.
 *
 * Covers CASES 1-8 from the task's validation list.
 */

const ME = "me-1";
const AURORA = "u-aurora";
const BOREAL = "u-boreal";

let backend: FakeSocialBackend;

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    // Indirection through the mutable `backend`, so each test gets a fresh one.
    rpc: (name: string, args: Record<string, unknown>) =>
      backend.rpc(name, args),
    // getSocialEligibility reads the viewer's own profiles row directly.
    from: (table: string) => backend.from(table),
  },
}));

vi.mock("@/hooks/useAuthUser", () => ({
  useAuthUser: () => ({
    user: { id: ME, email: "me@krov.cr" },
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

// SweetAlert2 needs a real document paint cycle we do not care about here; the
// feedback helpers are asserted separately in their own units.
const { successToast, errorAlert } = vi.hoisted(() => ({
  successToast: vi.fn(),
  errorAlert: vi.fn(),
}));
vi.mock("@/components/social/socialAlerts", () => ({
  socialSuccessToast: successToast,
  socialErrorAlert: errorAlert,
}));

import FriendsView from "./FriendsView";

function renderPortal() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <FriendsView />
    </QueryClientProvider>
  );
}

const user = () => userEvent.setup();

/** Open a portal section by its segmented-control label. */
async function goTo(section: RegExp) {
  await user().click(screen.getByRole("radio", { name: section }));
}

/** Type into the search box and wait out the 350ms debounce. */
async function search(term: string) {
  await goTo(/buscar/i);
  const box = await screen.findByRole("searchbox", {
    name: /buscar personas/i,
  });
  await user().type(box, term);
}

const profile = (id: string, username: string, isPublic = true) => ({
  id,
  username,
  avatarUrl: null,
  experiencePoints: 5200,
  fullName: "Nombre Real",
  isPublic,
});

describe("friendship lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    backend = makeFakeSocialBackend(ME, [
      profile(AURORA, "aurora"),
      profile(BOREAL, "borealis"),
    ]);
  });

  afterEach(() => vi.restoreAllMocks());

  describe("CASE 1 — send a request", () => {
    it("flips the row from Agregar to Pendiente without a reload", async () => {
      renderPortal();
      await search("auro");

      const add = await screen.findByRole(
        "button",
        { name: /enviar solicitud de amistad a aurora/i },
        { timeout: 3000 }
      );
      await user().click(add);

      // The mutation invalidated the search + sent lists; the refetched row is
      // what changes the label. Nothing was faked locally.
      expect(await screen.findByText("Pendiente")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /cancelar la solicitud/i })
      ).toBeInTheDocument();
      expect(successToast).toHaveBeenCalledWith("Solicitud enviada");
    });

    it("creates exactly one pending request", async () => {
      renderPortal();
      await search("auro");
      await user().click(
        await screen.findByRole(
          "button",
          { name: /enviar solicitud/i },
          { timeout: 3000 }
        )
      );
      await screen.findByText("Pendiente");

      expect(
        backend.requests.filter((r) => r.status === "pending")
      ).toHaveLength(1);
    });
  });

  describe("CASE 7 — duplicate click", () => {
    it("does not create a second request when Agregar is clicked twice", async () => {
      renderPortal();
      await search("auro");

      const add = await screen.findByRole(
        "button",
        { name: /enviar solicitud/i },
        { timeout: 3000 }
      );

      // Two clicks as fast as the harness allows.
      await user().click(add);
      await user().click(add).catch(() => {});

      await screen.findByText("Pendiente");

      expect(backend.requests).toHaveLength(1);
      expect(backend.callCount("send_friend_request")).toBeLessThanOrEqual(2);
      // Even if a second call slipped through, the server is idempotent, so
      // the invariant that matters holds.
      expect(
        backend.requests.filter((r) => r.status === "pending")
      ).toHaveLength(1);
    });
  });

  describe("CASE 2 — cancel a request", () => {
    it("returns the row to Agregar and allows sending again", async () => {
      renderPortal();
      await search("auro");

      await user().click(
        await screen.findByRole(
          "button",
          { name: /enviar solicitud/i },
          { timeout: 3000 }
        )
      );
      await screen.findByText("Pendiente");

      await user().click(
        screen.getByRole("button", { name: /cancelar la solicitud/i })
      );

      expect(
        await screen.findByRole("button", { name: /enviar solicitud/i })
      ).toBeEnabled();
      expect(successToast).toHaveBeenCalledWith("Solicitud cancelada");
      expect(
        backend.requests.filter((r) => r.status === "pending")
      ).toHaveLength(0);

      // A cancelled request is not a block — the same person can be re-added.
      await user().click(
        screen.getByRole("button", { name: /enviar solicitud/i })
      );
      await screen.findByText("Pendiente");
      expect(
        backend.requests.filter((r) => r.status === "pending")
      ).toHaveLength(1);
    });
  });

  describe("CASE 3 — receive a request", () => {
    it("lists the sender in Solicitudes with both decisions available", async () => {
      backend.receiveRequestFrom(AURORA);
      renderPortal();

      await goTo(/solicitudes/i);

      expect(await screen.findByText("aurora")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /aceptar la solicitud de aurora/i })
      ).toBeEnabled();
      expect(
        screen.getByRole("button", { name: /rechazar la solicitud de aurora/i })
      ).toBeEnabled();
    });

    it("counts the pending requests on the tab, from server state", async () => {
      backend.receiveRequestFrom(AURORA);
      backend.receiveRequestFrom(BOREAL);
      renderPortal();

      const tab = await screen.findByRole("radio", { name: /solicitudes/i });
      await waitFor(() => expect(tab).toHaveAccessibleName(/2 pendientes/i));
    });
  });

  describe("CASE 8 — reverse request", () => {
    it("shows the incoming state in search and offers no way to duplicate it", async () => {
      backend.receiveRequestFrom(AURORA);
      renderPortal();
      await search("auro");

      expect(
        await screen.findByText("Solicitud recibida", undefined, {
          timeout: 3000,
        })
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /enviar solicitud/i })
      ).not.toBeInTheDocument();
      expect(backend.callCount("send_friend_request")).toBe(0);
    });

    it("routes to Solicitudes so the request can be answered", async () => {
      backend.receiveRequestFrom(AURORA);
      renderPortal();
      await search("auro");

      await user().click(
        await screen.findByRole(
          "button",
          { name: /responder la solicitud/i },
          { timeout: 3000 }
        )
      );

      expect(
        await screen.findByRole("button", { name: /aceptar la solicitud/i })
      ).toBeInTheDocument();
    });
  });

  describe("CASE 4 — accept a request", () => {
    it("empties the inbox, creates one friendship and updates search", async () => {
      backend.receiveRequestFrom(AURORA);
      renderPortal();

      await goTo(/solicitudes/i);
      await user().click(
        await screen.findByRole("button", { name: /aceptar la solicitud/i })
      );

      // Inbox drains.
      expect(
        await screen.findByText(/no tienes solicitudes pendientes/i)
      ).toBeInTheDocument();
      expect(successToast).toHaveBeenCalledWith("Solicitud aceptada");

      // Exactly ONE symmetric row, not two directional ones.
      expect(backend.friendships).toHaveLength(1);

      // The friends list now has them.
      await goTo(/amigos/i);
      expect(await screen.findByText("aurora")).toBeInTheDocument();

      // And so does search. Scoped to the result row: the portal's own
      // "Amigos" tab label would otherwise match too.
      await search("auro");
      const row = await screen.findByRole("listitem", undefined, {
        timeout: 3000,
      });
      await waitFor(() =>
        expect(within(row).getByText("Amigos")).toBeInTheDocument()
      );
    });
  });

  describe("CASE 5 — reject a request", () => {
    it("drains the inbox, creates no friendship, and permits a new request", async () => {
      backend.receiveRequestFrom(AURORA);
      renderPortal();

      await goTo(/solicitudes/i);
      await user().click(
        await screen.findByRole("button", { name: /rechazar la solicitud/i })
      );

      expect(
        await screen.findByText(/no tienes solicitudes pendientes/i)
      ).toBeInTheDocument();
      expect(backend.friendships).toHaveLength(0);
      expect(successToast).toHaveBeenCalledWith("Solicitud rechazada");

      // Not a block: the search offers Agregar again.
      await search("auro");
      expect(
        await screen.findByRole(
          "button",
          { name: /enviar solicitud/i },
          { timeout: 3000 }
        )
      ).toBeEnabled();
    });
  });

  describe("CASE 6 — remove a friend", () => {
    it("drops them from the list and returns search to none", async () => {
      backend.receiveRequestFrom(AURORA);
      renderPortal();

      await goTo(/solicitudes/i);
      await user().click(
        await screen.findByRole("button", { name: /aceptar la solicitud/i })
      );
      await goTo(/amigos/i);
      await screen.findByText("aurora");

      await user().click(
        screen.getByRole("button", { name: /eliminar a aurora/i })
      );
      const dialog = await screen.findByRole("dialog");
      await waitFor(() => expect(dialog).toHaveFocus());
      await user().click(
        within(dialog).getByRole("button", { name: /^eliminar$/i })
      );

      expect(
        await screen.findByText(/aún no tienes amigos/i)
      ).toBeInTheDocument();
      expect(backend.friendships).toHaveLength(0);
      expect(successToast).toHaveBeenCalledWith("Amigo eliminado");

      // Reversible: they can be added again.
      await search("auro");
      expect(
        await screen.findByRole(
          "button",
          { name: /enviar solicitud/i },
          { timeout: 3000 }
        )
      ).toBeEnabled();
    });
  });

  describe("CASE 9 — the target went private", () => {
    it("reports the refusal and does not claim success", async () => {
      renderPortal();
      await search("auro");

      const add = await screen.findByRole(
        "button",
        { name: /enviar solicitud/i },
        { timeout: 3000 }
      );

      // Between render and click, they made their profile private.
      backend.failNext("send_friend_request", "user_profile_is_private");
      backend.profiles.get(AURORA)!.isPublic = false;

      await user().click(add);

      await waitFor(() => expect(errorAlert).toHaveBeenCalled());
      const [error] = errorAlert.mock.calls[0];
      expect(error.code).toBe("user_profile_is_private");
      expect(error.isStale).toBe(true);
      expect(successToast).not.toHaveBeenCalled();
      expect(backend.requests).toHaveLength(0);
    });
  });

  describe("CASE 12 — a mutation fails", () => {
    it("shows a controlled error and never a false success", async () => {
      backend.receiveRequestFrom(AURORA);
      renderPortal();

      await goTo(/solicitudes/i);
      backend.failNext("accept_friend_request", "friend_request_is_not_pending");

      await user().click(
        await screen.findByRole("button", { name: /aceptar la solicitud/i })
      );

      await waitFor(() => expect(errorAlert).toHaveBeenCalled());
      expect(successToast).not.toHaveBeenCalled();
      expect(backend.friendships).toHaveLength(0);
      // The page is still usable.
      expect(
        screen.getByRole("radio", { name: /solicitudes/i })
      ).toBeInTheDocument();
    });
  });
});
