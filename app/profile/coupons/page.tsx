import type { Metadata } from "next";
import CouponsView from "@/components/coupons/CouponsView";

export const metadata: Metadata = {
  title: "Mis cupones",
  description: "Los cupones de descuento que desbloqueas al subir de nivel.",
  // Personal account pages must never be indexed — same rule as /profile.
  robots: { index: false, follow: false },
};

export default function ProfileCouponsPage() {
  return <CouponsView />;
}
