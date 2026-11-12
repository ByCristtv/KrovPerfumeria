"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import Swal from "sweetalert2";
import {
  deleteCouponRewardAction,
  issueCouponRewardRetroactivelyAction,
  setCouponRewardActiveAction,
} from "@/app/admin/rewards/actions";
import RankBadge from "@/components/rank/RankBadge";
import { adminSerif, ADMIN_ACCENT } from "@/components/admin/ui/styles";
import { formatPrice, formatXp } from "@/lib/format";
import { describeBenefit } from "@/lib/coupons/discount";
import type { RankLadder, RankTier } from "@/lib/rank";
import type { AdminRewardDefinition } from "@/lib/loyalty/types";
import RewardFormModal, { type RewardFormTarget } from "./RewardFormModal";

interface Props {
  ladder: RankLadder;
  rewards: AdminRewardDefinition[];
  /** Migrations not applied yet — show, don't edit. */
  readOnly?: boolean;
}

function toast(message: string) {
  void Swal.fire({
    toast: true,
    position: "top-end",
    icon: "success",
    title: message,
    showConfirmButton: false,
    timer: 3000,
    timerProgressBar: true,
  });
}

function failure(message: string) {
  void Swal.fire({ icon: "error", title: "No se pudo completar", text: message, confirmButtonColor: ADMIN_ACCENT });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Coupon reward DEFINITIONS, grouped by rank. A rank may hand out several
 * independent coupons, or none.
 *
 * Every action goes through a server action → admin RPC (migration
 * 20261109000200); the page re-renders from the database afterwards
 * (revalidatePath), so what is listed is always what is stored. Destructive or
 * customer-visible actions ask first and say exactly what will and will not
 * change for customers who already hold the coupon.
 */
export default function CouponRewardsManager({ ladder, rewards, readOnly = false }: Props) {
  const [target, setTarget] = useState<RewardFormTarget | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const byLevel = new Map<number, AdminRewardDefinition[]>();
  for (const reward of rewards) {
    const list = byLevel.get(reward.level) ?? [];
    list.push(reward);
    byLevel.set(reward.level, list);
  }

  function run(id: string, task: () => Promise<void>) {
    setBusyId(id);
    startTransition(async () => {
      try {
        await task();
      } catch {
        failure("Error de conexión. Intenta de nuevo.");
      } finally {
        setBusyId(null);
      }
    });
  }

  async function toggleActive(reward: AdminRewardDefinition, tier: RankTier | undefined) {
    const activating = !reward.isActive;
    const confirm = await Swal.fire({
      title: activating ? "¿Activar recompensa?" : "¿Desactivar recompensa?",
      html: activating
        ? `<b>${escapeHtml(reward.name)}</b> se entregará a quienes alcancen <b>${tier?.rank ?? "el rango"}</b> a partir de ahora. Quienes ya tienen el rango no la reciben automáticamente.`
        : `<b>${escapeHtml(reward.name)}</b> dejará de entregarse.${
            reward.issuedCount > 0
              ? ` Los ${reward.issuedCount} cupones ya entregados <b>siguen siendo válidos</b>.`
              : ""
          }`,
      icon: activating ? "question" : "warning",
      showCancelButton: true,
      confirmButtonColor: ADMIN_ACCENT,
      cancelButtonColor: "#2a2130",
      confirmButtonText: activating ? "Activar" : "Desactivar",
      cancelButtonText: "Cancelar",
    });
    if (!confirm.isConfirmed) return;

    run(reward.id, async () => {
      const result = await setCouponRewardActiveAction(reward.id, activating);
      if (result.ok) toast(result.message);
      else failure(result.message);
    });
  }

  async function remove(reward: AdminRewardDefinition) {
    const confirm = await Swal.fire({
      title: "¿Eliminar recompensa?",
      html: `Vas a eliminar <b>${escapeHtml(reward.name)}</b> (${escapeHtml(reward.code)}). Nunca se entregó a ningún cliente. Esta acción no se puede deshacer.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#2a2130",
      confirmButtonText: "Sí, eliminar",
      cancelButtonText: "Cancelar",
    });
    if (!confirm.isConfirmed) return;

    run(reward.id, async () => {
      const result = await deleteCouponRewardAction(reward.id);
      if (result.ok) toast(result.message);
      else failure(result.message);
    });
  }

  function issueToCurrent(reward: AdminRewardDefinition, tier: RankTier | undefined) {
    run(reward.id, async () => {
      const preview = await issueCouponRewardRetroactivelyAction(reward.id, true);
      if (!preview.ok || !preview.data) {
        failure(preview.message);
        return;
      }
      const eligible = preview.data.eligible;
      if (eligible === 0) {
        void Swal.fire({
          icon: "info",
          title: "Nadie pendiente",
          text: "Todos los clientes con este rango o superior ya tienen esta recompensa.",
          confirmButtonColor: ADMIN_ACCENT,
        });
        return;
      }

      const confirm = await Swal.fire({
        title: "¿Entregar a clientes actuales?",
        html: `<b>${escapeHtml(reward.name)}</b> se entregará ahora a <b>${eligible} ${
          eligible === 1 ? "cliente" : "clientes"
        }</b> que ya tienen ${tier?.rank ?? "el rango"} o superior y aún no la tienen. Nadie la recibe dos veces. Los cupones entregados no se pueden retirar.`,
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: ADMIN_ACCENT,
        cancelButtonColor: "#2a2130",
        confirmButtonText: "Entregar",
        cancelButtonText: "Cancelar",
      });
      if (!confirm.isConfirmed) return;

      const result = await issueCouponRewardRetroactivelyAction(reward.id, false);
      if (result.ok) toast(result.message);
      else failure(result.message);
    });
  }

  return (
    <section aria-labelledby="rewards-heading" className="rounded-none border border-krov-smoke bg-krov-graphite">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-krov-smoke px-5 py-4">
        <div>
          <h2 id="rewards-heading" className="text-xl text-krov-bone" style={{ fontFamily: adminSerif }}>
            Cupones por rango
          </h2>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-krov-ash">
            Cada recompensa activa se entrega una sola vez a cada cliente cuando alcanza su rango. Los
            cambios aplican a cupones futuros; los ya entregados conservan sus condiciones.
          </p>
        </div>
      </header>

      <div className="divide-y divide-krov-smoke/70">
        {ladder.map((tier, index) => {
          const list = byLevel.get(tier.level) ?? [];
          const next = ladder[index + 1];
          return (
            <section key={tier.level} aria-labelledby={`rank-${tier.level}-heading`} className="px-5 py-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <RankBadge rank={tier.rank} size="sm" decorative />
                  <div>
                    <h3 id={`rank-${tier.level}-heading`} className="text-sm font-medium text-krov-bone">
                      {tier.rank}
                    </h3>
                    <p className="text-[11px] tabular-nums text-krov-dust">
                      {next
                        ? `${formatXp(tier.minXP)} – ${formatXp(next.minXP - 1)} XP`
                        : `${formatXp(tier.minXP)}+ XP`}
                      {" · "}
                      {list.filter((r) => r.isActive).length} activas
                    </p>
                  </div>
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => setTarget({ mode: "create", level: tier.level })}
                    className="inline-flex items-center gap-1.5 rounded-none border border-krov-blood/50 px-3 py-2 text-xs uppercase tracking-[0.14em] text-krov-rose transition hover:bg-krov-blood/10"
                  >
                    <Plus size={14} aria-hidden />
                    Agregar cupón
                    <span className="sr-only"> a {tier.rank}</span>
                  </button>
                )}
              </div>

              {list.length === 0 ? (
                <p className="border border-dashed border-krov-smoke px-4 py-3 text-xs text-krov-dust">
                  Este rango no entrega cupones.
                </p>
              ) : (
                <ul className="grid gap-3 md:grid-cols-2">
                  {list.map((reward) => (
                    <RewardCard
                      key={reward.id}
                      reward={reward}
                      busy={busyId === reward.id}
                      readOnly={readOnly}
                      onEdit={() => setTarget({ mode: "edit", reward })}
                      onToggle={() => void toggleActive(reward, tier)}
                      onDelete={() => void remove(reward)}
                      onIssue={() => issueToCurrent(reward, tier)}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <RewardFormModal
        ladder={ladder}
        target={target}
        onClose={() => setTarget(null)}
        onSaved={(message) => {
          setTarget(null);
          toast(message);
        }}
      />
    </section>
  );
}

function RewardCard({
  reward,
  busy,
  readOnly,
  onEdit,
  onToggle,
  onDelete,
  onIssue,
}: {
  reward: AdminRewardDefinition;
  busy: boolean;
  readOnly: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onIssue: () => void;
}) {
  const headline =
    reward.discountType === "percentage" ? `${reward.discountValue}%` : formatPrice(reward.discountValue);
  const conditions = [
    reward.minOrderSubtotal > 0 ? `Compra mínima ${formatPrice(reward.minOrderSubtotal)}` : "Sin compra mínima",
    reward.maxDiscountAmount !== null ? `Tope ${formatPrice(reward.maxDiscountAmount)}` : null,
    reward.validDays !== null ? `Vence a los ${reward.validDays} días` : "No vence",
  ].filter(Boolean);

  const action =
    "rounded-none border px-2.5 py-1.5 text-[11px] uppercase tracking-[0.12em] transition disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <li
      className={`flex flex-col gap-3 border p-4 ${
        reward.isActive ? "border-krov-smoke bg-krov-void" : "border-krov-smoke/60 bg-krov-void/50"
      }`}
      aria-busy={busy || undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-2xl leading-none ${reward.isActive ? "text-krov-rose" : "text-krov-dust"}`} style={{ fontFamily: adminSerif }}>
            {headline}
          </p>
          <p className="mt-1.5 truncate text-sm text-krov-bone">{reward.name}</p>
          <p className="text-[11px] text-krov-dust">{reward.code}</p>
        </div>
        <span
          className={`shrink-0 border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${
            reward.isActive ? "border-emerald-500/40 text-emerald-300" : "border-krov-smoke text-krov-dust"
          }`}
        >
          {reward.isActive ? "Activa" : "Inactiva"}
        </span>
      </div>

      <p className="text-xs text-krov-ash">
        <span className="sr-only">{describeBenefit(reward)}. </span>
        {conditions.join(" · ")}
      </p>
      <p className="text-[11px] text-krov-dust">
        Entregada a {reward.issuedCount} {reward.issuedCount === 1 ? "cliente" : "clientes"}
      </p>

      {!readOnly && (
        <div className="mt-auto flex flex-wrap gap-2">
          <button type="button" onClick={onEdit} disabled={busy} className={`${action} border-krov-smoke text-krov-bone hover:border-krov-blood/60`}>
            Editar
          </button>
          <button type="button" onClick={onToggle} disabled={busy} className={`${action} border-krov-smoke text-krov-ash hover:border-krov-blood/60 hover:text-krov-bone`}>
            {reward.isActive ? "Desactivar" : "Activar"}
          </button>
          {reward.isActive && (
            <button type="button" onClick={onIssue} disabled={busy} className={`${action} border-krov-smoke text-krov-ash hover:border-krov-blood/60 hover:text-krov-bone`}>
              Entregar a clientes actuales
            </button>
          )}
          {reward.issuedCount === 0 && (
            <button type="button" onClick={onDelete} disabled={busy} className={`${action} border-red-500/40 text-red-300 hover:bg-red-500/10`}>
              Eliminar
            </button>
          )}
        </div>
      )}
    </li>
  );
}
