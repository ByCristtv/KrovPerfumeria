"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

interface AddToCartButtonProps {
  onAdd: () => void;
  disabled?: boolean;
  label?: string;
  disabledLabel?: string;
}

interface Particle {
  id: number;
  dx: number;
  dy: number;
  size: number;
}

/**
 * The page's one saturated element: solid KROV red, square, full width.
 *
 * This used to be a dark gradient pill ringed with a red glow. On the old white
 * page that read as premium; on the void it vanishes into the background. The
 * relationship is inverted now — the ground is dark and the commitment is red.
 *
 * On click it releases a short burst of pale sparks. It is the only decorative
 * animation left on the page, and it is attached to the single most important
 * action, which is the only kind of moment that earns one. Particles clear
 * themselves so nothing accumulates across repeated adds.
 */
export default function AddToCartButton({
  onAdd,
  disabled,
  label = "Agregar al carrito",
  disabledLabel = "Sin stock",
}: AddToCartButtonProps) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const [confirmed, setConfirmed] = useState(false);

  const handleClick = () => {
    if (disabled) return;
    onAdd();

    setConfirmed(true);

    const burst: Particle[] = Array.from({ length: 6 }).map((_, i) => ({
      id: Date.now() + i,
      dx: (Math.random() - 0.5) * 110,
      dy: -36 - Math.random() * 70,
      size: 3 + Math.random() * 3,
    }));
    setParticles((p) => [...p, ...burst]);

    window.setTimeout(() => setConfirmed(false), 1600);
    window.setTimeout(
      () =>
        setParticles((p) => p.filter((x) => !burst.find((b) => b.id === x.id))),
      1300
    );
  };

  return (
    <div className="relative h-full">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className={`relative h-full min-h-12 w-full overflow-hidden md:h-auto md:min-h-0 whitespace-nowrap px-3 py-3.5 text-[11px] font-medium uppercase tracking-[0.14em] transition-colors duration-300 md:px-8 md:py-4 md:tracking-[0.24em] ${
          disabled
            ? "cursor-not-allowed border border-krov-smoke text-krov-dust"
            : confirmed
              ? "bg-krov-blush text-krov-void"
              : "bg-krov-blood text-krov-void hover:bg-krov-blush"
        }`}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={confirmed ? "confirmed" : disabled ? "out" : "default"}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
            className="relative inline-flex items-center justify-center gap-2"
          >
            {confirmed ? (
              <>
                <CheckIcon /> Agregado
              </>
            ) : disabled ? (
              disabledLabel
            ) : (
              label
            )}
          </motion.span>
        </AnimatePresence>
      </button>

      {/* Spark burst */}
      <div className="pointer-events-none absolute inset-0 overflow-visible">
        <AnimatePresence>
          {particles.map((p) => (
            <motion.span
              key={p.id}
              initial={{ x: 0, y: 0, opacity: 0.9, scale: 1 }}
              animate={{ x: p.dx, y: p.dy, opacity: 0, scale: 0.4 }}
              transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
              className="absolute left-1/2 top-1/2 rounded-full"
              style={{
                width: p.size,
                height: p.size,
                background:
                  "radial-gradient(circle, #ffdede 0%, #ff0b55 60%, transparent 100%)",
              }}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="text-krov-void"
    >
      <path
        d="M5 12.5l4.5 4.5L19 7"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
