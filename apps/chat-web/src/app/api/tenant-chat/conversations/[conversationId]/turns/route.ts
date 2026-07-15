import { cookies } from 'next/headers';

import {
  assertNoQuery,
  conversationId,
  createTurnBody,
} from '@/lib/conversation-contract.mjs';
import { conversationError, streamFromConversationApi } from '@/lib/conversation-server';
import { secureJson } from '@/lib/route-security';

type Context = Readonly<{ params: Promise<{ conversationId: string }> }>;

export async function POST(request: Request, context: Context) {
  try {
    assertNoQuery(request.url);
    const id = conversationId((await context.params).conversationId);
    const body = createTurnBody(await secureJson(request, await cookies(), 96 * 1024));
    return streamFromConversationApi({
      body,
      path: `/internal/v1/tenant-chat/conversations/${id}/turns`,
      request,
    });
  } catch (error) {
    return conversationError(error);
  }
}
