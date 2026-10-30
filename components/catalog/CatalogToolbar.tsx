"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BadgeCheck, ChevronDown, Search, SlidersHorizontal, Tag, X } from "lucide-react";
import { useCategories } from "@/hooks/useCategories";
import { useWholesaleStatus } from "@/hooks/useWholesaleStatus";
import { buildCatalogQuery } from "@/lib/catalogParams";
import type { ProductFilters, ProductOrderBy } from "@/types/productFilter";
import type { ProductTypes } from "@/types/product";

const TYPE_OPTIONS: { value: ProductTypes; label: string }[] = [
  { value: "full_size", label: "Tamaño completo" },
  { value: "decant", label: "Disponibles en Decants" },
  { value: "set", label: "Sets" },
];

const ORDER_OPTIONS: { value: ProductOrderBy; label: string }[] = [
  { value: "price_asc", label: "Precio: menor a mayor" },
  { value: "price_desc", label: "Precio: mayor a menor" },
  { value: "name_asc", label: "Nombre: A–Z" },
  { value: "name_desc", label: "Nombre: Z–A" },
];

const selectClass =
  "w-full appearance-none rounded-lg border border-krov-edge bg-krov-graphite px-4 py-3 pr-10 text-sm text-white/80 outline-none transition-colors duration-300 focus:border-krov-blood focus:ring-1 focus:ring-krov-blood/40";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span
        className="mb-2 block text-[10px] uppercase tracking-[0.2em] text-white/45"
      >
        {label}
      </span>
      <div className="relative">
        {children}
        <ChevronDown
          size={15}
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-krov-rose/70"
        />
      </div>
    </label>
  );
}

