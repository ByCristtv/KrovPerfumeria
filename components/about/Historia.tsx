import Image from "next/image";

const serif = "var(--font-krov-display), 'Cormorant Garamond', Georgia, serif";

export default function Historia() {
  return (
    <section
      id="historia"
      aria-labelledby="historia-title"
      className="scroll-mt-24 bg-krov-void py-24 md:py-32 px-6"
    >
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-16 md:gap-24 items-center">
        <div>
          <p
            className="text-krov-rose tracking-[0.4em] text-xs mb-6 uppercase"
          >
            Nuestra historia
          </p>
          <h2
            id="historia-title"
            className="text-3xl md:text-5xl text-white leading-tight mb-8"
            style={{ fontFamily: serif }}
          >
            Una pasión convertida en
            <span className="italic text-krov-rose"> experiencia</span>
          </h2>
          <div
            className="space-y-5 text-white/75 text-base md:text-lg leading-relaxed"
            style={{ fontFamily: serif }}
          >
            <p>
              KROV Perfumería nació de una necesidad y de un sueño: Dar acceso a 
              a Costa Rica a una expeiencia nueva y unica en la perfumeria, donde cada uno de nuestros clientes pueda descubrir y explorar el mundo de los perfumes,
               de una forma personalizada y con un enfoque en la calidad, autenticidad, elegancia y un reconocimiento distintivo para el cliente.
            </p>
           
          </div>

          <div className="mt-12 pl-6 border-l border-krov-blood/40">
            <p
              className="text-krov-rose tracking-[0.3em] text-xs mb-3 uppercase"
            >
              Nuestra filosofía
            </p>
            <p
              className="text-white text-xl md:text-2xl italic"
              style={{ fontFamily: serif }}
            >
              La excelencia está en los detalles.
            </p>
          </div>
        </div>

        <div className="relative aspect-4/5 w-full overflow-hidden">
          <Image
            src="/images/about/SecondAbout.jpg"
            alt="Mesa con perfumes nicho dispuestos con iluminación cálida y editorial"
            fill
            className="object-cover"
            sizes="(min-width: 768px) 50vw, 100vw"
          />
          <div className="absolute inset-0 ring-1 ring-inset ring-krov-blood/20" />
        </div>
      </div>
    </section>
  );
}
