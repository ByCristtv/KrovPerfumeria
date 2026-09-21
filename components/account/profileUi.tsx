"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Check, Lock, Pencil } from "lucide-react";

/**
 * The shared visual primitives of /profile and /profile/orders.
 *
 * The page edits IN PLACE: a section shows its values as plain text, "Editar"
 * turns that same section into a form, and Save or Cancel turns it back. (It
 * used to open a modal per card.) Two rules keep the page readable:
 *
 * · Editable and read-only never look alike. An editable value in view mode is
 *   plain text under a section that has an "Editar" button; a read-only value
 *   carries a lock and a screen-reader "(no editable)", and it never turns into
 *   an input, even while its section is being edited.
 *
 * · Input chrome only appears in edit mode. A page where every value sits in a
 *   bordered box reads as a form waiting to be submitted; a page of plain text
 *   with explicit edit actions reads as a profile.
 */

const INPUT_CLS =
  "w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-white/30 transition-colors duration-200 hover:border-white/25 focus:outline-none focus:ring-1 focus:ring-krov-blood/60 focus:border-krov-blood/60 disabled:cursor-not-allowed disabled:opacity-40 aria-[invalid=true]:border-red-400/70 aria-[invalid=true]:focus:ring-red-400/50";

// Native <select> reuses INPUT_CLS for its (dark) closed control, but the OS
// renders the open <option> list on its own surface — with the translucent
// `bg-white/5` above the options came out white-on-white and unreadable. Pin the
// options to a light background with near-black text (same treatment the
// checkout address selects already use) so the menu is legible; the closed
// control keeps the dark styling.
const SELECT_CLS = `${INPUT_CLS} [&>option]:bg-white [&>option]:text-gray-900`;

export { INPUT_CLS, SELECT_CLS };

// ─────────────────────────────────────────────────────────────────────────────
// Surfaces
// ─────────────────────────────────────────────────────────────────────────────

/** The dark glass panel every account section sits on. */
export function Card({
  children,
  highlighted = false,
}: {
  children: ReactNode;
  /** Rose edge while the section is in edit mode, so it's clear where you are. */
  highlighted?: boolean;
}) {
  return (
    <section
      className={`rounded-2xl border bg-black/50 backdrop-blur-sm p-5 sm:p-6 shadow-[0_12px_40px_rgba(0,0,0,0.35)] transition-colors duration-300 ${
        highlighted ? "border-krov-blood/45" : "border-krov-smoke"
      }`}
    >
      {children}
    </section>
  );
}

/**
 * A section's header: small-caps title, an optional one-line description, and
 * an action slot on the right (usually {@link EditButton}).
 */
