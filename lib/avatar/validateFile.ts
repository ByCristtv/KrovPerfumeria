import {
  AVATAR_ACCEPTED_MIME_TYPES,
  AVATAR_MAX_INPUT_BYTES,
} from "@/lib/avatar/constants";

/**
 * Client-side pre-flight for a picked avatar. Returns a Spanish message for the
 * user, or null when the file looks acceptable.
 *
 * This is a CONVENIENCE: it spares a 10 MB round trip for an obviously wrong
 * file. It is not a security check — `File.type` is whatever the OS/browser
 * guessed from the extension and is trivially forged. The server re-validates
 * the actual bytes (see lib/avatar/processAvatar.ts).
 */
export function validateAvatarFile(file: Pick<File, "type" | "size">): string | null {
  if (!(AVATAR_ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return "Formato no permitido. Usa una imagen JPG, PNG o WebP.";
  }
  if (file.size === 0) {
    return "El archivo está vacío.";
  }
  if (file.size > AVATAR_MAX_INPUT_BYTES) {
    return "La imagen supera el tamaño máximo de 10 MB.";
  }
  return null;
}
