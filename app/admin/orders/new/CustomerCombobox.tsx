"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useCustomerSearch } from "@/hooks/useCustomerSearch";
import type { AdminCustomerMatch } from "@/types/adminOrder";

interface CustomerComboboxProps {
  onSelect: (customer: AdminCustomerMatch) => void;
  disabled?: boolean;
}

/**
 * Search registered customers by name, email or phone and pick one.
 *
 * Follows the ARIA 1.2 combobox pattern (list autocomplete, focus stays in the
 * input, the highlighted option is announced through aria-activedescendant) so
 * it is fully keyboard-operable: ↓/↑ move, Enter picks, Esc closes.
 *
 * Picking is a callback, not internal state. The form owns what "a customer was
 * chosen" means (autofill, the account link), and this component only has to
 * reflect a search.
 *
 * Loading, failure and "nobody found" are three different panels on purpose: a
 * dead search endpoint must not read as "this customer isn't registered", or an
 * admin would create the order unlinked and the customer would lose their XP.
 */
export default function CustomerCombobox({
  onSelect,
  disabled = false,
}: CustomerComboboxProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const listboxId = useId();
  const optionId = (index: number) => `${listboxId}-opt-${index}`;

  const { customers, isLoading, isError, isIdle, isPending, refetch } =
    useCustomerSearch(query);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const choose = (customer: AdminCustomerMatch) => {
    onSelect(customer);
    setQuery("");
    setOpen(false);
    setActiveIndex(0);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (customers.length === 0) return;
      e.preventDefault();
      setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => (i + step + customers.length) % customers.length);
      return;
    }
    if (e.key === "Enter" && open && customers[activeIndex]) {
      // Enter inside a form field would otherwise submit the order.
      e.preventDefault();
      choose(customers[activeIndex]);
    }
  };

  const showList = open && customers.length > 0;
  const showPanel = open && !isIdle && !showList;

  return (
    <div className="relative" ref={rootRef}>
      <input
        role="combobox"
        aria-label="Buscar cliente registrado"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-activedescendant={showList ? optionId(activeIndex) : undefined}
        className="adm-input"
        value={query}
        disabled={disabled}
        autoComplete="off"
        placeholder="Buscar cliente registrado por nombre, correo o teléfono…"
        onChange={(e) => {
          setQuery(e.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />

      <ul
        id={listboxId}
        role="listbox"
        aria-label="Clientes registrados"
        hidden={!showList}
        className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto border border-krov-blood/30 bg-krov-ink shadow-2xl"
      >
        {customers.map((c, index) => (
          <li
            key={c.user_id}
            id={optionId(index)}
            role="option"
            aria-selected={index === activeIndex}
            // mousedown, not click: the input's blur must not close the list
            // before the click lands.
            onMouseDown={(e) => {
              e.preventDefault();
              choose(c);
            }}
            onMouseEnter={() => setActiveIndex(index)}
            className={`cursor-pointer px-3 py-2.5 ${
              index === activeIndex ? "bg-[#1f1f1f]" : ""
            }`}
          >
            <span className="block truncate text-sm text-krov-bone">
              {c.full_name?.trim() || "Sin nombre"}
            </span>
            <span className="block truncate text-[11px] text-krov-ash">
              {c.email}
              {c.phone ? ` · ${c.phone}` : ""}
            </span>
          </li>
        ))}
      </ul>

      {showPanel && (
        <div
          role="status"
          className="absolute z-20 mt-1 w-full border border-krov-smoke bg-krov-ink px-3 py-3 text-sm text-krov-ash shadow-2xl"
        >
          {isError ? (
            <span>
              No pudimos buscar clientes.{" "}
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={refetch}
                className="text-krov-rose underline underline-offset-2"
              >
                Reintentar
              </button>
            </span>
          ) : isLoading || isPending ? (
            "Buscando…"
          ) : (
            "Sin clientes registrados con ese dato."
          )}
        </div>
      )}
    </div>
  );
}
