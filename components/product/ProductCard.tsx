"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, Plus } from "lucide-react";
import { useAddToCart } from "@/hooks/useCart";
import type { ProductCardData, ProductTypes } from "@/types/product";
import { resolveCardState, type CardState, type CardStatus } from "@/lib/catalog/cardState";
import { buildProductInquiryUrl } from "@/lib/whatsapp/productInquiry";
import { formatPrice } from "@/lib/format";
import { useCatalogWholesale } from "@/components/catalog/CatalogWholesaleContext";
import { isWholesaleConfigured } from "@/lib/pricing/wholesale";

const serif = "var(--font-krov-display), 'Cormorant Garamond', Georgia, serif";

/**
 * The width the photograph is actually drawn at, so the browser requests (and
 * decodes) a candidate that size and not the whole column. The plate has `p-7`
 * (28px a side) around the image, so the drawn width is the column width minus
 * 56px; the column widths come from ProductGrid (2 columns below 768px, 3 below
 * 1024px, 4 above) and the page gutters (px-5, sm:px-8) inside `max-w-7xl`.
 * Using the full column made a 3x phone fetch and decode a 640px image for a
 * ~110px slot: ~3x the bytes and bitmap memory, times every card on the page.
 * Keep in sync with ProductGrid's columns and the plate padding below.
 */
const IMAGE_SIZES = [
  "(max-width: 639px) calc(50vw - 84px)",
  "(max-width: 767px) calc(50vw - 100px)",
  "(max-width: 1023px) calc(33.4vw - 93px)",
  "(max-width: 1279px) calc(25vw - 90px)",
  "230px",
].join(", ");

const TYPE_LABEL: Record<ProductTypes, string> = {
  full_size: "Botella",
  decant: "Decant",
  set: "Set",
};

/**
 * ── The card ────────────────────────────────────────────────────────────────
 *
 * A plate: a luminous image niche with the type set beneath it on the page's own
 * ground. There is no container — the photograph and the words are the card.
 *
 * · The niche stays LIGHT. Product photography is shot on white, so a dark tile
 *   would either show a white rectangle or need every asset re-cut.
 *
 * · The corner control is a small square that only fills with red on hover, and
 *   on touch it is permanently visible. Hiding a primary action behind hover is a
 *   desktop-only affordance and would strand every phone.
 *
 * ── What the card says, and who decides ─────────────────────────────────────
 *
 * Which of the five states a card is in — available, low stock, made to order,
 * decants only, sold out — is decided by `resolveCardState` (lib/catalog/
 * cardState.ts), never here. This file only DRAWS a state:
 *
 *   top-left   ONE availability badge — or none when KROV holds the bottle
 *              (`available` AND `low_stock`: the resolver still tells them apart
 *              for its callers, but the card shows no badge and no count for
 *              either; only the non-stock states need a label)
 *   top-right  the discount, when it is real — a different fact, so it may sit
 *              beside the availability badge but never replaces it
 *   corner     ONE control, chosen by the state, not by the mere existence of
 *              decants: + (add) · WhatsApp · + (pick a decant) · disabled
 *
 * The presentation line and the price always describe the SAME variant — the one
 * the card actually offers — so a bottle's price is never shown beside a decant,
 * and a bottle nobody can obtain is never the only thing a card advertises.
 */

// ── Availability badge (top-left) ───────────────────────────────────────────

type BadgeTone = "quiet" | "muted";

// Flat translucent fills, NOT `backdrop-blur`: a backdrop filter makes the
// compositor end the render pass, re-read the pixels behind the badge and blur
// them again on every scrolled frame, once per badge in view. On a 90%-opaque
// plate the blur was invisible anyway.
const BADGE_TONE: Record<BadgeTone, string> = {
  quiet: "bg-krov-void/85 text-krov-blush",
  muted: "bg-krov-void/90 text-krov-ash",
};

// No `available` / `low_stock` entry: a bottle KROV holds carries no badge.
const STATUS_BADGE: Partial<Record<CardStatus, { label: string; tone: BadgeTone }>> = {
  made_to_order: { label: "Por encargo", tone: "quiet" },
  decants_only: { label: "Solo en decants", tone: "quiet" },
  sold_out: { label: "Agotado", tone: "muted" },
};

/** Compact, rectangular, uppercase. It may wrap to two lines beside a discount. */
function AvailabilityBadge({ status }: { status: CardStatus }) {
  const badge = STATUS_BADGE[status];
  if (!badge) return null;
  return (
    <span
      className={`min-w-0 px-2 py-1 text-[9px] uppercase leading-[1.3] tracking-[0.14em] ${BADGE_TONE[badge.tone]}`}
    >
      {badge.label}
    </span>
  );
}

// ── Presentation line ───────────────────────────────────────────────────────

/**
 * "Botella · 100 ml", "Botella · 100 ml · Por encargo", "Decants disponibles ·
 * Desde 3 ml".
 *
 * On a two-column phone this line often cannot fit on one row. It is built from
 * segments whose inner spaces are non-breaking, so it wraps BETWEEN segments
 * ("Botella · 100 ml ·" / "Por encargo") and never inside one ("Por / encargo",
 * "100 / ml").
 */
