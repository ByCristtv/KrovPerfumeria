import { MessageCircle } from "lucide-react";

interface InquiryButtonProps {
  /** A `wa.me` link with the inquiry already written (see lib/whatsapp). */
  href: string;
  label?: string;
}

/**
 * The made-to-order counterpart of {@link AddToCartButton}: same footprint and
 * the same solid KROV red, because it is the page's one primary action in this
 * state too.
 *
 * It is a plain link, not a button with a handler: it opens WhatsApp with the
 * message prefilled and that is all. No cart, no order, no state — and no spark
 * burst, since nothing has been "added" to confirm. A new tab keeps the product
 * page (and the size the customer chose) where it was.
 */
export default function InquiryButton({
  href,
  label = "Consultar disponibilidad",
}: InquiryButtonProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="relative flex w-full items-center justify-center gap-2.5 bg-krov-blood px-3 py-3.5 text-[11px] font-medium uppercase tracking-[0.14em] text-krov-void md:px-8 md:py-4 md:tracking-[0.24em] transition-colors duration-300 hover:bg-krov-blush"
    >
      <MessageCircle size={15} aria-hidden />
      {label}
      <span className="sr-only"> (abre WhatsApp en una pestaña nueva)</span>
    </a>
  );
}
