'use client';

import { Button } from '@gatelm/ui';
import { AlertTriangle, LoaderCircle, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { api, ChatApiError } from '@/lib/browser-api';
import type {
  UsageRankingMetric,
  UsageRankingRange,
  UsageRankingResponse,
  UsageRankingRow,
} from '@/lib/usage-ranking-contract.mjs';

type RankingState = 'idle' | 'loading' | 'ready' | 'error';

export function UsageRankingView({ active }: Readonly<{ active: boolean }>) {
  const [range, setRange] = useState<UsageRankingRange>('30d');
  const [metric, setMetric] = useState<UsageRankingMetric>('cost');
  const [state, setState] = useState<RankingState>('idle');
  const [data, setData] = useState<UsageRankingResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [retryVersion, setRetryVersion] = useState(0);
  const cacheRef = useRef(new Map<string, UsageRankingResponse>());
  const requestRef = useRef<AbortController | null>(null);
  const cacheKey = `${range}:${metric}`;

  useEffect(() => {
    if (!active) return;
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setData(cached);
      setErrorMessage('');
      setState('ready');
      return;
    }
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setData(null);
    setErrorMessage('');
    setState('loading');
    const query = new URLSearchParams({ metric, range });
    void api<UsageRankingResponse>(`/api/tenant-chat/usage-ranking?${query}`, {
      signal: controller.signal,
    }).then((response) => {
      if (controller.signal.aborted) return;
      cacheRef.current.set(cacheKey, response);
      setData(response);
      setState('ready');
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setErrorMessage(
        error instanceof ChatApiError
          ? error.detail.message
          : '사용량 순위를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.',
      );
      setState('error');
    });
    return () => controller.abort();
  }, [active, cacheKey, metric, range, retryVersion]);

  function retry() {
    cacheRef.current.delete(cacheKey);
    setRetryVersion((current) => current + 1);
  }

  const viewerInRanking = data?.viewer?.rank !== null &&
    data?.viewer?.rank !== undefined &&
    data.viewer.rank <= data.items.length;
  const separateViewer = data?.viewer && !viewerInRanking ? data.viewer : null;

  return <section
    aria-busy={state === 'loading'}
    aria-labelledby="usage-ranking-title"
    className="usage-ranking-view"
    hidden={!active}
  >
    <header className="usage-ranking-header">
      <div className="usage-ranking-heading">
        <h2 id="usage-ranking-title">사용량 순위</h2>
        {data && <span>참여 직원 {formatInteger(data.rankedEmployeeCount)}명</span>}
      </div>
      <div className="usage-ranking-filters">
        <fieldset>
          <legend className="sr-only">조회 기간</legend>
          {([
            ['24h', '1일'],
            ['7d', '7일'],
            ['30d', '30일'],
          ] as const).map(([value, label]) => <button
            aria-pressed={range === value}
            key={value}
            onClick={() => setRange(value)}
            type="button"
          >{label}</button>)}
        </fieldset>
        <fieldset>
          <legend className="sr-only">순위 단위</legend>
          {([
            ['cost', '추정 비용'],
            ['tokens', '토큰'],
          ] as const).map(([value, label]) => <button
            aria-pressed={metric === value}
            key={value}
            onClick={() => setMetric(value)}
            type="button"
          >{label}</button>)}
        </fieldset>
      </div>
    </header>

    {metric === 'cost' && <p className="usage-ranking-note">
      GateLM 가격표 기반 추정치이며 토큰은 확정 사용량만 집계합니다.
    </p>}

    <div className="usage-ranking-content" role="region">
      {state === 'loading' && <div className="usage-ranking-status" role="status">
        <LoaderCircle className="spin" size={20} aria-hidden />
        <span>사용량 순위를 불러오는 중…</span>
      </div>}
      {state === 'error' && <div className="usage-ranking-status is-error" role="alert">
        <AlertTriangle size={20} aria-hidden />
        <span>{errorMessage}</span>
        <Button variant="secondary" onClick={retry}>
          <RefreshCw size={15} aria-hidden />다시 시도
        </Button>
      </div>}
      {state === 'ready' && data && <>
        {data.items.length ? <>
          <RankingChart
            items={data.items}
            metric={metric}
            viewerRank={data.viewer?.rank ?? null}
          />
          <section className="usage-ranking-list" aria-labelledby="usage-ranking-list-title">
            <h3 className="usage-ranking-section-title" id="usage-ranking-list-title">전체 순위</h3>
            <div role="table" aria-label="직원 Tenant Chat 전체 사용량 순위">
              <div className="usage-ranking-columns" role="row">
                <span role="columnheader">순위</span>
                <span role="columnheader">직원</span>
                <span role="columnheader">{metric === 'cost' ? '추정 비용' : '확정 토큰'}</span>
              </div>
              <ol role="rowgroup">
                {data.items.map((row) => <RankingRow
                  isViewer={data.viewer?.rank === row.rank}
                  key={row.rank}
                  metric={metric}
                  row={row}
                />)}
              </ol>
            </div>
          </section>
        </> : <div className="usage-ranking-status is-empty" role="status">
          선택한 기간의 Tenant Chat 사용 기록이 없습니다.
        </div>}
        {separateViewer && <section className="usage-ranking-viewer" aria-labelledby="viewer-ranking-title">
          <h3 id="viewer-ranking-title">내 순위</h3>
          <div aria-label="내 Tenant Chat 사용량 순위" role="table">
            <ol role="rowgroup">
              <RankingRow isViewer metric={metric} row={separateViewer} />
            </ol>
          </div>
        </section>}
      </>}
    </div>
  </section>;
}

