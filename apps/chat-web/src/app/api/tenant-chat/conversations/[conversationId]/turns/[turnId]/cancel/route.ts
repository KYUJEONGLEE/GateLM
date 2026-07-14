import { cookies } from 'next/headers';

import {
  assertNoQuery,
  cancelResult,
  conversationId,
  turnId,
} from '@/lib/conversation-contract.mjs';
import { conversationError, jsonFromConversationApi } from '@/lib/conversation-server';
import { secureEmptyMutation } from '@/lib/route-security';

type Context = Readonly<{ params: Promise<{ conversationId: string; turnId: string }> }>;

export async function POST(request: Request, context: Context) {
  try {
    assertNoQuery(request.url);
    const params = await context.params;
    const conversation = conversationId(params.conversationId);
    const turn = turnId(params.turnId);
    await secureEmptyMutation(request, await cookies());
    return jsonFromConversationApi({
      method: 'POST',
      path: `/internal/v1/tenant-chat/conversations/${conversation}/turns/${turn}/cancel`,
      request,
      shape: cancelResult,
    });
  } catch (error) {
    return conversationError(error);
  }
}
