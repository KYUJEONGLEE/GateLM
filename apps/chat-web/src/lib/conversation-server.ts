import { cookies } from 'next/headers';
import { UpstreamResponseError } from '@gatelm/web-bff';

import {
  ConversationContractError,
  safeChatError,
} from './conversation-contract.mjs';
import {
  ConversationBffError,
  conversationJson,
  conversationSse,
} from './conversation-upstream.mjs';
import { COOKIE } from './auth-server';
import { serverEnv } from './server-env';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export async function jsonFromConversationApi<T>(input: Readonly<{
  body?: unknown;
  ifMatch?: string;
  method: Method;
  path: string;
  request: Request;
  shape: (value: unknown) => T;
}>): Promise<Response> {
  try {
    const jar = await cookies();
    const env = serverEnv();
    const result = await conversationJson({
      accessToken: jar.get(COOKIE.access)?.value,
      baseUrl: env.chatApiBaseUrl,
      body: input.body,
      fetchImpl: fetch,
      ifMatch: input.ifMatch,
      method: input.method,
      path: input.path,
      serviceToken: env.serviceToken,
      signal: input.request.signal,
    });
    if (result.status === 204) return new Response(null, { headers: safeHeaders(), status: 204 });
    return Response.json(input.shape(result.payload), { headers: safeHeaders(), status: result.status });
  } catch (error) {
    return conversationError(error);
  }
}

export async function streamFromConversationApi(input: Readonly<{
  body: unknown;
  path: string;
  request: Request;
}>): Promise<Response> {
  try {
    const jar = await cookies();
    const env = serverEnv();
    return await conversationSse({
      accessToken: jar.get(COOKIE.access)?.value,
      baseUrl: env.chatApiBaseUrl,
      body: input.body,
      fetchImpl: fetch,
      path: input.path,
      serviceToken: env.serviceToken,
    });
  } catch (error) {
    return conversationError(error);
  }
}

export function conversationError(error: unknown): Response {
  const known = error instanceof ConversationBffError || error instanceof ConversationContractError || error instanceof UpstreamResponseError;
  const status = known ? error.status : 500;
  const payload = error instanceof ConversationBffError
    ? error.payload
      : error instanceof ConversationContractError
      ? safeChatError({ code: error.code })
      : error instanceof UpstreamResponseError
        ? safeChatError(error.payload)
      : safeChatError({ code: 'CHAT_INTERNAL_ERROR' });
  return Response.json(payload, { headers: safeHeaders(), status });
}

function safeHeaders(): HeadersInit {
  return { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
}
