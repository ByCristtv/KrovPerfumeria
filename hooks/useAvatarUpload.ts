"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  AVATAR_FORM_FIELD,
  AVATAR_UPLOAD_ENDPOINT,
} from "@/lib/avatar/constants";
import { prepareAvatarForUpload } from "@/lib/avatar/prepareUpload";
import { validateAvatarFile } from "@/lib/avatar/validateFile";

interface UseAvatarUploadOptions {
  /** The avatar currently saved (`profiles.avatar_url`), or null. */
  currentUrl: string | null;
  /** Called after the server stored the new photo, so callers can re-read the profile. */
  onUploaded: () => void;
}

/**
 * Pick → validate → upload a new profile photo, with an optimistic preview.
 *
 * The preview is an object URL of the file the user chose, shown immediately
 * (under a spinner) rather than after the round trip. It is tied to the saved
 * URL it was created against: once the profile re-reads and `currentUrl`
 * changes, the preview stops applying on its own and the real, stored image
 * takes over, so there is no "clear the preview" step to forget. On failure it
 * is dropped and the previous photo is shown again.
 */
export function useAvatarUpload({ currentUrl, onUploaded }: UseAvatarUploadOptions) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ url: string; base: string | null } | null>(null);

  // Own the object URL's lifetime: revoke when it is replaced or on unmount.
  const previewUrl = preview?.url;
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const open = useCallback(() => {
    setError("");
    inputRef.current?.click();
  }, []);

  const onChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const input = e.currentTarget;
      const file = input.files?.[0];
      // Reset so picking the SAME file again after a failure still fires `change`.
      input.value = "";
      if (!file) return;

      const invalid = validateAvatarFile(file);
      if (invalid) {
        setError(invalid);
        return;
      }

      setError("");
      setUploading(true);
      setPreview({ url: URL.createObjectURL(file), base: currentUrl });

      try {
        // Shrink first: Vercel refuses request bodies over 4.5 MB, which
        // camera originals routinely exceed. Throws a user-facing message if
        // the photo is too big AND can't be shrunk.
        let toSend: File;
        try {
          toSend = await prepareAvatarForUpload(file);
        } catch (prepErr) {
          setPreview(null);
          setError(prepErr instanceof Error ? prepErr.message : "No pudimos preparar tu foto.");
          return;
        }

        const body = new FormData();
        body.append(AVATAR_FORM_FIELD, toSend);

        const res = await fetch(AVATAR_UPLOAD_ENDPOINT, { method: "POST", body });
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; message?: string }
          | null;

        if (!res.ok || !json?.ok) {
          setPreview(null);
          setError(
            json?.message ??
              (res.status === 413
                ? "La imagen es demasiado grande. Prueba con una más pequeña."
                : "No pudimos subir tu foto. Intenta de nuevo.")
          );
          return;
        }

        onUploaded();
      } catch {
        setPreview(null);
        setError("No pudimos subir tu foto. Revisa tu conexión e intenta de nuevo.");
      } finally {
        setUploading(false);
      }
    },
    [currentUrl, onUploaded]
  );

  // A preview only applies while the saved photo is still the one it was made against.
  const shownPreview = preview && preview.base === currentUrl ? preview.url : null;

  return { inputRef, open, onChange, uploading, error, previewUrl: shownPreview };
}
