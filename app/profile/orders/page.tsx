import type { Metadata } from "next";
import OrdersView from "@/components/account/OrdersView";

export const metadata: Metadata = {
  title: "Mis pedidos",
  description: "El historial de tus compras en KROV Perfumería.",
  // Personal account pages must never be indexed — same rule as /profile.
  robots: { index: false, follow: false },
};

export default function ProfileOrdersPage() {
  return <OrdersView />;
}
