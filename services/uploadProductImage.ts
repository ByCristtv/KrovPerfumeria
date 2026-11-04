import { supabase } from "@/lib/supabase/client";
import { compressImage } from "@/services/imageCompression";

const BUCKET = "product-images";

/**
 * Upload an image to the `product-images` Supabase Storage bucket
 * and return the public URL. Filenames are namespaced with a UUID
 * to avoid collisions.
 *
 * Every file is optimized (downscaled + re-encoded) on the client before it
 * leaves the browser — see `services/imageCompression`. This is the single
 * chokepoint all product-image flows share, so compression is applied
 * uniformly without any caller needing to know about it.
 */
export async function uploadProductImage(file: File): Promise<string> {
  const optimized = await compressImage(file);
  const filePath = `${BUCKET}/${crypto.randomUUID()}-${optimized.name}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    // The UUID makes every key unique and this never upserts, so the object
    // cannot change under its URL. Same value as the avatar route.
    .upload(filePath, optimized, { cacheControl: "31536000" });

  if (uploadError) {
    throw new Error(`Image upload failed: ${uploadError.message}`);
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(filePath);

  return publicUrl;
}

/**
 * Best-effort deletion of a previously uploaded image, given its public URL.
 *
 * Used when replacing or removing a variant image so we don't leave orphaned
 * objects in the bucket. Failures are logged but never thrown — the DB row is
 * the source of truth, and a lingering file is harmless compared to blocking
 * the admin's action.
 */
export async function deleteProductImageFile(publicUrl: string): Promise<void> {
  const marker = `/object/public/${BUCKET}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return; // Not a URL from our bucket — nothing to delete.

  const objectKey = decodeURIComponent(publicUrl.slice(idx + marker.length));
  const { error } = await supabase.storage.from(BUCKET).remove([objectKey]);
  if (error) {
    console.warn("deleteProductImageFile: could not remove", objectKey, error.message);
  }
}
