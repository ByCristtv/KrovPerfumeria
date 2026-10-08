import type { Metadata } from "next";
import HowToBuyExperience from "@/components/howtobuy/HowToBuyExperience";
import { buildPageMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = buildPageMetadata({
  title: "Cómo comprar perfumes online en Costa Rica",
  description:
    "Guía paso a paso para comprar en KROV Perfumería: elige tu perfume o decant, paga con tarjeta o SINPE Móvil y recíbelo en cualquier parte de Costa Rica.",
  path: "/howtobuy",
});

export default function HowToBuyPage() {
  return <HowToBuyExperience />;
}