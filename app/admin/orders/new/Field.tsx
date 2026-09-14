"use client";

/**
 * The labelled-field wrapper used by the manual-order form.
 *
 * Extracted from AdminOrderCreateView so the address cascade can live in its own
 * component (and its own test) without either file re-inventing the label
 * markup. Purely presentational — it ships no input styling of its own; the
 * inputs inside carry `adm-input` from the form's global style block.
 */
export default function Field({
  label,
  children,
  className = "",
  htmlFor,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  /**
   * When set, renders as a <label for=…> next to its control instead of
   * wrapping it. Needed for the district <select>, which lives in a shared
   * component and so cannot be nested inside this label's implicit association
   * without the surrounding text also becoming clickable label content.
   */
  htmlFor?: string;
}) {
  const caption = (
    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-krov-ash">
      {label}
    </span>
  );

  if (htmlFor) {
    return (
      <div className={`block ${className}`}>
        <label htmlFor={htmlFor}>{caption}</label>
        {children}
      </div>
    );
  }

  return (
    <label className={`block ${className}`}>
      {caption}
      {children}
    </label>
  );
}
