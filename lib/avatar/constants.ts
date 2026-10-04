/**
 * Limits and names shared by the avatar upload UI and its server pipeline.
 * Pure constants only (no `sharp`, no `node:*`) so the client bundle can import
 * this file without pulling in the image library.
 */

/** Storage bucket. Public-read: avatars are shown to other users (social, friends). */
export const AVATAR_BUCKET = "avatars";

/** Folder inside the bucket. Every object is `profile-photos/{user_id}/{uuid}.webp`. */
export const AVATAR_FOLDER = "profile-photos";

/** Largest file a user may pick. Checked on the client AND again on the server. */
export const AVATAR_MAX_INPUT_BYTES = 10 * 1024 * 1024;

/** Side of the stored square, in pixels. */
export const AVATAR_SIZE_PX = 512;

/** Ceiling for the re-encoded file; the encoder steps quality down to fit it. */
export const AVATAR_MAX_OUTPUT_BYTES = 500 * 1024;

/**
 * Decoded-pixel ceiling (~50 MP). A 10 MB PNG can hold a far larger canvas than
 * its byte size suggests ("decompression bomb"), so sharp is told to refuse it.
 */
export const AVATAR_MAX_INPUT_PIXELS = 50_000_000;

/** What the file picker offers and the server accepts. */
export const AVATAR_ACCEPTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type AvatarMimeType = (typeof AVATAR_ACCEPTED_MIME_TYPES)[number];

/** Form field name carrying the file in the multipart upload. */
export const AVATAR_FORM_FIELD = "avatar";

export const AVATAR_UPLOAD_ENDPOINT = "/api/profile/avatar";

/**
 * Largest body the browser sends. Vercel rejects serverless request bodies over
 * 4.5 MB before our code runs, so anything larger than this is downscaled first
 * (see lib/avatar/prepareUpload.ts); the margin covers multipart overhead.
 */
export const AVATAR_MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

/** Files at or under this are sent untouched; the server re-encodes them anyway. */
export const AVATAR_SKIP_DOWNSCALE_BYTES = 1024 * 1024;

/**
 * Longest side of the client-side downscale. The server crops to 512 px, so
 * this only has to leave it enough pixels to crop from (and to look sharp on
 * high-DPI screens).
 */
export const AVATAR_CLIENT_MAX_DIMENSION = 1280;
