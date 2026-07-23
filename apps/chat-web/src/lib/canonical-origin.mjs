const LOCAL_BROWSER_ALIASES = new Set(['localhost', '127.0.0.1', '[::1]']);

export function canonicalLocalBrowserUrl(requestUrl, configuredOrigin) {
  if (!configuredOrigin) return null;

  try {
    const request = new URL(requestUrl);
    const canonical = new URL(configuredOrigin);
    if (
      !canonical.hostname.endsWith('.localhost') ||
      !LOCAL_BROWSER_ALIASES.has(request.hostname) ||
      request.protocol !== canonical.protocol ||
      request.port !== canonical.port
    ) {
      return null;
    }

    canonical.pathname = request.pathname;
    canonical.search = request.search;
    canonical.hash = '';
    return canonical.toString();
  } catch {
    return null;
  }
}
