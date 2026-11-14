"use client";

import { useId, useState, type FormEvent } from "react";
import { CalendarRange } from "lucide-react";
import {
  DEFAULT_SALES_RANGE,
  todayInZone,
  validateCustomRange,
  type SalesPreset,
  type SalesRange,
} from "@/lib/analytics/dateRange";

/**
 * Period selector for the Sales section: four presets plus a custom range.
 *
 * Controlled by the APPLIED range (`value`). The custom dates are a local
 * draft: typing or picking dates never fires a query — only "Aplicar" does
 * (via onChange), and only for a valid range. Presets apply immediately.
 *
 * Native <input type="date"> on purpose: the project has no date-picker
 * dependency, and the native control is accessible, localized and has a
 * proper picker on mobile.
 */

interface Props {
  value: SalesRange;
  onChange: (range: SalesRange) => void;
}

const PRESETS: { id: SalesPreset; label: string }[] = [
  { id: "7d", label: "7 días" },
  { id: "30d", label: "30 días" },
  { id: "90d", label: "90 días" },
  { id: "all", label: "Todo" },
];

const segmentBase =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap px-1.5 py-1.5 text-[11px] uppercase tracking-wide rounded-none transition sm:px-3 sm:text-xs sm:tracking-wider focus:outline-none focus-visible:ring-2 focus-visible:ring-krov-blood/40";
const segmentActive = "bg-krov-blood text-black font-semibold";
const segmentIdle = "text-krov-ash hover:text-krov-bone";

const dateInputCls =
  "w-full rounded-none border border-krov-blood/30 bg-krov-void px-2.5 py-2 text-sm text-krov-bone [color-scheme:dark] focus:border-krov-blood focus:outline-none focus:ring-2 focus:ring-krov-blood/40 aria-[invalid=true]:border-red-400";

export default function DateRangePicker({ value, onChange }: Props) {
  const isCustom = value.kind === "custom";
  const [editorOpen, setEditorOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(isCustom ? value.start : "");
  const [draftEnd, setDraftEnd] = useState(isCustom ? value.end : "");
  const [submitted, setSubmitted] = useState(false);
  const ids = useId();

  // Evaluated per render so "today" rolls over at Costa Rica midnight.
  const today = todayInZone();
  const validation = validateCustomRange(draftStart, draftEnd, today);
  // Missing-field messages wait for an apply attempt; contradictions (end
  // before start, future date) show as soon as both inputs say so.
  const showError =
    !validation.ok && (submitted || (draftStart !== "" && draftEnd !== ""));

  function selectPreset(preset: SalesPreset) {
    setEditorOpen(false);
    setSubmitted(false);
    onChange({ kind: "preset", preset });
  }

  function toggleEditor() {
    if (!editorOpen) {
      // Re-open on what is applied, so the inputs always explain the numbers.
      setDraftStart(isCustom ? value.start : "");
      setDraftEnd(isCustom ? value.end : today);
      setSubmitted(false);
    }
    setEditorOpen((open) => !open);
  }

  function apply(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!validation.ok) return;
    onChange(validation.range);
    setEditorOpen(false);
    setSubmitted(false);
  }

  function clear() {
    setDraftStart("");
    setDraftEnd("");
    setSubmitted(false);
    if (isCustom) {
      // Clearing an APPLIED custom range returns to the default period.
      onChange(DEFAULT_SALES_RANGE);
      setEditorOpen(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
      <div
        role="group"
        aria-label="Rango de fechas"
        className="grid w-full grid-cols-5 rounded-none border border-krov-blood/30 bg-krov-graphite p-0.5 sm:inline-flex sm:w-auto"
      >
        {PRESETS.map((p) => {
          const active = value.kind === "preset" && value.preset === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => selectPreset(p.id)}
              aria-pressed={active}
              className={`${segmentBase} ${active ? segmentActive : segmentIdle}`}
            >
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={toggleEditor}
          aria-pressed={isCustom}
          aria-expanded={editorOpen}
          aria-controls={`${ids}-custom`}
          aria-label="Rango personalizado"
          className={`${segmentBase} ${isCustom ? segmentActive : editorOpen ? "bg-krov-blood/15 text-krov-rose" : segmentIdle}`}
        >
          <CalendarRange className="hidden h-3.5 w-3.5 sm:block" aria-hidden />
          <span className="sm:hidden">Rango</span>
          <span className="hidden sm:inline">Personalizado</span>
        </button>
      </div>

      {editorOpen && (
        <form
          id={`${ids}-custom`}
          onSubmit={apply}
          noValidate
          aria-label="Rango personalizado"
          className="w-full rounded-none border border-krov-smoke bg-krov-graphite p-3 sm:w-[26rem]"
        >
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label
                htmlFor={`${ids}-start`}
                className="mb-1 block text-[11px] uppercase tracking-wider text-krov-ash"
              >
                Desde
              </label>
              <input
                id={`${ids}-start`}
                type="date"
                value={draftStart}
                max={draftEnd && draftEnd < today ? draftEnd : today}
                onChange={(e) => setDraftStart(e.target.value)}
                aria-invalid={showError && !validation.ok && validation.field === "start"}
                aria-describedby={showError ? `${ids}-error` : undefined}
                className={dateInputCls}
              />
            </div>
            <div>
              <label
                htmlFor={`${ids}-end`}
                className="mb-1 block text-[11px] uppercase tracking-wider text-krov-ash"
              >
                Hasta (incluido)
              </label>
              <input
                id={`${ids}-end`}
                type="date"
                value={draftEnd}
                min={draftStart || undefined}
                max={today}
                onChange={(e) => setDraftEnd(e.target.value)}
                aria-invalid={showError && !validation.ok && validation.field === "end"}
                aria-describedby={showError ? `${ids}-error` : undefined}
                className={dateInputCls}
              />
            </div>
          </div>

          {showError && !validation.ok && (
            <p id={`${ids}-error`} role="alert" className="mt-2 text-xs text-red-300">
              {validation.message}
            </p>
          )}

          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={clear}
              className="rounded-none px-3 py-2 text-xs uppercase tracking-wider text-krov-ash transition hover:text-krov-bone"
            >
              Limpiar
            </button>
            <button
              type="submit"
              disabled={submitted && !validation.ok}
              className="rounded-none bg-krov-blood px-4 py-2 text-xs font-semibold uppercase tracking-wider text-black transition hover:bg-krov-crimson disabled:cursor-not-allowed disabled:opacity-60"
            >
              Aplicar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
