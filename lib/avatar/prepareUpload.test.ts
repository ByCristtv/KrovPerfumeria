import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fitWithin, prepareAvatarForUpload } from "./prepareUpload";
import {
  AVATAR_CLIENT_MAX_DIMENSION,
  AVATAR_MAX_UPLOAD_BYTES,
  AVATAR_SKIP_DOWNSCALE_BYTES,
} from "./constants";

const MB = 1024 * 1024;
const bigFile = (bytes: number, type = "image/jpeg") =>
  new File([new Uint8Array(bytes)], "IMG_0001.JPG", { type });

describe("fitWithin", () => {
  it("scales the longer side down to the cap, keeping the aspect ratio", () => {
    expect(fitWithin(4000, 3000, 1280)).toEqual({ width: 1280, height: 960 });
    expect(fitWithin(3000, 4000, 1280)).toEqual({ width: 960, height: 1280 });
  });

  it("never scales up", () => {
    expect(fitWithin(800, 600, 1280)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1280, 1280, 1280)).toEqual({ width: 1280, height: 1280 });
  });

  it("never collapses a dimension to zero", () => {
    expect(fitWithin(100000, 10, 1280).height).toBeGreaterThanOrEqual(1);
  });
});

describe("prepareAvatarForUpload", () => {
  const drawImage = vi.fn();
  let canvasSize: { width: number; height: number };
  /** What toBlob should produce: [type it claims, byte size] per call, in order. */
  let encodeQueue: Array<[string, number]>;
  const encoded: Array<{ type: string; quality: number }> = [];
  const bitmapClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    encoded.length = 0;
    encodeQueue = [];

    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 4000, height: 3000, close: bitmapClose }))
    );

    const ctx = {
      drawImage,
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn(),
      imageSmoothingQuality: "low",
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
      this: HTMLCanvasElement,
      cb: BlobCallback,
      type?: string,
      quality?: number
    ) {
      canvasSize = { width: this.width, height: this.height };
      encoded.push({ type: type ?? "", quality: quality ?? 0 });
      const [claimedType, size] = encodeQueue.shift() ?? [type ?? "image/webp", 200 * 1024];
      cb(new Blob([new Uint8Array(size)], { type: claimedType }));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends small files untouched, without decoding", async () => {
    const small = bigFile(AVATAR_SKIP_DOWNSCALE_BYTES);
    const out = await prepareAvatarForUpload(small);

    expect(out).toBe(small);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("downscales a camera original to a WebP under the Vercel-safe ceiling", async () => {
    const original = bigFile(9 * MB);
    const out = await prepareAvatarForUpload(original);

    expect(out.type).toBe("image/webp");
    expect(out.name).toBe("avatar.webp"); // the camera filename is not carried along
    expect(out.size).toBeLessThanOrEqual(AVATAR_MAX_UPLOAD_BYTES);
    expect(out.size).toBeLessThan(original.size);
    expect(Math.max(canvasSize.width, canvasSize.height)).toBe(AVATAR_CLIENT_MAX_DIMENSION);
    expect(canvasSize).toEqual({ width: 1280, height: 960 });
    expect(bitmapClose).toHaveBeenCalled();
  });

  it("asks the decoder to honour EXIF orientation", async () => {
    await prepareAvatarForUpload(bigFile(5 * MB));
    expect(createImageBitmap).toHaveBeenCalledWith(expect.any(File), {
      imageOrientation: "from-image",
    });
  });

  it("steps quality down until the result fits", async () => {
    encodeQueue = [
      ["image/webp", 100], // format probe
      ["image/webp", 6 * MB], // 0.85 too big
      ["image/webp", 4 * MB], // 0.75 too big
      ["image/webp", 1 * MB], // 0.65 fits
    ];
    const out = await prepareAvatarForUpload(bigFile(9 * MB));

    expect(out.size).toBe(1 * MB);
    expect(encoded.map((e) => e.quality)).toEqual([0.85, 0.85, 0.75, 0.65]);
  });

  it("falls back to JPEG when the browser can't encode WebP (returns PNG instead)", async () => {
    encodeQueue = [["image/png", 100]]; // probe: asked for webp, got png
    const out = await prepareAvatarForUpload(bigFile(9 * MB));

    expect(out.type).toBe("image/jpeg");
    expect(out.name).toBe("avatar.jpg");
    expect(encoded.at(-1)?.type).toBe("image/jpeg");
  });

  it("sends the original when shrinking fails but it already fits", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("decode failed")));
    const original = bigFile(2 * MB);

    expect(await prepareAvatarForUpload(original)).toBe(original);
  });

  it("refuses with a user-facing message when it can neither shrink nor send the original", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("decode failed")));

    await expect(prepareAvatarForUpload(bigFile(9 * MB))).rejects.toThrow(
      /no pudimos preparar tu foto/i
    );
  });
});