export function SectionHeader({
  title,
  description,
  action,
  titleId,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  /** Pass when a form or list inside should be labelled by this title. */
  titleId?: string;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2
          id={titleId}
          className="text-[10px] tracking-[0.25em] uppercase text-white/50"
        >
          {title}
        </h2>
        {description && (
          <p className="mt-1.5 text-xs leading-relaxed text-white/35">
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * The "Editar" affordance. The visible label stays short; `accessibleName`
 * says WHAT is edited ("Editar teléfono"), because a screen-reader user tabbing
 * through five identical "Editar" buttons can't tell them apart.
 */
export function EditButton({
  onClick,
  accessibleName,
  label = "Editar",
  buttonRef,
}: {
  onClick: () => void;
  accessibleName: string;
  label?: string;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-label={accessibleName}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-white/15 px-3.5 text-[11px] uppercase tracking-[0.16em] text-white/70 transition-colors duration-200 hover:border-krov-blood/60 hover:text-krov-rose"
    >
      <Pencil size={12} aria-hidden />
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// View mode
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One label/value pair in view mode.
 *
 * `readOnly` is the distinction the page is built around: a lock icon, a muted
 * value and a screen-reader "(no editable)". An empty value renders
 * `placeholder` in italic, visibly different from real data, so "Sin teléfono"
 * can never be mistaken for a phone number.
 */
export function DetailRow({
  label,
  value,
  placeholder = "—",
  readOnly = false,
  optional = false,
  className = "",
}: {
  label: string;
  value: ReactNode | null | undefined;
  placeholder?: string;
  readOnly?: boolean;
  optional?: boolean;
  className?: string;
}) {
  const empty = value === null || value === undefined || value === "";

  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="flex items-center gap-1.5 text-xs text-white/45">
        {label}
        {optional && <OptionalTag />}
        {readOnly && (
          <>
            <Lock size={11} aria-hidden className="text-white/30" />
            <span className="sr-only">(no editable)</span>
          </>
        )}
      </dt>
      <dd
        className={`mt-1 break-words text-sm leading-relaxed ${
          empty
            ? "italic text-white/35"
            : readOnly
              ? "text-white/70"
              : "text-white"
        }`}
      >
        {empty ? placeholder : value}
      </dd>
    </div>
  );
}

/** The "Opcional" chip beside a label. */
export function OptionalTag() {
  return (
    <span className="rounded-full border border-white/10 px-1.5 py-px text-[9px] uppercase tracking-[0.14em] text-white/40">
      Opcional
    </span>
  );
}

/** Small outlined chip used for statuses. */
export function Badge({ label }: { label: string }) {
  return (
    <span className="inline-block border border-white/15 px-2 py-0.5 text-[10px] tracking-wide uppercase text-white/55">
      {label}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit mode
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A labelled form row with its hint or error underneath.
 *
 * Pass `htmlFor` with a matching `id` on the control. The hint and the error
 * share one slot, so the layout doesn't jump when an error appears. The
 * control should point `aria-describedby` at {@link fieldMessageId}.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  optional = false,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  children: ReactNode;
}) {
  const messageId = htmlFor ? fieldMessageId(htmlFor) : undefined;

  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 flex items-center gap-1.5 text-xs text-white/55"
      >
        {label}
        {optional && <OptionalTag />}
      </label>
      {children}
      {error ? (
        <p id={messageId} className="mt-1.5 text-xs text-red-400">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="mt-1.5 text-xs leading-relaxed text-white/35">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** The id `Field` gives its hint/error line, for `aria-describedby`. */
export function fieldMessageId(controlId: string) {
  return `${controlId}-message`;
}

/**
 * Cancel / Save footer for an inline form. Save is `type="submit"`, so Enter
 * in any single-line field saves, as it would in any web form.
 */
export function FormActions({
  onCancel,
  saving,
  saveDisabled = false,
}: {
  onCancel: () => void;
  saving: boolean;
  /** Blocks Save for reasons other than an in-flight request (invalid, unchanged). */
  saveDisabled?: boolean;
}) {
  return (
    <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        className="min-h-11 rounded-lg border border-white/20 px-6 text-sm font-medium text-white/80 transition hover:bg-white/5 disabled:opacity-50"
      >
        Cancelar
      </button>
      <button
        type="submit"
        disabled={saving || saveDisabled}
        className="min-h-11 rounded-lg bg-krov-blood px-6 text-sm font-medium text-black transition hover:bg-krov-blush disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saving ? "Guardando…" : "Guardar"}
      </button>
    </div>
  );
}

/**
 * The quiet confirmation after a save, shown beside the Edit button.
 *
 * It lives in the header rather than under the content so appearing costs no
 * layout shift. The live region is always mounted (a region that appears
 * together with its text is often not announced), so a screen reader hears
 * "Guardado" too. It clears itself after a few seconds.
 */
export function SavedNotice({ visible }: { visible: boolean }) {
  return (
    <span
      aria-live="polite"
      className="inline-flex items-center gap-1 text-[11px] text-krov-rose"
    >
      {visible && (
        <span className="krov-enter inline-flex items-center gap-1">
          <Check size={13} aria-hidden />
          Guardado
        </span>
      )}
    </span>
  );
}

/**
 * The header action slot for an editable section: notice + Edit button.
 *
 * Always mounted, with only the button hidden while editing, so the notice's
 * live region already exists when "Guardado" is written into it.
 */
export function EditActions({
  editing,
  savedVisible,
  onEdit,
  accessibleName,
  label,
  buttonRef,
}: {
  editing: boolean;
  savedVisible: boolean;
  onEdit: () => void;
  accessibleName: string;
  label?: string;
  buttonRef: React.Ref<HTMLButtonElement>;
}) {
  return (
    <div className="flex items-center gap-3">
      <SavedNotice visible={savedVisible} />
      {!editing && (
        <EditButton
          onClick={onEdit}
          accessibleName={accessibleName}
          label={label}
          buttonRef={buttonRef}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Behaviour
// ─────────────────────────────────────────────────────────────────────────────

const SAVED_NOTICE_MS = 2600;

/**
 * State and focus handling shared by every inline-editable section.
 *
 * · `start()` enters edit mode and focuses the first control.
 * · `cancel()` (also bound to Escape) leaves it and returns focus to the Edit
 *   button, so keyboard users land back where they started.
 * · `submit(fn)` runs a save: `fn` resolves to an error message to show, or
 *   to nothing on success, which closes the form and flashes the notice.
 *
 * Nothing local is mutated on a failed save. The section keeps showing what
 * the database holds, and only the unsaved edit stays in the form.
 */
export function useInlineEdit() {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedVisible, setSavedVisible] = useState(false);

  const editButtonRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const wasEditing = useRef(false);
  const noticeTimer = useRef<number | null>(null);

  // Focus follows the mode switch. Done in an effect because the target
  // (first control / the Edit button) only exists after the re-render.
  useEffect(() => {
    if (editing) {
      formRef.current
        ?.querySelector<HTMLElement>("input:not([disabled]), select, textarea")
        ?.focus();
    } else if (wasEditing.current) {
      editButtonRef.current?.focus();
    }
    wasEditing.current = editing;
  }, [editing]);

  useEffect(
    () => () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    },
    []
  );

  const start = useCallback(() => {
    setError("");
    setSavedVisible(false);
    setEditing(true);
  }, []);

  const cancel = useCallback(() => {
    setError("");
    setEditing(false);
  }, []);

  const submit = useCallback(
    async (save: () => Promise<string | void>) => {
      setSaving(true);
      setError("");
      try {
        const message = await save();
        if (message) {
          setError(message);
          return;
        }
        setEditing(false);
        setSavedVisible(true);
        if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(
          () => setSavedVisible(false),
          SAVED_NOTICE_MS
        );
      } catch {
        setError("No pudimos guardar los cambios. Intenta de nuevo.");
      } finally {
        setSaving(false);
      }
    },
    []
  );

  /** Spread onto the <form>: Escape cancels unless a save is in flight. */
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLFormElement>) => {
      if (e.key === "Escape" && !saving) {
        e.preventDefault();
        cancel();
      }
    },
    [saving, cancel]
  );

  return {
    editing,
    saving,
    error,
    setError,
    savedVisible,
    start,
    cancel,
    submit,
    onKeyDown,
    editButtonRef,
    formRef,
  };
}

/** A save failure, announced. Kept separate from field-level messages. */
export function FormError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs text-red-400">
      {message}
    </p>
  );
}
