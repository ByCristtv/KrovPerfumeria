/**
 * Client-side image compression.
 *
 * A single, dependency-free service that every product-image upload flow runs
 * its files through *before* they reach Supabase Storage. It downscales
 * oversized images, re-encodes them at a high-but-efficient quality, and (as a
 * free side effect of canvas re-encoding) strips EXIF/metadata.
 *
 * Design goals:
 *   - Reusable: the upload layer (`services/uploadProductImage.ts`) receives an
 *     already-optimized File and stays ignorant of *how* it was optimized.
 *   - Safe: never upscale, never emit a file larger than the original, and
 *     never silently produce a corrupted file — on any failure we throw a
 *     clear, user-facing error so the caller can abort the upload.
 *   - Transparent: same File contract in/out, so naming conventions and the
 *     rest of the pipeline keep working unchanged.
 */

export interface CompressImageOptions {
  /** Longest edge (px) the output may reach. Images already smaller are left
   *  at their native size — we never upscale. Default 1600. */
  maxDimension?: number;
  /** Lossy encoder quality, 0–1. Default 0.82 (visually excellent, small). */
  quality?: number;
  /** Preferred output MIME type. Default "image/webp" — great compression +
   *  alpha. The file returned always says what was actually encoded. */
  mimeType?: "image/webp" | "image/jpeg";
}

const DEFAULTS: Required<CompressImageOptions> = {
  maxDimension: 1600,
  quality: 0.82,
  mimeType: "image/webp",
};

/**
 * Extensions we swap the filename to, keyed by the format actually encoded.
 * PNG is what a browser's canvas emits for a type it cannot encode, and what we
 * keep when an image has transparency and WebP is unavailable.
 */
const EXTENSION_BY_MIME: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/avif": "avif",
  "image/gif": "gif",
};

/**
 * Compress a single image File. Returns a new, optimized File on success.
 *
 * If the source isn't a raster image we can decode (or the browser lacks the
 * needed APIs), the original File is returned untouched — compression is a
 * best-effort optimization, not a gate. Genuine decode/encode failures throw.
 */
export async function compressImage(
  file: File,
  options: CompressImageOptions = {}
): Promise<File> {
  const opts = { ...DEFAULTS, ...options };

  // Only raster images are compressible. SVGs, unknown types, or a
  // non-browser (SSR) context fall through unchanged.
  if (
    typeof document === "undefined" ||
    !file.type.startsWith("image/") ||
    file.type === "image/svg+xml"
  ) {
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    // `imageOrientation: "from-image"` bakes in EXIF rotation so the output
    // isn't sideways once the original metadata is dropped.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Couldn't decode (corrupt or unsupported). Don't upload a file we can't
    // even read — surface a clear error.
    throw new Error("No pudimos procesar la imagen. Verifica que el archivo no esté dañado.");
  }

  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, opts.maxDimension);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("No pudimos optimizar la imagen (canvas no disponible).");
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await encodeCanvas(canvas, ctx, opts);
    if (!blob || !EXTENSION_BY_MIME[blob.type]) {
      throw new Error("No pudimos optimizar la imagen. Intenta con otro archivo.");
    }

    // Guard against pathological cases (tiny already-optimized images can grow
    // when re-encoded) — keep whichever is smaller.
    if (blob.size >= file.size) {
      return labelByContent(file);
    }

    return new File([blob], renameForMime(file.name, blob.type), {
      type: blob.type,
      lastModified: file.lastModified,
    });
  } finally {
    bitmap.close();
  }
}

/**
 * Scale (w, h) down to fit inside a maxDimension × maxDimension box, preserving
 * aspect ratio. Never enlarges — if it already fits, dimensions are unchanged.
 */
function fitWithin(
  width: number,
  height: number,
  maxDimension: number
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxDimension) {
    return { width, height };
  }
  const scale = maxDimension / longest;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

/**
 * Encode in the requested format, trusting only what the browser reports back.
 * `toBlob` silently returns a PNG for a type it cannot encode, which is what
 * Safari does for WebP. The fallback is JPEG, except that JPEG has no alpha and
 * would turn a transparent background black, so those images stay PNG.
 */
async function encodeCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  opts: Required<CompressImageOptions>
): Promise<Blob | null> {
  const preferred = await canvasToBlob(canvas, opts.mimeType, opts.quality);
  if (preferred?.type === opts.mimeType) return preferred;

  if (!hasTransparency(ctx, canvas.width, canvas.height)) {
    const jpeg = await canvasToBlob(canvas, "image/jpeg", opts.quality);
    if (jpeg?.type === "image/jpeg") return jpeg;
  }
  return preferred;
}

function hasTransparency(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): boolean {
  const { data } = ctx.getImageData(0, 0, width, height);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

/**
 * A kept original is uploaded as it came, but a browser derives `File.type` from
 * the extension alone, so a PNG renamed to .webp would claim to be WebP. Read
 * the signature, and correct the label only when it is known and disagrees.
 */
async function labelByContent(file: File): Promise<File> {
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const actual = sniffImageType(header);
  if (!actual || actual === file.type) return file;

  return new File([file], renameForMime(file.name, actual), {
    type: actual,
    lastModified: file.lastModified,
  });
}

function sniffImageType(bytes: Uint8Array): string | null {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.subarray(start, end));

  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 3) === "GIF") return "image/gif";
  if (ascii(4, 8) === "ftyp" && ascii(8, 11) === "avi") return "image/avif";
  return null;
}

/** Promise wrapper around the callback-based canvas.toBlob. */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
}

/** Swap a filename's extension to match the compressed output format. */
function renameForMime(originalName: string, mimeType: string): string {
  const ext = EXTENSION_BY_MIME[mimeType] ?? "webp";
  const base = originalName.replace(/\.[^./\\]+$/, "");
  return `${base || "image"}.${ext}`;
}
