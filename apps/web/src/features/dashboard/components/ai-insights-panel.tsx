"use client";

import { RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildMockAiInsights,
  type AiInsightCategory,
  type AiInsightLevel,
  type AiInsightMode,
  type AiInsightPriority,
  type AiInsightResponse,
  type AiInsightsRequest,
  isAiInsightResponse,
  toAiInsightsRecentRequests
} from "@/lib/dashboard/ai-insights-types";
import type { LiveRequestRow } from "@/lib/gateway/live-requests-types";

export type AiInsightsPanelProps = {
  averageLatencyMs: number;
  cacheHitRate: number;
  monthToDateSpendMicroUsd: number;
  p95LatencyMs?: number;
  projectId: string | null;
  projectName: string | null;
  rangeLabel: string;
  recentRequests?: LiveRequestRow[];
  successRate: number;
  totalRequests: number;
};

const insightLevelLabels: Record<AiInsightLevel, string> = {
  High: "높음",
  Low: "낮음",
  Medium: "보통"
};

const recommendationCategoryLabels: Record<AiInsightCategory, string> = {
  Cache: "캐시",
  Cost: "비용",
  Reliability: "안정성",
  Routing: "라우팅",
  Safety: "안전"
};

const recommendationPriorityLabels: Record<AiInsightPriority, string> = {
  High: "높음",
  Low: "낮음",
  Medium: "보통"
};

const modeLabels: Record<AiInsightMode, string> = {
  fallback: "FALLBACK",
  live: "LIVE",
  mock: "MOCK"
};

