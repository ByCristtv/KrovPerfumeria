"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Package } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";
import RankProgress from "@/components/account/RankProgress";
import IdentitySection from "@/components/account/IdentitySection";
import ContactSection from "@/components/account/ContactSection";
import AddressSection from "@/components/account/AddressSection";
import { Badge, Card, SectionHeader } from "@/components/account/profileUi";
import {
  Bone,
  LoadingAnnouncement,
  SkeletonRegion,
  TextBone,
} from "@/components/ui/Skeleton";
import {
  getAccountData,
  type AccountData,
} from "@/features/account/getAccountData";

const SERIF = "var(--font-krov-display), 'Cormorant Garamond', Georgia, serif";

/** Shared by the page and its skeleton so the two can't drift apart. */
const PAGE_CLS =
  "min-h-screen px-4 pt-28 pb-16 bg-[radial-gradient(circle_at_12%_8%,#191420_0%,#111_45%,#000_100%)]";
const GRID_CLS =
  "grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]";

/**
 * /profile: the customer's account home.
 *
 * A summary of who you are and where we deliver, and nothing else. The order
 * history moved to /profile/orders; this page links to it with one "Ver
 * pedidos" card, so the account no longer loads every order just to show its
 * details.
 *
 * Layout (one column on phones, two from `lg`):
 *
 *   Identidad          │ Contacto
 *   Rango y progreso   │ Dirección de entrega
 *   Ver pedidos        │ Cuenta mayorista
 *
 * The left column is who you are (short, mostly read); the right is what you
 * maintain (longer, edited). On a phone that order also puts "Ver pedidos"
 * third, where it's reachable without scrolling past the address form.
 *
 * Every editable section edits in place (see `profileUi`), and read-only values
 * (full name, email) never become inputs.
 */
