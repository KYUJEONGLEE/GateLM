export async function fetchWithSessionRefresh(url, init, options) {
  const response = await options.fetchImpl(url, options.prepare(init));
  if (response.status !== 401 || !url.startsWith('/api/tenant-chat/conversations')) return response;
  const refreshed = await options.fetchImpl('/api/tenant-chat/auth/session', options.prepare({ method: 'GET' }));
  if (!refreshed.ok) {
    await refreshed.body?.cancel().catch(() => undefined);
    return response;
  }
  await Promise.allSettled([
    response.body?.cancel(),
    refreshed.body?.cancel(),
  ]);
  return options.fetchImpl(url, options.prepare(init));
}
