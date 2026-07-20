import { useEffect, useState } from "react";

import {
  formatPolicyNumberInputValue,
  parseOptionalBoundedInteger
} from "../runtime-policy-editor-utils";

export function PolicyNumberField({
  className,
  label,
  labelClassName,
  max,
  min,
  onChange,
  readOnly = false,
  value
}: {
  className?: string;
  label: string;
  labelClassName?: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  readOnly?: boolean;
  value: number | null | undefined;
}) {
  const [inputValue, setInputValue] = useState(() =>
    formatPolicyNumberInputValue(value)
  );

  useEffect(() => {
    setInputValue(formatPolicyNumberInputValue(value));
  }, [value]);

  return (
    <label className={["policy-field", className].filter(Boolean).join(" ")}>
      <span className={labelClassName}>{label}</span>
      <input
        max={max}
        min={min}
        onBlur={() => setInputValue(formatPolicyNumberInputValue(value))}
        onChange={(event) => {
          const nextInputValue = event.target.value;
          const nextValue = parseOptionalBoundedInteger(nextInputValue, min, max);

          setInputValue(nextInputValue);
          if (nextValue !== null) {
            onChange(nextValue);
          }
        }}
        readOnly={readOnly}
        type="number"
        value={inputValue}
      />
    </label>
  );
}

export function formatEnabled(value?: boolean | null) {
  return value ? "enabled" : "disabled";
}
