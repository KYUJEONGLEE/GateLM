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
