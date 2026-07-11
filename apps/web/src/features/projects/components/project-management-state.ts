export type ProjectCreateActionLocation = "empty" | "toolbar" | null;

export function isProjectVisibleInList(status: string) {
  return status !== "ARCHIVED";
}

export function compareProjectCreatedAtDescending(
  left: { createdAt: string },
  right: { createdAt: string }
) {
  const leftTime = Date.parse(left.createdAt);
  const rightTime = Date.parse(right.createdAt);

  if (Number.isNaN(leftTime)) {
    return Number.isNaN(rightTime) ? 0 : 1;
  }

  if (Number.isNaN(rightTime)) {
    return -1;
  }

  return rightTime - leftTime;
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
