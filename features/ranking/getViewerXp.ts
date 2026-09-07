import { supabase } from "@/lib/supabase/client";

/**
 * The signed-in viewer's XP balance — and nothing else.
 *
 * Deliberately narrower than `features/account/getAccountData`, which also pulls
 * the address and the wholesale application. /ranking needs one integer to place
 * the visitor on the rewards roadmap, and asking for three tables to render a
 * progress bar would be paying for data the page never shows.
 *
 * Returns null rather than throwing when the profile row can't be read: the
 * roadmap treats "no viewer" as a first-class state (every tier renders, none
 * highlighted), so a failed read degrades to the signed-out view instead of
 * taking the page down.
 */
export async function getViewerXp(userId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("experience_points")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("getViewerXp failed:", error.message);
    return null;
  }

  return data?.experience_points ?? null;
}
