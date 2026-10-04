import { AVATAR_BUCKET, AVATAR_FOLDER } from "@/lib/avatar/constants";

const UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID_PATTERN}$`, "i");
const FILE_RE = new RegExp(`^${UUID_PATTERN}\\.webp$`, "i");

/** `profile-photos/{userId}` — the only folder a user's RLS policies reach. */
export function userAvatarFolder(userId: string): string {
  return `${AVATAR_FOLDER}/${userId}`;
}

/**
 * Object key for a freshly processed avatar: `profile-photos/{userId}/{uuid}.webp`.
 *
 * Both parts are generated server-side (the id from the verified session, the
 * uuid from `crypto.randomUUID()`); nothing the client sent is ever part of it,
 * so there is no filename to traverse out of the folder with. A new key per
 * upload also means the CDN/browser can cache each object forever and a change
 * of photo is visible immediately, with no cache-busting query string.
 */
export function buildAvatarPath(userId: string, uuid: string = crypto.randomUUID()): string {
  return `${userAvatarFolder(userId)}/${uuid}.webp`;
}

/** True when `name` (a bare file name inside the user's folder) is one we wrote. */
export function isAvatarFileName(name: string): boolean {
  return FILE_RE.test(name);
}

/**
 * The object key behind one of OUR public avatar URLs, or null for anything
 * else (a Google profile picture, an empty string, a URL on another bucket).
 *
 * Used to find the previous photo so it can be deleted. Only keys of the exact
 * shape `buildAvatarPath` produces for THIS user are returned, so a hand-edited
 * `avatar_url` can never turn into "delete somebody else's file".
 */
export function avatarPathFromUrl(url: string | null | undefined, userId: string): string | null {
  if (!url || !UUID_RE.test(userId)) return null;

  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }

  const marker = `/storage/v1/object/public/${AVATAR_BUCKET}/`;
  const at = pathname.indexOf(marker);
  if (at === -1) return null;

  let key: string;
  try {
    key = decodeURIComponent(pathname.slice(at + marker.length));
  } catch {
    return null;
  }

  const prefix = `${userAvatarFolder(userId)}/`;
  if (!key.startsWith(prefix)) return null;

  return isAvatarFileName(key.slice(prefix.length)) ? key : null;
}
