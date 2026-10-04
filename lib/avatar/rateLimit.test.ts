import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { claimAvatarUploadSlot } from "./rateLimit";

const rpc = vi.fn();
const client = { rpc } as unknown as SupabaseClient<Database>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("claimAvatarUploadSlot", () => {
  it("allows when the function grants a slot", async () => {
    rpc.mockResolvedValue({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null });
    expect(await claimAvatarUploadSlot(client)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("claim_avatar_upload_slot");
  });

  it("reports the wait when the limit is hit", async () => {
    rpc.mockResolvedValue({ data: [{ allowed: false, retry_after_seconds: 312 }], error: null });
    expect(await claimAvatarUploadSlot(client)).toEqual({
      ok: false,
      reason: "limited",
      retryAfterSeconds: 312,
    });
  });

  it("never reports a zero or negative wait", async () => {
    rpc.mockResolvedValue({ data: [{ allowed: false, retry_after_seconds: 0 }], error: null });
    expect(await claimAvatarUploadSlot(client)).toMatchObject({ retryAfterSeconds: 1 });
  });

  it.each([
    ["an RPC error", { data: null, error: { message: "boom" } }],
    ["an empty result", { data: [], error: null }],
  ])("fails closed on %s", async (_name, response) => {
    rpc.mockResolvedValue(response);
    expect(await claimAvatarUploadSlot(client)).toEqual({ ok: false, reason: "error" });
  });
});
