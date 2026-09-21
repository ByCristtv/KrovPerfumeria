import Link from "next/link";
import {
  Package,
  BarChart3,
  ClipboardList,
  FlaskConical,
  ArrowDownToLine,
  Tags,
  Store,
  Gift,
  type LucideIcon,
} from "lucide-react";
import AdminContainer from "@/components/admin/ui/AdminContainer";
import AdminPageHeader from "@/components/admin/ui/AdminPageHeader";
import { adminSerif } from "@/components/admin/ui/styles";

interface AdminSection {
  href: string;
  title: string;
  description: string;
  Icon: LucideIcon;
}

/** Single source of truth for the dashboard tiles — no per-card duplication. */
const SECTIONS: AdminSection[] = [
  {
    href: "/admin/products",
    title: "Administrar Productos",
    description:
      "Agrega, elimina y edita todos tus productos. Mantén tu catálogo al día con las últimas fragancias.",
    Icon: Package,
  },
  {
    href: "/admin/dashboard",
    title: "Mis Ventas",
    description:
      "Observa tus ingresos y ventas totales. Analiza el rendimiento de tu tienda y decide con datos.",
    Icon: BarChart3,
  },
  {
    href: "/admin/orders",
    title: "Administrar Órdenes",
    description:
      "Gestiona los pedidos pendientes: envíos, actualizaciones de estado y soporte al cliente.",
    Icon: ClipboardList,
  },
  {
    href: "/admin/brands",
    title: "Administrar Marcas",
    description:
      "Crea, edita y elimina las marcas de tu catálogo. Mantén la lista de casas de perfumería organizada.",
    Icon: Tags,
  },
  {
    href: "/admin/decant-stock",
    title: "Stock para Decants",
    description:
      "Administra el pool de mililitros de tus decants. Transforma botellas full size en stock compartido.",
    Icon: FlaskConical,
  },
  {
    href: "/admin/stock",
    title: "Movimientos de Stock",
    description:
      "Consulta el historial de inventario y registra entradas de stock en lote para varias variantes.",
    Icon: ArrowDownToLine,
  },
  {
    href: "/admin/wholesale",
    title: "Cuentas Mayoristas",
    description:
      "Revisa y aprueba las solicitudes de cuenta mayorista (B2B). Gestiona el acceso a precios al por mayor.",
    Icon: Store,
  },
  {
    href: "/admin/rewards",
    title: "Recompensas",
    description:
      "Configura las recompensas asociadas a cada rango de cliente. Define beneficios por nivel de fidelidad.",
    Icon: Gift,
  },
];

export default function AdminPage() {
  return (
    <AdminContainer>
      <AdminPageHeader
        showBack={false}
        eyebrow="Panel de Administración"
        title="KROV Perfumería"
        description="Gestiona tu tienda de perfumes desde un solo lugar."
      />

      {/* CSS stagger on the grid (see globals.css) instead of eight Framer
          nodes: this page is a Server Component and ships no animation JS.
          The stagger animates the Link wrapper; the hover lift lives on the
          inner <article>, so the two transforms never fight. */}
      <div className="krov-enter-stagger grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map(({ href, title, description, Icon }) => (
          <div key={href}>
            <Link href={href} className="group block h-full">
              <article className="flex h-full flex-col rounded-none border border-krov-smoke bg-krov-graphite p-7 shadow-[0_18px_64px_rgba(0,0,0,0.35)] transition-all duration-300 hover:-translate-y-1 hover:border-krov-blood/60 hover:shadow-[0_0_28px_rgba(255,11,85,0.12)]">
                <span className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-none border border-krov-smoke bg-krov-blood/[0.06] text-krov-rose transition-colors duration-300 group-hover:border-krov-blood/60 group-hover:bg-krov-blood/10">
                  <Icon size={26} strokeWidth={1.5} aria-hidden />
                </span>

                <h3
                  className="mb-3 text-xl text-krov-bone transition-colors group-hover:text-krov-rose"
                  style={{ fontFamily: adminSerif }}
                >
                  {title}
                </h3>

                <p className="text-sm leading-relaxed text-krov-ash">
                  {description}
                </p>
              </article>
            </Link>
          </div>
        ))}
      </div>
    </AdminContainer>
  );
}
