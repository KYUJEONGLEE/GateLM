export function parseCompactStepperInput(value: string, unit: string) {
  const normalizedValue = value
    .replace(unit, "")
    .replace(/[^0-9.-]/g, "")
    .trim();
  if (
    normalizedValue.length === 0 ||
    normalizedValue === "-" ||
    normalizedValue === "." ||
    normalizedValue === "-."
  ) {
    return null;
  }
  const numericValue = Number(normalizedValue);
  return Number.isFinite(numericValue) ? numericValue : null;
}