function RankingChart({
  items,
  metric,
  viewerRank,
}: Readonly<{
  items: readonly UsageRankingRow[];
  metric: UsageRankingMetric;
  viewerRank: number | null;
}>) {
  const chartItems = items.slice(0, 10);
  const values = chartItems.map((row) => rankingValue(row, metric));
  const maximum = Math.max(...values, 1);

  return <section className="usage-ranking-chart" aria-labelledby="usage-ranking-chart-title">
    <div className="usage-ranking-chart-heading">
      <h3 id="usage-ranking-chart-title">상위 10명 사용량 분포</h3>
      <span>{metric === 'cost' ? '추정 비용' : '확정 토큰'}</span>
    </div>
    <ol>
      {chartItems.map((row, index) => {
        const value = values[index] ?? 0;
        const isViewer = viewerRank === row.rank;
        return <li className={isViewer ? 'is-viewer' : ''} key={row.rank}>
          <span
            className="usage-ranking-chart-value"
            title={formatRankingValue(row, metric)}
          >
            {formatCompactRankingValue(row, metric)}
          </span>
          <div className="usage-ranking-chart-track" aria-hidden>
            <span style={{ height: `${rankingBarPercent(value, maximum)}%` }} />
          </div>
          <div className="usage-ranking-chart-label">
            <span className="usage-ranking-chart-rank">{row.rank}위</span>
            <strong title={row.displayName}>{row.displayName}</strong>
            {isViewer && <span className="usage-ranking-me">나</span>}
          </div>
        </li>;
      })}
    </ol>
  </section>;
}

function RankingRow({
  isViewer,
  metric,
  row,
}: Readonly<{
  isViewer: boolean;
  metric: UsageRankingMetric;
  row: Omit<UsageRankingRow, 'rank'> & { rank: number | null };
}>) {
  return <li className={isViewer ? 'is-viewer' : ''} role="row">
    <span className="usage-ranking-rank" role="cell">
      {row.rank === null ? '—' : row.rank}
    </span>
    <div className="usage-ranking-identity" role="cell">
      <strong>{row.displayName}{isViewer && <span className="usage-ranking-me">나</span>}</strong>
      {row.department && <span>{row.department}</span>}
    </div>
    <strong className="usage-ranking-value" role="cell">
      {row.rank === null
        ? '사용 기록 없음'
        : formatRankingValue(row, metric)}
    </strong>
  </li>;
}

function rankingValue(row: UsageRankingRow, metric: UsageRankingMetric): number {
  return metric === 'cost' ? row.estimatedCostMicroUsd : row.confirmedTotalTokens;
}

function rankingBarPercent(value: number, maximum: number): number {
  if (value <= 0 || maximum <= 0) return 0;
  return Math.min(100, Math.max(4, Math.round((value / maximum) * 1_000) / 10));
}

function formatRankingValue(
  row: Pick<UsageRankingRow, 'confirmedTotalTokens' | 'estimatedCostMicroUsd'>,
  metric: UsageRankingMetric,
): string {
  return metric === 'cost'
    ? formatMicroUsd(row.estimatedCostMicroUsd)
    : `${formatInteger(row.confirmedTotalTokens)} 토큰`;
}

function formatCompactRankingValue(
  row: Pick<UsageRankingRow, 'confirmedTotalTokens' | 'estimatedCostMicroUsd'>,
  metric: UsageRankingMetric,
): string {
  if (metric === 'cost') return formatMicroUsd(row.estimatedCostMicroUsd);
  return new Intl.NumberFormat('ko-KR', {
    maximumFractionDigits: 1,
    notation: 'compact',
  }).format(row.confirmedTotalTokens);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(value);
}

function formatMicroUsd(value: number): string {
  const usd = value / 1_000_000;
  if (usd > 0 && usd < 0.0001) return '<$0.0001';
  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    maximumFractionDigits: 4,
    minimumFractionDigits: 2,
    style: 'currency',
  }).format(usd);
}
