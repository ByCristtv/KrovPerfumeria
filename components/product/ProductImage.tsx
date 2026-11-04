"use client";

import Image, { type ImageProps } from "next/image";
import type { SyntheticEvent } from "react";

export const PLACEHOLDER_IMAGE = "/placeholder.png";

/**
 * Swaps a failed photograph for the placeholder straight on the element, so a
 * grid of cards pays for no extra state or re-render. The placeholder is the
 * raw file rather than an optimizer URL, which keeps it working when the failure
 * IS the optimizer (a 402 once the transformation allowance runs out). If the
 * placeholder itself fails the path check stops here, so this can never loop.
 */
function showPlaceholder(event: SyntheticEvent<HTMLImageElement>) {
  const img = event.currentTarget;
  if (new URL(img.src, window.location.href).pathname === PLACEHOLDER_IMAGE) return;
  img.removeAttribute("srcset");
  img.src = PLACEHOLDER_IMAGE;
}

/**
 * `next/image` for a product photograph on a light plate: falls back to the
 * placeholder when it fails, and never spends a transformation on the placeholder.
 */
export default function ProductImage({ alt, unoptimized, ...props }: ImageProps) {
  return (
    <Image
      {...props}
      alt={alt}
      unoptimized={unoptimized || props.src === PLACEHOLDER_IMAGE}
      onError={showPlaceholder}
    />
  );
}
