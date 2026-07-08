import { parseBoundedInteger } from "../runtime-policy-editor-utils";

export function PolicyNumberField({
  label,
  max,
  min,
  onChange,
  readOnly = false,
  value
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  readOnly?: boolean;
  value: number;
}) {
  return (
    <label className="policy-field">
      <span>{label}</span>
      <input
        max={max}
        min={min}
        onChange={(event) => onChange(parseBoundedInteger(event.target.value, min, max))}
        readOnly={readOnly}
        type="number"
        value={value}
      />
    </label>
  );
}

export function formatEnabled(value?: boolean | null) {
  return value ? "enabled" : "disabled";
}
