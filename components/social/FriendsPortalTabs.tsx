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
 * The active segment is frosted glass — a faint white fill, a 1px border and an
 * inset top highlight — with a short glowing rose underline, instead of the
 * solid magenta block it used to be. A filled brand colour on the selected tab
 * is the heaviest thing on the screen; here it is reserved for the one element
 * that should pull the eye: the pending-requests badge.
 *
 * On phones it is a full-width row of three; the icons carry the meaning when
 * the labels get tight.
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

      <div className="flex items-center gap-1 rounded-full border border-krov-smoke bg-white/[0.03] p-1 backdrop-blur-md">
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          const active = value === option.value;
          const showCount = option.value === "requests" && requestCount > 0;

          return (
            <label
              key={option.value}
              className={`relative flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full border px-2.5 text-[10px] uppercase tracking-[0.14em] transition-[color,background-color,border-color,box-shadow] duration-300 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-krov-blood/60 sm:flex-none sm:gap-2 sm:px-5 sm:text-xs sm:tracking-[0.2em] ${
                active
                  ? "border-white/15 bg-white/[0.08] text-krov-bone shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_6px_20px_rgba(0,0,0,0.35)]"
                  : "border-transparent text-white/55 hover:text-white"
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
              <Icon
                size={15}
                strokeWidth={1.6}
                aria-hidden="true"
                className={active ? "text-krov-rose" : ""}
              />
              {option.label}

              {/* The count comes straight from the received-requests query —
                  there is no separate counter that could drift from the list.
                  Hidden from assistive tech here and restated below, so it is
                  not read as a bare numeral. The ping ring is the "social
                  urgency" cue; it is motion-gated, and the static badge alone
                  carries the information. */}
              {showCount && (
                <>
                  <span aria-hidden className="relative ml-0.5 inline-flex">
                    <span className="absolute inset-0 rounded-full bg-krov-blood/60 motion-safe:animate-ping" />
                    <span className="relative inline-flex min-w-5 items-center justify-center rounded-full bg-krov-blood px-1.5 py-0.5 text-[10px] font-semibold leading-none tracking-normal text-black">
                      {requestCount}
                    </span>
                  </span>
                  <span className="sr-only">
                    {`, ${requestCount} pendiente${requestCount === 1 ? "" : "s"}`}
                  </span>
                </>
              )}

              {/* Glowing underline. Always in the DOM and faded in/out, so the
                  indicator transitions instead of popping. */}
              <span
                aria-hidden
                className={`pointer-events-none absolute -bottom-px left-1/2 h-px w-8 -translate-x-1/2 rounded-full bg-krov-blood shadow-[0_0_10px_2px_rgba(255,11,85,0.65)] transition-opacity duration-300 ${
                  active ? "opacity-100" : "opacity-0"
                }`}
              />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
