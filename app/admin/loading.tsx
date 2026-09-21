import AdminContainer from "@/components/admin/ui/AdminContainer";
import {
  Bone,
  LoadingAnnouncement,
  SkeletonRegion,
  TextBone,
} from "@/components/ui/Skeleton";

/**
 * The admin panel's loading state.
 *
 * Scope matters here: a `loading.tsx` at the `/admin` segment is the Suspense
 * fallback for EVERY nested admin route without its own (orders, products,
 * stock, wholesale…), and today none of them have one. The dashboard itself is
 * static and never actually suspends. So this deliberately does NOT draw the
 * dashboard's tile grid. It draws what every admin page shares:
 *
 * · the exact `AdminContainer` shell (widths, navbar offset);
 * · `AdminPageHeader`: back link, rose eyebrow pill, serif title, description,
 *   red rule. These are the same on every admin page, so the header resolves in
 *   place wherever the operator is going;
 * · a neutral content panel: a filter bar plus table rows, the shape most admin
 *   screens are.
 *
 * If a nested route later needs a closer match (e.g. /admin/orders), give it
 * its own loading.tsx; the nearest one wins.
 */
export default function AdminLoading() {
  return (
    <AdminContainer>
      <LoadingAnnouncement label="Cargando el panel…" />

      <SkeletonRegion>
        {/* AdminPageHeader */}
        <div className="mb-8">
          <div className="mb-5">
            <TextBone className="text-[11px] tracking-[0.25em]" width="8rem" />
          </div>
          {/* Eyebrow pill: 15px line + py-1.5 + border. */}
          <Bone className="mb-3 h-[29px] w-40 rounded-full" />
          <TextBone className="text-3xl leading-tight sm:text-4xl" width="16rem" strong />
          <TextBone
            className="mt-2 text-sm leading-relaxed sm:text-[0.95rem]"
            width="min(28rem, 90%)"
          />
          <span className="krov-rule mt-6 block h-px w-full opacity-60" />
        </div>

        {/* Generic list screen: filters, then rows. */}
        <div className="border border-krov-smoke bg-krov-graphite/60">
          <div className="flex flex-wrap gap-3 border-b border-krov-smoke p-4">
            <Bone className="h-10 min-w-0 flex-1 basis-56" />
            <Bone className="h-10 w-36" />
            <Bone className="h-10 w-28" />
          </div>
          <div className="divide-y divide-krov-smoke/70">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4">
                <Bone className="h-10 w-10 shrink-0" />
                <div className="min-w-0 flex-1">
                  <TextBone className="text-sm" width="min(14rem, 70%)" strong />
                  <TextBone className="mt-1 text-xs" width="min(9rem, 45%)" />
                </div>
                <Bone className="hidden h-6 w-20 sm:block" />
                <TextBone className="shrink-0 text-sm" width="4.5rem" />
              </div>
            ))}
          </div>
        </div>
      </SkeletonRegion>
    </AdminContainer>
  );
}