function presentationLabel(state: CardState): string {
  const v = state.presented;

  const segments =
    state.status === "decants_only"
      ? state.decantsAvailable.length > 1
        ? ["Decants disponibles", `Desde ${state.decantFromMl} ml`]
        : ["Decant", `${v.size_ml} ml`]
      : [
          TYPE_LABEL[v.product_type],
          `${v.size_ml} ml`,
          ...(state.status === "made_to_order" ? ["Por encargo"] : []),
        ];

  return segments.map((s) => s.replace(/ /g, "\u00a0")).join(" · ");
}

// ── Corner control (bottom-right) ───────────────────────────────────────────

// Hidden until hover only where hover exists (a mouse at >= 640px). A touch
// tablet is also >= 640px wide, and `sm:opacity-0` alone would have hidden the
// add button from it for good — there is no hover to bring it back.
const CORNER =
  "absolute bottom-0 right-0 flex h-11 w-11 items-center justify-center transition-[opacity,background-color,color] duration-200 motion-reduce:transition-none [@media(hover:hover)_and_(min-width:40rem)]:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100";
const CORNER_LIVE =
  "bg-krov-void/90 text-krov-blush hover:bg-krov-blood hover:text-krov-void";

export default function ProductCard({ product }: { product: ProductCardData }) {
  // The add-only hook, not `useCart()`: that one subscribes to the WHOLE cart
  // store and builds four mutations, so every card on the page (up to 20) paid
  // for it on mount and re-rendered on every cart change.
  const addItem = useAddToCart();
  const { eligible, pricingMap } = useCatalogWholesale();

  const [added, setAdded] = useState(false);
  const addedTimeout = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (addedTimeout.current) clearTimeout(addedTimeout.current);
    };
  }, []);

  // A product with no commercial (featured) variant can't be sold or priced.
  const state = product.featured_variant ? resolveCardState(product) : null;
  if (!state) return null;

  const { status, action, presented, price } = state;
  const imageUrl = product.product_images[0]?.url || "/placeholder.png";

  // Wholesale dual pricing — approved buyers only, only where the card offers the
  // regular add-to-cart (a made-to-order bottle or a decant never enters a
  // wholesale cart), and only for the featured variant, whose wholesale columns
  // are the ones fetched client-side (see CatalogWholesaleProvider).
  const wholesale = pricingMap[presented.id];
  const showWholesale =
    eligible &&
    action === "add_to_cart" &&
    price.current !== null &&
    !!wholesale &&
    isWholesaleConfigured(wholesale);
  const wholesalePrice = showWholesale ? (wholesale.wholesale_price as number) : null;
  const minWholesaleQty = showWholesale
    ? (wholesale.min_wholesale_quantity as number)
    : null;

  // The inquiry describes the bottle the card presents, at the published retail
  // price — an inquiry is not a wholesale order.
  const inquiryUrl =
    action === "whatsapp"
      ? buildProductInquiryUrl({
          productName: product.name,
          brand: product.brands?.name,
          sizeMl: presented.size_ml,
          productType: presented.product_type,
          sku: presented.sku,
          price: price.current,
          slug: product.slug,
        })
      : null;

  const handleAddToCart = () => {
    if (action !== "add_to_cart" || price.current === null) return;
    addItem({
      variant_id: presented.id,
      product_name: product.name,
      product_type: presented.product_type,
      size_ml: presented.size_ml,
      price: price.current,
      image_url: imageUrl,
      stock: state.units,
    });
    setAdded(true);
    if (addedTimeout.current) clearTimeout(addedTimeout.current);
    addedTimeout.current = window.setTimeout(() => setAdded(false), 1600);
  };

  const hasDiscount = price.discountPercent !== null;
  const startsFrom = status === "decants_only" && state.decantsAvailable.length > 1;

  return (
    <article className="animate-fadeIn group flex h-full flex-col">
      {/* ── The niche ──────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-t-xl">
        <Link
          href={`/products/${product.slug}`}
          className="relative block aspect-4/5 overflow-hidden bg-linear-to-b from-krov-linen to-krov-linen-deep"
          aria-label={`Ver ${product.name}`}
        >
          {/* The linen plate is already the image's placeholder, so there is no
              skeleton, no load-state and no fade: the photograph simply paints
              when the browser has decoded it (`decoding="async"`, lazy below
              the fold). That was one `useState`, one re-render and one infinite
              `animate-pulse` per card, ~20 of them while a page loaded. */}
          <Image
            src={imageUrl}
            alt={product.name}
            fill
            sizes={IMAGE_SIZES}
            className="object-contain p-7 transition-transform duration-500 ease-krov motion-reduce:transition-none group-hover:scale-[1.04]"
          />

          {/* A red edge lights along the foot of the plate on hover. Cheaper to
              read than a shadow and it belongs to the palette. */}
          <span
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 bg-krov-blood transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-x-100"
          />
        </Link>

        {/* Badges — two independent corners, flush and square. Availability
            (left) and discount (right) are different facts and never stack; the
            left one yields width, wrapping to two lines, before it would ever
            reach the discount. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-1">
          <AvailabilityBadge status={status} />
          {hasDiscount && (
            <span className="ml-auto shrink-0 bg-krov-blood px-2 py-1 text-[10px] font-medium leading-[1.3] tabular-nums tracking-[0.04em] text-krov-void">
              <span aria-hidden>-{price.discountPercent}%</span>
              <span className="sr-only">{price.discountPercent}% de descuento</span>
            </span>
          )}
        </div>

        {/* Corner control: one per card, chosen by the STATE. On touch it is
            always visible (`sm:` gates only the opacity fade) and keeps a 44px
            target. */}
        {action === "add_to_cart" && (
          <button
            type="button"
            onClick={handleAddToCart}
            aria-label={`Agregar ${product.name} al carrito`}
            className={`${CORNER} ${
              added
                ? "bg-krov-blood text-krov-void opacity-100!"
                : CORNER_LIVE
            }`}
          >
            {added ? <Check size={16} aria-hidden /> : <Plus size={16} aria-hidden />}
          </button>
        )}

        {/* Made to order: a link, not a button — it opens WhatsApp with the
            inquiry prefilled (a new tab, so the catalog and its filters stay put)
            and has no connection to the cart. */}
        {action === "whatsapp" && inquiryUrl && (
          <a
            href={inquiryUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Consultar disponibilidad de ${product.name} por WhatsApp`}
            title="Consultar disponibilidad por WhatsApp"
            className={`${CORNER} ${CORNER_LIVE}`}
          >
            <Image
              src="/icons/whatsapp.svg"
              alt=""
              width={18}
              height={18}
              aria-hidden
              className="h-[18px] w-[18px]"
            />
          </a>
        )}

        {/* Decants only: the existing size picker lives on the product page, so
            the control goes there with the starting decant preselected. */}
        {action === "choose_decant" && (
          <Link
            href={`/products/${product.slug}?variant=${presented.id}`}
            aria-label={`Elegir un decant de ${product.name}`}
            title="Ver los decants disponibles"
            className={`${CORNER} ${CORNER_LIVE}`}
          >
            <Plus size={16} aria-hidden />
          </Link>
        )}

        {/* Nothing to buy or ask about: a restrained, disabled square. */}
        {action === "none" && (
          <button
            type="button"
            disabled
            aria-label={status === "sold_out" ? "Sin stock" : "Precio no disponible"}
            className={`${CORNER} cursor-not-allowed bg-krov-void/70 text-krov-dust`}
          >
            <Plus size={16} aria-hidden />
          </button>
        )}
      </div>

      {/* ── The type ───────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col pt-4">
        <p className="text-[10px] uppercase tracking-[0.26em] text-krov-rose">
          {product.brands?.name ?? "KROV"}
        </p>

        {/* Two lines are reserved for EVERY name, so a one-line name and a
            two-line name leave the presentation and price at the same height
            across a row. Long names clamp at two lines instead of one. */}
        <h3
          className="mt-2 text-[18px] leading-[1.2] text-krov-bone"
          style={{ fontFamily: serif }}
          title={product.name}
        >
          <Link
            href={`/products/${product.slug}`}
            className="line-clamp-2 min-h-[2.4em] transition-colors duration-300 hover:text-krov-blush"
          >
            {product.name}
          </Link>
        </h3>

        <p className="mt-1.5 text-[12px] tracking-[0.04em] text-krov-dust">
          {presentationLabel(state)}
        </p>
        {state.alsoDecants && (
          <p className="mt-0.5 text-[11px] tracking-[0.04em] text-krov-ash">
            También disponible en decants
          </p>
        )}

        {/* Price sits on its own line at the foot of the card so every card in a
            row aligns its price regardless of how long the name wrapped. */}
        <div className="mt-auto flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 pt-3">
          {price.current === null ? (
            <span className="text-[12px] text-krov-dust">Precio no disponible</span>
          ) : showWholesale ? (
            // Wholesale buyer: retail struck through, wholesale leads in rose.
            <>
              <span className="text-[17px] tabular-nums text-krov-rose">
                {formatPrice(wholesalePrice as number)}
              </span>
              <span className="text-[12px] text-krov-dust line-through">
                {formatPrice(price.current)}
              </span>
            </>
          ) : (
            <>
              {startsFrom && (
                <span className="text-[11px] uppercase tracking-[0.14em] text-krov-dust">
                  Desde{" "}
                </span>
              )}
              <span
                className={`text-[17px] tabular-nums ${
                  status === "sold_out" ? "text-krov-ash" : "text-krov-bone"
                }`}
              >
                {formatPrice(price.current)}
              </span>
              {price.original !== null && (
                <span className="text-[12px] tabular-nums text-krov-dust line-through">
                  {formatPrice(price.original)}
                </span>
              )}
            </>
          )}
        </div>

        {/* Minimum wholesale quantity (no savings % — keep the card clean). */}
        {showWholesale && (
          <span className="mt-2 text-[9px] uppercase tracking-[0.2em] text-krov-dust">
            Desde {minWholesaleQty} uds.
          </span>
        )}
      </div>
    </article>
  );
}
