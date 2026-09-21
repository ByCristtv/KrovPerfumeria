"use client";

import { useId, useState, type FormEvent } from "react";
import {
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
import { updatePhone } from "@/features/account/getAccountData";

const PHONE_MIN_DIGITS = 8;
const PHONE_MAX_LENGTH = 20;

/** Null when valid, otherwise the message to show under the field. */
function phoneIssue(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length > PHONE_MAX_LENGTH) return "El teléfono es demasiado largo";
  // Counted in digits, not characters, so "8888-8888" and "+506 8888 8888"
  // both pass and "--------" doesn't.
  if (trimmed.replace(/\D/g, "").length < PHONE_MIN_DIGITS)
    return `Escribe al menos ${PHONE_MIN_DIGITS} dígitos`;
  return null;
}

/**
 * "Contacto" on /profile: phone (editable) and email (read-only).
 *
 * The email is the account's sign-in identity, owned by Supabase Auth, so it
 * is shown as a reference and never becomes an input, not even while the
 * phone is being edited. Seeing it stay put beside the phone field is the
 * clearest way to say "this one isn't yours to change here".
 *
 * The phone error waits for the first blur (or a save attempt) before it
 * appears. Flagging "8 dígitos" while someone is on digit three is noise.
 */
export default function ContactSection({
  userId,
  phone,
  email,
  onSaved,
}: {
  userId: string;
  phone: string | null;
  email: string | null;
  onSaved: () => void;
}) {
  const titleId = useId();
  const phoneId = useId();
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

  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);

  const issue = phoneIssue(value);
  const showIssue = touched && issue !== null;
  const dirty = value.trim() !== (phone ?? "");

  const startEditing = () => {
    setValue(phone ?? "");
    setTouched(false);
    start();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (issue || !dirty) return;

    void submit(async () => {
      await updatePhone(userId, value.trim());
      onSaved();
    });
  };

  return (
    <Card highlighted={editing}>
      <SectionHeader
        title="Contacto"
        titleId={titleId}
        description="Lo usamos para coordinar tus entregas."
        action={
          <EditActions
            editing={editing}
            savedVisible={savedVisible}
            onEdit={startEditing}
            accessibleName="Editar teléfono"
            buttonRef={editButtonRef}
          />
        }
      />

      {editing ? (
        <form
          ref={formRef}
          onSubmit={onSubmit}
          onKeyDown={onKeyDown}
          aria-labelledby={titleId}
          noValidate
          className="space-y-5"
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              label="Teléfono"
              htmlFor={phoneId}
              error={showIssue ? issue : undefined}
              hint="Con o sin guiones: 8888-8888"
            >
              <input
                id={phoneId}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={PHONE_MAX_LENGTH}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={() => setTouched(true)}
                placeholder="8888-8888"
                aria-invalid={showIssue}
                aria-describedby={fieldMessageId(phoneId)}
                className={INPUT_CLS}
              />
            </Field>

            <dl className="sm:pt-0.5">
              <DetailRow label="Correo electrónico" value={email} readOnly />
            </dl>
          </div>

          <FormError message={saveError} />
          <FormActions
            onCancel={cancel}
            saving={saving}
            saveDisabled={!dirty}
          />
        </form>
      ) : (
        <dl className="grid gap-5 sm:grid-cols-2">
          <DetailRow label="Teléfono" value={phone} placeholder="Sin teléfono" />
          <DetailRow label="Correo electrónico" value={email} readOnly />
        </dl>
      )}
    </Card>
  );
}
