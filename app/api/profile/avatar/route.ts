import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  AVATAR_BUCKET,
  AVATAR_FORM_FIELD,
  AVATAR_MAX_INPUT_BYTES,
} from "@/lib/avatar/constants";
import { AvatarError, processAvatar } from "@/lib/avatar/processAvatar";
import {
  avatarPathFromUrl,
  buildAvatarPath,
  isAvatarFileName,
  userAvatarFolder,
} from "@/lib/avatar/paths";
import { claimAvatarUploadSlot } from "@/lib/avatar/rateLimit";

/**
 * POST /api/profile/avatar   (multipart/form-data, field `avatar`)
 *
 * Replaces the signed-in user's profile photo.
 *
 * Why a Route Handler and not a Server Action: Server Actions cap the request
 * body at 1 MB by default, and the product allows picking a 10 MB original.
 * Raising that cap globally would loosen it for every action in the app; a
 * dedicated endpoint keeps the large body to the one place that needs it.
 *
 * Trust boundary. The only thing taken from the request is the file's bytes:
 *   · WHO it is comes from `auth.getUser()` (verified server-side), never a body field;
 *   · the stored file name is generated here (see `buildAvatarPath`), never derived
 *     from the uploaded name;
 *   · the file type is decided by magic bytes + a full decode (see `processAvatar`),
 *     never by `File.type`;
 *   · every storage and DB write runs as the USER (anon key + their session), so
 *     Row Level Security is the final backstop, not this code. The service-role
 *     key is deliberately not used.
 *
 * Abuse control: each attempt first claims a slot from a database-backed counter
 * (5 per user per 10 minutes, see migration 20261003000200). It has to live in
 * the database because on Vercel every request may land on a different
 * serverless instance, so an in-memory counter would not limit anything. The
 * claim happens BEFORE the body is parsed or decoded, so a refused request costs
 * almost nothing.
 *
 * Write order is upload → point profile at it → delete the old one, so a failure
 * at any step leaves the user with a working photo: the previous one until the
 * profile row flips, the new one after.
 */
export const runtime = "nodejs";

/** Headroom over the file cap for the multipart envelope (boundary, headers). */
const MAX_BODY_BYTES = AVATAR_MAX_INPUT_BYTES + 64 * 1024;

