"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import AdminContainer from "@/components/admin/ui/AdminContainer";
import AdminPageHeader from "@/components/admin/ui/AdminPageHeader";

/** Error state for Admin → Clientes and its detail pages. */
export default function CustomersError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[admin/clientes]", error);
  }, [error]);

  return (
    <AdminContainer width="narrow">
      <AdminPageHeader eyebrow="Clientes" title="Algo salió mal" backHref="/admin/clientes" backLabel="Volver a clientes" />
      <div
        role="alert"
        className="rounded-none border border-red-500/40 bg-red-500/10 p-8 text-center text-sm text-red-200"
      >
        <p>No pudimos cargar la información del cliente.</p>
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="mt-5 inline-flex items-center rounded-none border border-krov-smoke px-4 py-2 text-xs uppercase tracking-[0.2em] text-krov-bone transition hover:border-krov-blood/60 hover:text-krov-rose"
        >
          Reintentar
        </button>
      </div>
    </AdminContainer>
  );
}
