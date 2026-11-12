"use client";

import { useMemo, useState, useTransition } from "react";
import Swal from "sweetalert2";
import { saveLevelThresholdsAction } from "@/app/admin/rewards/actions";
import RankBadge from "@/components/rank/RankBadge";
import { adminSerif, ADMIN_ACCENT } from "@/components/admin/ui/styles";
import { formatXp } from "@/lib/format";
import type { RankLadder } from "@/lib/rank";
import {
  MAX_REQUIRED_XP,
  diffThresholds,
  draftsFromLadder,
  validateThresholds,
} from "@/lib/loyalty/thresholds";

interface Props {
  ladder: RankLadder;
  /** Optimistic-lock token: max(levels.updated_at) when the page loaded. */
  levelsUpdatedAt: string | null;
  /** Migrations not applied yet — show, don't edit. */
  readOnly?: boolean;
}

type Feedback = { kind: "success" | "error"; message: string } | null;

const DATE_FMT = new Intl.DateTimeFormat("es-CR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Costa_Rica",
});

/**
 * The XP ladder, edited as ONE sequence.
 *
 * Ranks are listed in progression order, each next to the rank it must exceed,
 * and the whole proposal is validated on every keystroke with the same rules
 * the database enforces (lib/loyalty/thresholds.ts ↔
 * admin_update_level_thresholds). A conflict is reported on the rank that
 * breaks the order and names the rank it collides with, so the admin knows
 * which of the two to move. Saving sends every rank at once; the database
 * applies all of them or none.
 */
