"use client";

import { Search } from "lucide-react";
import { useState, type ChangeEvent, type ReactNode } from "react";

type RequestLogFilterFormProps = {
  action: string;
  children: ReactNode;
};

type RequestLogUnifiedSearchProps = {
  defaultValue: string;
  label: string;
  placeholder: string;
  submitLabel: string;
};

export function RequestLogFilterForm({ action, children }: RequestLogFilterFormProps) {
  function submitChangedFilter(event: ChangeEvent<HTMLFormElement>) {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }

    const form = event.currentTarget;
    if (target.name === "provider") {
      const modelSelect = form.elements.namedItem("model");
      if (modelSelect instanceof HTMLSelectElement) {
        modelSelect.value = "";
      }
    }

    form.requestSubmit();
  }

  return (
    <form action={action} className="request-log-search-panel" onChange={submitChangedFilter}>
      {children}
    </form>
  );
}

export function RequestLogUnifiedSearch({
  defaultValue,
  label,
  placeholder,
  submitLabel
}: RequestLogUnifiedSearchProps) {
  const [isOpen, setIsOpen] = useState(Boolean(defaultValue));

  if (!isOpen) {
    return (
      <div className="request-log-unified-search">
        <button
          aria-expanded="false"
          aria-label={label}
          className="request-log-search-toggle"
          onClick={() => setIsOpen(true)}
          title={label}
          type="button"
        >
          <Search aria-hidden="true" size={18} strokeWidth={2.3} />
        </button>
      </div>
    );
  }

  return (
    <div className="request-log-unified-search" data-open="true">
      <div className="request-log-search-shell">
        <input
          aria-label={label}
          autoFocus
          defaultValue={defaultValue}
          name="search"
          placeholder={placeholder}
          type="search"
        />
        <button aria-label={submitLabel} className="request-log-search-button" type="submit">
          <Search aria-hidden="true" size={18} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
}
