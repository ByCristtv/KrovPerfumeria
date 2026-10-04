"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { MoreHorizontal } from "lucide-react";

export interface SocialMenuItem {
  label: string;
  icon?: ReactNode;
  /** `danger` is for the destructive entry: tinted, and never first. */
  tone?: "default" | "danger";
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * The "•••" overflow menu: where secondary and destructive actions live so they
 * are one deliberate step away instead of sitting next to the primary action.
 *
 * Follows the WAI-ARIA menu-button pattern, because a popover that only works
 * with a mouse is a regression from the plain button it replaces:
 *   · trigger: `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`
 *   · Enter / Space / ArrowDown opens and focuses the first item
 *   · ArrowUp / ArrowDown / Home / End move; Escape closes and returns focus to
 *     the trigger; Tab closes (focus is not trapped — it is not a modal)
 *   · pointer-down outside closes it
 *
 * Items are real `<button role="menuitem">`s with `tabIndex={-1}`: reachable by
 * arrow keys, not a tab stop each. Choosing one closes the menu BEFORE running
 * its handler, so a handler that opens a dialog hands focus to that dialog
 * rather than racing the menu for it.
 */
export default function SocialMenu({
  label,
  items,
}: {
  /** Accessible name of the trigger — name the person: "Más opciones de aurora". */
  label: string;
  items: SocialMenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const focusItem = (index: number) => {
    const enabled = itemRefs.current.filter(
      (el): el is HTMLButtonElement => !!el && !el.disabled
    );
    if (enabled.length === 0) return;
    enabled[(index + enabled.length) % enabled.length]?.focus();
  };

  // Dismiss on a press outside. `pointerdown`, not `click`: the menu must be
  // gone before whatever was pressed gets its own click.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Move focus into the menu once it exists in the DOM.
  useEffect(() => {
    if (open) {
      const first = itemRefs.current.find((el) => el && !el.disabled);
      first?.focus();
    }
  }, [open]);

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusItem(current + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusItem(current - 1);
        break;
      case "Home":
        event.preventDefault();
        focusItem(0);
        break;
      case "End":
        event.preventDefault();
        focusItem(-1);
        break;
      case "Escape":
        event.preventDefault();
        close(true);
        break;
      case "Tab":
        close(false);
        break;
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        className="flex size-11 items-center justify-center rounded-full text-krov-dust transition-colors duration-200 hover:bg-white/[0.06] hover:text-krov-bone focus-visible:outline focus-visible:outline-2 focus-visible:outline-krov-blood/70 aria-expanded:bg-white/[0.08] aria-expanded:text-krov-bone sm:size-10"
      >
        <MoreHorizontal size={20} strokeWidth={1.8} aria-hidden />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-xl border border-krov-smoke bg-krov-graphite/95 p-1 shadow-[0_18px_40px_rgba(0,0,0,0.55)] backdrop-blur-md"
        >
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={item.disabled}
              onClick={() => {
                close(false);
                item.onSelect();
              }}
              className={`flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm transition-colors duration-150 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-10 ${
                item.tone === "danger"
                  ? "text-krov-rose hover:bg-krov-blood/15 focus-visible:bg-krov-blood/15"
                  : "text-krov-bone hover:bg-white/[0.06] focus-visible:bg-white/[0.06]"
              }`}
            >
              {item.icon && (
                <span aria-hidden className="shrink-0 opacity-80">
                  {item.icon}
                </span>
              )}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
