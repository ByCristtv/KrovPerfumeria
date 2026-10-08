import type { Metadata } from "next";
import CatalogLandingView from "@/components/catalog/CatalogLandingView";
import { getLandingCatalog } from "@/features/products/getLandingCatalog";
import { parseCatalogPage, type RawSearchParams } from "@/lib/catalogParams";
import { LANDINGS, landingMetadata } from "@/lib/seo/landings";

const landing = LANDINGS["decants"];

interface LandingPageProps {
  // Next.js 16: searchParams is async.
  searchParams: Promise<RawSearchParams>;
}

export async function generateMetadata({
  searchParams,
}: LandingPageProps): Promise<Metadata> {
  const page = parseCatalogPage(await searchParams);
  // Same request-scoped cache as the page body: one query serves both.
  return landingMetadata(landing, await getLandingCatalog(landing.slug, page));
}

export default async function Page({ searchParams }: LandingPageProps) {
  const page = parseCatalogPage(await searchParams);
  return <CatalogLandingView landing={landing} page={page} />;
}
