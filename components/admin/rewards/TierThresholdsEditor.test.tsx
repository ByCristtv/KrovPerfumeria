import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...(props as object)} />,
}));
vi.mock("sweetalert2", () => ({ default: { fire: vi.fn() } }));
const { saveMock } = vi.hoisted(() => ({ saveMock: vi.fn() }));
vi.mock("@/app/admin/rewards/actions", () => ({ saveLevelThresholdsAction: saveMock }));

import Swal from "sweetalert2";
import TierThresholdsEditor from "./TierThresholdsEditor";
import { TEST_LADDER } from "@/test/helpers/rankLadder";

const STAMP = "2026-11-09T10:00:00.123456+00:00";
const fire = Swal.fire as unknown as ReturnType<typeof vi.fn>;

function setup(readOnly = false) {
  render(<TierThresholdsEditor ladder={TEST_LADDER} levelsUpdatedAt={STAMP} readOnly={readOnly} />);
}

const field = (rank: string) => screen.getByLabelText(new RegExp(`^${rank}`)) as HTMLInputElement;
const save = () => screen.getByRole("button", { name: "Guardar umbrales" });
const type = (rank: string, value: string) => fireEvent.change(field(rank), { target: { value } });

beforeEach(() => {
  vi.clearAllMocks();
  fire.mockResolvedValue({ isConfirmed: true });
  saveMock.mockResolvedValue({ ok: true, message: "Umbrales guardados (1 rango).", data: {} });
});

describe("TierThresholdsEditor — layout", () => {
  it("lists every rank in progression order with its stored XP", () => {
    setup();
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => within(li).getByRole("textbox").getAttribute("id"))).toEqual([
      "tier-xp-1",
      "tier-xp-2",
      "tier-xp-3",
      "tier-xp-4",
      "tier-xp-5",
    ]);
    expect(TEST_LADDER.map((t) => field(t.rank).value)).toEqual(["0", "1000", "5000", "10000", "18000"]);
  });

  it("shows the rank each one must exceed", () => {
    setup();
    const conocedor = field("Conocedor").closest("li")!;
    expect(conocedor).toHaveTextContent("Debe superar a Coleccionista (1,000 XP)");
  });

  it("locks the entry rank at 0", () => {
    setup();
    expect(field("Aficionado")).toBeDisabled();
    expect(field("Aficionado").closest("li")).toHaveTextContent("Fijo en 0 XP.");
  });

  it("starts with nothing to save", () => {
    setup();
    expect(save()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Descartar cambios" })).toBeDisabled();
  });
});

describe("TierThresholdsEditor — validation", () => {
  it("flags identical adjacent thresholds on the higher rank and blocks saving", () => {
    setup();
    type("Conocedor", "1000");
    expect(field("Conocedor")).toHaveAttribute("aria-invalid", "true");
    expect(field("Conocedor").closest("li")).toHaveTextContent(/misma XP/);
    expect(save()).toBeDisabled();
  });

  it("explains the knock-on conflict of raising a rank past the next one", () => {
    setup();
    type("Conocedor", "12000");
    expect(field("Conocedor")).not.toHaveAttribute("aria-invalid");
    expect(field("Alquimista")).toHaveAttribute("aria-invalid", "true");
    expect(field("Alquimista").closest("li")).toHaveTextContent(/Sube Alquimista o baja Conocedor/);
    // The reference updates live to the proposed value.
    expect(field("Alquimista").closest("li")).toHaveTextContent("Debe superar a Conocedor (12,000 XP)");
  });

  it.each([
    ["-5", /negativa/],
    ["1500.5", /entero/],
    ["", /Ingresa/],
  ])("rejects %j", (value, message) => {
    setup();
    type("Coleccionista", value);
    expect(field("Coleccionista").closest("li")).toHaveTextContent(message);
    expect(save()).toBeDisabled();
  });

  it("enables saving once the whole ladder is valid again", () => {
    setup();
    type("Conocedor", "12000");
    expect(save()).toBeDisabled();
    type("Alquimista", "13000");
    expect(save()).toBeEnabled();
  });

  it("discards back to the stored values", () => {
    setup();
    type("Maestro", "25000");
    fireEvent.click(screen.getByRole("button", { name: "Descartar cambios" }));
    expect(field("Maestro").value).toBe("18000");
  });
});

describe("TierThresholdsEditor — saving", () => {
  it("confirms the changes, then submits every rank with the lock token", async () => {
    setup();
    type("Coleccionista", "800");
    fireEvent.click(save());

    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    const dialog = fire.mock.calls[0][0] as { html: string };
    expect(dialog.html).toContain("Coleccionista</b>: 1,000 → 800 XP");
    expect(dialog.html).toMatch(/bajar/); // explains that lowering promotes customers now
    expect(saveMock).toHaveBeenCalledWith({
      thresholds: [
        { level: 1, value: "0" },
        { level: 2, value: "800" },
        { level: 3, value: "5000" },
        { level: 4, value: "10000" },
        { level: 5, value: "18000" },
      ],
      expectedUpdatedAt: STAMP,
    });
  });

  it("does nothing when the admin cancels the confirmation", async () => {
    fire.mockResolvedValueOnce({ isConfirmed: false });
    setup();
    type("Maestro", "20000");
    fireEvent.click(save());
    await waitFor(() => expect(fire).toHaveBeenCalled());
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("shows the server's reason when the save is rejected", async () => {
    saveMock.mockResolvedValueOnce({ ok: false, message: "Otro administrador cambió los umbrales…" });
    setup();
    type("Maestro", "20000");
    fireEvent.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Otro administrador");
  });

  it("is read-only while the migrations are pending", () => {
    setup(true);
    expect(field("Coleccionista")).toBeDisabled();
    expect(save()).toBeDisabled();
  });
});
