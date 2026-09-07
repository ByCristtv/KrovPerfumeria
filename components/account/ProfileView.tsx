"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";
import Modal from "@/components/ui/Modal";
import RankProgress from "@/components/account/RankProgress";
import RankingSettingsCard from "@/components/account/RankingSettingsCard";
import DistrictSelect from "@/components/ui/DistrictSelect";
import {
  Badge,
  Card,
  CardHeading,
  Field,
  INPUT_CLS,
  ModalActions,
  SELECT_CLS,
} from "@/components/account/profileUi";
import { formatPrice } from "@/lib/format";
import {
  findCanton,
  findDistrictByName,
  getCantones,
  getProvinces,
} from "@/lib/cr-geo";
import {
  getAccountData,
  getAccountOrders,
  updatePhone,
  upsertAddress,
  type AccountData,
  type AccountOrderRow,
} from "@/features/account/getAccountData";

const SERIF = "var(--font-krov-display), 'Cormorant Garamond', Georgia, serif";
const ORDERS_PREVIEW_COUNT = 4;

/**
 * /profile — the customer's account home.
 *
 * Split out of the old 788-line AccountView, which rendered BOTH the sign-in
 * form and the account dashboard from one component. That conflation is why the
 * account lived at /login. Now each route owns one job: /login authenticates,
 * /profile shows the account, and each redirects to the other when the auth
 * state doesn't match.
 *
 * Data access is unchanged — the same `features/account/getAccountData` helpers
 * back it, so nothing about the Supabase contract moved.
 */
