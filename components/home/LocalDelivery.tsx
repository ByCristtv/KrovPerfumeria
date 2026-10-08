import Link from "next/link";
import Reveal from "@/components/ui/Reveal";
import { LANDINGS } from "@/lib/seo/landings";
import { SITE } from "@/lib/seo/site";

const serif = "var(--font-krov-display), 'Cormorant Garamond', Georgia, serif";

/**
 * Where the shop is and where it ships.
 *
 * The home page is the only page that can answer a local query like
 * "perfumería en Cariari de Pococí", and until now it never said where the shop
 * is. This is one short, factual block — not a keyword list, not a location
 * landing page — and every claim in it is something the storefront enforces:
 *
 *  - Cariari centro gets free delivery (lib/shipping/localDelivery.ts).
 *  - The rest of the country is served with a zone-based rate that checkout
 *    shows before payment.
 *  - Payment is card or SINPE Móvil.
 *
 * It also gives the home page natural, descriptive links into the catalog and
 * the two curated landings, which is how those pages get discovered and ranked.
 *
 * Server component, static copy: no data requirement and no client JS beyond
 * the shared Reveal wrapper.
 */
export default function LocalDelivery() {
  const { locality, canton, region } = SITE.address;

  return (
    <section
      aria-labelledby="entregas-titulo"
      className="bg-krov-ink px-5 py-20 sm:px-8 md:py-28"
    >
      <Reveal>
        <div className="mx-auto max-w-4xl">
          <p className="krov-eyebrow">Entregas</p>

          <h2
            id="entregas-titulo"
            className="mt-6 text-3xl leading-[1.1] text-krov-bone sm:text-4xl md:text-5xl"
            style={{ fontFamily: serif }}
          >
            Perfumería en {locality} de {canton},{" "}
            <span className="italic text-krov-blush">
              envíos a todo Costa Rica
            </span>
          </h2>

          <div className="mt-8 max-w-2xl space-y-5 text-[0.95rem] leading-relaxed text-krov-ash md:text-base">
            <p>
              {SITE.shortName} es una perfumería con base en {locality} de{" "}
              {canton}, {region}. Si estás en {locality} centro, la entrega de
              tu pedido es gratis.
            </p>
            <p>
              Al resto del país llegamos con envío nacional: el costo depende de
              tu zona y lo ves antes de pagar. Puedes pagar con tarjeta o SINPE
              Móvil.
            </p>
            <p>
              Explora los{" "}
              <Link href="/products" className="krov-underline text-krov-bone">
                perfumes originales
              </Link>
              , los{" "}
              <Link
                href={LANDINGS["perfumes-arabes"].path}
                className="krov-underline text-krov-bone"
              >
                perfumes árabes
              </Link>{" "}
              o prueba primero con un{" "}
              <Link
                href={LANDINGS.decants.path}
                className="krov-underline text-krov-bone"
              >
                decant
              </Link>
              .
            </p>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
