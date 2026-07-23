const LOCAL_BROWSER_ALIASES = new Set(['localhost', '127.0.0.1', '[::1]']);
const CANONICAL_LOCAL_HOSTNAME = 'chat.localhost';

export function canonicalLocalBrowserUrl(requestUrl, configuredOrigin, incomingHost) {
  try {
    const request = browserRequestUrl(requestUrl, incomingHost);
    if (!LOCAL_BROWSER_ALIASES.has(request.hostname)) return null;

    const canonical = configuredOrigin
      ? new URL(configuredOrigin)
      : new URL(request.origin);
    if (configuredOrigin) {
      if (
        !canonical.hostname.endsWith('.localhost') ||
        request.protocol !== canonical.protocol ||
        request.port !== canonical.port
      ) {
        return null;
      }
    } else {
      canonical.hostname = CANONICAL_LOCAL_HOSTNAME;
    }

    canonical.pathname = request.pathname;
    canonical.search = request.search;
    canonical.hash = '';
    return canonical.toString();
  } catch {
    return null;
  }
}

function browserRequestUrl(requestUrl, incomingHost) {
  const request = new URL(requestUrl);
  if (!incomingHost) return request;

  const browserOrigin = new URL(`${request.protocol}//${incomingHost}`);
  if (
    browserOrigin.username ||
    browserOrigin.password ||
    browserOrigin.pathname !== '/' ||
    browserOrigin.search ||
    browserOrigin.hash
  ) {
    throw new Error('Invalid browser host');
  }

  request.host = browserOrigin.host;
  return request;
}
