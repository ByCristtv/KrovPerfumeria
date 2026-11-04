import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compressImage } from "./imageCompression";

/**
 * jsdom has no canvas, so the encoder is scripted: each test decides which
 * formats this "browser" can really produce. An unsupported type comes back as
 * PNG, exactly as `toBlob` behaves in Safari for image/webp.
 */
const encodable = (...types: string[]) => (type: string) =>
  types.includes(type) ? type : "image/png";

let encode: (type: string) => string;
let encodedSize: number;
let alpha: number;
let context: { imageSmoothingQuality?: string; drawImage: ReturnType<typeof vi.fn>; getImageData: ReturnType<typeof vi.fn> };
let canvases: { width: number; height: number }[];

function installCanvas() {
  context = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([9, 9, 9, 255, 9, 9, 9, alpha]) })),
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function () {
    return context as unknown as CanvasRenderingContext2D;
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback,
    type
  ) {
    canvases.push({ width: this.width, height: this.height });
    callback(new Blob([new Uint8Array(encodedSize)], { type: encode(type ?? "image/png") }));
  });
}

function stubBitmap(width: number, height: number) {
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width, height, close: vi.fn() })));
}

/** A file of `size` bytes whose first bytes are `header`. */
function fileOf(name: string, type: string, header: number[] = [], size = 1000) {
  const bytes = new Uint8Array(size);
  bytes.set(header);
  const file = new File([bytes], name, { type });
  // jsdom's Blob lacks arrayBuffer(); every browser the app supports has it.
  file.slice = (start?: number, end?: number) =>
    ({ arrayBuffer: async () => bytes.slice(start, end).buffer }) as Blob;
  return file;
}

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
const PNG_HEADER = [0x89, ...ascii("PNG"), 13, 10, 26, 10];

beforeEach(() => {
  encode = encodable("image/webp", "image/jpeg");
  encodedSize = 100;
  alpha = 255;
  canvases = [];
  installCanvas();
  stubBitmap(800, 800);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("compressImage: labelling", () => {
  it("labels a real WebP as WebP", async () => {
    const out = await compressImage(fileOf("Khamrah.png", "image/png"));
    expect(out.type).toBe("image/webp");
    expect(out.name).toBe("Khamrah.webp");
  });

  it("falls back to JPEG, correctly named, when the browser cannot encode WebP", async () => {
    encode = encodable("image/jpeg");
    const out = await compressImage(fileOf("Khamrah.png", "image/png"));
    expect(out.type).toBe("image/jpeg");
    expect(out.name).toBe("Khamrah.jpg");
  });

  it("keeps a transparent image as PNG rather than flattening it to JPEG", async () => {
    encode = encodable("image/jpeg");
    alpha = 0;
    const out = await compressImage(fileOf("cutout.webp", "image/webp"));
    expect(out.type).toBe("image/png");
    expect(out.name).toBe("cutout.png");
  });

  it("does not scan pixels when WebP worked", async () => {
    await compressImage(fileOf("a.png", "image/png"));
    expect(context.getImageData).not.toHaveBeenCalled();
  });

  it("refuses an encoding it cannot name instead of guessing an extension", async () => {
    encode = () => "image/bmp";
    await expect(compressImage(fileOf("a.png", "image/png"))).rejects.toThrow(/optimizar/);
  });

  it("throws when the encoder returns nothing", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(null));
    await expect(compressImage(fileOf("a.png", "image/png"))).rejects.toThrow(/optimizar/);
  });
});

describe("compressImage: keeping the original", () => {
  beforeEach(() => {
    encodedSize = 5000; // Re-encoding made it bigger, so the original is kept.
  });

  it("returns the same file when its label is true", async () => {
    const file = fileOf("Qahwa.png", "image/png", PNG_HEADER);
    expect(await compressImage(file)).toBe(file);
  });

  it("keeps an AVIF that re-encoding cannot beat, as AVIF", async () => {
    const file = fileOf("Qahwa.avif", "image/avif", [0, 0, 0, 28, ...ascii("ftypavif")]);
    expect(await compressImage(file)).toBe(file);
  });

  it("corrects a PNG that was renamed to .webp", async () => {
    const out = await compressImage(fileOf("fake.webp", "image/webp", PNG_HEADER));
    expect(out.type).toBe("image/png");
    expect(out.name).toBe("fake.png");
  });

  it("leaves the label alone when the signature is unknown", async () => {
    const file = fileOf("odd.webp", "image/webp", [1, 2, 3, 4]);
    expect(await compressImage(file)).toBe(file);
  });
});

describe("compressImage: resizing", () => {
  it("draws with high-quality smoothing", async () => {
    await compressImage(fileOf("a.png", "image/png"));
    expect(context.imageSmoothingQuality).toBe("high");
  });

  it("caps the longest edge at 1600px and keeps the aspect ratio", async () => {
    stubBitmap(3200, 1600);
    await compressImage(fileOf("a.png", "image/png"));
    expect(canvases[0]).toEqual({ width: 1600, height: 800 });
  });

  it("never upscales", async () => {
    stubBitmap(375, 500);
    await compressImage(fileOf("a.png", "image/png"));
    expect(canvases[0]).toEqual({ width: 375, height: 500 });
  });

  it("encodes at the existing 0.82 quality", async () => {
    await compressImage(fileOf("a.png", "image/png"));
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      "image/webp",
      0.82
    );
  });

  it("passes an SVG through untouched", async () => {
    const file = fileOf("logo.svg", "image/svg+xml");
    expect(await compressImage(file)).toBe(file);
  });
});
