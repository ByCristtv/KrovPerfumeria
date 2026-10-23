"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SEARCH_PARAM, PAGE_PARAM, buildQuery } from "@/lib/pagination";

/**
 * Debounced (300ms) search box for /admin/clientes. Writes `?q=` and resets
 * `page`, re-rendering the server-paginated list — same model as OrdersFilters.
 */
export default function CustomersSearch({ search }: { search: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const spRef = useRef(searchParams);
  useEffect(() => {
    spRef.current = searchParams;
  }, [searchParams]);

  const [localSearch, setLocalSearch] = useState(search);
  const firstRun = useRef(true);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const t = setTimeout(() => {
      const current = spRef.current.get(SEARCH_PARAM) ?? "";
      if (localSearch.trim() === current) return;
      const qs = buildQuery(new URLSearchParams(spRef.current.toString()), {
        [SEARCH_PARAM]: localSearch.trim() || undefined,
        [PAGE_PARAM]: undefined,
      });
      router.push(`${pathname}${qs}`, { scroll: false });
    }, 300);
    return () => clearTimeout(t);
  }, [localSearch, pathname, router]);

  return (
    <div className="rounded-none border border-krov-smoke bg-krov-graphite p-4 sm:p-5">
      <label
        htmlFor="customer-search"
        className="mb-1.5 block text-[11px] uppercase tracking-wider text-krov-ash"
      >
        Buscar
      </label>
      <input
        id="customer-search"
        type="search"
        placeholder="Nombre o usuario"
        value={localSearch}
        onChange={(e) => setLocalSearch(e.target.value)}
        className="w-full rounded-none border border-krov-blood/30 bg-krov-void px-3 py-2.5 text-sm text-krov-bone placeholder:text-krov-dust focus:border-krov-blood focus:outline-none focus:ring-2 focus:ring-krov-blood/40"
      />
    </div>
  );
}
