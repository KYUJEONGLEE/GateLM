import type { SafeChatError } from './conversation-contract.mjs';

export class UsageRankingBffError extends Error {
  readonly status: number;
  readonly payload: SafeChatError;
  constructor(status: number, payload: unknown);
}

export function usageRankingJson(input: Readonly<{
  accessToken?: string;
  baseUrl: string;
  fetchImpl: typeof fetch;
  path: string;
  serviceToken: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}>): Promise<Readonly<{ payload: unknown; status: number }>>;
