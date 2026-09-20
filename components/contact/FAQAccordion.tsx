"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus } from "lucide-react";
import SectionHeading from "./SectionHeading";
import { fadeUp, serif, stagger } from "./styles";

const faqs = [
  {
    q: "¿Cuánto tarda el envío?",
    a: "Realizamos entregas a todo Costa Rica. Los tiempos varían según tu zona; al confirmar tu pedido te indicamos el plazo estimado y puedes consultarnos por WhatsApp en cualquier momento.",
  },
  {
    q: "¿Puedo pagar con SINPE Móvil?",
    a: "Sí. Durante el pago puedes elegir SINPE Móvil; tras enviar tu comprobante, nuestro equipo verifica el pago manualmente y actualiza el estado de tu pedido.",
  },
  {
    q: "¿Cómo funcionan los decants?",
    a: "Los decants son atomizadores originales de 2ml, 5ml y 10ml decantados con precisión. Te permiten probar una fragancia antes de invertir en el frasco completo.",
  },
  {
    q: "¿Cómo doy seguimiento a mi pedido?",
    a: "Al iniciar sesión puedes ver el estado de tus pedidos desde tu cuenta. Si necesitas ayuda adicional, escríbenos y con gusto te acompañamos en el proceso.",
  },
];

function FAQItem({
  q,
  a,
  isOpen,
  onToggle,
  id,
}: {
  q: string;
  a: string;
  isOpen: boolean;
  onToggle: () => void;
  id: string;
}) {
  return (
    <motion.div
      variants={fadeUp}
      className={`overflow-hidden rounded-2xl border backdrop-blur-sm transition-colors duration-500 ${
        isOpen
          ? "border-krov-blood/35 bg-white/[0.04]"
          : "border-white/5 bg-white/[0.025] hover:border-krov-smoke"
      }`}
    >
      <h3>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-controls={`${id}-panel`}
          id={`${id}-button`}
          className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
        >
          <span className="text-lg text-white md:text-xl" style={{ fontFamily: serif }}>
            {q}
          </span>
          <motion.span
            animate={{ rotate: isOpen ? 135 : 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-krov-blood/40 text-krov-rose"
            aria-hidden="true"
          >
            <Plus size={16} />
          </motion.span>
        </button>
      </h3>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id={`${id}-panel`}
            role="region"
            aria-labelledby={`${id}-button`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            <p
              className="px-6 pb-6 text-sm leading-relaxed text-white/60 md:text-base"
              style={{ fontFamily: serif }}
            >
              {a}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function FAQAccordion() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" aria-labelledby="faq-heading" className="scroll-mt-24">
      <div id="faq-heading">
        <SectionHeading
          eyebrow="Preguntas frecuentes"
          title="Resolvemos tus"
          emphasis="dudas"
          description="Un vistazo rápido a las consultas más comunes. ¿No encuentras lo que buscas? Escríbenos."
        />
      </div>

      <motion.div
        variants={stagger}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-80px" }}
        className="mx-auto mt-14 max-w-3xl space-y-4"
      >
        {faqs.map((f, i) => (
          <FAQItem
            key={f.q}
            id={`faq-${i}`}
            q={f.q}
            a={f.a}
            isOpen={open === i}
            onToggle={() => setOpen(open === i ? null : i)}
          />
        ))}
      </motion.div>
    </section>
  );
}
