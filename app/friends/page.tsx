import type { Metadata } from "next";
import FriendsView from "@/components/social/FriendsView";

export const metadata: Metadata = {
  title: "Amigos",
  description:
    "Encuentra a otras personas de KROV Perfumería por su nombre de usuario.",
  // Personal, signed-in-only pages must never be indexed — same rule /profile
  // follows. There is nothing here for a crawler: every result depends on who
  // is asking.
  robots: { index: false, follow: false },
};

export default function FriendsPage() {
  return <FriendsView />;
}
