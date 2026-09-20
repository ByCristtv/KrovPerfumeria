"use client";

import Link from "next/link";
import { useId, useState } from "react";
import Modal from "@/components/ui/Modal";
import {
  Badge,
  Card,
  CardHeading,
  Field,
  INPUT_CLS,
  ModalActions,
} from "@/components/account/profileUi";
import {
  isValidUsername,
  USERNAME_MAX_LENGTH,
  usernameSchema,
} from "@/schemas/ranking";
import { updateRankingSettingsAction } from "@/app/profile/actions";

interface RankingSettingsCardProps {
  username: string | null;
  showInRanking: boolean;
  /**
   * `profiles.is_profile_public` — whether other people can FIND this account
   * in /friends. A different column from `showInRanking`, displayed separately
   * below even though one switch currently writes both, so the card never
   * implies the two are one thing.
   */
  isProfilePublic: boolean;
  /** Invalidates the cached account query so the card re-reads what was saved. */
  onSaved: () => void;
}

/**
 * Username + public-profile opt-in, on /profile.
 *
 * Follows the same shape as PhoneCard and AddressCard: the card face states the
 * current setting, an "Editar" action opens a modal, and one Save writes. Both
 * fields go in the same modal deliberately — they are not independent (the
 * toggle depends on the username), and splitting them into two save paths would
 * let a user commit a cleared username while the opt-in was still on.
 *
 * ONE switch, TWO columns. It writes `show_in_ranking` (appear on the public
 * leaderboard) and `is_profile_public` (be findable by username in /friends),
 * because a single "my profile is public" decision is what a customer actually
 * has an opinion about — offering two near-identical privacy switches invites
 * the state nobody wants, "hidden but findable". The card still shows the two
 * resulting states as separate badges and the action still writes them through
 * separate paths, so splitting the control later needs no migration.
 *
 * Because the switch is now a privacy control and not just a leaderboard
 * preference, its label and help text state BOTH consequences. Understating
 * what a privacy toggle does is the one thing this card must not do.
 */
