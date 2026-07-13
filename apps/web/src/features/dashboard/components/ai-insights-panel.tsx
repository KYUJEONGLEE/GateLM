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
import type { Locale } from "@/lib/i18n/locale";

export type AiInsightsPanelProps = {
  averageLatencyMs: number;
  cacheHitRate: number;
  locale: Locale;
  monthToDateSpendMicroUsd: number;
  p95LatencyMs?: number;
  projectId: string | null;
  projectName: string | null;
  rangeLabel: string;
  recentRequests?: LiveRequestRow[];
  successRate: number;
  tenantId: string;
  totalRequests: number;
};

const insightLevelLabels: Record<Locale, Record<AiInsightLevel, string>> = {
  en: { High: "High", Low: "Low", Medium: "Medium" },
  ko: { High: "높음", Low: "낮음", Medium: "보통" }
};

const recommendationCategoryLabels: Record<Locale, Record<AiInsightCategory, string>> = {
  en: { Cache: "Cache", Cost: "Cost", Reliability: "Reliability", Routing: "Routing", Safety: "Safety" },
  ko: { Cache: "캐시", Cost: "비용", Reliability: "안정성", Routing: "라우팅", Safety: "안전" }
};

const recommendationPriorityLabels: Record<Locale, Record<AiInsightPriority, string>> = {
  en: { High: "High", Low: "Low", Medium: "Medium" },
  ko: { High: "높음", Low: "낮음", Medium: "보통" }
};

const aiInsightsText = {
  en: {
    analyze: "Analyze",
    analyzing: "Analyzing...",
    aria: "AI insights",
    empty: "Not enough data to analyze yet",
    emptyBody: "Send a few Gateway requests to generate AI insights.",
    emptySteps: [
      "Send test requests through the Gateway.",
      "Review the Live Requests section after generating traffic.",
      "Refresh insights once recent requests are available."
    ],
    error: "AI analysis is unavailable. Showing a safe fallback.",
    keySignals: "Key signals",
    pending: "Waiting for analysis",
    policyDraft: "Policy draft suggestions",
    recommendations: "Recommended actions",
    subtitle: "Operational analysis from aggregate metrics",
    summary: "Summary",
    timeUnavailable: "Analysis time unavailable",
    title: "AI insights"
  },
  ko: {
    analyze: "분석",
    analyzing: "분석 중...",
    aria: "AI 인사이트",
    empty: "아직 분석할 데이터가 부족합니다",
    emptyBody: "Gateway 요청을 몇 개 보내면 AI 인사이트를 생성할 수 있습니다.",
    emptySteps: [
      "Gateway로 테스트 요청을 보내세요.",
      "트래픽 생성 후 실시간 요청 영역을 확인하세요.",
      "최근 요청이 쌓이면 분석 버튼으로 인사이트를 갱신하세요."
    ],
    error: "AI 분석을 불러오지 못해 안전한 대체 인사이트를 표시합니다.",
    keySignals: "핵심 신호",
    pending: "분석 대기",
    policyDraft: "정책 초안 제안",
    recommendations: "권장 조치",
    subtitle: "집계 지표 기반 운영 분석",
    summary: "요약",
    timeUnavailable: "분석 시각 없음",
    title: "AI 인사이트"
  }
} satisfies Record<Locale, unknown>;

const modeLabels: Record<AiInsightMode, string> = {
  fallback: "FALLBACK",
  live: "LIVE",
  mock: "MOCK"
};

