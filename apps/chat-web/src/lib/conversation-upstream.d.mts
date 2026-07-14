import type { SafeChatError } from './conversation-contract.mjs';

type Input = Readonly<{
  accessToken?: string;
  baseUrl: string;
  body?: unknown;
  fetchImpl: typeof fetch;
  ifMatch?: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  serviceToken: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}>;

export class ConversationBffError extends Error { status: number; payload: SafeChatError }
export function conversationJson(input: Input): Promise<Readonly<{ payload: unknown; status: number }>>;
export function conversationSse(input: Omit<Input, 'method'> & { body: unknown }): Promise<Response>;
