"use client";

import Image from "next/image";
import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { Camera, Loader2 } from "lucide-react";
import { useAvatarUpload } from "@/hooks/useAvatarUpload";
import { AVATAR_ACCEPTED_MIME_TYPES } from "@/lib/avatar/constants";
import { isRenderableAvatar } from "@/lib/avatar/renderable";
import {
  Badge,
  Card,
  DetailRow,
  EditActions,
  Field,
  FormActions,
  FormError,
  INPUT_CLS,
  SectionHeader,
  fieldMessageId,
  useInlineEdit,
} from "@/components/account/profileUi";
import {
  isValidUsername,
  USERNAME_MAX_LENGTH,
  usernameSchema,
} from "@/schemas/ranking";
import { updateRankingSettingsAction } from "@/app/profile/actions";

const ANONYMOUS_AVATAR = "/User/UserAnonimous.avif";

interface IdentitySectionProps {
  /** From the auth account (Google / sign-up). Shown, never edited here. */
  fullName: string;
  /** `profiles.avatar_url`, falling back to the OAuth picture. Changed via the camera button. */
  avatarUrl: string | null;
  username: string | null;
  showInRanking: boolean;
  /**
   * `profiles.is_profile_public`: whether other people can FIND this account
   * in /friends. A different column from `showInRanking`, displayed separately
   * below even though one switch currently writes both, so the section never
   * implies the two are one thing.
   */
  isProfilePublic: boolean;
  /** Invalidates the cached account query so the section re-reads what was saved. */
  onSaved: () => void;
}

/**
 * "Identidad" on /profile: full name (read-only) and username (editable).
 *
 * Why the public-profile switch lives HERE, next to the username: the two are
 * not independent. The switch needs a valid username (the schema, the action's
 * auto-disable and a database CHECK all enforce that), and clearing the
 * username must turn the switch off in the SAME save. Editing them in two
 * places would let a user commit a cleared username while the switch was on.
 * It is also what /ranking and /friends send people here for ("Configura tu
 * participación", "Haz público tu perfil"), so it can't be dropped.
 *
 * ONE switch, TWO columns. It writes `show_in_ranking` (appear on the public
 * leaderboard) and `is_profile_public` (be findable by username in /friends),
 * because a single "my profile is public" decision is what a customer actually
 * has an opinion about. The view still shows the two resulting states as
 * separate badges and the action still writes them through separate paths, so
 * splitting the control later needs no migration.
 *
 * Because the switch is a privacy control and not just a leaderboard
 * preference, its label and help text state BOTH consequences.
 */
