import {
  Bone,
  LoadingAnnouncement,
  SkeletonRegion,
  TextBone,
} from "@/components/ui/Skeleton";

const serif = "var(--font-krov-display), 'Cormorant Garamond', Georgia, serif";

/**
 * /howtobuy fetches no data. It is prerendered, so this fallback only shows
 * during a client navigation that beats the route's JS chunk (a cold visit on
 * a slow phone connection, before the prefetch lands). It still earns its place
 * there: without it the previous page stays frozen with no sign the tap
 * registered.
 *
 * Every word on the page is static, so the copy above the fold is rendered for
 * real. Only the device toggle and the first step card, whose content depends
 * on client state (the matchMedia default), are bones. The page's own
 * scroll-reveal system (`.reveal` + useReveal) then takes over for the
 * entrance, so nothing here animates in on top of it.
 */
export default function HowToBuyLoading() {
  return (
    <div className="relative bg-krov-void">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-linear-to-b from-krov-ink via-krov-void to-krov-void"
      />
      <LoadingAnnouncement label="Cargando la guía de compra…" />

      <div className="relative">
        {/* HowToBuyHero, minus its ambient halos (decoration nobody waits for). */}
        <section className="relative px-6 pb-10 pt-28 text-center md:pt-36">
          <p className="mb-6 text-xs uppercase tracking-[0.4em] text-krov-rose md:text-sm">
            Guía de compra · KROV Perfumería
          </p>
        </section>

        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <div className="pt-10 md:pt-14">
            <p className="mb-4 text-center text-xs uppercase tracking-[0.3em] text-white/35">
              ¿Cómo estás navegando?
            </p>
            {/* ViewToggle: p-1 + a py-2.5/text-xs label + border = 46px. */}
            <SkeletonRegion className="mx-auto w-fit">
              <Bone className="h-[46px] w-[19rem] max-w-full rounded-full" />
            </SkeletonRegion>
          </div>

          <section className="pt-12 md:pt-20">
            <div className="mx-auto max-w-2xl text-center">
              <p className="mb-5 text-xs uppercase tracking-[0.4em] text-krov-rose">
                Opcional pero recomendado
              </p>
              <h2
                className="text-3xl leading-tight text-white md:text-5xl"
                style={{ fontFamily: serif }}
              >
                Comienza con <span className="italic text-krov-rose">ventaja</span>
              </h2>
              <p
                className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-white/55 md:text-lg"
                style={{ fontFamily: serif }}
              >
                Estos pasos no son obligatorios, pero hacen tu experiencia más
                rápida, segura y personalizada.
              </p>
            </div>

            {/* First StepCard: same shell, radius and padding as the real one. */}
            <SkeletonRegion className="mt-16">
              <div className="rounded-[1.6rem] border border-white/5 bg-white/[0.025] p-5 sm:p-7 lg:p-9">
                <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
                  <Bone className="aspect-[16/10] w-full rounded-2xl" />
                  <div>
                    <div className="mb-5 flex items-center gap-4">
                      <Bone className="h-12 w-12 shrink-0 rounded-full" />
                      <TextBone className="text-xs tracking-[0.35em]" width="5rem" />
                    </div>
                    <TextBone
                      className="mb-4 text-3xl leading-tight md:text-4xl"
                      width="75%"
                      strong
                    />
                    <TextBone className="text-base leading-relaxed md:text-lg" width="100%" />
                    <TextBone className="text-base leading-relaxed md:text-lg" width="90%" />
                    <TextBone className="text-base leading-relaxed md:text-lg" width="60%" />
                  </div>
                </div>
              </div>
            </SkeletonRegion>
          </section>
        </div>
      </div>
    </div>
  );
}