export function AiInsightsPanel({
  averageLatencyMs,
  cacheHitRate,
  locale,
  monthToDateSpendMicroUsd,
  p95LatencyMs,
  projectId,
  projectName,
  rangeLabel,
  recentRequests,
  successRate,
  tenantId,
  totalRequests
}: AiInsightsPanelProps) {
  const text = aiInsightsText[locale];
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
      tenantId,
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
      tenantId,
      totalRequests
    ]
  );
  const initialPreview = useMemo(
    () => buildMockAiInsights(analysisRequest, { generatedAt: "", locale }),
    [analysisRequest, locale]
  );
  const [insight, setInsight] = useState<AiInsightResponse>(() => initialPreview);

  useEffect(() => {
    setInsight(buildMockAiInsights(analysisRequest, { locale }));
    setError(null);
    abortRef.current?.abort();
  }, [analysisRequest, locale]);

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

      setError(text.error);
      setInsight(
        buildMockAiInsights(analysisRequest, {
          generatedAt: new Date().toISOString(),
          locale,
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
    <section className="dashboard-ai-insights-panel" aria-label={text.aria}>
      <div className="dashboard-ai-insights-header">
        <div>
          <span className="dashboard-ai-insights-eyebrow">
            <Sparkles aria-hidden="true" size={15} strokeWidth={2.3} />
            Gateway AI
          </span>
          <h2>{text.title}</h2>
          <p>{text.subtitle}</p>
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
        <span>{isAnalyzing ? text.analyzing : text.analyze}</span>
      </button>

      {totalRequests <= 0 ? (
        <AiInsightsEmptyState generatedAt={insight.generatedAt} locale={locale} />
      ) : (
        <div className="dashboard-ai-insights-content">
          {error ? <div className="dashboard-ai-insights-warning">{error}</div> : null}

          <section className="dashboard-ai-insights-summary" aria-label={`${text.title} ${text.summary}`}>
            <h3>{text.summary}</h3>
            <p>{insight.summary}</p>
          </section>

          <section className="dashboard-ai-insights-section" aria-label={text.keySignals}>
            <div className="dashboard-ai-insights-section-title">
              <h3>{text.keySignals}</h3>
              <span>{formatRangeDisplayLabel(rangeLabel, locale)}</span>
            </div>
            <div className="dashboard-ai-signal-list">
              {insight.signals.map((signal) => (
                <div className="dashboard-ai-signal-row" key={`${signal.label}-${signal.level}`}>
                  <span title={signal.reason ? `${signal.label}: ${signal.reason}` : signal.label}>
                    {signal.label}
                  </span>
                  <strong data-level={signal.level}>{insightLevelLabels[locale][signal.level]}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="dashboard-ai-insights-section" aria-label={text.recommendations}>
            <h3>{text.recommendations}</h3>
            <ol className="dashboard-ai-recommendation-list">
              {insight.recommendations.map((recommendation) => (
                <li key={`${recommendation.category}-${recommendation.text}`}>
                  <span data-category={recommendation.category}>
                    {recommendationCategoryLabels[locale][recommendation.category]}
                  </span>
                  <p>
                    <strong data-priority={recommendation.priority}>
                      {recommendationPriorityLabels[locale][recommendation.priority]}
                    </strong>
                    {recommendation.text}
                  </p>
                </li>
              ))}
            </ol>
          </section>

          <section className="dashboard-ai-policy-draft" aria-label={text.policyDraft}>
            <h3>{text.policyDraft}</h3>
            <ul>
              {insight.policyDraft.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </div>
      )}

      <footer className="dashboard-ai-insights-footer">
        <span>{footerModeText(insight.mode, locale)}</span>
        <GeneratedAtTime generatedAt={insight.generatedAt} locale={locale} />
      </footer>
    </section>
  );
}

function AiInsightsEmptyState({
  generatedAt,
  locale
}: {
  generatedAt: string;
  locale: Locale;
}) {
  const text = aiInsightsText[locale];

  return (
    <div className="dashboard-ai-insights-empty">
      <strong>{text.empty}</strong>
      <p>{text.emptyBody}</p>
      <ul>
        {text.emptySteps.map((step) => <li key={step}>{step}</li>)}
      </ul>
      <GeneratedAtTime generatedAt={generatedAt} locale={locale} />
    </div>
  );
}

function GeneratedAtTime({
  generatedAt,
  locale
}: {
  generatedAt: string;
  locale: Locale;
}) {
  const text = aiInsightsText[locale];

  if (!generatedAt) {
    return <span>{text.pending}</span>;
  }

  const date = new Date(generatedAt);
  if (Number.isNaN(date.getTime())) {
    return <span>{text.timeUnavailable}</span>;
  }

  return <time dateTime={generatedAt}>{formatGeneratedAt(date, locale)}</time>;
}

function footerModeText(mode: AiInsightMode, locale: Locale) {
  if (mode === "live") {
    return locale === "ko" ? "실제 AI 분석" : "Live AI analysis";
  }

  if (mode === "fallback") {
    return locale === "ko" ? "대체 인사이트" : "Fallback insight";
  }

  return locale === "ko" ? "예시 미리보기" : "Mock preview";
}

function formatRangeDisplayLabel(value: string, locale: Locale) {
  if (locale === "en") {
    return value;
  }

  if (value === "Last 5 minutes") {
    return "최근 5분";
  }

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

function formatGeneratedAt(value: Date, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Seoul"
  }).format(value);
}
