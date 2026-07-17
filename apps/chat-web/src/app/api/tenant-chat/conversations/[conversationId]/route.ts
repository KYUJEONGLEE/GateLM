import { cookies } from 'next/headers';

import {
  assertNoQuery,
  conversationId,
  conversationView,
  parseIfMatch,
  updateConversationBody,
} from '@/lib/conversation-contract.mjs';
import { conversationError, jsonFromConversationApi } from '@/lib/conversation-server';
import { secureEmptyMutation, secureJson } from '@/lib/route-security';

type Context = Readonly<{ params: Promise<{ conversationId: string }> }>;

export async function GET(request: Request, context: Context) {
  try {
    assertNoQuery(request.url);
    const id = conversationId((await context.params).conversationId);
    return jsonFromConversationApi({
      method: 'GET', path: upstream(id), request, shape: conversationView,
    });
  } catch (error) {
    return conversationError(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    assertNoQuery(request.url);
    const id = conversationId((await context.params).conversationId);
    const body = updateConversationBody(await secureJson(request, await cookies()));
    return jsonFromConversationApi({ body, method: 'PATCH', path: upstream(id), request, shape: conversationView });
  } catch (error) {
    return conversationError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    assertNoQuery(request.url);
    const id = conversationId((await context.params).conversationId);
    await secureEmptyMutation(request, await cookies());
    const version = parseIfMatch(request.headers.get('if-match'));
    return jsonFromConversationApi({
      ifMatch: `"${version}"`,
      method: 'DELETE',
      path: upstream(id),
      request,
      shape: () => null,
    });
  } catch (error) {
    return conversationError(error);
  }
}

function upstream(id: string): string {
  return `/internal/v1/tenant-chat/conversations/${id}`;
}
