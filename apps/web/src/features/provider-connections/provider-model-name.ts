const datedModelVersionPattern = /(?:^|[-_/])\d{4}-\d{2}-\d{2}(?=$|[-_/])/;
const geminiPreviewPattern = /(?:^|[-_/])preview(?=$|[-_/])/;
const geminiLegacyVersionPattern = /(?:^|[-_/])001(?=$|[-_/])/;

export function hasDatedModelVersion(modelName: string): boolean {
  return datedModelVersionPattern.test(modelName.trim());
}

export function hasExcludedGeminiVariant(modelName: string): boolean {
  const normalizedModelName = modelName.trim().toLowerCase().replace(/^models\//, "");

  if (!normalizedModelName.startsWith("gemini-")) {
    return false;
  }

  return (
    geminiPreviewPattern.test(normalizedModelName) ||
    geminiLegacyVersionPattern.test(normalizedModelName)
  );
}
