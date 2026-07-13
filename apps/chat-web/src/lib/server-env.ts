function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function origin(name: string): string {
  const value = required(name);
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/') {
    throw new Error(`${name} must be an http(s) origin without credentials or path.`);
  }
  return url.origin;
}

export function serverEnv() {
  const serviceToken = required('TENANT_CHAT_WEB_SERVICE_TOKEN');
  if (serviceToken.length < 32 || /placeholder|replace-me/i.test(serviceToken)) {
    throw new Error('TENANT_CHAT_WEB_SERVICE_TOKEN must be a strong non-placeholder value.');
  }
  return {
    chatApiBaseUrl: origin('TENANT_CHAT_API_BASE_URL'),
    chatWebOrigin: origin('GATELM_CHAT_WEB_ORIGIN'),
    production: process.env.NODE_ENV === 'production',
    serviceToken,
  };
}
