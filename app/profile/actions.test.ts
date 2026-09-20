import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeSupabaseMock, type SupabaseMockConfig } from "@/test/helpers/supabaseMock";

// createClient + revalidatePath are hoisted mocks so the action resolves against
// our fake client instead of a real request/database.
const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateRankingSettingsAction } from "./actions";

function setup(config: SupabaseMockConfig) {
  const mock = makeSupabaseMock(config);
  createClientMock.mockReturnValue(mock.client);
  return mock;
}

describe("updateRankingSettingsAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves a username with the opt-in enabled", async () => {
    const mock = setup({ user: { id: "u1" } });

    const res = await updateRankingSettingsAction({
      username: "aurora.cr",
      show_in_ranking: true,
    });

    expect(res.ok).toBe(true);
    expect(mock.captured.update?.table).toBe("profiles");
    expect(mock.captured.update?.row).toEqual({
      username: "aurora.cr",
      show_in_ranking: true,
    });
    expect(res.data).toEqual({
      username: "aurora.cr",
      show_in_ranking: true,
      is_profile_public: true,
    });
  });

  it("trims the username before writing", async () => {
    const mock = setup({ user: { id: "u1" } });
    await updateRankingSettingsAction({
      username: "   aurora   ",
      show_in_ranking: false,
    });
    expect(mock.captured.update?.row.username).toBe("aurora");
  });

  it("saves a username without opting in", async () => {
    const mock = setup({ user: { id: "u1" } });

    const res = await updateRankingSettingsAction({
      username: "aurora",
      show_in_ranking: false,
    });

    expect(res.ok).toBe(true);
    expect(mock.captured.update?.row.show_in_ranking).toBe(false);
  });

  it("clears the username and auto-disables the opt-in", async () => {
    // The state the requirement calls out: removing a username while visible
    // must resolve to something valid rather than erroring or leaving the user
    // published under a name that no longer exists.
    const mock = setup({ user: { id: "u1" } });

    const res = await updateRankingSettingsAction({
      username: "",
      show_in_ranking: true,
    });

    // The schema rejects that pair outright — the user never reaches the
    // database in an invalid state.
    expect(res.ok).toBe(false);
    expect(mock.captured.update).toBeUndefined();
  });

  it("writes null + false when the username is cleared and the toggle is off", async () => {
    const mock = setup({ user: { id: "u1" } });

    const res = await updateRankingSettingsAction({
      username: "",
      show_in_ranking: false,
    });

    expect(res.ok).toBe(true);
    expect(mock.captured.update?.row).toEqual({
      username: null,
      show_in_ranking: false,
    });
  });

  it("refuses to publish an invalid username", async () => {
    const mock = setup({ user: { id: "u1" } });

    const res = await updateRankingSettingsAction({
      username: "a b",
      show_in_ranking: true,
    });

    expect(res.ok).toBe(false);
    // Nothing was written — a frontend that skipped validation gains nothing.
    expect(mock.captured.update).toBeUndefined();
  });

  it("refuses a reserved username", async () => {
    const mock = setup({ user: { id: "u1" } });
    const res = await updateRankingSettingsAction({
      username: "admin",
      show_in_ranking: true,
    });
    expect(res.ok).toBe(false);
    expect(mock.captured.update).toBeUndefined();
  });

  it("rejects a guest (not signed in)", async () => {
    const mock = setup({ user: null });

    const res = await updateRankingSettingsAction({
      username: "aurora",
      show_in_ranking: true,
    });

    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/iniciar sesión/i);
    expect(mock.captured.update).toBeUndefined();
  });

  it("never takes a user id from the caller", async () => {
    // The payload has no id field by design; the row written is the one that
    // auth.getUser() resolved. This asserts the action didn't grow one.
    const mock = setup({ user: { id: "u1" } });
    await updateRankingSettingsAction({
      username: "aurora",
      show_in_ranking: true,
    });
    expect(mock.captured.update?.row).not.toHaveProperty("id");
  });

  it("explains a duplicate username instead of leaking the constraint error", async () => {
    setup({
      user: { id: "u1" },
      updateError: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "idx_profiles_username_lower"',
      },
    });

    const res = await updateRankingSettingsAction({
      username: "aurora",
      show_in_ranking: true,
    });

    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/ya está en uso/i);
    expect(res.message).not.toMatch(/constraint|duplicate key/i);
  });

  it("explains a CHECK violation without exposing it", async () => {
    setup({
      user: { id: "u1" },
      updateError: {
        code: "23514",
        message:
          'new row violates check constraint "profiles_username_format"',
      },
    });

    const res = await updateRankingSettingsAction({
      username: "aurora",
      show_in_ranking: true,
    });

    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/formato/i);
    expect(res.message).not.toMatch(/check constraint/i);
  });

  it("falls back to a generic message on an unknown database error", async () => {
    setup({
      user: { id: "u1" },
      updateError: { code: "08006", message: "connection failure" },
    });

    const res = await updateRankingSettingsAction({
      username: "aurora",
      show_in_ranking: true,
    });

    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/no pudimos guardar/i);
    expect(res.message).not.toMatch(/connection failure/i);
  });
});
