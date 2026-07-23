import { parseUsageRankingResponse } from './usage-ranking.contract';

describe('usage ranking contract', () => {
  it('accepts only the bounded safe ranking response', () => {
    expect(parseUsageRankingResponse(response())).toEqual(response());
  });

  it('rejects employee identifiers, email, and provider details', () => {
    for (const extra of [
      { employeeId: 'employee-id' },
      { email: 'employee@example.test' },
      { provider: 'openai' },
    ]) {
      expect(() => parseUsageRankingResponse({
        ...response(),
        items: [{ ...response().items[0], ...extra }],
      })).toThrow('invalid_usage_ranking_response');
    }
  });

  it('rejects oversized lists and ranks outside the participant count', () => {
    expect(() => parseUsageRankingResponse({
      ...response(),
      items: Array.from({ length: 21 }, () => response().items[0]),
    })).toThrow('invalid_usage_ranking_response');
    expect(() => parseUsageRankingResponse({
      ...response(),
      items: [{ ...response().items[0], rank: 3 }],
      rankedEmployeeCount: 2,
    })).toThrow('invalid_usage_ranking_response');
  });
});

function response() {
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
  } as const;
}
