export function getApplicationOrigin() {
  const configuredOrigin =
    process.env.GATELM_APPLICATION_BASE_URL ??
    process.env.NEXT_PUBLIC_GATELM_APPLICATION_BASE_URL ??
    "http://localhost:3002";

  return configuredOrigin.replace(/\/+$/, "");
}

export function getApplicationUrl(path = "/") {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return `${getApplicationOrigin()}${normalizedPath}`;
}
