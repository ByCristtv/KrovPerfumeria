import sharp from "sharp";
import {
  AVATAR_MAX_INPUT_BYTES,
  AVATAR_MAX_INPUT_PIXELS,
  AVATAR_MAX_OUTPUT_BYTES,
  AVATAR_SIZE_PX,
} from "@/lib/avatar/constants";

/**
 * Server-only avatar pipeline (imports `sharp`; never import from a client file).
 *
 * The browser's `File.type` and `File.name` are attacker-controlled, so nothing
 * here trusts them. The file is accepted only if its leading BYTES say it is a
 * JPEG, PNG or WebP, and is then fully DECODED and RE-ENCODED, so what reaches
 * storage is pixels we produced, not bytes the user sent: a polyglot (an image
 * with a script or archive appended), an EXIF/GPS block or a malformed chunk
 * cannot survive a decode → re-encode round trip.
 */

export type SniffedImageFormat = "jpeg" | "png" | "webp";

/**
 * Identify a JPEG/PNG/WebP by its magic bytes. Returns null for anything else
 * (SVG, GIF, HEIC, PDF, an HTML file renamed `.png`, an empty buffer…).
 */
export function sniffImageFormat(bytes: Uint8Array): SniffedImageFormat | null {
  // JPEG: FF D8 FF
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= PNG.length && PNG.every((b, i) => bytes[i] === b)) {
    return "png";
  }

  // WebP: "RIFF" <4-byte size> "WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return "webp";
  }

  return null;
}

export type AvatarErrorCode =
  | "empty"
  | "too_large"
  | "unsupported_format"
  | "invalid_image"
  | "output_too_large";

/** A user-correctable problem with the uploaded file (HTTP 4xx), as opposed to our own failure. */
export class AvatarError extends Error {
  constructor(
    public readonly code: AvatarErrorCode,
    message: string
  ) {
    super(message);
    this.name = "AvatarError";
  }
}

export interface ProcessedAvatar {
  buffer: Buffer;
  contentType: "image/webp";
  width: number;
  height: number;
}

/** Quality ladder: first rung that fits under the byte ceiling wins. */
const QUALITY_STEPS = [82, 72, 62, 50, 40] as const;

/**
 * Validate and normalise an uploaded image into a square, metadata-free WebP.
 *
 * Applied to EVERY upload, not only those over 1 MB: a small file can still
 * carry GPS EXIF, and always producing the same 512×512 WebP keeps the display
 * path (and the bucket's `allowed_mime_types`) trivially uniform.
 *
 * @throws {AvatarError} when the file is not an acceptable image.
 */
export async function processAvatar(input: Uint8Array): Promise<ProcessedAvatar> {
  if (input.byteLength === 0) {
    throw new AvatarError("empty", "El archivo está vacío.");
  }
  if (input.byteLength > AVATAR_MAX_INPUT_BYTES) {
    throw new AvatarError("too_large", "La imagen supera el tamaño máximo de 10 MB.");
  }

  const sniffed = sniffImageFormat(input);
  if (!sniffed) {
    throw new AvatarError(
      "unsupported_format",
      "Formato no permitido. Usa una imagen JPG, PNG o WebP."
    );
  }

  try {
    // `failOn: "error"` makes a truncated/corrupt file throw instead of being
    // silently half-decoded. `limitInputPixels` refuses decompression bombs.
    // Animation is deliberately not requested, so an animated WebP yields its
    // first frame only.
    const pipeline = () =>
      sharp(input, {
        failOn: "error",
        limitInputPixels: AVATAR_MAX_INPUT_PIXELS,
      })
        // Apply the EXIF orientation to the pixels BEFORE the metadata is
        // dropped; otherwise a phone photo would come out sideways.
        .rotate()
        .resize(AVATAR_SIZE_PX, AVATAR_SIZE_PX, {
          fit: "cover",
          position: "attention", // crop toward the most salient region (faces)
          withoutEnlargement: false,
        })
        .toColourspace("srgb");

    // The decoder, not the header sniff, has the last word on the real format.
    const meta = await sharp(input, {
      failOn: "error",
      limitInputPixels: AVATAR_MAX_INPUT_PIXELS,
    }).metadata();
    if (meta.format !== sniffed) {
      throw new AvatarError(
        "invalid_image",
        "El archivo no es una imagen válida."
      );
    }

    // sharp drops all metadata (EXIF, XMP, ICC, GPS) unless `.withMetadata()`
    // is called, which we never do.
    for (const quality of QUALITY_STEPS) {
      const buffer = await pipeline().webp({ quality, effort: 4 }).toBuffer();
      if (buffer.byteLength <= AVATAR_MAX_OUTPUT_BYTES) {
        return {
          buffer,
          contentType: "image/webp",
          width: AVATAR_SIZE_PX,
          height: AVATAR_SIZE_PX,
        };
      }
    }
  } catch (err) {
    if (err instanceof AvatarError) throw err;
    // sharp throws plain Errors for corrupt data, oversized canvases, etc.
    // All of those are "this isn't a usable image" from the user's side.
    throw new AvatarError("invalid_image", "No pudimos leer la imagen. Prueba con otra.");
  }

  // 512×512 WebP at q40 is tens of KB for real photos; reaching here would take
  // pathological noise. Refuse rather than store something over budget.
  throw new AvatarError(
    "output_too_large",
    "No pudimos comprimir la imagen lo suficiente. Prueba con otra."
  );
}
