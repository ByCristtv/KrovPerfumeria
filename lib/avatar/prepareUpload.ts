import {
  AVATAR_CLIENT_MAX_DIMENSION,
  AVATAR_MAX_UPLOAD_BYTES,
  AVATAR_SKIP_DOWNSCALE_BYTES,
} from "@/lib/avatar/constants";

/**
 * Browser-side shrink of a picked photo, run BEFORE it is posted.
 *
 * Why: the site is on Vercel, which rejects serverless request bodies over
 * 4.5 MB before any of our code runs. Modern phone and camera originals
 * routinely exceed that, so without this step a perfectly good photo would fail
 * with an opaque platform error. The server only ever stores a 512×512 WebP, so
 * nothing is lost by sending ~1280 px instead of 12 megapixels.
 *
 * It is a transport optimisation, NOT a trust boundary. The server still
 * sniffs magic bytes and decodes and re-encodes whatever arrives, exactly as if
 * this step did not exist. (As a side effect the canvas round trip also drops
 * EXIF from what leaves the device.)
 */

/** `width × height` scaled down to fit within `max` on the longer side; never scaled up. */
export function fitWithin(
  width: number,
  height: number,
  max: number
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Quality ladder, tried in order until the blob fits under the upload ceiling. */
const QUALITY_STEPS = [0.85, 0.75, 0.65, 0.5, 0.4] as const;

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

/**
 * Decode with the EXIF orientation applied to the pixels, so a portrait phone
 * photo isn't drawn sideways onto the canvas.
 */
async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  }

  // Older browsers: an <img> applies EXIF orientation by default.
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => {},
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Returns the file to upload: the original when it is already small, otherwise
 * a downscaled WebP (JPEG on browsers that cannot encode WebP).
 *
 * @throws {Error} with a user-facing message when the photo is too big to send
 *   AND could not be shrunk (undecodable, or no canvas support).
 */
export async function prepareAvatarForUpload(file: File): Promise<File> {
  if (file.size <= AVATAR_SKIP_DOWNSCALE_BYTES) return file;

  let decoded: Decoded | null = null;
  try {
    decoded = await decode(file);
    const { width, height } = fitWithin(decoded.width, decoded.height, AVATAR_CLIENT_MAX_DIMENSION);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.imageSmoothingQuality = "high";

    // WebP first; a browser that can't encode it silently hands back PNG, which
    // is the signal to use JPEG instead. JPEG has no alpha, so it gets a white
    // backdrop rather than the black a transparent pixel would turn into.
    ctx.drawImage(decoded.source, 0, 0, width, height);
    let type = "image/webp";
    const probe = await toBlob(canvas, type, QUALITY_STEPS[0]);
    if (!probe || probe.type !== "image/webp") {
      type = "image/jpeg";
      ctx.save();
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    for (const quality of QUALITY_STEPS) {
      const blob = await toBlob(canvas, type, quality);
      if (blob && blob.size <= AVATAR_MAX_UPLOAD_BYTES) {
        const ext = type === "image/webp" ? "webp" : "jpg";
        return new File([blob], `avatar.${ext}`, { type, lastModified: Date.now() });
      }
    }
    throw new Error("could not fit under the upload ceiling");
  } catch {
    // Couldn't shrink it. The original is still fine to send if it fits.
    if (file.size <= AVATAR_MAX_UPLOAD_BYTES) return file;
    throw new Error(
      "No pudimos preparar tu foto para subirla. Prueba con otra imagen o una de menor tamaño."
    );
  } finally {
    decoded?.release();
  }
}
