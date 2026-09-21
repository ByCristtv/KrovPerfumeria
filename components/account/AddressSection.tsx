"use client";

import { useId, useState, type FormEvent } from "react";
import DistrictSelect from "@/components/ui/DistrictSelect";
import {
  Card,
  DetailRow,
  EditActions,
  Field,
  FormActions,
  FormError,
  INPUT_CLS,
  SELECT_CLS,
  SectionHeader,
  fieldMessageId,
  useInlineEdit,
} from "@/components/account/profileUi";
import {
  findCanton,
  findDistrictByName,
  findProvince,
  getCantones,
  getProvinces,
} from "@/lib/cr-geo";
import {
  upsertAddress,
  type AccountData,
} from "@/features/account/getAccountData";

const EXACT_ADDRESS_MIN = 10;

type FieldKey = "province" | "canton" | "district" | "exactAddress";
type FieldErrors = Partial<Record<FieldKey, string>>;

/**
 * "Dirección de entrega" on /profile. Every field is editable; References is
 * the one optional field and is labelled as such in both modes.
 *
 * The cascade and validation rules are the checkout form's, so an address saved
 * here always passes checkout:
 * · the province is derived from the cantón in the SAME render, so the option
 *   list can never lag behind a restored value;
 * · changing a level clears the levels below it;
 * · the district must exist in the chosen cantón (a legacy free-text district
 *   survives prefill so the customer can see it, but can't be re-saved as is).
 *
 * Errors are attached to their own field (aria-invalid + the field's message
 * line) and appear on Save, then clear as soon as that field is changed.
 */
