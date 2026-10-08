import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  NOINDEX_FOLLOW,
  buildPageMetadata,
  truncateDescription,
} from "@/lib/seo/metadata";

const serif = "var(--font-krov-display), 'Cormorant Garamond', Georgia, serif";

type LegalDoc = {
  title: string;
  intro: string;
  sections: { heading: string; body: string }[];
};

/**
 * Lightweight legal pages so the footer links resolve to real, on-brand
 * routes instead of 404s. Copy is provisional — replace with the final,
 * legally-reviewed text before launch.
 */
const DOCS: Record<string, LegalDoc> = {
  privacidad: {
    title: "Política de Privacidad",
    intro:
      "En KROV Perfumería respetamos tu privacidad y protegemos los datos personales que compartes con nosotros. Este documento describe, de forma general, cómo recopilamos y utilizamos tu información.",
    sections: [
      {
        heading: "Datos que recopilamos",
        body: "Recopilamos la información que nos proporcionas al crear una cuenta, realizar un pedido o contactarnos: nombre, correo electrónico, dirección de envío y datos de contacto.",
      },
      {
        heading: "Uso de la información",
        body: "Utilizamos tus datos para procesar pedidos, coordinar envíos, brindar atención al cliente y, con tu consentimiento, enviarte novedades y promociones.",
      },
      {
        heading: "Tus derechos",
        body: "Puedes solicitar el acceso, la corrección o la eliminación de tus datos personales en cualquier momento escribiéndonos a través de nuestra página de contacto.",
      },
    ],
  },
  terminos: {
    title: "Términos y Condiciones",
    intro:
      "Al utilizar el sitio de KROV Perfumería y realizar compras, aceptas los siguientes términos generales. Te recomendamos leerlos antes de finalizar tu pedido.",
    sections: [
      {
        heading: "Productos y autenticidad",
        body: "Todos nuestros perfumes y decants son 100% originales. Las presentaciones tipo decant se preparan a partir de frascos auténticos.",
      },
      {
        heading: "Pedidos y pagos",
        body: "Aceptamos pagos con tarjeta y SINPE Móvil. Los pagos por SINPE se verifican manualmente tras recibir el comprobante correspondiente.",
      },
      {
        heading: "Envíos y entregas",
        body: "Realizamos envíos a todo Costa Rica. Los plazos de entrega se confirman al momento de procesar tu pedido.",
      },
    ],
  },
};

export function generateStaticParams() {
  return Object.keys(DOCS).map((doc) => ({ doc }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ doc: string }>;
}): Promise<Metadata> {
  const { doc } = await params;
  const data = DOCS[doc];
  if (!data) {
    return { title: "Documento no encontrado", robots: NOINDEX_FOLLOW };
  }

  // The root title template already appends the brand — repeating it here
  // produced "… · KROV Perfumería · KROV Perfumería". Each document also gets
  // its own canonical and description (it used to inherit the home page's).
  return buildPageMetadata({
    title: data.title,
    description: truncateDescription(data.intro),
    path: `/legal/${doc}`,
  });
}

export default async function LegalPage({
  params,
}: {
  params: Promise<{ doc: string }>;
}) {
  const { doc } = await params;
  const data = DOCS[doc];
  if (!data) notFound();

  return (
    <div className="relative min-h-screen bg-krov-void">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-linear-to-b from-krov-ink via-krov-void to-krov-void"
      />

      <div className="relative mx-auto max-w-3xl px-6 pt-32 pb-24 md:pt-40">
        <p
          className="mb-5 text-xs uppercase tracking-[0.4em] text-krov-rose"
        >
          KROV Perfumería
        </p>
        <h1
          className="text-4xl leading-tight text-white md:text-5xl"
          style={{ fontFamily: serif }}
        >
          {data.title}
        </h1>

        <p
          className="mt-8 text-base leading-relaxed text-white/65 md:text-lg"
          style={{ fontFamily: serif }}
        >
          {data.intro}
        </p>

        <div className="mt-12 space-y-10">
          {data.sections.map((section) => (
            <section key={section.heading}>
              <h2
                className="mb-3 text-2xl text-white"
                style={{ fontFamily: serif }}
              >
                {section.heading}
              </h2>
              <p
                className="text-base leading-relaxed text-white/60"
                style={{ fontFamily: serif }}
              >
                {section.body}
              </p>
            </section>
          ))}
        </div>

        <div className="mt-16 border-t border-white/10 pt-8">
          <p className="text-sm text-white/45" style={{ fontFamily: serif }}>
            ¿Tienes preguntas sobre este documento?{" "}
            <Link href="/#canales" className="text-krov-rose underline-offset-4 hover:underline">
              Contáctanos
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