export default function RankingSettingsCard({
  username,
  showInRanking,
  isProfilePublic,
  onSaved,
}: RankingSettingsCardProps) {
  const usernameFieldId = useId();
  const toggleHelpId = useId();

  const [open, setOpen] = useState(false);
  const [usernameValue, setUsernameValue] = useState("");
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Empty is a legitimate value ("I have no public name"), so it is not an error
  // state — it just can't support the toggle. Anything non-empty is held to the
  // full rule set as the user types.
  const trimmed = usernameValue.trim();
  const isEmpty = trimmed === "";
  const usernameOk = !isEmpty && isValidUsername(trimmed);
  const usernameIssue =
    isEmpty || usernameOk
      ? ""
      : (usernameSchema.safeParse(trimmed).error?.issues[0]?.message ?? "");

  const openModal = () => {
    setUsernameValue(username ?? "");
    setVisible(showInRanking);
    setError("");
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    setError("");

    // The action re-validates and the database constrains; this only decides
    // what to send. `visible && usernameOk` mirrors the action's auto-disable so
    // the request is never one the server would have to correct.
    const result = await updateRankingSettingsAction({
      username: trimmed,
      show_in_ranking: visible && usernameOk,
    });

    setSaving(false);

    if (!result.ok) {
      // The card keeps showing the previously saved values — nothing local was
      // mutated — so a failed save loses only the unsaved edit.
      setError(result.message);
      return;
    }

    onSaved();
    setOpen(false);
  };

  return (
    <Card>
      <CardHeading
        title="Perfil público"
        action={{ label: username ? "Editar" : "Configurar", onClick: openModal }}
      />

      <p className="text-white text-sm break-words">
        {username ?? "Sin nombre de usuario"}
      </p>

      {/* Two badges, not one: they report two different columns. Today one
          switch moves both, so they will read the same — which is exactly why
          showing them separately is worth the line, since the day they can
          diverge the card already says so. */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge label={showInRanking ? "Visible en el ranking" : "Oculto"} />
        <Badge label={isProfilePublic ? "Perfil encontrable" : "Perfil privado"} />
      </div>

      <p className="text-white/35 text-xs mt-2.5 leading-relaxed">
        {showInRanking
          ? "Tu nombre de usuario, tu XP y tu rango son visibles en el ranking público, y otras personas pueden encontrarte por tu nombre de usuario."
          : "Elige un nombre de usuario y actívalo para competir en el ranking y que tus amigos puedan encontrarte."}
      </p>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        <Link
          href="/ranking"
          className="inline-block text-krov-rose text-xs hover:underline"
        >
          Ver el ranking
        </Link>
        <Link
          href="/friends"
          className="inline-block text-krov-rose text-xs hover:underline"
        >
          Buscar amigos
        </Link>
      </div>

      <Modal
        open={open}
        onClose={() => !saving && setOpen(false)}
        title="Perfil público"
        subtitle="Tu nombre de usuario, el Top 10 y quién puede encontrarte"
        closeOnBackdrop={!saving}
      >
        <div className="space-y-4">
          <Field label="Nombre de usuario" htmlFor={usernameFieldId}>
            <input
              id={usernameFieldId}
              type="text"
              inputMode="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={USERNAME_MAX_LENGTH}
              value={usernameValue}
              onChange={(e) => setUsernameValue(e.target.value)}
              placeholder="aurora.cr"
              aria-invalid={usernameIssue !== ""}
              aria-describedby={usernameIssue ? `${usernameFieldId}-error` : undefined}
              className={INPUT_CLS}
            />
            {usernameIssue ? (
              <p
                id={`${usernameFieldId}-error`}
                className="mt-1.5 text-xs text-red-400"
              >
                {usernameIssue}
              </p>
            ) : (
              <p className="mt-1.5 text-xs text-white/35">
                Entre 3 y {USERNAME_MAX_LENGTH} caracteres: letras, números,
                punto o guion bajo. Déjalo vacío para no tener uno.
              </p>
            )}
          </Field>

          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <RankingToggle
              checked={visible && usernameOk}
              // The requirement stated as a control: with no valid username
              // there is nothing to publish, so the toggle is genuinely
              // unavailable rather than merely rejected on save.
              disabled={!usernameOk}
              describedBy={toggleHelpId}
              onChange={setVisible}
            />

            <p id={toggleHelpId} className="mt-2.5 text-xs leading-relaxed text-white/40">
              {usernameOk
                ? "Al activarlo, tu nombre de usuario, tu XP y tu rango aparecen públicamente en el ranking, y cualquier persona con cuenta puede encontrarte buscando tu nombre de usuario. No mostramos tu nombre real, tu correo, tu teléfono, tu dirección ni tus pedidos."
                : "Necesitas un nombre de usuario válido para aparecer en el ranking o ser encontrable."}
            </p>
          </div>

          {error && (
            <p role="alert" className="text-xs text-red-400">
              {error}
            </p>
          )}

          <ModalActions
            onCancel={() => setOpen(false)}
            onSave={save}
            saving={saving}
            // Non-empty but invalid is the only unsavable state; empty is fine
            // and clears the username.
            saveDisabled={!isEmpty && !usernameOk}
          />
        </div>
      </Modal>
    </Card>
  );
}

/**
 * The opt-in switch.
 *
 * A real checkbox carries the semantics (Space toggles it, screen readers
 * announce checked/disabled, the label is clickable); the two spans are purely
 * the painted track and knob, hidden from the accessibility tree. Sizes are the
 * card's own — 44px of hit area on the label, per the mobile targets the navbar
 * already uses.
 */
function RankingToggle({
  checked,
  disabled,
  describedBy,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  describedBy: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      className={`flex items-center justify-between gap-4 ${
        disabled ? "cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      {/* The label names BOTH consequences of the switch. It has to: this is a
          privacy control, and "Aparecer en el ranking" alone would not tell a
          user that strangers can also look them up. */}
      <span
        className={`text-sm ${disabled ? "text-white/35" : "text-white"}`}
      >
        Aparecer en el ranking y permitir que me encuentren
      </span>

      <span className="relative inline-flex shrink-0 items-center">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span
          aria-hidden
          className="block h-6 w-11 rounded-full border border-white/15 bg-white/10 transition-colors duration-200 peer-checked:border-krov-blood peer-checked:bg-krov-blood peer-disabled:opacity-40 peer-focus-visible:ring-2 peer-focus-visible:ring-krov-blood/60 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-black"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 peer-checked:translate-x-5 motion-reduce:transition-none"
        />
      </span>
    </label>
  );
}
