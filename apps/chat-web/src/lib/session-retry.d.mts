export function fetchWithSessionRefresh(
  url: string,
  init: RequestInit | undefined,
  options: Readonly<{
    fetchImpl: typeof fetch;
    prepare: (init: RequestInit | undefined) => RequestInit;
  }>,
): Promise<Response>;
