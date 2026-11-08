import { supabase } from "@/lib/supabase/client";

/**
 * Every category, for the catalog filter dropdown and the admin pickers.
 * `slug` lets callers tell the gender compatibility categories (Hombre / Mujer /
 * Unisex) from the commercial ones — see lib/catalogCategoryFilter.ts.
 */
export async function getCategories() {
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, slug")
    .order("name");

  if (error) throw new Error(error.message);
  return data ?? [];
}
