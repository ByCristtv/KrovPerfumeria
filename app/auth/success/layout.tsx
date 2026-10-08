import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NOINDEX_NOFOLLOW } from "@/lib/seo/metadata";

/**
 * The page is a client component (it only forwards to "/"), and a client
 * component can't export metadata — so the noindex lives on this layout. Without
 * it the page inherited the root's `index, follow` and relied on the
 * X-Robots-Tag header alone.
 */
export const metadata: Metadata = { robots: NOINDEX_NOFOLLOW };

export default function AuthSuccessLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
