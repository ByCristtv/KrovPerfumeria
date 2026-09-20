"use client";

import { Search, UserPlus, Users } from "lucide-react";

/** The three sections of the social portal. */
export type FriendsSection = "friends" | "requests" | "search";

const OPTIONS: Array<{
  value: FriendsSection;
  label: string;
  icon: typeof Users;
}> = [
  { value: "friends", label: "Amigos", icon: Users },
  { value: "requests", label: "Solicitudes", icon: UserPlus },
  { value: "search", label: "Buscar", icon: Search },
];

/**
 * The portal's section switcher.
 *
 * Built in the same idiom as components/howtobuy/ViewToggle — real radio inputs
 * inside a fieldset, painted as a segmented control — rather than as an ARIA
 * tablist. That gets arrow-key navigation, a single tab stop and a grouped
 * announcement from the platform instead of from hand-written key handlers, and
 * it is the convention this codebase already has for exactly this control. No
 * new UI framework is introduced.
 *
 * On phones it wraps to a full-width row of three; the icons carry the meaning
 * when the labels get tight.
 */
export default function FriendsPortalTabs({
  value,
  onChange,
  /** Pending received requests. Rendered as a count beside "Solicitudes". */
  requestCount,
}: {
  value: FriendsSection;
  onChange: (section: FriendsSection) => void;
  requestCount: number;
}) {
  return (
    <fieldset className="mx-auto w-full sm:w-fit">
      <legend className="sr-only">Secciones de tu portal social</legend>

      <div className="flex items-center gap-1 rounded-full border border-krov-smoke bg-white/[0.03] p-1 backdrop-blur-sm">
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          const active = value === option.value;
          const showCount = option.value === "requests" && requestCount > 0;

          return (
            <label
              key={option.value}
              className={`relative flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-full px-3 py-2.5 text-[10px] uppercase tracking-[0.16em] transition-colors duration-300 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-krov-blood/60 sm:flex-none sm:px-5 sm:text-xs sm:tracking-[0.2em] ${
                active
                  ? "bg-krov-blood text-black"
                  : "text-white/55 hover:text-white"
              }`}
            >
              <input
                type="radio"
                name="friends-section"
                value={option.value}
                checked={active}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              <Icon size={15} strokeWidth={1.6} aria-hidden="true" />
              {option.label}

              {/* The count comes straight from the received-requests query —
                  there is no separate counter that could drift from the list.
                  Hidden from assistive tech here and restated in the label
                  below, so it is not read as a bare numeral. */}
              {showCount && (
                <>
                  <span
                    aria-hidden
                    className={`ml-0.5 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] tracking-normal ${
                      active ? "bg-black/25 text-black" : "bg-krov-blood text-black"
                    }`}
                  >
                    {requestCount}
                  </span>
                  <span className="sr-only">
                    {`, ${requestCount} pendiente${requestCount === 1 ? "" : "s"}`}
                  </span>
                </>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
