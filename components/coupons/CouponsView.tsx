"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import Swal from "sweetalert2";
import CouponCard from "@/components/coupons/CouponCard";
import { Bone, LoadingAnnouncement, SkeletonRegion } from "@/components/ui/Skeleton";
import { useAuthUser } from "@/hooks/useAuthUser";
import { ClaimCouponError, useClaimCoupon, useUserCoupons } from "@/hooks/useUserCoupons";
import { groupCoupons } from "@/lib/coupons/discount";
import type { CouponGroup, UserCoupon } from "@/lib/coupons/types";

const SERIF = "var(--font-krov-display), 'Cormorant Garamond', Georgia, serif";

const PAGE_CLS =
  "min-h-screen px-4 pt-28 pb-16 bg-[radial-gradient(circle_at_12%_8%,#191420_0%,#111_45%,#000_100%)]";

/** Section order and copy. `Disponibles` leads: it is what people came for. */
const SECTIONS: Array<{
  group: CouponGroup;
  title: string;
  description: string;
}> = [
  {
    group: "available",
    title: "Disponibles",
    description: "Listos para usar en tu próxima compra. Un cupón por pedido.",
  },
  {
    group: "used",
    title: "Usados",
    description: "Cupones que ya aplicaste a un pedido.",
  },
  {
    group: "expired",
    title: "Vencidos",
    description: "Cupones cuyo plazo terminó.",
  },
];

/**
 * /profile/coupons: the customer's level coupons, grouped by what they can still
 * do — Disponibles / Usados / Vencidos.
 *
 * Client-rendered like /profile and /profile/orders: the session lives in the
 * browser client and every row depends on who is asking (RLS on `user_coupons`).
 */
export default function CouponsView() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuthUser();
  const couponsQuery = useUserCoupons();
  const claim = useClaimCoupon();
  const [claimingId, setClaimingId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  const groups = useMemo(
    () => groupCoupons(couponsQuery.data ?? []),
    [couponsQuery.data]
  );
  const total = couponsQuery.data?.length ?? 0;
  const loading = authLoading || !user || couponsQuery.isPending;

  const handleClaim = (coupon: UserCoupon) => {
    setClaimingId(coupon.id);
    claim.mutate(coupon.id, {
      onSuccess: () => {
        void Swal.fire({
          toast: true,
          position: "top-end",
          icon: "success",
          title: "Cupón reclamado",
          showConfirmButton: false,
          timer: 2000,
          timerProgressBar: true,
        });
      },
      onError: (error: ClaimCouponError) => {
        void Swal.fire({
          icon: "error",
          title: "No se pudo reclamar",
          text: error.message,
          confirmButtonColor: "#ff4d74",
        });
      },
      onSettled: () => setClaimingId(null),
    });
  };

  return (
    <section className={PAGE_CLS}>
      <div className="mx-auto max-w-3xl">
        <Link
          href="/profile"
          className="group inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 bg-black/40 px-5 text-[11px] uppercase tracking-[0.2em] text-white/75 transition-colors duration-300 hover:border-krov-blood/60 hover:text-krov-rose"
        >
          <ArrowLeft
            size={15}
            aria-hidden
            className="transition-transform duration-300 group-hover:-translate-x-1"
          />
          Volver a mi perfil
        </Link>

        <header className="mt-8 mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-krov-smoke pb-7 sm:mb-10">
          <div>
            <p className="mb-3 text-[10px] uppercase tracking-[0.35em] text-krov-rose">
              Mi cuenta
            </p>
            <h1
              className="text-3xl font-light tracking-[0.04em] text-white sm:text-4xl"
              style={{ fontFamily: SERIF }}
            >
              Mis cupones
            </h1>
          </div>
          {!loading && total > 0 && (
            <p className="krov-enter text-xs text-white/45">
              {groups.available.length} disponible
              {groups.available.length === 1 ? "" : "s"}
            </p>
          )}
        </header>

        {loading ? (
          <CouponsSkeleton />
        ) : couponsQuery.isError ? (
          <StatePanel title="No pudimos cargar tus cupones">
            <p>Revisa tu conexión e inténtalo de nuevo.</p>
            <button
              type="button"
              onClick={() => void couponsQuery.refetch()}
              className="mt-5 min-h-10 border border-krov-blood/50 px-6 text-[10px] uppercase tracking-[0.2em] text-krov-rose transition-colors duration-300 hover:bg-krov-blood hover:text-black"
            >
              Reintentar
            </button>
          </StatePanel>
        ) : total === 0 ? (
          <StatePanel title="Todavía no tienes cupones">
            <p>
              Sube de nivel comprando: cada nivel desbloquea un cupón de
              descuento de un solo uso.
            </p>
            <Link
              href="/ranking"
              className="mt-5 inline-flex min-h-10 items-center border border-krov-blood/50 px-6 text-[10px] uppercase tracking-[0.2em] text-krov-rose transition-colors duration-300 hover:bg-krov-blood hover:text-black"
            >
              Ver los premios por nivel
            </Link>
          </StatePanel>
        ) : (
          <div className="space-y-10">
            {SECTIONS.map(({ group, title, description }) => {
              const items = groups[group];
              // Hide empty "Usados"/"Vencidos"; keep "Disponibles" so the page
              // still explains itself when everything has been spent.
              if (items.length === 0 && group !== "available") return null;

              return (
                <section key={group} aria-labelledby={`coupons-${group}`}>
                  <div className="mb-4">
                    <h2
                      id={`coupons-${group}`}
                      className="text-[10px] uppercase tracking-[0.25em] text-white/50"
                    >
                      {title}
                      <span className="ml-2 tabular-nums text-white/30">
                        {items.length}
                      </span>
                    </h2>
                    <p className="mt-1.5 text-xs text-white/35">{description}</p>
                  </div>

                  {items.length === 0 ? (
                    <p className="rounded-2xl border border-krov-smoke bg-black/40 px-5 py-6 text-sm text-white/45">
                      No tienes cupones disponibles ahora mismo.
                    </p>
                  ) : (
                    <ul className="krov-enter-stagger space-y-4">
                      {items.map((coupon) => (
                        <CouponCard
                          key={coupon.id}
                          coupon={coupon}
                          onClaim={group === "available" ? handleClaim : undefined}
                          claiming={claimingId === coupon.id}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function StatePanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="krov-enter rounded-2xl border border-krov-smoke bg-black/50 px-6 py-10 text-center text-sm text-white/55">
      <h2 className="text-xl text-white" style={{ fontFamily: SERIF }}>
        {title}
      </h2>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function CouponsSkeleton() {
  return (
    <div className="space-y-4">
      <LoadingAnnouncement label="Cargando tus cupones…" />
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex overflow-hidden rounded-2xl border border-krov-smoke bg-black/50"
        >
          <SkeletonRegion className="flex w-full items-stretch">
            <Bone className="h-28 w-28 shrink-0 rounded-none sm:w-32" />
            <div className="flex-1 space-y-3 p-5">
              <Bone className="h-5 w-40" />
              <Bone className="h-3 w-56" />
              <Bone className="h-3 w-32" />
            </div>
          </SkeletonRegion>
        </div>
      ))}
    </div>
  );
}
