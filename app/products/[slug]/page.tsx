import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getProductBySlug } from "@/features/products/getProductBySlug";
import { getRelatedProducts } from "@/features/products/getRelatedProducts";
import ProductDetailView from "@/components/product/detail/ProductDetailView";
import JsonLd from "@/components/seo/JsonLd";
import { breadcrumbSchema, productGroupSchema } from "@/lib/seo/jsonLd";
import { NOINDEX_FOLLOW, buildPageMetadata } from "@/lib/seo/metadata";
import {
  isListableProduct,
  productDescription,
  productImages,
  productPath,
  productSchemaInput,
  productTitle,
} from "@/lib/seo/product";

interface ProductPageProps {
  // Next.js 16: params/searchParams are async.
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ variant?: string }>;
}

export async function generateMetadata({
  params,
}: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  // Same request-scoped `cache` as the page body: one query serves both.
  const product = await getProductBySlug(slug);

  // A product without a sellable variant renders the 404 page, so its metadata
  // must say noindex too — otherwise the 404 ships with a contradictory
  // `index` signal.
  if (!isListableProduct(product)) {
    return { title: "Producto no encontrado", robots: NOINDEX_FOLLOW };
  }

  // Every metadata field derives from the product row, so title, description,
  // images and the price teaser follow the database with no extra bookkeeping.
  // The canonical carries no query string: `?variant=` only preselects a size
  // on this same document and must not be indexed as a separate page.
  return buildPageMetadata({
    title: productTitle(product),
    description: productDescription(product),
    path: productPath(product.slug),
    images: productImages(product, 4),
  });
}

export default async function ProductPage({
  params,
  searchParams,
}: ProductPageProps) {
  const { slug } = await params;
  const { variant: initialVariantId } = await searchParams;
  const product = await getProductBySlug(slug);

  if (!isListableProduct(product)) {
    notFound();
  }

  const related = await getRelatedProducts(
    product.id,
    product.categories.map((c) => c.id),
    4
  );

  return (
    <>
      {/*
        Structured data is built from the same helpers the page renders with
        (lib/seo/product.ts → lib/stock.ts), so a price or availability that
        disagrees with the visible page — a manual-action risk, not just a
        missed rich result — can't be introduced here. The breadcrumb names
        mirror the visible trail in ProductDetailView.
      */}
      <JsonLd
        data={[
          productGroupSchema(productSchemaInput(product)),
          breadcrumbSchema([
            { name: "KROV", path: "/" },
            { name: "Colección", path: "/products" },
            { name: product.name, path: productPath(product.slug) },
          ]),
        ]}
      />

      <ProductDetailView
        product={product}
        related={related}
        initialVariantId={initialVariantId}
      />
    </>
  );
}
