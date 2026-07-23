import { cookies } from 'next/headers';

import { COOKIE } from './auth-server';
import { safeChatError } from './conversation-contract.mjs';
import {
  UsageRankingContractError,
  usageRankingResponse,
} from './usage-ranking-contract.mjs';
import {
  UsageRankingBffError,
  usageRankingJson,
} from './usage-ranking-upstream.mjs';
import { serverEnv } from './server-env';

export async function usageRankingFromApi(input: Readonly<{
  metric: 'cost' | 'tokens';
  range: '24h' | '7d' | '30d';
  request: Request;
}>): Promise<Response> {
  try {
    const jar = await cookies();
    const env = serverEnv();
    const query = new URLSearchParams({
      metric: input.metric,
      range: input.range,
    });
    const result = await usageRankingJson({
      accessToken: jar.get(COOKIE.access)?.value,
      baseUrl: env.chatApiBaseUrl,
      fetchImpl: fetch,
      path: `/internal/v1/tenant-chat/usage-ranking?${query}`,
      serviceToken: env.serviceToken,
      signal: input.request.signal,
    });
    let payload;
    try {
      payload = usageRankingResponse(result.payload);
    } catch (error) {
      if (error instanceof UsageRankingContractError) {
        throw new UsageRankingBffError(503, { code: 'CHAT_USAGE_UNAVAILABLE' });
      }
      throw error;
    }
    return Response.json(payload, {
      headers: safeHeaders(),
      status: result.status,
    });
  } catch (error) {
    return usageRankingError(error);
  }
}

export function usageRankingError(error: unknown): Response {
  if (error instanceof UsageRankingBffError) {
    return Response.json(error.payload, {
      headers: safeHeaders(),
      status: error.status,
    });
  }
  if (error instanceof UsageRankingContractError) {
    return Response.json(safeChatError({ code: error.code }), {
      headers: safeHeaders(),
      status: error.status,
    });
  }
  return Response.json(safeChatError({ code: 'CHAT_INTERNAL_ERROR' }), {
    headers: safeHeaders(),
    status: 500,
  });
}

function safeHeaders(): HeadersInit {
  return {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
}
