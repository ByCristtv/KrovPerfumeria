"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import RankBadge from "@/components/rank/RankBadge";
import SocialAvatar from "@/components/social/SocialAvatar";
import { formatXp } from "@/lib/format";
import { socialHandle, socialHeadline } from "@/lib/social/display";
import type { AdminCustomerRow } from "@/features/admin/getCustomersAdminPage";

interface Props {
  customers: AdminCustomerRow[];
  /** A search is active — changes the empty-state copy. */
  searching?: boolean;
}

/** Admin → Clientes list. Same table chrome and row-click model as OrdersTable. */
export default function CustomersTable({ customers, searching = false }: Props) {
  const router = useRouter();

  if (customers.length === 0) {
    return (
      <div className="rounded-none border border-krov-smoke bg-krov-graphite p-12 text-center text-krov-ash">
        {searching
          ? "No hay clientes que coincidan con la búsqueda."
          : "Todavía no hay clientes registrados."}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-none border border-krov-smoke bg-krov-graphite">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-krov-smoke text-left text-[11px] uppercase tracking-wider text-krov-ash">
            <th className="px-4 py-3">Cliente</th>
            <th className="px-4 py-3">Usuario</th>
            <th className="px-4 py-3 text-right">XP</th>
            <th className="px-4 py-3">Rango</th>
            <th className="hidden px-4 py-3 md:table-cell">Teléfono</th>
            <th className="hidden px-4 py-3 md:table-cell">Cuenta</th>
            <th className="hidden px-4 py-3 lg:table-cell">Registro</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-krov-smoke/70">
          {customers.map((c) => {
            const href = `/admin/clientes/${c.id}`;
            const handle = socialHandle(c.username);
            return (
              <tr
                key={c.id}
                // Whole row navigates; the name <Link> stays the keyboard target.
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("a, button, input, select")) return;
                  router.push(href);
                }}
                className="cursor-pointer text-krov-bone transition hover:bg-krov-blood/5 focus-within:bg-krov-blood/5"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <SocialAvatar
                      username={c.username}
                      fullName={c.full_name}
                      avatarUrl={c.avatar_url}
                      size={36}
                    />
                    <Link
                      href={href}
                      className="font-medium hover:text-krov-rose focus:outline-none focus-visible:ring-1 focus-visible:ring-krov-blood/70"
                    >
                      {socialHeadline(null, c.full_name)}
                    </Link>
                  </div>
                </td>
                <td className="px-4 py-3 text-krov-ash">{handle ?? "—"}</td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">
                  {formatXp(c.experience_points)}
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-2 whitespace-nowrap">
                    <RankBadge rank={c.rank} size="xs" decorative />
                    {c.rank}
                  </span>
                </td>
                <td className="hidden px-4 py-3 text-xs text-krov-ash md:table-cell">
                  {c.phone || "—"}
                </td>
                <td className="hidden px-4 py-3 md:table-cell">
                  <RoleBadge role={c.role} />
                </td>
                <td className="hidden whitespace-nowrap px-4 py-3 text-xs text-krov-ash lg:table-cell">
                  {formatJoined(c.created_at)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function RoleBadge({ role }: { role: string }) {
  const [label, cls] =
    role === "wholesale"
      ? ["Mayorista", "bg-purple-500/20 text-purple-200"]
      : role === "admin"
        ? ["Admin", "bg-krov-blood/20 text-krov-rose"]
        : ["Cliente", "bg-krov-smoke text-krov-ash"];
  return (
    <span className={`inline-block rounded-none px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}

function formatJoined(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
