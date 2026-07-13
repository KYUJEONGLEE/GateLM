export function getChatOrigin() {
  const configuredOrigin = process.env.GATELM_CHAT_WEB_ORIGIN ?? "http://chat.localhost:3002";

  return configuredOrigin.replace(/\/+$/, "");
}

export function getChatUrl(path = "/") {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return `${getChatOrigin()}${normalizedPath}`;
}