export default function CatalogToolbar({ filters }: { filters: ProductFilters }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: categories = [] } = useCategories();
  const { isApproved: isWholesale } = useWholesaleStatus();

  // Keep latest searchParams without re-subscribing the debounce effect.
  const spRef = useRef(searchParams);
  useEffect(() => {
    spRef.current = searchParams;
  }, [searchParams]);

  const [search, setSearch] = useState(filters.query ?? "");
  // Filters collapse behind the "Filtros" button at every breakpoint, so the
  // catalog leads and the filters expand on demand. Default collapsed. Toggling
  // it never touches the filter values (those live in the URL), so selections
  // survive open/close.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const firstRun = useRef(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // The panel is a popover, so it must be dismissible the way one is: a press
  // anywhere outside the toolbar, or Escape (which hands focus back to the
  // button that opened it). Listeners exist only while it is open.
  useEffect(() => {
    if (!filtersOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setFiltersOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFiltersOpen(false);
        toggleRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [filtersOpen]);

  const navigate = (
    overrides: Parameters<typeof buildCatalogQuery>[1]
  ) => {
    // Any filter change returns to page 1.
    const qs = buildCatalogQuery(new URLSearchParams(spRef.current.toString()), {
      ...overrides,
      page: undefined,
    });
    router.push(`${pathname}${qs}`, { scroll: false });
  };

  // Debounced search → URL.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const handle = setTimeout(() => {
      const current = spRef.current.get("q") ?? "";
      if (search.trim() !== current) navigate({ query: search.trim() || undefined });
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const activeCount =
    (filters.category ? 1 : 0) +
    (filters.productType ? 1 : 0) +
    (filters.onOffer ? 1 : 0) +
    (filters.wholesaleOnly ? 1 : 0) +
    (filters.query ? 1 : 0);

  const controls = (
    <>
      <Field label="Categoría">
        <select
          className={selectClass}
          value={filters.category ?? ""}
          onChange={(e) => navigate({ category: e.target.value || undefined })}
        >
          <option value="">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Tipo de producto">
        <select
          className={selectClass}
          value={filters.productType ?? ""}
          onChange={(e) => navigate({ type: e.target.value || undefined })}
        >
          <option value="">Todos los tipos</option>
          {TYPE_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Ordenar por">
        <select
          className={selectClass}
          value={filters.orderBy ?? "price_asc"}
          onChange={(e) => navigate({ sort: e.target.value })}
        >
          {ORDER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
    </>
  );

  const offerToggle = (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-krov-edge bg-krov-graphite px-4 py-3">
      <span className="flex items-center gap-2 text-sm text-white/80">
        <Tag size={15} aria-hidden className="text-krov-rose" />
        Solo en oferta
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={!!filters.onOffer}
        onClick={() => navigate({ offer: filters.onOffer ? undefined : "1" })}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-300 ${filters.onOffer ? "bg-krov-blood" : "bg-white/15"
          }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform duration-300 ${filters.onOffer ? "translate-x-5" : "translate-x-0"
            }`}
        />
      </button>
    </label>
  );

  // Only approved wholesale buyers see this — filters to products whose card can
  // show a wholesale price (featured variant configured for wholesale).
  const wholesaleToggle = isWholesale ? (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-krov-smoke bg-krov-graphite px-4 py-3">
      <span className="flex items-center gap-2 text-sm text-white/80">
        <BadgeCheck size={15} aria-hidden className="text-krov-rose" />
        Solo productos mayoristas
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={!!filters.wholesaleOnly}
        aria-label="Mostrar solo productos con precio mayorista"
        onClick={() => navigate({ wholesale: filters.wholesaleOnly ? undefined : "1" })}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-300 ${filters.wholesaleOnly ? "bg-krov-blood" : "bg-white/15"
          }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform duration-300 ${filters.wholesaleOnly ? "translate-x-5" : "translate-x-0"
            }`}
        />
      </button>
    </label>
  ) : null;

  return (
    <div ref={rootRef} className="relative z-30 lg:sticky lg:top-21">
      {/* Solid fill, no `backdrop-blur`: this bar is sticky on desktop and sits
          over the page gradient on phones, and a backdrop filter on it was
          recomputed on every frame the page behind it moved or resized. */}
      <div className="rounded-2xl border border-white/8 bg-krov-ink p-4 sm:p-5">
        {/* Search + mobile toggle */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search
              size={17}
              aria-hidden
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/35"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar perfumes, marcas, notas…"
              aria-label="Buscar perfumes"
              className="w-full rounded-lg border border-krov-edge bg-krov-graphite py-3 pl-11 pr-10 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-300 focus:border-krov-blood focus:ring-1 focus:ring-krov-blood/40"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Limpiar búsqueda"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
              >
                <X size={15} />
              </button>
            )}
          </div>

          {/* Filter toggle — collapses the filters at every breakpoint. */}
          <button
            ref={toggleRef}
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
            aria-controls="catalog-filters"
            className="relative flex items-center gap-2 rounded-lg border border-krov-blood/40 px-4 py-3 text-xs uppercase tracking-[0.15em] text-krov-rose"
          >
            <SlidersHorizontal size={15} aria-hidden />
            Filtros
            {activeCount > 0 && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-krov-blood text-[9px] font-bold text-black">
                {activeCount}
              </span>
            )}
            <ChevronDown
              size={15}
              aria-hidden
              className={`transition-transform duration-300 ${filtersOpen ? "rotate-180" : ""}`}
            />
          </button>
        </div>

        {/* Clear filters */}
        {activeCount > 0 && (
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => {
                setSearch("");
                router.push(pathname, { scroll: false });
              }}
              className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-white/50 transition-colors hover:text-krov-rose"
            >
              <X size={13} aria-hidden /> Limpiar filtros ({activeCount})
            </button>
          </div>
        )}
      </div>

      {/* The controls: a popover hung off the bar's lower edge, NOT a block in
          the flow. The old panel animated `height` (a JS loop, a layout of the
          whole grid per frame, a moving document under every card on screen);
          this one is out of flow, so opening it moves nothing — the cards, the
          document height and the sticky bar are untouched — and animates only
          `opacity` and `transform`, which the compositor handles alone.
          Always mounted (so `aria-controls` always resolves) and toggled with
          `visibility`: while closed it takes no focus and no taps, and the
          flip to hidden lands at the END of the fade-out. */}
      <div
        id="catalog-filters"
        className={`absolute inset-x-0 top-full mt-2 rounded-2xl border border-white/8 bg-krov-ink p-4 shadow-[0_16px_32px_-12px_rgba(0,0,0,0.8)] transition-[opacity,transform,visibility] duration-200 ease-krov motion-reduce:transition-none sm:p-5 ${
          filtersOpen
            ? "visible translate-y-0 opacity-100"
            : "invisible -translate-y-1.5 opacity-0"
        }`}
      >
        <div className="grid gap-4 sm:grid-cols-3">{controls}</div>
        <div className={`grid gap-4 pt-4 ${wholesaleToggle ? "sm:grid-cols-2" : ""}`}>
          {offerToggle}
          {wholesaleToggle}
        </div>
      </div>
    </div>
  );
}
