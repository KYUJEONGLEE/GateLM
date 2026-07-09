import "server-only";

export function isProductionLikeEnv(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (env.NODE_ENV === "production") {
    return true;
  }

  if (
    env.AWS_EXECUTION_ENV ||
    env.ECS_CONTAINER_METADATA_URI ||
    env.ECS_CONTAINER_METADATA_URI_V4
  ) {
    return true;
  }

  const deploymentEnv = (
    env.GATELM_DEPLOYMENT_ENV ??
    env.WEB_DEPLOYMENT_ENV ??
    env.DEPLOYMENT_ENV ??
    env.APP_ENV ??
    ""
  )
    .trim()
    .toLowerCase();

  return [
    "aws",
    "aws-triage",
    "prod",
    "production",
    "release",
    "selfhost",
    "staging",
    "stage"
  ].includes(deploymentEnv);
}