export default function AddressSection({
  userId,
  address,
  onSaved,
}: {
  userId: string;
  address: AccountData["address"];
  onSaved: () => void;
}) {
  const titleId = useId();
  const ids = {
    province: useId(),
    canton: useId(),
    district: useId(),
    exactAddress: useId(),
    reference: useId(),
  };

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
  const [cantonCode, setCantonCode] = useState("");
  const [provinceOverride, setProvinceOverride] = useState("");
  const [district, setDistrict] = useState("");
  const [exactAddress, setExactAddress] = useState("");
  const [reference, setReference] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  const selectedProvince =
    findCanton(cantonCode)?.provinceCode ?? provinceOverride;
  const cantonesForProvince = getCantones(selectedProvince);

  const dirty =
    !address ||
    cantonCode !== (address.canton ?? "") ||
    district !== (address.district ?? "") ||
    exactAddress.trim() !== (address.exact_address ?? "") ||
    reference.trim() !== (address.references ?? "");

  const clearError = (key: FieldKey) =>
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));

  const startEditing = () => {
    setCantonCode(address?.canton ?? "");
    setProvinceOverride(address?.province ?? "");
    setDistrict(address?.district ?? "");
    setExactAddress(address?.exact_address ?? "");
    setReference(address?.references ?? "");
    setErrors({});
    start();
  };

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    const canton = findCanton(cantonCode);
    if (!selectedProvince) next.province = "Selecciona una provincia";
    if (!canton) next.canton = "Selecciona un cantón";
    if (!district.trim()) next.district = "Selecciona un distrito";
    else if (canton && !findDistrictByName(canton.code, district))
      next.district = `Selecciona un distrito válido de ${canton.name}`;
    if (exactAddress.trim().length < EXACT_ADDRESS_MIN)
      next.exactAddress = `Describe cómo llegar (al menos ${EXACT_ADDRESS_MIN} caracteres)`;
    return next;
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const found = validate();
    setErrors(found);

    const firstInvalid = (Object.keys(found) as FieldKey[])[0];
    if (firstInvalid) {
      // Take the user to the first problem instead of leaving them to hunt.
      document.getElementById(ids[firstInvalid])?.focus();
      return;
    }

    const canton = findCanton(cantonCode)!;
    const districtRecord = findDistrictByName(canton.code, district)!;

    void submit(async () => {
      await upsertAddress(
        userId,
        {
          province: canton.provinceCode,
          canton: canton.code,
          // The dataset's canonical spelling, not the raw option text, so
          // accents and casing are consistent for every address we store.
          district: districtRecord.name,
          exact_address: exactAddress.trim(),
          references: reference.trim() || null,
        },
        address?.id
      );
      onSaved();
    });
  };

  const invalid = (key: FieldKey) => (errors[key] ? true : undefined);

  return (
    <Card highlighted={editing}>
      <SectionHeader
        title="Dirección de entrega"
        titleId={titleId}
        description="Se autocompleta en tu próximo checkout."
        action={
          <EditActions
            editing={editing}
            savedVisible={savedVisible}
            onEdit={startEditing}
            label={address ? "Editar" : "Agregar"}
            accessibleName={address ? "Editar dirección" : "Agregar dirección"}
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
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Provincia" htmlFor={ids.province} error={errors.province}>
              <select
                id={ids.province}
                value={selectedProvince}
                onChange={(e) => {
                  setProvinceOverride(e.target.value);
                  // Both levels below the province are now stale.
                  setCantonCode("");
                  setDistrict("");
                  clearError("province");
                }}
                aria-invalid={invalid("province")}
                aria-describedby={fieldMessageId(ids.province)}
                className={SELECT_CLS}
              >
                <option value="">Selecciona</option>
                {getProvinces().map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Cantón" htmlFor={ids.canton} error={errors.canton}>
              <select
                id={ids.canton}
                value={cantonCode}
                onChange={(e) => {
                  setCantonCode(e.target.value);
                  // The old district belonged to the old cantón.
                  setDistrict("");
                  clearError("canton");
                }}
                disabled={!selectedProvince}
                aria-invalid={invalid("canton")}
                aria-describedby={fieldMessageId(ids.canton)}
                className={SELECT_CLS}
              >
                <option value="">
                  {selectedProvince ? "Selecciona" : "Elige provincia"}
                </option>
                {cantonesForProvince.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>

            {/* Same cascading dropdown the checkout form uses: one component,
                so the two can't disagree about which districts a cantón has. */}
            <Field label="Distrito" htmlFor={ids.district} error={errors.district}>
              <DistrictSelect
                id={ids.district}
                cantonCode={cantonCode}
                value={district}
                onChange={(next) => {
                  setDistrict(next);
                  clearError("district");
                }}
                aria-invalid={invalid("district")}
                aria-describedby={fieldMessageId(ids.district)}
                className={SELECT_CLS}
              />
            </Field>
          </div>

          <Field
            label="Señas exactas"
            htmlFor={ids.exactAddress}
            error={errors.exactAddress}
            hint="Calle, color de la casa, portón… lo que ayude a encontrarte."
          >
            <textarea
              id={ids.exactAddress}
              rows={3}
              value={exactAddress}
              onChange={(e) => {
                setExactAddress(e.target.value);
                clearError("exactAddress");
              }}
              placeholder="200 m sur de la iglesia, casa azul, portón negro"
              aria-invalid={invalid("exactAddress")}
              aria-describedby={fieldMessageId(ids.exactAddress)}
              className={`${INPUT_CLS} resize-none`}
            />
          </Field>

          <Field label="Referencias" htmlFor={ids.reference} optional>
            <input
              id={ids.reference}
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Ej. frente al parque"
              className={INPUT_CLS}
            />
          </Field>

          <FormError message={saveError} />
          <FormActions
            onCancel={cancel}
            saving={saving}
            saveDisabled={!dirty}
          />
        </form>
      ) : address ? (
        <dl className="grid gap-5 sm:grid-cols-3">
          <DetailRow
            label="Provincia"
            value={findProvince(address.province)?.name ?? address.province}
          />
          <DetailRow
            label="Cantón"
            value={findCanton(address.canton)?.name ?? address.canton}
          />
          <DetailRow label="Distrito" value={address.district} />
          <DetailRow
            label="Señas exactas"
            value={address.exact_address}
            className="sm:col-span-3"
          />
          <DetailRow
            label="Referencias"
            value={address.references}
            placeholder="Sin referencias"
            optional
            className="sm:col-span-3"
          />
        </dl>
      ) : (
        <p className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-white/45">
          Aún no tienes una dirección guardada.
        </p>
      )}
    </Card>
  );
}
