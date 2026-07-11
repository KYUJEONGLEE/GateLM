export type ProjectCreateActionLocation = "empty" | "toolbar" | null;

export function isProjectVisibleInList(status: string) {
  return status !== "ARCHIVED";
}

export function compareProjectCreatedAtDescending(
  left: { createdAt: string },
  right: { createdAt: string }
) {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt);
}

export function getProjectCreateActionLocation(
  projectCount: number,
  canCreateProject: boolean
): ProjectCreateActionLocation {
  if (!canCreateProject) {
    return null;
  }

  return projectCount === 0 ? "empty" : "toolbar";
}