export function AiInsightsPanel({
  averageLatencyMs,
  cacheHitRate,
  monthToDateSpendMicroUsd,
  p95LatencyMs,
  projectId,
  projectName,
  rangeLabel,
  recentRequests,
  successRate,
  totalRequests
}: AiInsightsPanelProps) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const analysisRequest = useMemo<AiInsightsRequest>(
    () => ({
      projectId,
      projectName,
      recentRequests: toAiInsightsRecentRequests(recentRequests),
      summary: {
        avgLatencyMs: averageLatencyMs,
        cacheHitRate,
        monthToDateSpendUsd: monthToDateSpendMicroUsd / 1_000_000,
        p95LatencyMs,
        successRate,
        totalRequests
      },
      timeRange: rangeLabel
    }),
    [
      averageLatencyMs,
      cacheHitRate,
      monthToDateSpendMicroUsd,
      p95LatencyMs,
      projectId,
      projectName,
      rangeLabel,
      recentRequests,
      successRate,
      totalRequests
    ]
  );
  const initialPreview = useMemo(
    () => buildMockAiInsights(analysisRequest, { generatedAt: "" }),
    [analysisRequest]
  );
  const [insight, setInsight] = useState<AiInsightResponse>(() => initialPreview);

  useEffect(() => {
    setInsight(buildMockAiInsights(analysisRequest));
    setError(null);
    abortRef.current?.abort();
  }, [analysisRequest]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function analyzeAgain() {
    if (isAnalyzing || totalRequests <= 0) {
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsAnalyzing(true);
    setError(null);

    try {
      const response = await fetch("/api/dashboard/ai-insights", {
        body: JSON.stringify(analysisRequest),
        cache: "no-store",
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST",
        signal: controller.signal
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || !isAiInsightResponse(payload)) {
        throw new Error("ai_insights_unavailable");
      }

      setInsight(payload);
    } catch (requestError) {
      if (controller.signal.aborted) {
        return;
      }

      setError("AI 분석을 불러오지 못해 안전한 fallback을 표시합니다.");
      setInsight(
        buildMockAiInsights(analysisRequest, {
          generatedAt: new Date().toISOString(),
          mode: "fallback",
          notes: ["AI Insights endpoint failed. Showing client-side fallback insight."]
        })
      );
      console.warn("AI insights request failed", {
        reason: requestError instanceof Error ? requestError.message : "unknown"
      });
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setIsAnalyzing(false);
    }
  }

  return (
    <section className="dashboard-ai-insights-panel" aria-label="AI 인사이트">
      <div className="dashboard-ai-insights-header">
        <div>
          <span className="dashboard-ai-insights-eyebrow">
            <Sparkles aria-hidden="true" size={15} strokeWidth={2.3} />
            Gateway AI
          </span>
          <h2>AI 인사이트</h2>
          <p>집계 지표 기반 운영 분석</p>
        </div>
        <span className="dashboard-ai-insights-badge" data-mode={insight.mode}>
          {modeLabels[insight.mode]}
        </span>
      </div>

      <button
        className="dashboard-ai-insights-analyze"
        disabled={isAnalyzing || totalRequests <= 0}
        onClick={analyzeAgain}
        type="button"
      >
        <RefreshCw aria-hidden="true" data-spinning={isAnalyzing} size={15} strokeWidth={2.3} />
        <span>{isAnalyzing ? "분석 중..." : "분석"}</span>
      </button>

      {totalRequests <= 0 ? (
        <AiInsightsEmptyState generatedAt={insight.generatedAt} />
      ) : (
        <div className="dashboard-ai-insights-content">
          {error ? <div className="dashboard-ai-insights-warning">{error}</div> : null}

          <section className="dashboard-ai-insights-summary" aria-label="AI 인사이트 요약">
            <h3>요약</h3>
            <p>{insight.summary}</p>
          </section>

          <section className="dashboard-ai-insights-section" aria-label="핵심 신호">
            <div className="dashboard-ai-insights-section-title">
              <h3>핵심 신호</h3>
              <span>{formatRangeDisplayLabel(rangeLabel)}</span>
            </div>
            <div className="dashboard-ai-signal-list">
              {insight.signals.map((signal) => (
                <div className="dashboard-ai-signal-row" key={`${signal.label}-${signal.level}`}>
                  <span title={signal.reason ? `${signal.label}: ${signal.reason}` : signal.label}>
                    {signal.label}
                  </span>
                  <strong data-level={signal.level}>{insightLevelLabels[signal.level]}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="dashboard-ai-insights-section" aria-label="권장 조치">
            <h3>권장 조치</h3>
            <ol className="dashboard-ai-recommendation-list">
              {insight.recommendations.map((recommendation) => (
                <li key={`${recommendation.category}-${recommendation.text}`}>
                  <span data-category={recommendation.category}>
                    {recommendationCategoryLabels[recommendation.category]}
                  </span>
                  <p>
                    <strong data-priority={recommendation.priority}>
                      {recommendationPriorityLabels[recommendation.priority]}
                    </strong>
                    {recommendation.text}
                  </p>
                </li>
              ))}
            </ol>
          </section>

          <section className="dashboard-ai-policy-draft" aria-label="정책 초안 제안">
            <h3>정책 초안 제안</h3>
            <ul>
              {insight.policyDraft.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </div>
      )}

      <footer className="dashboard-ai-insights-footer">
        <span>{footerModeText(insight.mode)}</span>
        <GeneratedAtTime generatedAt={insight.generatedAt} />
      </footer>
    </section>
  );
}

function AiInsightsEmptyState({ generatedAt }: { generatedAt: string }) {
  return (
    <div className="dashboard-ai-insights-empty">
      <strong>아직 분석할 데이터가 부족합니다</strong>
      <p>Gateway 요청을 몇 개 보내면 AI 인사이트를 생성할 수 있습니다.</p>
      <ul>
        <li>Gateway로 테스트 요청을 보내세요.</li>
        <li>트래픽 생성 후 Live Requests 영역을 확인하세요.</li>
        <li>최근 요청이 쌓이면 분석 버튼으로 인사이트를 갱신하세요.</li>
      </ul>
      <GeneratedAtTime generatedAt={generatedAt} />
    </div>
  );
}

function GeneratedAtTime({ generatedAt }: { generatedAt: string }) {
  if (!generatedAt) {
    return <span>분석 대기</span>;
  }

  const date = new Date(generatedAt);
  if (Number.isNaN(date.getTime())) {
    return <span>분석 시각 없음</span>;
  }

  return <time dateTime={generatedAt}>{formatGeneratedAt(date)}</time>;
}

function footerModeText(mode: AiInsightMode) {
  if (mode === "live") {
    return "실제 AI 분석";
  }

  if (mode === "fallback") {
    return "fallback 인사이트";
  }

  return "mock preview";
}

function formatRangeDisplayLabel(value: string) {
  if (value === "Last 15 minutes") {
    return "최근 15분";
  }

  if (value === "Last hour") {
    return "최근 1시간";
  }

  if (value === "Last 24 hours") {
    return "최근 24시간";
  }

  if (value === "Last 7 days") {
    return "최근 7일";
  }

  return value;
}

function formatGeneratedAt(value: Date) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Seoul"
  }).format(value);
}
