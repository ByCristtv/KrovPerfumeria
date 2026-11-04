import { beforeEach, describe, expect, it, vi } from "vitest";

const upload = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({
        upload,
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/product-images/${path}` },
        }),
      }),
    },
  },
}));

vi.mock("@/services/imageCompression", () => ({
  compressImage: async (file: File) => file,
}));

import { uploadProductImage } from "./uploadProductImage";

describe("uploadProductImage", () => {
  beforeEach(() => {
    upload.mockReset();
    upload.mockResolvedValue({ error: null });
  });

  it("caches for a year, under a unique key, without ever overwriting", async () => {
    await uploadProductImage(new File(["x"], "Khamrah.webp", { type: "image/webp" }));

    const [path, , options] = upload.mock.calls[0];
    expect(path).toMatch(/^product-images\/[0-9a-f-]{36}-Khamrah\.webp$/);
    expect(options).toEqual({ cacheControl: "31536000" });
  });

  it("keeps the URL shape existing records rely on", async () => {
    const url = await uploadProductImage(new File(["x"], "a.webp", { type: "image/webp" }));
    expect(url).toMatch(
      /^https:\/\/x\.supabase\.co\/storage\/v1\/object\/public\/product-images\/product-images\/[0-9a-f-]{36}-a\.webp$/
    );
  });
});
