import type { Metadata } from "next";
import AboutHero from "@/components/about/AboutHero";
import Historia from "@/components/about/Historia";
import Diferenciadores from "@/components/about/Diferenciadores";
import ArteDecant from "@/components/about/ArteDecant";
import CasasPerfumistas from "@/components/about/CasasPerfumistas";
import Identidad from "@/components/about/Identidad";

import CTAFinal from "@/components/about/CTAFinal";
import Reveal from "@/components/ui/Reveal";

export const metadata: Metadata = {
  alternates: { canonical: "/about" },
  title: "Sobre Nosotros",
  description:
    "KROV Perfumería: perfumes nicho, diseñadores de lujo y decants originales en Costa Rica. Descubre nuestra historia, filosofía y compromiso con la excelencia olfativa.",
};

export default function AboutPage() {
  return (
    <div className="bg-krov-void">
      <Reveal><AboutHero /></Reveal>
      <Reveal><Historia /></Reveal>
      <Reveal><Diferenciadores /></Reveal>
      <Reveal><ArteDecant /></Reveal>
      <Reveal><CasasPerfumistas /></Reveal>
      <Reveal><Identidad /></Reveal>
      <Reveal><CTAFinal /></Reveal>
    </div>
  );
}
