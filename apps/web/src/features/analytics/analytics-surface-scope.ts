export type AnalyticsSurfaceScope = "all" | "project_application";

export function resolveAnalyticsSurfaceScope(input: {
  projectId: string;
  projectScoped: boolean;
}): AnalyticsSurfaceScope {
  return !input.projectScoped && input.projectId.trim() === ""
    ? "all"
    : "project_application";
}
