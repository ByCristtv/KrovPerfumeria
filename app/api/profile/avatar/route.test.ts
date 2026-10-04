// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";

const USER_ID = "11111111-2222-4333-8444-555555555555";
const OLD_KEY = `profile-photos/${USER_ID}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.webp`;
const STRANGER_KEY = "profile-photos/99999999-2222-4333-8444-555555555555/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.webp";

const m = vi.hoisted(() => ({
  getUser: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  selectProfile: vi.fn(),
  revalidatePath: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: m.getUser },
    rpc: m.rpc,
    storage: {
      from: () => ({
        upload: m.upload,
        remove: m.remove,
        list: m.list,
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/avatars/${path}` },
        }),
      }),
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: m.selectProfile }) }),
      update: (values: unknown) => ({ eq: () => m.update(values) }),
    }),
  }),
}));

import { POST } from "./route";

const png = () =>
  sharp({ create: { width: 640, height: 480, channels: 3, background: "#c33" } })
    .png()
    .toBuffer();

function req(file: Blob | null, headers: Record<string, string> = {}) {
  const body = new FormData();
  if (file) body.append("avatar", file, "../../etc/passwd.png");
  return new Request("https://shop.test/api/profile/avatar", {
    method: "POST",
    body,
    headers: { host: "shop.test", ...headers },
  }) as unknown as import("next/server").NextRequest;
}

const asNext = (r: Request) => {
  // NextRequest.nextUrl isn't needed by the handler; the Request API is enough.
  return r as unknown as import("next/server").NextRequest;
};

beforeEach(() => {
  vi.clearAllMocks();
  m.getUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  m.selectProfile.mockResolvedValue({ data: { avatar_url: null } });
  m.upload.mockResolvedValue({ error: null });
  m.update.mockResolvedValue({ error: null });
  m.remove.mockResolvedValue({ error: null });
  m.list.mockResolvedValue({ data: [] });
  m.rpc.mockResolvedValue({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null });
});

describe("POST /api/profile/avatar", () => {
  it("401s when signed out, before touching storage", async () => {
    m.getUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(asNext(req(new Blob([await png()]))));
    expect(res.status).toBe(401);
    expect(m.upload).not.toHaveBeenCalled();
  });

  describe("rate limit", () => {
    it("429s with Retry-After when the limit is hit, before reading the body or touching storage", async () => {
      m.rpc.mockResolvedValue({ data: [{ allowed: false, retry_after_seconds: 421 }], error: null });
      const res = await POST(asNext(req(new Blob([await png()], { type: "image/png" }))));

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("421");
      const json = await res.json();
      expect(json.code).toBe("rate_limited");
      expect(json.message).toMatch(/8 min/); // 421 s rounds up to 8 min
      expect(m.upload).not.toHaveBeenCalled();
      expect(m.update).not.toHaveBeenCalled();
    });

    it("claims through the RPC with no caller-supplied limit", async () => {
      await POST(asNext(req(new Blob([await png()], { type: "image/png" }))));
      expect(m.rpc).toHaveBeenCalledWith("claim_avatar_upload_slot");
    });

    it("fails closed (503) when the limiter can't be consulted", async () => {
      m.rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
      const res = await POST(asNext(req(new Blob([await png()], { type: "image/png" }))));

      expect(res.status).toBe(503);
      expect(m.upload).not.toHaveBeenCalled();
    });

    it("doesn't spend a slot on a signed-out or cross-site request", async () => {
      m.getUser.mockResolvedValue({ data: { user: null } });
      await POST(asNext(req(new Blob([await png()]))));
      m.getUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
      await POST(asNext(req(new Blob([await png()]), { origin: "https://evil.example" })));
      expect(m.rpc).not.toHaveBeenCalled();
    });
  });

  it("403s a cross-site Origin", async () => {
    const res = await POST(
      asNext(req(new Blob([await png()]), { origin: "https://evil.example" }))
    );
    expect(res.status).toBe(403);
    expect(m.upload).not.toHaveBeenCalled();
  });

  it("400s when no file is sent", async () => {
    const res = await POST(asNext(req(null)));
    expect(res.status).toBe(400);
  });

  it("422s a non-image even when it claims to be image/png", async () => {
    const fake = new Blob(["<script>alert(1)</script>"], { type: "image/png" });
    const res = await POST(asNext(req(fake)));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("unsupported_format");
    expect(m.upload).not.toHaveBeenCalled();
  });

  it("stores a server-generated name, never the uploaded one", async () => {
    const res = await POST(asNext(req(new Blob([await png()], { type: "image/png" }))));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);

    const [path, , options] = m.upload.mock.calls[0];
    expect(path).toMatch(
      new RegExp(`^profile-photos/${USER_ID}/[0-9a-f-]{36}\\.webp$`)
    );
    expect(path).not.toContain("passwd");
    expect(options).toMatchObject({ contentType: "image/webp", upsert: false });
    expect(json.avatarUrl).toContain(path);
  });

  it("uploads a 512×512 metadata-free WebP, not the original bytes", async () => {
    await POST(asNext(req(new Blob([await png()], { type: "image/png" }))));

    const stored: Buffer = m.upload.mock.calls[0][1];
    const meta = await sharp(stored).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 512, height: 512 });
    expect(meta.exif).toBeUndefined();
  });

  it("points the profile at the new URL and revalidates", async () => {
    await POST(asNext(req(new Blob([await png()], { type: "image/png" }))));

    expect(m.update).toHaveBeenCalledWith({
      avatar_url: expect.stringContaining(`/avatars/profile-photos/${USER_ID}/`),
    });
    expect(m.revalidatePath).toHaveBeenCalledWith("/profile");
  });

  it("deletes the previous photo and stale leftovers, but only this user's", async () => {
    m.selectProfile.mockResolvedValue({
      data: { avatar_url: `https://x.supabase.co/storage/v1/object/public/avatars/${OLD_KEY}` },
    });
    const orphan = "ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee.webp";
    m.list.mockResolvedValue({
      data: [
        { name: orphan },
        { name: ".emptyFolderPlaceholder" },
        { name: "unrelated.png" },
      ],
    });

    await POST(asNext(req(new Blob([await png()], { type: "image/png" }))));

    const newPath: string = m.upload.mock.calls[0][0];
    const removed: string[] = m.remove.mock.calls[0][0];
    // Listing is scoped to the caller's own folder.
    expect(m.list).toHaveBeenCalledWith(`profile-photos/${USER_ID}`, expect.anything());
    expect(removed.sort()).toEqual([OLD_KEY, `profile-photos/${USER_ID}/${orphan}`].sort());
    expect(removed).not.toContain(newPath);
    expect(removed).not.toContain(STRANGER_KEY);
  });

  it("leaves a Google picture alone (nothing of ours to delete)", async () => {
    m.selectProfile.mockResolvedValue({
      data: { avatar_url: "https://lh3.googleusercontent.com/a/abc" },
    });
    await POST(asNext(req(new Blob([await png()], { type: "image/png" }))));
    expect(m.remove).not.toHaveBeenCalled();
  });

  it("rolls the upload back if the profile update fails", async () => {
    m.update.mockResolvedValue({ error: { message: "boom" } });
    const res = await POST(asNext(req(new Blob([await png()], { type: "image/png" }))));

    expect(res.status).toBe(500);
    expect(m.remove).toHaveBeenCalledWith([m.upload.mock.calls[0][0]]);
    expect(m.revalidatePath).not.toHaveBeenCalled();
  });

  it("still succeeds when old-photo cleanup fails", async () => {
    m.selectProfile.mockResolvedValue({
      data: { avatar_url: `https://x.supabase.co/storage/v1/object/public/avatars/${OLD_KEY}` },
    });
    m.remove.mockResolvedValue({ error: { message: "nope" } });
    const res = await POST(asNext(req(new Blob([await png()], { type: "image/png" }))));
    expect(res.status).toBe(200);
  });

  it("reports an upload failure without touching the profile", async () => {
    m.upload.mockResolvedValue({ error: { message: "storage down" } });
    const res = await POST(asNext(req(new Blob([await png()], { type: "image/png" }))));
    expect(res.status).toBe(500);
    expect(m.update).not.toHaveBeenCalled();
  });
});
