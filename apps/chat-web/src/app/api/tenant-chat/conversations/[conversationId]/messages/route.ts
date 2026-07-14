import {
  conversationId,
  messagePage,
  parsePageQuery,
} from '@/lib/conversation-contract.mjs';
import { conversationError, jsonFromConversationApi } from '@/lib/conversation-server';

type Context = Readonly<{ params: Promise<{ conversationId: string }> }>;

export async function GET(request: Request, context: Context) {
  try {
    const id = conversationId((await context.params).conversationId);
    const query = parsePageQuery(request.url, 100, 50);
    const search = new URLSearchParams({ limit: String(query.limit) });
    if (query.cursor) search.set('cursor', query.cursor);
    return jsonFromConversationApi({
      method: 'GET',
      path: `/internal/v1/tenant-chat/conversations/${id}/messages?${search}`,
      request,
      shape: messagePage,
    });
  } catch (error) {
    return conversationError(error);
  }
}