export default function IdentitySection({
  fullName,
  avatarUrl,
  username,
  showInRanking,
  isProfilePublic,
  onSaved,
}: IdentitySectionProps) {
  const titleId = useId();
  const usernameFieldId = useId();
  const toggleHelpId = useId();

  const {
    editing,
    saving,
    error: saveError,
    savedVisible,
    start,
    cancel,
    submit,
    onKeyDown,
    editButtonRef,
    formRef,
  } = useInlineEdit();
  const [usernameValue, setUsernameValue] = useState("");
  const [visible, setVisible] = useState(false);
  const {
    inputRef: avatarInputRef,
    open: openAvatarPicker,
    onChange: onAvatarChange,
    uploading: uploadingAvatar,
    error: avatarError,
    previewUrl,
  } = useAvatarUpload({ currentUrl: avatarUrl, onUploaded: onSaved });

  // Empty is a legitimate value ("I have no public name"), so it is not an error
  // state; it just can't support the switch. Anything non-empty is held to the
  // full rule set as the user types.
  const trimmed = usernameValue.trim();
  const isEmpty = trimmed === "";
  const usernameOk = !isEmpty && isValidUsername(trimmed);
  const usernameIssue =
    isEmpty || usernameOk
      ? ""
      : (usernameSchema.safeParse(trimmed).error?.issues[0]?.message ?? "");

  // What would actually be sent. Mirrors the action's auto-disable so the
  // request is never one the server would have to correct.
  const nextVisible = visible && usernameOk;
  const dirty =
    trimmed !== (username ?? "") || nextVisible !== showInRanking;

  const startEditing = () => {
    setUsernameValue(username ?? "");
    setVisible(showInRanking);
    start();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!dirty || (!isEmpty && !usernameOk)) return;

    void submit(async () => {
      const result = await updateRankingSettingsAction({
        username: trimmed,
        show_in_ranking: nextVisible,
      });
      if (!result.ok) return result.message;
      onSaved();
    });
  };

  return (
    <Card highlighted={editing}>
      <SectionHeader
        title="Identidad"
        titleId={titleId}
        action={
          <EditActions
            editing={editing}
            savedVisible={savedVisible}
            onEdit={startEditing}
            accessibleName="Editar username y visibilidad"
            buttonRef={editButtonRef}
          />
        }
      />

      <div className="flex items-start gap-4">
        <div className="relative shrink-0">
          {/* Red ring: the one decorative flourish, kept subtle. */}
          <div className="absolute -inset-0.5 rounded-full bg-gradient-to-br from-krov-blood/60 via-transparent to-krov-blood/30" />
          <Image
            width={64}
            height={64}
            src={
              previewUrl ??
              (isRenderableAvatar(avatarUrl) ? avatarUrl : ANONYMOUS_AVATAR)
            }
            alt=""
            className="relative h-16 w-16 rounded-full object-cover"
          />

          {uploadingAvatar && (
            <span
              aria-hidden
              className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60"
            >
              <Loader2 size={22} className="animate-spin text-white motion-reduce:animate-none" />
            </span>
          )}

          {/* Corner badge rather than a whole-avatar overlay: the picture stays
              fully visible, and the control keeps its own focus ring. */}
          <button
            type="button"
            onClick={openAvatarPicker}
            disabled={uploadingAvatar}
            aria-label="Cambiar foto de perfil"
            className="absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full border border-white/20 bg-krov-blood text-white shadow transition-colors duration-200 hover:bg-krov-rose focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-krov-rose focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Camera size={14} aria-hidden />
          </button>

          {/* Hidden picker, opened by the button above. `accept` only filters
              the OS dialog; the real checks run in validateAvatarFile and,
              authoritatively, on the server. */}
          <input
            ref={avatarInputRef}
            type="file"
            accept={AVATAR_ACCEPTED_MIME_TYPES.join(",")}
            onChange={onAvatarChange}
            className="hidden"
            tabIndex={-1}
            aria-hidden
          />
        </div>

        {/* The full name stays read-only in BOTH modes: seeing it unchanged
            next to the username input is what makes the difference obvious. */}
        <dl className="min-w-0 flex-1 space-y-3">
          <DetailRow label="Nombre completo" value={fullName} readOnly />
          {!editing && (
            <DetailRow
              label="Username"
              value={username}
              placeholder="Sin username"
            />
          )}
        </dl>
      </div>

      {/* Live regions live outside the conditional parts so a screen reader
          hears the state change instead of a node appearing already-filled. */}
      <p role="status" className="sr-only">
        {uploadingAvatar ? "Subiendo tu foto…" : ""}
      </p>
      {avatarError && (
        <p role="alert" className="mt-3 text-xs text-red-400">
          {avatarError}
        </p>
      )}

      {editing ? (
        <form
          ref={formRef}
          onSubmit={onSubmit}
          onKeyDown={onKeyDown}
          aria-labelledby={titleId}
          noValidate
          className="mt-5 space-y-4 border-t border-krov-smoke/70 pt-5"
        >
          <Field
            label="Username"
            htmlFor={usernameFieldId}
            error={usernameIssue}
            hint={`Entre 3 y ${USERNAME_MAX_LENGTH} caracteres: letras, números, punto o guion bajo. Déjalo vacío para no tener uno.`}
          >
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
              aria-describedby={fieldMessageId(usernameFieldId)}
              className={INPUT_CLS}
            />
          </Field>

          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <VisibilityToggle
              checked={nextVisible}
              // The requirement stated as a control: with no valid username
              // there is nothing to publish, so the switch is genuinely
              // unavailable rather than merely rejected on save.
              disabled={!usernameOk}
              describedBy={toggleHelpId}
              onChange={setVisible}
            />
            <p id={toggleHelpId} className="mt-2.5 text-xs leading-relaxed text-white/40">
              {usernameOk
                ? "Al activarlo, tu username, tu XP y tu rango aparecen públicamente en el ranking, y cualquier persona con cuenta puede encontrarte buscando tu username. No mostramos tu nombre real, tu correo, tu teléfono, tu dirección ni tus pedidos."
                : "Necesitas un username válido para aparecer en el ranking o ser encontrable."}
            </p>
          </div>

          <FormError message={saveError} />
          <FormActions
            onCancel={cancel}
            saving={saving}
            // Non-empty but invalid is the unsavable state; empty is fine and
            // clears the username. Unchanged is disabled so Save always means
            // "something will change".
            saveDisabled={!dirty || (!isEmpty && !usernameOk)}
          />
        </form>
      ) : (
        <div className="mt-5 border-t border-krov-smoke/70 pt-4">
          {/* Two badges, not one: they report two different columns. */}
          <div className="flex flex-wrap gap-1.5">
            <Badge label={showInRanking ? "Visible en el ranking" : "Oculto"} />
            <Badge label={isProfilePublic ? "Perfil encontrable" : "Perfil privado"} />
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            <Link href="/ranking" className="krov-underline text-xs text-krov-rose">
              Ver el ranking
            </Link>
            <Link href="/friends" className="krov-underline text-xs text-krov-rose">
              Buscar amigos
            </Link>
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * The public-profile switch.
 *
 * A real checkbox carries the semantics (Space toggles it, screen readers
 * announce checked/disabled, the label is clickable); the two spans are purely
 * the painted track and knob, hidden from the accessibility tree.
 */
function VisibilityToggle({
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
      className={`flex min-h-11 items-center justify-between gap-4 ${
        disabled ? "cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      {/* The label names BOTH consequences of the switch. It has to: this is a
          privacy control, and "Aparecer en el ranking" alone would not tell a
          user that strangers can also look them up. */}
      <span className={`text-sm ${disabled ? "text-white/35" : "text-white"}`}>
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
