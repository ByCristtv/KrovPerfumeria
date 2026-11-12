import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";
import AdminContainer from "@/components/admin/ui/AdminContainer";
import AdminPageHeader from "@/components/admin/ui/AdminPageHeader";
import TierThresholdsEditor from "@/components/admin/rewards/TierThresholdsEditor";
import CouponRewardsManager from "@/components/admin/rewards/CouponRewardsManager";
import { getRewardsAdminData } from "@/features/admin/getRewardsAdminData";
import { MISSING_MIGRATION_MESSAGE } from "@/lib/loyalty/errors";

export const metadata: Metadata = {
  title: "Recompensas — Admin",
};

// Always the stored configuration, never a cached copy: an admin edits here.
export const dynamic = "force-dynamic";

/**
 * Admin → Recompensas: the XP each rank requires and the coupons each rank
 * hands out.
 *
 * Authorization: proxy.ts redirects non-admins away from /admin/*; the server
 * actions re-check the role; the RPCs behind them check is_admin() and are the
 * only write path (migration 20261109000200).
 *
 * Source of truth: `public.levels` (thresholds) and `public.coupons` (reward
 * definitions). Nothing on this page is hard-coded — the ranks, their order and
 * every number are read from the database.
 */
export default async function AdminRewardsPage() {
  const data = await getRewardsAdminData();

  return (
    <AdminContainer width="narrow">
      <AdminPageHeader
        eyebrow="Fidelidad"
        title="Recompensas"
        description="Define cuánta experiencia requiere cada rango y qué cupones entrega al alcanzarlo."
      />

      {data.status === "error" ? (
        <div
          role="alert"
          className="rounded-none border border-red-500/40 bg-red-500/10 px-5 py-4 text-sm text-red-200"
        >
          {data.message} Recarga la página o revisa la conexión con Supabase.
        </div>
      ) : (
        <div className="space-y-10">
          {!data.migrationsApplied && (
            <div
              role="status"
              className="flex items-start gap-3 rounded-none border border-amber-400/40 bg-amber-400/10 px-5 py-4 text-sm text-amber-100"
            >
              <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
              <p>
                {MISSING_MIGRATION_MESSAGE} Mientras tanto ves la configuración actual en modo de
                solo lectura.
              </p>
            </div>
          )}

          {/* key: remount with the stored values after every successful save. */}
          <TierThresholdsEditor
            key={data.levelsUpdatedAt ?? "initial"}
            ladder={data.ladder}
            levelsUpdatedAt={data.levelsUpdatedAt}
            readOnly={!data.migrationsApplied}
          />

          <CouponRewardsManager
            ladder={data.ladder}
            rewards={data.rewards}
            readOnly={!data.migrationsApplied}
          />
        </div>
      )}
    </AdminContainer>
  );
}
