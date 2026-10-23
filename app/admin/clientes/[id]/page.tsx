import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import CustomerOrderHistory from "./CustomerOrderHistory";
import XpAdjustmentForm from "./XpAdjustmentForm";
import { RoleBadge } from "../CustomersTable";
import AdminContainer from "@/components/admin/ui/AdminContainer";
import AdminPageHeader from "@/components/admin/ui/AdminPageHeader";
import { adminSerif } from "@/components/admin/ui/styles";
import RankBadge from "@/components/rank/RankBadge";
import SocialAvatar from "@/components/social/SocialAvatar";
import { getCustomerAdminDetail } from "@/features/admin/getCustomerAdminDetail";
import { formatXp } from "@/lib/format";
import { socialHandle, socialHeadline } from "@/lib/social/display";

export const metadata: Metadata = {
  title: "Cliente — Admin",
};

export const dynamic = "force-dynamic";

interface AdminCustomerPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Admin → Clientes → [id]: profile, XP/rank, manual XP adjustments and order
 * history. Auth: proxy.ts + RLS for reads; the XP form writes only through the
 * admin-gated RPC. Next.js 16: `params` is async and MUST be awaited.
 */
export default async function AdminCustomerPage({ params }: AdminCustomerPageProps) {
  const { id } = await params;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    notFound();
  }

  const detail = await getCustomerAdminDetail(id);
  if (!detail) notFound();

  const { profile, xp, orders, ordersTotal, ordersLoaded, adjustments } = detail;
  const handle = socialHandle(profile.username);

  return (
    <AdminContainer>
      <AdminPageHeader
        eyebrow="Cliente"
        title={socialHeadline(null, profile.full_name)}
        description={handle ?? "Sin nombre de usuario"}
        backHref="/admin/clientes"
        backLabel="Volver a clientes"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <Panel title="Perfil">
            <div className="flex items-center gap-4">
              <SocialAvatar
                username={profile.username}
                fullName={profile.full_name}
                avatarUrl={profile.avatar_url}
                size={56}
              />
              <div className="min-w-0">
                <p className="truncate text-krov-bone">{socialHeadline(null, profile.full_name)}</p>
                <p className="truncate text-sm text-krov-ash">{handle ?? "—"}</p>
              </div>
            </div>

            <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-krov-ash">Cuenta</dt>
              <dd className="text-right">
                <RoleBadge role={profile.role} />
              </dd>
              <dt className="text-krov-ash">Teléfono</dt>
              <dd className="text-right text-krov-bone">{profile.phone || "—"}</dd>
              <dt className="text-krov-ash">Registro</dt>
              <dd className="text-right text-krov-bone">
                {new Date(profile.created_at).toLocaleDateString("es-CR", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </dd>
              <dt className="text-krov-ash">En el ranking</dt>
              <dd className="text-right text-krov-bone">{profile.show_in_ranking ? "Sí" : "No"}</dd>
              <dt className="text-krov-ash">Perfil público</dt>
              <dd className="text-right text-krov-bone">{profile.is_profile_public ? "Sí" : "No"}</dd>
            </dl>
          </Panel>

          <Panel title="Experiencia">
            <div className="flex items-center gap-4">
              <RankBadge rank={xp.currentRank} size="lg" decorative />
              <div>
                <p className="text-2xl text-krov-bone tabular-nums" style={{ fontFamily: adminSerif }}>
                  {formatXp(xp.experiencePoints)} XP
                </p>
                <p className="text-sm text-krov-rose">{xp.currentRank}</p>
              </div>
            </div>

            <div className="mt-4">
              <div
                className="h-1.5 w-full bg-krov-smoke"
                role="progressbar"
                aria-label="Progreso al siguiente rango"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={xp.progressPercent}
              >
                <div className="h-full bg-krov-blood" style={{ width: `${xp.progressPercent}%` }} />
              </div>
              <p className="mt-2 text-xs text-krov-ash">
                {xp.nextRank
                  ? `Faltan ${formatXp(xp.xpRemaining)} XP para ${xp.nextRank}.`
                  : "Rango máximo alcanzado."}
              </p>
            </div>
          </Panel>

          <Panel title="Ajustar XP">
            <XpAdjustmentForm userId={profile.id} currentXp={xp.experiencePoints} />
          </Panel>

          <Panel title="Ajustes recientes">
            {adjustments === null ? (
              <p className="text-xs text-krov-ash">
                El historial de ajustes no está disponible (¿falta aplicar la migración
                20261022000100?).
              </p>
            ) : adjustments.length === 0 ? (
              <p className="text-xs text-krov-ash">Sin ajustes manuales.</p>
            ) : (
              <ul className="divide-y divide-krov-smoke/70 text-sm">
                {adjustments.map((a) => (
                  <li key={a.id} className="py-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span
                        className={`font-medium tabular-nums ${
                          a.delta > 0 ? "text-emerald-300" : "text-red-300"
                        }`}
                      >
                        {a.delta > 0 ? "+" : "−"}
                        {formatXp(Math.abs(a.delta))} XP
                      </span>
                      <span className="text-xs text-krov-ash">
                        {new Date(a.created_at).toLocaleDateString("es-CR", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                    <p className="text-xs text-krov-ash">
                      {formatXp(a.balance_before)} → {formatXp(a.balance_after)} XP
                    </p>
                    {a.reason && <p className="mt-1 text-xs text-krov-bone">{a.reason}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <section className="lg:col-span-2" aria-labelledby="orders-heading">
          <h2
            id="orders-heading"
            className="mb-4 text-xl text-krov-bone"
            style={{ fontFamily: adminSerif }}
          >
            Historial de pedidos
            {ordersLoaded && (
              <span className="ml-2 align-middle text-xs text-krov-ash">({ordersTotal})</span>
            )}
          </h2>
          <CustomerOrderHistory orders={orders} total={ordersTotal} loaded={ordersLoaded} />
        </section>
      </div>
    </AdminContainer>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-none border border-krov-smoke bg-krov-graphite p-5">
      <h2 className="mb-4 text-[11px] uppercase tracking-[0.25em] text-krov-ash">{title}</h2>
      {children}
    </section>
  );
}
