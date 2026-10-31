import Image from "next/image";

const serif = "var(--font-krov-display), 'Cormorant Garamond', Georgia, serif";

export default function ArteDecant() {
  return (
    <section
      aria-labelledby="decant-title"
      className="bg-krov-void py-24 md:py-32"
    >
      <div className="max-w-7xl mx-auto px-6">
        <div className="relative aspect-16/8 w-full overflow-hidden mb-16">
          <Image
            src="/images/about/DecantsAbout.avif"
            alt="Atomizadores de 3ml, 5ml y 10ml junto a jeringas de precisión y una botella de lujo siendo decantada"
            fill
            className="object-cover"
            sizes="(min-width: 1280px) 1200px, 100vw"
          />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,0,0,0)56%,rgba(0,0,0,0.65)100%)]" />
          <div className="absolute inset-0 ring-1 ring-inset ring-krov-blood/20" />
        </div>

        <div className="max-w-3xl mx-auto text-center">
          <p
            className="text-krov-rose tracking-[0.4em] text-xs mb-6 uppercase"
          >
            El arte del decant
          </p>
          <h2
            id="decant-title"
            className="text-3xl md:text-5xl text-white leading-tight mb-8"
            style={{ fontFamily: serif }}
          >
            Explora antes de <span className="italic text-krov-rose">comprometerte</span>
          </h2>
          <p
            className="text-white/75 text-base md:text-lg leading-relaxed"
            style={{ fontFamily: serif }}
          >
            Los decants te permiten descubrir perfumes exclusivos en
            presentaciones accesibles, sin renunciar a la autenticidad. Cada
            atomizador se decanta a mano, con jeringas de precisión y
            envasado estéril, directamente desde la botella original. Es la
            forma más honesta de conocer una fragancia antes de adoptarla
            como tuya.
          </p>

          <div
            className="mt-12 flex flex-wrap justify-center gap-8 text-krov-rose"
            style={{ fontFamily: serif }}
          >
            {["2ml", "5ml", "10ml"].map((s) => (
              <div key={s} className="text-center">
                <div className="text-4xl md:text-5xl">{s}</div>
                <div className="text-xs tracking-[0.3em] text-white/50 mt-2 uppercase">
                  Atomizador
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
