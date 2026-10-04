import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/profile/actions", () => ({ updateRankingSettingsAction: vi.fn() }));

// The real downscaler needs a canvas, which jsdom lacks (see prepareUpload.test.ts).
// Pass-through by default; individual tests override it.
const { prepareMock } = vi.hoisted(() => ({ prepareMock: vi.fn() }));
vi.mock("@/lib/avatar/prepareUpload", () => ({ prepareAvatarForUpload: prepareMock }));

import IdentitySection from "./IdentitySection";

const onSaved = vi.fn();
const fetchMock = vi.fn();

function renderSection(avatarUrl: string | null = null) {
  return render(
    <IdentitySection
      fullName="Aurora Solís"
      avatarUrl={avatarUrl}
      username={null}
      showInRanking={false}
      isProfilePublic={false}
      onSaved={onSaved}
    />
  );
}

const cameraButton = () => screen.getByRole("button", { name: /cambiar foto de perfil/i });
const fileInput = (container: HTMLElement) =>
  container.querySelector<HTMLInputElement>('input[type="file"]')!;
const file = (type: string, bytes = 1024, name = "x") =>
  new File([new Uint8Array(bytes)], name, { type });

const avatarImg = (container: HTMLElement) => container.querySelector("img")!;

/** A promise the test resolves by hand, to observe the in-flight state. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  prepareMock.mockImplementation(async (f: File) => f);
  vi.stubGlobal("fetch", fetchMock);
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("IdentitySection — profile photo", () => {
  it("offers an accessible camera button and a restricted, hidden file input", () => {
    const { container } = renderSection();

    expect(cameraButton()).toBeEnabled();
    const input = fileInput(container);
    expect(input.accept).toBe("image/jpeg,image/png,image/webp");
    expect(input).toHaveClass("hidden");
  });

  it("opens the file picker when the button is pressed", async () => {
    const { container } = renderSection();
    const click = vi.spyOn(fileInput(container), "click");

    await userEvent.setup().click(cameraButton());

    expect(click).toHaveBeenCalledTimes(1);
  });

  it("rejects a disallowed type on the client without calling the server", () => {
    const { container } = renderSection();

    fireEvent.change(fileInput(container), { target: { files: [file("image/gif")] } });

    expect(screen.getByRole("alert")).toHaveTextContent(/formato no permitido/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a file over 10 MB on the client without calling the server", () => {
    const { container } = renderSection();

    fireEvent.change(fileInput(container), {
      target: { files: [file("image/png", 10 * 1024 * 1024 + 1)] },
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/10 MB/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uploads, shows the new photo optimistically under a busy state, then refreshes", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    const { container } = renderSection("https://lh3.googleusercontent.com/a/old");

    fireEvent.change(fileInput(container), { target: { files: [file("image/png")] } });

    // In flight: optimistic preview, spinner status, button locked.
    await waitFor(() => expect(cameraButton()).toBeDisabled());
    expect(avatarImg(container)).toHaveAttribute("src", "blob:preview");
    expect(screen.getByRole("status")).toHaveTextContent(/subiendo/i);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/profile/avatar");
    expect(init.method).toBe("POST");
    expect((init.body as FormData).get("avatar")).toBeInstanceOf(File);

    pending.resolve(
      new Response(JSON.stringify({ ok: true, message: "Foto actualizada." }), { status: 200 })
    );

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(cameraButton()).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("uploads the DOWNSCALED file, not the camera original", async () => {
    const shrunk = new File([new Uint8Array(300_000)], "avatar.webp", { type: "image/webp" });
    prepareMock.mockResolvedValue(shrunk);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const { container } = renderSection();

    const original = file("image/jpeg", 9 * 1024 * 1024, "IMG_0001.JPG");
    fireEvent.change(fileInput(container), { target: { files: [original] } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(prepareMock).toHaveBeenCalledWith(original);
    const sent = (fetchMock.mock.calls[0][1].body as FormData).get("avatar") as File;
    expect(sent.name).toBe("avatar.webp");
    expect(sent.size).toBe(300_000);
  });

  it("shows the reason and doesn't upload when the photo can't be prepared", async () => {
    prepareMock.mockRejectedValue(new Error("No pudimos preparar tu foto para subirla."));
    const { container } = renderSection();

    fireEvent.change(fileInput(container), {
      target: { files: [file("image/jpeg", 9 * 1024 * 1024)] },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(/no pudimos preparar/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cameraButton()).toBeEnabled();
  });

  it("shows the rate-limit message from the server", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, message: "Cambiaste tu foto demasiadas veces. Intenta de nuevo en 8 min." }),
        { status: 429 }
      )
    );
    const { container } = renderSection();

    fireEvent.change(fileInput(container), { target: { files: [file("image/png")] } });

    expect(await screen.findByRole("alert")).toHaveTextContent(/demasiadas veces/i);
  });

  it("falls back to the previous photo and shows the server's message on failure", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, message: "No pudimos leer la imagen. Prueba con otra." }),
        { status: 422 }
      )
    );
    const { container } = renderSection("https://lh3.googleusercontent.com/a/old");

    fireEvent.change(fileInput(container), { target: { files: [file("image/jpeg")] } });

    expect(await screen.findByRole("alert")).toHaveTextContent(/no pudimos leer la imagen/i);
    expect(avatarImg(container).getAttribute("src")).not.toBe("blob:preview");
    expect(onSaved).not.toHaveBeenCalled();
    expect(cameraButton()).toBeEnabled();
  });

  it("reports a network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));
    const { container } = renderSection();

    fireEvent.change(fileInput(container), { target: { files: [file("image/webp")] } });

    expect(await screen.findByRole("alert")).toHaveTextContent(/conexión/i);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("ignores an avatar URL on a host next/image isn't configured for", () => {
    const { container } = renderSection("https://evil.example/pic.png");

    expect(avatarImg(container).getAttribute("src")).toContain("UserAnonimous");
  });
});
