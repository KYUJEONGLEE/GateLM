import { cookies } from 'next/headers';

import {
  assertNoQuery,
  conversationPage,
  conversationView,
  createConversationBody,
  parsePageQuery,
} from '@/lib/conversation-contract.mjs';
import { conversationError, jsonFromConversationApi } from '@/lib/conversation-server';
import { secureJson } from '@/lib/route-security';

const UPSTREAM = '/internal/v1/tenant-chat/conversations';

export async function GET(request: Request) {
  try {
    const query = parsePageQuery(request.url, 50, 20);
    const search = new URLSearchParams({ limit: String(query.limit) });
    if (query.cursor) search.set('cursor', query.cursor);
    return jsonFromConversationApi({
      method: 'GET',
      path: `${UPSTREAM}?${search}`,
      request,
      shape: conversationPage,
    });
  } catch (error) {
    return conversationError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertNoQuery(request.url);
    const body = createConversationBody(await secureJson(request, await cookies()));
    return jsonFromConversationApi({ body, method: 'POST', path: UPSTREAM, request, shape: conversationView });
  } catch (error) {
    return conversationError(error);
  }
}
