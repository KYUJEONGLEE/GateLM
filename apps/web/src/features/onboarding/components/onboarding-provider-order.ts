export function orderOnboardingProviderRows<T extends { family: string }>(
  presetRows: T[],
  registeredRows: T[]
) {
  const registeredFamilies = new Set(
    registeredRows.map((row) => getComparableProviderFamily(row.family))
  );
  const availablePresetRows = presetRows.filter(
    (row) => !registeredFamilies.has(getComparableProviderFamily(row.family))
  );
  const alreadyRegisteredPresetRows = presetRows.filter((row) =>
    registeredFamilies.has(getComparableProviderFamily(row.family))
  );

  return [...availablePresetRows, ...registeredRows, ...alreadyRegisteredPresetRows];
}

function getComparableProviderFamily(providerFamily: string) {
  const normalizedFamily = providerFamily.trim().toLowerCase();

  return normalizedFamily === "claude" ? "anthropic" : normalizedFamily;
}