export default function ProfileView() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuthUser();

  const queryClient = useQueryClient();
  const [showAllOrders, setShowAllOrders] = useState(false);

  // Data lives in React Query rather than useState+useEffect. Beyond matching
  // how the rest of the app fetches (useAuthUser, useIsAdmin), it means the
  // profile/orders are cached, deduped, and refetchable — and it keeps the
  // fetch out of an effect, which the React Compiler flags for good reason:
  // a setState cascade in an effect body causes extra render passes.
  const accountQuery = useQuery<AccountData>({
    queryKey: ["account", "data", user?.id],
    queryFn: () => getAccountData(user!.id),
    enabled: !!user,
    staleTime: 60_000,
  });

  const ordersQuery = useQuery<AccountOrderRow[]>({
    queryKey: ["account", "orders", user?.id],
    queryFn: () => getAccountOrders(user!.id),
    enabled: !!user,
    staleTime: 60_000,
  });

  const accountData = accountQuery.data ?? null;
  const orders = ordersQuery.data ?? [];
  const dataLoading = accountQuery.isPending || ordersQuery.isPending;
  const ordersError = ordersQuery.isError ? "No pudimos cargar tus pedidos." : "";

  /** Re-read after an edit. Scoped to this user's account subtree. */
  const refreshAccount = () => {
    void queryClient.invalidateQueries({ queryKey: ["account"] });
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

  if (authLoading || !user) {
    return <ProfileSkeleton />;
  }

  const fullName = user.user_metadata?.full_name ?? "Sin nombre";

  return (
    <section className="min-h-screen pt-28 pb-16 px-4 bg-[radial-gradient(circle_at_12%_8%,#191420_0%,#111_45%,#000_100%)]">
      <div className="max-w-6xl mx-auto">
        {/* ──────── Header ──────── */}
        <header className="mb-10 flex flex-wrap items-end justify-between gap-6 border-b border-krov-smoke pb-8">
          <div>
            <p
              className="text-krov-rose text-[10px] tracking-[0.35em] uppercase mb-3"
            >
              Mi cuenta
            </p>
            <h1
              className="text-white text-3xl sm:text-4xl font-light tracking-[0.06em]"
              style={{ fontFamily: SERIF }}
            >
              {fullName}
            </h1>
            <p className="text-white/45 text-sm mt-2">{user.email}</p>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="text-[10px] tracking-[0.2em] uppercase text-white/50 border border-white/15 px-5 py-2.5 transition-colors duration-300 hover:border-krov-blood/60 hover:text-krov-rose"
          >
            Cerrar sesión
          </button>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6 items-start">
          {/* ──────── Left: identity + details ──────── */}
          <aside className="space-y-5">
            <Card>
              <div className="flex flex-col items-center text-center">
                <div className="relative">
                  {/* Red ring — the one decorative flourish, kept subtle. */}
                  <div className="absolute -inset-1 rounded-full bg-gradient-to-br from-krov-blood/60 via-transparent to-krov-blood/30" />
                  <Image
                    width={96}
                    height={96}
                    src={
                      user.user_metadata?.avatar_url ??
                      "/User/UserAnonimous.avif"
                    }
                    alt=""
                    className="relative w-24 h-24 rounded-full object-cover"
                  />
                </div>
                <p
                  className="text-white text-lg mt-4 tracking-wide"
                  style={{ fontFamily: SERIF }}
                >
                  {fullName}
                </p>
              </div>

              <div className="mt-6 pt-6 border-t border-krov-smoke/85">
                <RankProgress
                  experiencePoints={accountData?.profile?.experience_points ?? 0}
                />
              </div>
            </Card>

            {/* Placed directly under the rank card: the leaderboard is what
                that XP is for, so the opt-in belongs next to it rather than
                below the shipping details. */}
            <RankingSettingsCard
              username={accountData?.profile?.username ?? null}
              showInRanking={accountData?.profile?.show_in_ranking ?? false}
              onSaved={refreshAccount}
            />

            <PhoneCard
              userId={user.id}
              phone={accountData?.profile?.phone ?? null}
              onSaved={refreshAccount}
            />

            <AddressCard
              userId={user.id}
              address={accountData?.address ?? null}
              onSaved={refreshAccount}
            />

            <WholesaleCard
              role={accountData?.profile?.role ?? null}
              wholesale={accountData?.wholesale ?? null}
            />
          </aside>

          {/* ──────── Right: order history ──────── */}
          <div>
            <Card>
              <CardHeading
                title="Historial de pedidos"
                caption={
                  orders.length > 0
                    ? `${orders.length} pedido${orders.length === 1 ? "" : "s"}`
                    : undefined
                }
              />

              {dataLoading ? (
                <OrdersSkeleton />
              ) : ordersError ? (
                <p className="text-sm text-red-300/90 py-6">{ordersError}</p>
              ) : orders.length === 0 ? (
                <EmptyOrders />
              ) : (
                <>
                  <ul className="divide-y divide-krov-smoke/70">
                    {(showAllOrders
                      ? orders
                      : orders.slice(0, ORDERS_PREVIEW_COUNT)
                    ).map((order) => (
                      <OrderRow key={order.id} order={order} />
                    ))}
                  </ul>

                  {orders.length > ORDERS_PREVIEW_COUNT && (
                    <button
                      type="button"
                      onClick={() => setShowAllOrders((prev) => !prev)}
                      className="mt-5 w-full border border-krov-blood/30 py-3 text-[10px] tracking-[0.2em] uppercase text-krov-rose transition-colors duration-300 hover:bg-krov-blood hover:text-black"
                    >
                      {showAllOrders
                        ? "Ver menos"
                        : `Ver los ${orders.length} pedidos`}
                    </button>
                  )}
                </>
              )}
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Editable detail cards
// ─────────────────────────────────────────────────────────────────────────────

function PhoneCard({
  userId,
  phone,
  onSaved,
}: {
  userId: string;
  phone: string | null;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const openModal = () => {
    setValue(phone ?? "");
    setError("");
    setOpen(true);
  };

  const save = async () => {
    const trimmed = value.trim();
    if (trimmed.length < 8) return setError("Teléfono inválido (mínimo 8 dígitos)");
    if (trimmed.length > 20) return setError("Teléfono demasiado largo");

    setSaving(true);
    setError("");
    try {
      await updatePhone(userId, trimmed);
      onSaved();
      setOpen(false);
    } catch {
      setError("Error al guardar el teléfono");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeading
        title="Teléfono"
        action={{ label: phone ? "Editar" : "Agregar", onClick: openModal }}
      />
      <p className="text-white text-sm">{phone ?? "Sin teléfono"}</p>
      <p className="text-white/35 text-xs mt-1.5">
        Lo usamos para coordinar tus entregas.
      </p>

      <Modal
        open={open}
        onClose={() => !saving && setOpen(false)}
        title="Editar teléfono"
        subtitle="Lo usamos para coordinar tus entregas"
        closeOnBackdrop={!saving}
      >
        <div className="space-y-4">
          <Field label="Número de teléfono">
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="8888-8888"
              className={INPUT_CLS}
            />
          </Field>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <ModalActions
            onCancel={() => setOpen(false)}
            onSave={save}
            saving={saving}
          />
        </div>
      </Modal>
    </Card>
  );
}

function AddressCard({
  userId,
  address,
  onSaved,
}: {
  userId: string;
  address: AccountData["address"];
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [cantonCode, setCantonCode] = useState("");
  const [provinceOverride, setProvinceOverride] = useState("");
  const [district, setDistrict] = useState("");
  const [exactAddress, setExactAddress] = useState("");
  const [reference, setReference] = useState("");

  // Same derived-province rule as the checkout form: the province follows from
  // the cantón in the SAME render, so the <option> list can never lag behind the
  // value being restored.
  const selectedProvince =
    findCanton(cantonCode)?.provinceCode ?? provinceOverride;
  const cantonesForProvince = getCantones(selectedProvince);

  const openModal = () => {
    setCantonCode(address?.canton ?? "");
    setProvinceOverride("");
    setDistrict(address?.district ?? "");
    setExactAddress(address?.exact_address ?? "");
    setReference(address?.references ?? "");
    setError("");
    setOpen(true);
  };

  const save = async () => {
    const canton = findCanton(cantonCode);
    if (!canton) return setError("Selecciona un cantón válido");
    if (!district.trim()) return setError("El distrito es requerido");
    // Re-checked here, not just in the dropdown: a legacy free-text district
    // survives prefill as an option so the customer can see what was saved, and
    // this is what stops it from being saved again unchanged.
    const districtRecord = findDistrictByName(canton.code, district);
    if (!districtRecord)
      return setError(`Selecciona un distrito válido de ${canton.name}`);
    if (exactAddress.trim().length < 10)
      return setError("Escribe las señas exactas (al menos 10 caracteres)");

    setSaving(true);
    setError("");
    try {
      await upsertAddress(
        userId,
        {
          province: canton.provinceCode,
          canton: canton.code,
          // The dataset's canonical spelling, not the raw option text, so
          // accents and casing are consistent for every address we store.
          district: districtRecord.name,
          exact_address: exactAddress.trim(),
          references: reference.trim() || null,
        },
        address?.id
      );
      onSaved();
      setOpen(false);
    } catch {
      setError("Error al guardar la dirección");
    } finally {
      setSaving(false);
    }
  };

  const summary = address
    ? [
        findCanton(address.canton)?.name,
        address.district,
        address.exact_address,
      ]
        .filter(Boolean)
        .join(", ")
    : null;

  return (
    <Card>
      <CardHeading
        title="Dirección de entrega"
        action={{ label: address ? "Editar" : "Agregar", onClick: openModal }}
      />
      <p className="text-white text-sm leading-relaxed">
        {summary ?? "Sin dirección guardada"}
      </p>
      <p className="text-white/35 text-xs mt-1.5">
        Se autocompleta en tu próximo checkout.
      </p>

      <Modal
        open={open}
        onClose={() => !saving && setOpen(false)}
        title="Editar dirección"
        subtitle="La usamos para calcular el envío y entregarte"
        closeOnBackdrop={!saving}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Provincia">
              <select
                value={selectedProvince}
                onChange={(e) => {
                  setProvinceOverride(e.target.value);
                  // Both levels below the province are now stale.
                  setCantonCode("");
                  setDistrict("");
                }}
                className={SELECT_CLS}
              >
                <option value="">— Selecciona —</option>
                {getProvinces().map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Cantón">
              <select
                value={cantonCode}
                onChange={(e) => {
                  setCantonCode(e.target.value);
                  // The old district belonged to the old cantón.
                  setDistrict("");
                }}
                disabled={!selectedProvince}
                className={SELECT_CLS}
              >
                <option value="">
                  {selectedProvince ? "— Selecciona —" : "Elige provincia"}
                </option>
                {cantonesForProvince.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* Same cascading dropdown the checkout form uses — one component,
              so the two can't disagree about which districts a cantón has. */}
          <Field label="Distrito">
            <DistrictSelect
              cantonCode={cantonCode}
              value={district}
              onChange={setDistrict}
              className={SELECT_CLS}
            />
          </Field>

          <Field label="Señas exactas">
            <textarea
              rows={3}
              value={exactAddress}
              onChange={(e) => setExactAddress(e.target.value)}
              placeholder="200m sur de la iglesia, casa azul portón negro"
              className={`${INPUT_CLS} resize-none`}
            />
          </Field>

          <Field label="Referencia (opcional)">
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Ej. Frente al parque"
              className={INPUT_CLS}
            />
          </Field>

          {error && <p className="text-xs text-red-400">{error}</p>}
          <ModalActions
            onCancel={() => setOpen(false)}
            onSave={save}
            saving={saving}
          />
        </div>
      </Modal>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Wholesale (B2B) account
// ─────────────────────────────────────────────────────────────────────────────

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
      <CardHeading title="Cuenta mayorista" />

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
// Orders
// ─────────────────────────────────────────────────────────────────────────────

function OrderRow({ order }: { order: AccountOrderRow }) {
  return (
    <li>
      <Link
        href={`/orders/${order.id}`}
        className="group flex items-center justify-between gap-4 py-4 transition-colors duration-200 hover:bg-white/[0.02] -mx-2 px-2"
      >
        <div className="min-w-0">
          <p className="text-sm text-white">
            Pedido{" "}
            <span className="font-mono text-krov-rose">
              #{order.order_number}
            </span>
          </p>
          <p className="text-xs text-white/40 mt-1">
            {formatOrderDate(order.created_at)}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <Badge label={orderStatusLabel(order.order_status)} />
            <Badge label={paymentStatusLabel(order.payment_status)} />
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm text-white tabular-nums">
            {formatPrice(order.total)}
          </p>
          <span className="text-[10px] tracking-[0.15em] uppercase text-white/30 group-hover:text-krov-rose transition-colors duration-200">
            Ver detalle
          </span>
        </div>
      </Link>
    </li>
  );
}

function EmptyOrders() {
  return (
    <div className="py-12 text-center">
      <p className="text-white/50 text-sm">Todavía no tienes pedidos.</p>
      <Link
        href="/products"
        className="inline-block mt-5 border border-krov-blood/50 px-6 py-2.5 text-[10px] tracking-[0.2em] uppercase text-krov-rose transition-colors duration-300 hover:bg-krov-blood hover:text-black"
      >
        Explorar la colección
      </Link>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeletons
// ─────────────────────────────────────────────────────────────────────────────
// Card / CardHeading / Field / ModalActions / Badge and the input classes now
// live in `./profileUi`, shared with RankingSettingsCard.

function ProfileSkeleton() {
  return (
    <section className="min-h-screen pt-28 pb-16 px-4 bg-[radial-gradient(circle_at_12%_8%,#191420_0%,#111_45%,#000_100%)]">
      <div className="max-w-6xl mx-auto animate-pulse">
        <div className="h-10 w-64 bg-white/5 rounded mb-4" />
        <div className="h-4 w-40 bg-white/5 rounded mb-10" />
        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
          <div className="h-80 bg-white/5 rounded-2xl" />
          <div className="h-80 bg-white/5 rounded-2xl" />
        </div>
      </div>
    </section>
  );
}

function OrdersSkeleton() {
  return (
    <div className="space-y-3 py-2 animate-pulse">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-16 bg-white/5 rounded-lg" />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Labels
// ─────────────────────────────────────────────────────────────────────────────

function orderStatusLabel(status: AccountOrderRow["order_status"]): string {
  return (
    {
      pending: "Pendiente",
      received: "Confirmado",
      shipped: "Enviado",
      denied: "Cancelado",
    }[status] ?? status
  );
}

function paymentStatusLabel(status: AccountOrderRow["payment_status"]): string {
  return (
    {
      pending: "Pago pendiente",
      paid: "Pagado",
      failed: "Pago fallido",
      refunded: "Reembolsado",
    }[status] ?? status
  );
}

function formatOrderDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
