import { supabase } from "@/lib/supabase/client";

/**
 * Resolve a category's id from its stable slug (e.g. "arabe"). The catalog
 * filters by id; curated landing pages are addressed by slug.
 * Returns null when the category doesn't exist (or the lookup fails).
 */
export async function getCategoryIdBySlug(slug: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("categories")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("getCategoryIdBySlug failed:", error.message);
    return null;
  }

  return data?.id ?? null;
}
