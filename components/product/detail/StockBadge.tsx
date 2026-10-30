"use client";

import type { Availability } from "@/lib/stock";

interface StockBadgeProps {
  /** What the selected variant is to a customer — see `resolveAvailability`. */
  availability: Availability;
}

/**
 * Availability, told with a dot and a word.
 *
 * The traffic-light palette (green / amber / red) is deliberately gone: on the
 * KROV ground it read as a system alert, and the red state was indistinguishable
 * from the brand's own accent. Availability is now carried by the dot's
 * intensity — a live pulse when stock is healthy, a static rose when it is
 * running out, a hollow ring when it can be had on request ("Por encargo"), and
 * an unlit grey when it is gone.
 *
 * The sold-out word is "Agotado", the same one the catalog card, the size
 * selector and the mobile bar already use, so a sold-out perfume reads the same
 * on every surface.
 */
export default function StockBadge({ availability }: StockBadgeProps) {
  if (availability.status === "made_to_order") {
    return (
      <Badge tone="text-krov-blush" dot="border border-krov-rose">
        Por encargo
      </Badge>
    );
  }
  if (availability.status === "sold_out") {
    return (
      <Badge tone="text-krov-dust" dot="bg-krov-dust">
        Agotado
      </Badge>
    );
  }
  if (availability.units <= 5) {
    return (
      <Badge tone="text-krov-blush" dot="bg-krov-blood">
        Últimas {availability.units} unidades
      </Badge>
    );
  }
  return (
    <Badge tone="text-krov-ash" dot="bg-krov-blood krov-pulse">
      En existencia
    </Badge>
  );
}

function Badge({
  children,
  tone,
  dot,
}: {
  children: React.ReactNode;
  tone: string;
  dot: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] ${tone}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  );
}