export default function ProfileView() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuthUser();
  const queryClient = useQueryClient();

  const accountQuery = useQuery<AccountData>({
    queryKey: ["account", "data", user?.id],
    queryFn: () => getAccountData(user!.id),
    enabled: !!user,
    staleTime: 60_000,
  });

  /** Re-read after an edit. Scoped to this user's account subtree. */
  const refreshAccount = () => {
    void queryClient.invalidateQueries({ queryKey: ["account", "data"] });
  };

  // Guests don't belong here. `replace` (not push) so Back doesn't bounce them
  // between /profile and /login.
  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  // The skeleton holds until the account query answers too, not just auth.
  // Rendering on auth alone painted placeholder values ("Sin teléfono", a 0 XP
  // bar) for a beat before the real ones replaced them, which reads as wrong
  // data rather than as loading.
  if (authLoading || !user || accountQuery.isPending) {
    return <ProfileSkeleton />;
  }

  const profile = accountQuery.data?.profile ?? null;
  const fullName = user.user_metadata?.full_name ?? "Sin nombre";

  return (
    <section className={PAGE_CLS}>
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-5 border-b border-krov-smoke pb-7 sm:mb-10">
          <div>
            <p className="mb-3 text-[10px] uppercase tracking-[0.35em] text-krov-rose">
              Mi cuenta
            </p>
            <h1
              className="text-3xl font-light tracking-[0.04em] text-white sm:text-4xl"
              style={{ fontFamily: SERIF }}
            >
              Mi perfil
            </h1>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="min-h-10 border border-white/15 px-5 text-[10px] uppercase tracking-[0.2em] text-white/55 transition-colors duration-300 hover:border-krov-blood/60 hover:text-krov-rose"
          >
            Cerrar sesión
          </button>
        </header>

        {accountQuery.isError && (
          <p
            role="alert"
            className="mb-5 rounded-xl border border-red-400/30 bg-red-400/[0.06] px-4 py-3 text-sm text-red-300"
          >
            No pudimos cargar todos tus datos. Recarga la página para intentarlo
            de nuevo.
          </p>
        )}

        <div className={GRID_CLS}>
          {/* Each column staggers its cards. The animation lands on each Card
              itself, never on a wrapper: Cards are backdrop-blur glass, and a
              fading ancestor would blank the blur until the fade ends. */}
          <div className="krov-enter-stagger space-y-5">
            <IdentitySection
              fullName={fullName}
              avatarUrl={user.user_metadata?.avatar_url ?? null}
              username={profile?.username ?? null}
              showInRanking={profile?.show_in_ranking ?? false}
              isProfilePublic={profile?.is_profile_public ?? false}
              onSaved={refreshAccount}
            />

            <Card>
              <SectionHeader
                title="Rango y progreso"
                action={
                  <Link
                    href="/ranking"
                    className="krov-underline text-[11px] text-krov-rose"
                  >
                    Ver premios
                  </Link>
                }
              />
              <RankProgress experiencePoints={profile?.experience_points ?? 0} />
            </Card>

            <OrdersLinkCard />
          </div>

          <div className="krov-enter-stagger space-y-5">
            <ContactSection
              userId={user.id}
              phone={profile?.phone ?? null}
              email={user.email ?? null}
              onSaved={refreshAccount}
            />

            <AddressSection
              userId={user.id}
              address={accountQuery.data?.address ?? null}
              onSaved={refreshAccount}
            />

            
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Orders entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * "Ver pedidos": the whole card is one link (one tab stop, one big target),
 * rather than a card with a small link inside it. It uses the same glass as
 * the other sections, plus a rose edge and a chevron that moves on hover, to
 * mark it as the page's one piece of navigation.
 */
function OrdersLinkCard() {
  return (
    <Link
      href="/profile/orders"
      className="group flex items-center gap-4 rounded-2xl border border-krov-blood/25 bg-black/50 p-5 shadow-[0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur-sm transition-colors duration-300 hover:border-krov-blood/60 hover:bg-krov-blood/[0.05] sm:p-6"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-krov-blood/40 text-krov-rose transition-colors duration-300 group-hover:bg-krov-blood group-hover:text-black">
        <Package size={20} strokeWidth={1.5} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="block text-xl leading-snug text-white"
          style={{ fontFamily: SERIF }}
        >
          Ver pedidos
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-white/45">
          Historial, estado y detalle de tus compras
        </span>
      </span>
      <ChevronRight
        size={18}
        aria-hidden
        className="shrink-0 text-krov-rose/70 transition-transform duration-300 group-hover:translate-x-1"
      />
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Wholesale (B2B) account
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Kept on the profile although it isn't in the core identity/contact set: it
 * is the only place a customer can see their wholesale status or start an
 * application, and /wholesale/apply sends people back here when they're done.
 */
function WholesaleCard({
  role,
  wholesale,
}: {
  role: NonNullable<AccountData["profile"]>["role"] | null;
  wholesale: AccountData["wholesale"];
}) {
  // Admins have no use for the customer wholesale flow.
  if (role === "admin") return null;

  const status = wholesale?.application_status ?? null;
  const isActive = role === "wholesale" || status === "approved";

  return (
    <Card>
      <SectionHeader title="Cuenta mayorista" />

      {isActive ? (
        <>
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-krov-blood" />
            <p className="text-sm text-krov-rose">Activa</p>
          </div>
          <p className="mt-1.5 text-xs text-white/40">
            Verás los precios mayoristas en el carrito al alcanzar la cantidad
            mínima de cada producto.
          </p>
          {wholesale?.company_name && (
            <p className="mt-2 text-xs text-white/50">{wholesale.company_name}</p>
          )}
        </>
      ) : status === "pending" ? (
        <>
          <Badge label="En revisión" />
          <p className="mt-2 text-xs text-white/40">
            Estamos revisando tu solicitud. Te avisaremos aquí cuando haya una
            decisión.
          </p>
        </>
      ) : status === "rejected" ? (
        <>
          <Badge label="Rechazada" />
          <p className="mt-2 text-xs text-white/40">
            Tu solicitud fue rechazada. Puedes corregir los datos y volver a
            enviarla.
          </p>
          <WholesaleCta label="Volver a solicitar" />
        </>
      ) : (
        <>
          <p className="text-sm text-white/70">
            ¿Tienes un negocio? Compra al por mayor con precios especiales.
          </p>
          <WholesaleCta label="Solicitar cuenta mayorista" />
        </>
      )}
    </Card>
  );
}

function WholesaleCta({ label }: { label: string }) {
  return (
    <Link
      href="/wholesale/apply"
      className="mt-4 inline-block border border-krov-blood/40 px-5 py-2 text-[10px] uppercase tracking-[0.2em] text-krov-rose transition-colors duration-300 hover:bg-krov-blood hover:text-black"
    >
      {label}
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The page before auth + account data resolve: the same shell, grid and card
 * surfaces, each filled with bones set in the same type rhythm as the section
 * it stands in for (see `TextBone`). The shells stay solid; only their contents
 * pulse, and the pulse region sits INSIDE each glass card, never around it.
 *
 * WholesaleCard is left out: it renders only for some accounts, and as the
 * last card in its column its arrival grows the page downward without moving
 * anything above it.
 */
function ProfileSkeleton() {
  return (
    <section className={PAGE_CLS}>
      <LoadingAnnouncement label="Cargando tu perfil…" />
      <div className="mx-auto max-w-5xl">
        {/* The header copy is static, so it's real text, not bones. */}
        <header className="mb-8 flex flex-wrap items-end justify-between gap-5 border-b border-krov-smoke pb-7 sm:mb-10">
          <div>
            <p className="mb-3 text-[10px] uppercase tracking-[0.35em] text-krov-rose">
              Mi cuenta
            </p>
            <h1
              className="text-3xl font-light tracking-[0.04em] text-white sm:text-4xl"
              style={{ fontFamily: SERIF }}
            >
              Mi perfil
            </h1>
          </div>
          <SkeletonRegion>
            <Bone className="h-10 w-[9.5rem]" />
          </SkeletonRegion>
        </header>

        <div className={GRID_CLS}>
          <div className="space-y-5">
            <Card>
              <SkeletonRegion>
                <HeaderBone />
                <div className="flex items-start gap-4">
                  <Bone className="h-16 w-16 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-3">
                    <DetailBone valueWidth="10rem" />
                    <DetailBone valueWidth="6rem" />
                  </div>
                </div>
                <div className="mt-5 border-t border-krov-smoke/70 pt-4">
                  <div className="flex gap-1.5">
                    <Bone className="h-[21px] w-28" />
                    <Bone className="h-[21px] w-24" />
                  </div>
                  <TextBone className="mt-3 text-xs" width="10rem" />
                </div>
              </SkeletonRegion>
            </Card>

            <Card>
              <SkeletonRegion>
                <HeaderBone />
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <TextBone className="text-xs" width="5rem" />
                    <Bone className="mt-2 h-[35px] w-32 rounded-full" />
                  </div>
                  <TextBone className="text-sm" width="3.5rem" />
                </div>
                <Bone className="mt-5 h-2 w-full rounded-full" />
              </SkeletonRegion>
            </Card>

            <div className="rounded-2xl border border-krov-blood/25 bg-black/50 p-5 sm:p-6">
              <SkeletonRegion className="flex items-center gap-4">
                <Bone className="h-12 w-12 shrink-0 rounded-full" />
                <div className="flex-1">
                  <TextBone className="text-xl leading-snug" width="7rem" strong />
                  <TextBone className="mt-0.5 text-xs leading-relaxed" width="75%" />
                </div>
              </SkeletonRegion>
            </div>
          </div>

          <div className="space-y-5">
            <Card>
              <SkeletonRegion>
                <HeaderBone withDescription />
                <div className="grid gap-5 sm:grid-cols-2">
                  <DetailBone valueWidth="6.5rem" />
                  <DetailBone valueWidth="12rem" />
                </div>
              </SkeletonRegion>
            </Card>

            <Card>
              <SkeletonRegion>
                <HeaderBone withDescription />
                <div className="grid gap-5 sm:grid-cols-3">
                  <DetailBone valueWidth="5.5rem" />
                  <DetailBone valueWidth="6.5rem" />
                  <DetailBone valueWidth="6rem" />
                  <div className="sm:col-span-3">
                    <DetailBone valueWidth="85%" />
                  </div>
                  <div className="sm:col-span-3">
                    <DetailBone valueWidth="9rem" />
                  </div>
                </div>
              </SkeletonRegion>
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
}

/** `SectionHeader`: small-caps title (+ description) and a 36px Edit pill. */
function HeaderBone({ withDescription = false }: { withDescription?: boolean }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <TextBone className="text-[10px] tracking-[0.25em]" width="7rem" />
        {withDescription && (
          <TextBone className="mt-1.5 text-xs leading-relaxed" width="13rem" />
        )}
      </div>
      <Bone className="h-9 w-[5.5rem] shrink-0 rounded-full" />
    </div>
  );
}

/** `DetailRow`: a text-xs label over a text-sm value. */
function DetailBone({ valueWidth }: { valueWidth: string }) {
  return (
    <div>
      <TextBone className="text-xs" width="4.5rem" />
      <TextBone className="mt-1 text-sm leading-relaxed" width={valueWidth} strong />
    </div>
  );
}
