import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  usageRankingQuery,
  usageRankingResponse,
} from './src/lib/usage-ranking-contract.mjs';
import {
  UsageRankingBffError,
  usageRankingJson,
} from './src/lib/usage-ranking-upstream.mjs';

test('ranking query accepts only bounded range and metric filters', () => {
  assert.deepEqual(
    usageRankingQuery('https://chat.example.test/api/tenant-chat/usage-ranking'),
    { metric: 'cost', range: '30d' },
  );
  assert.deepEqual(
    usageRankingQuery('https://chat.example.test/api/tenant-chat/usage-ranking?range=7d&metric=tokens'),
    { metric: 'tokens', range: '7d' },
  );
  for (const query of [
    '?tenantId=tenant-id',
    '?employeeId=employee-id',
    '?source=tenant_chat',
    '?order=asc',
    '?from=2026-01-01T00%3A00%3A00.000Z',
    '?range=1y',
    '?metric=requests',
    '?range=7d&range=30d',
  ]) {
    assert.throws(
      () => usageRankingQuery(`https://chat.example.test/api/tenant-chat/usage-ranking${query}`),
      /Invalid usage ranking contract/,
    );
  }
});

test('ranking response excludes unknown identity and provider fields', () => {
  assert.deepEqual(usageRankingResponse(ranking()), ranking());
  for (const extra of [
    { email: 'employee@example.test' },
    { employeeId: 'employee-id' },
    { model: 'private-model' },
  ]) {
    assert.throws(
      () => usageRankingResponse({
        ...ranking(),
        items: [{ ...ranking().items[0], ...extra }],
      }),
      /Invalid usage ranking contract/,
    );
  }
});

test('ranking upstream injects fixed credentials without browser scope headers', async () => {
  let request;
  const result = await usageRankingJson({
    accessToken: 'access-token',
    baseUrl: 'https://chat-api.example.test',
    fetchImpl: async (url, init) => {
      request = { init, url: String(url) };
      return Response.json(ranking());
    },
    path: '/internal/v1/tenant-chat/usage-ranking?range=30d&metric=cost',
    serviceToken: 'service-token',
  });

  assert.equal(result.status, 200);
  assert.equal(
    request.url,
    'https://chat-api.example.test/internal/v1/tenant-chat/usage-ranking?range=30d&metric=cost',
  );
  const headers = new Headers(request.init.headers);
  assert.equal(headers.get('x-gatelm-chat-access'), 'access-token');
  assert.equal(headers.get('x-gatelm-chat-web-service-token'), 'service-token');
  assert.equal(headers.has('x-gatelm-tenant-id'), false);
  assert.equal(headers.has('x-gatelm-employee-id'), false);
});

test('ranking upstream fails closed on another internal path and transport errors', async () => {
  await assert.rejects(
    usageRankingJson({
      accessToken: 'access-token',
      baseUrl: 'https://chat-api.example.test',
      fetchImpl: async () => Response.json(ranking()),
      path: '/internal/v1/tenant-chat/conversations?range=30d',
      serviceToken: 'service-token',
    }),
    (error) => error instanceof UsageRankingBffError && error.status === 500,
  );
  await assert.rejects(
    usageRankingJson({
      accessToken: 'access-token',
      baseUrl: 'https://chat-api.example.test',
      fetchImpl: async () => { throw new Error('private transport detail'); },
      path: '/internal/v1/tenant-chat/usage-ranking?range=30d&metric=cost',
      serviceToken: 'service-token',
    }),
    (error) =>
      error instanceof UsageRankingBffError &&
      error.status === 503 &&
      error.payload.code === 'CHAT_USAGE_UNAVAILABLE',
  );
});

test('ranking upstream aborts a timed-out read and returns only the safe error', async () => {
  await assert.rejects(
    usageRankingJson({
      accessToken: 'access-token',
      baseUrl: 'https://chat-api.example.test',
      fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('private timeout')), { once: true });
      }),
      path: '/internal/v1/tenant-chat/usage-ranking?range=30d&metric=cost',
      serviceToken: 'service-token',
      timeoutMs: 1,
    }),
    (error) =>
      error instanceof UsageRankingBffError &&
      error.status === 503 &&
      error.payload.code === 'CHAT_USAGE_UNAVAILABLE',
  );
});

test('ranking view caches filters, aborts stale reads, and keeps ChatShell mounted', () => {
  const rankingView = readFileSync(
    new URL('./src/components/usage-ranking-view.tsx', import.meta.url),
    'utf8',
  );
  const chatShell = readFileSync(
    new URL('./src/components/chat-shell.tsx', import.meta.url),
    'utf8',
  );
  assert.match(rankingView, /cacheRef\.current\.get\(cacheKey\)/);
  assert.match(rankingView, /requestRef\.current\?\.abort\(\)/);
  assert.match(rankingView, /return \(\) => controller\.abort\(\)/);
  assert.doesNotMatch(rankingView, /setInterval|setTimeout/);
  assert.match(chatShell, /hidden=\{activeView !== 'chat'\}/);
  assert.match(chatShell, /<UsageRankingView active=\{activeView === 'usage-ranking'\} \/>/);
});

function ranking() {
  return {
    items: [{
      confirmedTotalTokens: 120,
      department: '플랫폼',
      displayName: '홍길동',
      estimatedCostMicroUsd: 35,
      rank: 1,
    }],
    metric: 'cost',
    period: {
      from: '2026-06-23T12:00:00.000Z',
      timezone: 'UTC',
      to: '2026-07-23T12:00:00.000Z',
    },
    provenance: {
      generatedAt: '2026-07-23T12:00:00.000Z',
      lastSourceAt: '2026-07-23T11:59:00.000Z',
      source: 'raw',
    },
    range: '30d',
    rankedEmployeeCount: 1,
    viewer: {
      confirmedTotalTokens: 120,
      department: '플랫폼',
      displayName: '홍길동',
      estimatedCostMicroUsd: 35,
      rank: 1,
    },
  };
}
