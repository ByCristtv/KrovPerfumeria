import Link from "next/link";
import ProductImage from "@/components/product/ProductImage";
import { formatPrice } from "@/lib/format";
import type { ProductCardData } from "@/types/product";

const serif = "var(--font-krov-display), 'Cormorant Garamond', Georgia, serif";

interface RelatedProductsProps {
  products: ProductCardData[];
}

/**
 * The width drawn: a column of the grid below, inside the product page's gutters,
 * less the plate's `p-6`. Plain `vw` so next/image can prune the srcset (see
 * ProductCard). Keep in sync with the grid and the plate padding.
 */
const IMAGE_SIZES =
  "(max-width: 639px) 31vw, (max-width: 1023px) 42vw, (max-width: 1279px) 19vw, 235px";

/**
 * Built to match the catalogue card exactly — same linen plate, same red edge
 * on hover, same left-aligned type beneath. A visitor who scrolls from the
 * catalogue into a product and on to these should not be able to tell that two
 * different components rendered the tiles.
 */
export default function RelatedProducts({ products }: RelatedProductsProps) {
  if (products.length === 0) return null;

  return (
    <section aria-labelledby="relacionados">
      <header className="mb-10">
        <p className="krov-eyebrow">Selección curada</p>
        <h2
          id="relacionados"
          className="mt-5 text-3xl text-krov-bone sm:text-4xl"
          style={{ fontFamily: serif }}
        >
          En la misma <span className="italic text-krov-blush">familia</span>
        </h2>
        <div className="krov-rule mt-8 h-px w-full" />
      </header>

      <ul className="grid grid-cols-2 gap-5 sm:gap-7 lg:grid-cols-4">
        {products.map((p) => (
          <li key={p.id} className="animate-fadeIn">
            <RelatedCard product={p} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function RelatedCard({ product }: { product: ProductCardData }) {
  const variant = product.featured_variant;
  const img = product.product_images[0]?.url || "/placeholder.png";
  const price = variant
    ? variant.is_on_offer && variant.offer_price
      ? variant.offer_price
      : variant.price
    : null;

  return (
    <Link href={`/products/${product.slug}`} className="group block">
      <div className="relative aspect-4/5 overflow-hidden bg-gradient-to-b from-krov-linen to-krov-linen-deep">
        <ProductImage
          src={img}
          alt={product.name}
          fill
          sizes={IMAGE_SIZES}
          className="object-contain p-6 transition-transform duration-700 ease-out group-hover:scale-[1.05]"
          loading="lazy"
        />
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 bg-krov-blood transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-x-100"
        />
      </div>

      <div className="pt-4">
        <p className="text-[9px] uppercase tracking-[0.28em] text-krov-rose">
          {product.brands?.name}
        </p>
        <h3
          className="mt-2 line-clamp-1 text-base leading-snug text-krov-bone transition-colors duration-300 group-hover:text-krov-blush"
          style={{ fontFamily: serif }}
        >
          {product.name}
        </h3>
        {price != null && (
          <p className="mt-1.5 text-sm tabular-nums text-krov-ash">
            {formatPrice(price)}
          </p>
        )}
      </div>
    </Link>
  );
}