export default function TierThresholdsEditor({ ladder, levelsUpdatedAt, readOnly = false }: Props) {
  const initial = useMemo(() => draftsFromLadder(ladder), [ladder]);
  const [values, setValues] = useState<Record<number, string>>(() =>
    Object.fromEntries(initial.map((d) => [d.level, String(d.value)]))
  );
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isPending, startTransition] = useTransition();

  const drafts = ladder.map((tier) => ({ level: tier.level, rank: tier.rank, value: values[tier.level] ?? "" }));
  const validation = validateThresholds(drafts);
  const changes = validation.payload ? diffThresholds(ladder, validation.payload) : [];
  const dirty = ladder.some((tier) => (values[tier.level] ?? "").trim() !== String(tier.minXP));
  const canSave = !readOnly && dirty && validation.ok && changes.length > 0 && !isPending;

  function reset() {
    setValues(Object.fromEntries(initial.map((d) => [d.level, String(d.value)])));
    setFeedback(null);
  }

  async function onSave() {
    if (!validation.ok || !validation.payload || changes.length === 0) return;

    const lowered = changes.some((c) => c.to < c.from);
    const raised = changes.some((c) => c.to > c.from);
    const list = changes
      .map((c) => `<li><b>${c.rank}</b>: ${formatXp(c.from)} → ${formatXp(c.to)} XP</li>`)
      .join("");
    const notes = [
      lowered
        ? "<p>Al <b>bajar</b> un umbral, los clientes que ya tienen esa XP suben de rango ahora y reciben los cupones activos de ese rango.</p>"
        : "",
      raised
        ? "<p>Al <b>subir</b> un umbral, quien ya no lo alcance baja de rango, pero conserva los cupones que ya recibió.</p>"
        : "",
    ].join("");

    const confirm = await Swal.fire({
      title: "¿Guardar los nuevos umbrales?",
      html: `<ul style="text-align:left;margin:0 0 12px 0;padding-left:18px">${list}</ul><div style="text-align:left;font-size:14px">${notes}<p>Se aplican todos los cambios o ninguno.</p></div>`,
      icon: "question",
      showCancelButton: true,
      confirmButtonColor: ADMIN_ACCENT,
      cancelButtonColor: "#2a2130",
      confirmButtonText: "Guardar",
      cancelButtonText: "Cancelar",
    });
    if (!confirm.isConfirmed) return;

    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await saveLevelThresholdsAction({
          thresholds: ladder.map((tier) => ({ level: tier.level, value: values[tier.level] ?? "" })),
          expectedUpdatedAt: levelsUpdatedAt,
        });
        if (result.ok) {
          // The page re-renders with the stored ladder (revalidatePath) and this
          // editor remounts from it (key = updated_at).
          void Swal.fire({
            toast: true,
            position: "top-end",
            icon: "success",
            title: result.message,
            showConfirmButton: false,
            timer: 3500,
            timerProgressBar: true,
          });
          setFeedback({ kind: "success", message: result.message });
        } else {
          setFeedback({ kind: "error", message: result.message });
        }
      } catch {
        setFeedback({ kind: "error", message: "Error de conexión. No se guardó ningún cambio." });
      }
    });
  }

  const inputCls =
    "w-full rounded-none border bg-krov-void px-3 py-2 text-right text-sm tabular-nums text-krov-bone placeholder:text-krov-dust focus:outline-none focus:ring-2 focus:ring-krov-blood/40 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <section aria-labelledby="tiers-heading" className="rounded-none border border-krov-smoke bg-krov-graphite">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-krov-smoke px-5 py-4">
        <div>
          <h2 id="tiers-heading" className="text-xl text-krov-bone" style={{ fontFamily: adminSerif }}>
            Experiencia por rango
          </h2>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-krov-ash">
            XP mínima para alcanzar cada rango. Cada rango debe pedir más XP que el anterior; edita en
            orden, de abajo hacia arriba, y guarda la escalera completa.
          </p>
        </div>
        {levelsUpdatedAt && (
          <p className="text-[11px] text-krov-dust">
            Última modificación: {DATE_FMT.format(new Date(levelsUpdatedAt))}
          </p>
        )}
      </header>

      <ol className="divide-y divide-krov-smoke/70">
        {validation.rows.map((row, index) => {
          const tier = ladder[index];
          const previous = index > 0 ? validation.rows[index - 1] : null;
          const isBase = index === 0;
          const changed = (values[tier.level] ?? "").trim() !== String(tier.minXP);
          const inputId = `tier-xp-${tier.level}`;
          const hintId = `${inputId}-hint`;

          return (
            <li key={tier.level} className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-start">
              <div className="flex min-w-0 items-center gap-3">
                <RankBadge rank={tier.rank} size="md" decorative />
                <div className="min-w-0">
                  <label htmlFor={inputId} className="block text-sm font-medium text-krov-bone">
                    {tier.rank}
                    <span className="ml-2 text-[10px] uppercase tracking-[0.2em] text-krov-dust">
                      Nivel {tier.level}
                    </span>
                  </label>
                  <p className="mt-0.5 text-xs text-krov-ash">
                    {isBase ? (
                      "Rango inicial: todos los clientes empiezan aquí."
                    ) : (
                      <>
                        Debe superar a <span className="text-krov-bone">{previous?.rank}</span>
                        {previous?.value !== null && previous?.value !== undefined && (
                          <> ({formatXp(previous.value)} XP)</>
                        )}
                      </>
                    )}
                    {changed && !isBase && (
                      <span className="ml-2 text-krov-dust">· antes {formatXp(tier.minXP)} XP</span>
                    )}
                  </p>
                </div>
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <input
                    id={inputId}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={values[tier.level] ?? ""}
                    onChange={(e) => {
                      const next = e.target.value;
                      setValues((v) => ({ ...v, [tier.level]: next }));
                      setFeedback(null);
                    }}
                    disabled={readOnly || isBase || isPending}
                    aria-invalid={row.issue ? true : undefined}
                    aria-describedby={hintId}
                    className={`${inputCls} ${
                      row.issue ? "border-red-500/70" : changed ? "border-krov-blood" : "border-krov-blood/30"
                    }`}
                  />
                  <span className="text-[11px] uppercase tracking-wider text-krov-dust">XP</span>
                </div>
                <p
                  id={hintId}
                  className={`mt-1.5 text-xs ${row.issue ? "text-red-300" : "text-krov-dust"}`}
                  aria-live="polite"
                >
                  {row.issue
                    ? row.message
                    : isBase
                      ? "Fijo en 0 XP."
                      : `Entero entre 0 y ${formatXp(MAX_REQUIRED_XP)}.`}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      <footer className="flex flex-col gap-3 border-t border-krov-smoke px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div aria-live="polite" className="min-h-5 text-sm">
          {feedback ? (
            <p
              role={feedback.kind === "error" ? "alert" : "status"}
              className={feedback.kind === "error" ? "text-red-300" : "text-emerald-300"}
            >
              {feedback.message}
            </p>
          ) : dirty && !validation.ok ? (
            <p className="text-krov-ash">Corrige los rangos marcados para poder guardar.</p>
          ) : dirty && changes.length > 0 ? (
            <p className="text-krov-ash">
              {changes.length} {changes.length === 1 ? "cambio sin guardar" : "cambios sin guardar"}.
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={reset}
            disabled={!dirty || isPending}
            className="rounded-none border border-krov-smoke px-4 py-2.5 text-sm text-krov-ash transition hover:border-krov-blood/60 hover:text-krov-bone disabled:cursor-not-allowed disabled:opacity-50"
          >
            Descartar cambios
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave}
            className="rounded-none bg-krov-blood px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-krov-crimson disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Guardando…" : "Guardar umbrales"}
          </button>
        </div>
      </footer>
    </section>
  );
}
