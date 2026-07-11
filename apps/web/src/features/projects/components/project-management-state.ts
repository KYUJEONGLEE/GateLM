export type ProjectCreateActionLocation = "empty" | "toolbar" | null;

export function getProjectCreateActionLocation(
  projectCount: number,
  canCreateProject: boolean
): ProjectCreateActionLocation {
  if (!canCreateProject) {
    return null;
  }

  return projectCount === 0 ? "empty" : "toolbar";
}

export function getRelativeTokenUsagePercent(
  totalTokens: number | null,
  highestProjectTokens: number | null
) {
  if (totalTokens === null || highestProjectTokens === null) {
    return null;
  }

  if (highestProjectTokens <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, (totalTokens * 100) / highestProjectTokens));
}