function fail(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

export async function POST(request: NextRequest) {
  // ──────── CSRF: same-origin only ────────
  // Cookies are SameSite=Lax, which already stops a cross-site form POST from
  // carrying the session; this refuses the request outright as a second layer.
  // Compared by host against the forwarded host, not `nextUrl.origin`, which
  // reports the internal address behind a tunnel/proxy (ngrok in dev).
  const origin = request.headers.get("origin");
  if (origin) {
    const requestHost =
      request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      // Malformed Origin (including the literal "null") falls through to refusal.
    }
    if (!originHost || originHost !== requestHost) {
      return fail(403, "forbidden", "Solicitud no permitida.");
    }
  }

  // ──────── Authenticate ────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return fail(401, "unauthenticated", "Debes iniciar sesión para cambiar tu foto.");
  }

  // ──────── Cheap size guard BEFORE buffering the body ────────
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return fail(413, "too_large", "La imagen supera el tamaño máximo de 10 MB.");
  }

  // ──────── Rate limit ────────
  const slot = await claimAvatarUploadSlot(supabase);
  if (!slot.ok) {
    if (slot.reason === "limited") {
      const minutes = Math.max(1, Math.ceil(slot.retryAfterSeconds / 60));
      return NextResponse.json(
        {
          ok: false,
          code: "rate_limited",
          message: `Cambiaste tu foto demasiadas veces. Intenta de nuevo en ${minutes} min.`,
        },
        { status: 429, headers: { "Retry-After": String(slot.retryAfterSeconds) } }
      );
    }
    // Fail closed: if the limiter can't be consulted, don't run the expensive,
    // storage-writing path unmetered.
    return fail(503, "unavailable", "No pudimos procesar tu foto ahora. Intenta de nuevo en un momento.");
  }

  // ──────── Read the file ────────
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get(AVATAR_FORM_FIELD);
  } catch {
    return fail(400, "bad_request", "No pudimos leer el archivo enviado.");
  }
  if (!(file instanceof File)) {
    return fail(400, "bad_request", "No se recibió ninguna imagen.");
  }
  // Authoritative check: Content-Length can be absent (chunked) or wrong.
  if (file.size > AVATAR_MAX_INPUT_BYTES) {
    return fail(413, "too_large", "La imagen supera el tamaño máximo de 10 MB.");
  }

  // ──────── Validate + normalise ────────
  let processed;
  try {
    processed = await processAvatar(new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    if (err instanceof AvatarError) {
      return fail(err.code === "too_large" ? 413 : 422, err.code, err.message);
    }
    console.error("[avatar] processing failed", err);
    return fail(500, "internal_error", "No pudimos procesar la imagen. Intenta de nuevo.");
  }

  // The previous photo's key, read BEFORE it is overwritten. A Google picture
  // or an empty string yields null: there is nothing of ours to delete.
  const { data: current } = await supabase
    .from("profiles")
    .select("avatar_url")
    .eq("id", user.id)
    .maybeSingle();
  const previousPath = avatarPathFromUrl(current?.avatar_url, user.id);

  // ──────── Upload ────────
  const path = buildAvatarPath(user.id);
  const bucket = supabase.storage.from(AVATAR_BUCKET);

  const { error: uploadError } = await bucket.upload(path, processed.buffer, {
    contentType: processed.contentType,
    // The key is unique per upload, so the object never changes under its URL.
    cacheControl: "31536000",
    upsert: false,
  });
  if (uploadError) {
    console.error("[avatar] upload failed", uploadError);
    return fail(500, "upload_failed", "No pudimos guardar tu foto. Intenta de nuevo.");
  }

  // ──────── Point the profile at it ────────
  const publicUrl = bucket.getPublicUrl(path).data.publicUrl;
  const { error: updateError } = await supabase
    .from("profiles")
    .update({ avatar_url: publicUrl })
    .eq("id", user.id);
  if (updateError) {
    console.error("[avatar] profile update failed", updateError);
    // Don't leave an unreferenced file behind.
    await bucket.remove([path]);
    return fail(500, "profile_update_failed", "No pudimos actualizar tu perfil. Intenta de nuevo.");
  }

  // ──────── Delete superseded photos (best effort) ────────
  // The profile already points at the new file, so a failure here costs some
  // storage, not correctness. Besides the key we just read, sweep any older
  // object in the user's folder that a previously failed cleanup left behind.
  await removeStaleAvatars(supabase, user.id, path, previousPath);

  revalidatePath("/profile");

  return NextResponse.json({ ok: true, message: "Foto actualizada.", avatarUrl: publicUrl });
}

async function removeStaleAvatars(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  keepPath: string,
  previousPath: string | null
) {
  try {
    const bucket = supabase.storage.from(AVATAR_BUCKET);
    const stale = new Set<string>();
    if (previousPath) stale.add(previousPath);

    // Listing is scoped to the user's own folder (and RLS only lets them see
    // that folder anyway); the name check keeps the delete to files we wrote.
    const folder = userAvatarFolder(userId);
    const { data: listed } = await bucket.list(folder, { limit: 100 });
    for (const entry of listed ?? []) {
      if (isAvatarFileName(entry.name)) stale.add(`${folder}/${entry.name}`);
    }

    stale.delete(keepPath);
    if (stale.size === 0) return;

    const { error } = await bucket.remove([...stale]);
    if (error) console.error("[avatar] stale cleanup failed", error);
  } catch (err) {
    console.error("[avatar] stale cleanup threw", err);
  }
}
