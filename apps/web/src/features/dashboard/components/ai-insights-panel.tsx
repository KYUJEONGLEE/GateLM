"use client";

import { RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export type AiInsightsPanelProps = {
  averageLatencyMs: number;
  blockedRequests: number;
  cacheHitRate: number;
  failedRequests: number;
  monthToDateSpendMicroUsd: number;
  projectName: string | null;
  rangeLabel: string;
  successRate: number;
  totalRequests: number;
};

type InsightLevel = "High" | "Low" | "Medium";
type RecommendationCategory = "Cache" | "Cost" | "Reliability" | "Routing" | "Safety";

const insightLevelLabels: Record<InsightLevel, string> = {
  High: "높음",
  Low: "낮음",
  Medium: "보통"
};

const recommendationCategoryLabels: Record<RecommendationCategory, string> = {
  Cache: "캐시",
  Cost: "비용",
  Reliability: "안정성",
  Routing: "라우팅",
  Safety: "안전"
};

type AiInsight = {
  policyDraft: string[];
  recommendations: Array<{
    category: RecommendationCategory;
    text: string;
  }>;
  signals: Array<{
    label: string;
    level: InsightLevel;
  }>;
  summary: string;
};

export function AiInsightsPanel({
  averageLatencyMs,
  blockedRequests,
  cacheHitRate,
  failedRequests,
  monthToDateSpendMicroUsd,
  projectName,
  rangeLabel,
  successRate,
  totalRequests
}: AiInsightsPanelProps) {
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const analyzeTimerRef = useRef<number | null>(null);
  const insights = useMemo(
    () =>
      buildMockAiInsights({
        averageLatencyMs,
        blockedRequests,
        cacheHitRate,
        failedRequests,
        monthToDateSpendMicroUsd,
        projectName,
        rangeLabel,
        successRate,
        totalRequests
      }),
    [
      averageLatencyMs,
      blockedRequests,
      cacheHitRate,
      failedRequests,
      monthToDateSpendMicroUsd,
      projectName,
      rangeLabel,
      successRate,
      totalRequests
    ]
  );

  useEffect(() => {
    setGeneratedAt(new Date());
  }, [insights]);

  useEffect(() => {
    return () => {
      if (analyzeTimerRef.current !== null) {
        window.clearTimeout(analyzeTimerRef.current);
      }
    };
  }, []);

  function analyzeAgain() {
    if (isAnalyzing) {
      return;
    }

    setIsAnalyzing(true);
    if (analyzeTimerRef.current !== null) {
      window.clearTimeout(analyzeTimerRef.current);
    }
    analyzeTimerRef.current = window.setTimeout(() => {
      setGeneratedAt(new Date());
      setIsAnalyzing(false);
      analyzeTimerRef.current = null;
    }, 450);
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
          <p>최근 Gateway 활동 기반 데모 분석</p>
        </div>
        <span className="dashboard-ai-insights-badge">MOCK</span>
      </div>

      <button
        className="dashboard-ai-insights-analyze"
        disabled={isAnalyzing}
        onClick={analyzeAgain}
        type="button"
      >
        <RefreshCw aria-hidden="true" data-spinning={isAnalyzing} size={15} strokeWidth={2.3} />
        <span>{isAnalyzing ? "분석 중..." : "분석"}</span>
      </button>

      {totalRequests <= 0 ? (
        <AiInsightsEmptyState generatedAt={generatedAt} />
      ) : (
        <div className="dashboard-ai-insights-content">
          <section className="dashboard-ai-insights-summary" aria-label="AI 인사이트 요약">
            <h3>요약</h3>
            <p>{insights.summary}</p>
          </section>

          <section className="dashboard-ai-insights-section" aria-label="핵심 신호">
            <div className="dashboard-ai-insights-section-title">
              <h3>핵심 신호</h3>
              <span>{formatRangeDisplayLabel(rangeLabel)}</span>
            </div>
            <div className="dashboard-ai-signal-list">
              {insights.signals.map((signal) => (
                <div className="dashboard-ai-signal-row" key={signal.label}>
                  <span>{signal.label}</span>
                  <strong data-level={signal.level}>{insightLevelLabels[signal.level]}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="dashboard-ai-insights-section" aria-label="권장 조치">
            <h3>권장 조치</h3>
            <ol className="dashboard-ai-recommendation-list">
              {insights.recommendations.map((recommendation) => (
                <li key={`${recommendation.category}-${recommendation.text}`}>
                  <span data-category={recommendation.category}>
                    {recommendationCategoryLabels[recommendation.category]}
                  </span>
                  <p>{recommendation.text}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="dashboard-ai-policy-draft" aria-label="정책 초안 제안">
            <h3>정책 초안 제안</h3>
            <ul>
              {insights.policyDraft.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </div>
      )}

      <footer className="dashboard-ai-insights-footer">
        <span>외부 LLM 호출 없음</span>
        <GeneratedAtTime generatedAt={generatedAt} />
      </footer>
    </section>
  );
}

function AiInsightsEmptyState({ generatedAt }: { generatedAt: Date | null }) {
  return (
    <div className="dashboard-ai-insights-empty">
      <strong>아직 분석할 데이터가 부족합니다</strong>
      <p>Gateway 요청을 몇 개 보내면 AI 인사이트를 생성할 수 있습니다.</p>
      <ul>
        <li>Gateway로 테스트 요청을 보내세요.</li>
        <li>트래픽 생성 후 Live Requests 영역을 확인하세요.</li>
        <li>최근 요청이 쌓이면 인사이트가 자동으로 갱신됩니다.</li>
      </ul>
      <GeneratedAtTime generatedAt={generatedAt} />
    </div>
  );
}

function GeneratedAtTime({ generatedAt }: { generatedAt: Date | null }) {
  if (!generatedAt) {
    return <span>분석 대기</span>;
  }

  return <time dateTime={generatedAt.toISOString()}>{formatGeneratedAt(generatedAt)}</time>;
}

function buildMockAiInsights({
  averageLatencyMs,
  blockedRequests,
  cacheHitRate,
  failedRequests,
  monthToDateSpendMicroUsd,
  projectName,
  successRate,
  totalRequests
}: AiInsightsPanelProps): AiInsight {
  const scopeLabel = projectName ? `${projectName} 프로젝트` : "전체 프로젝트";
  const spendUsd = monthToDateSpendMicroUsd / 1_000_000;
  const reliabilityRisk = successRate < 0.95 || failedRequests > 0 ? "High" : successRate < 0.985 ? "Medium" : "Low";
  const latencyRisk = averageLatencyMs >= 1_500 ? "High" : averageLatencyMs >= 800 ? "Medium" : "Low";
  const costRisk = spendUsd >= 50 ? "High" : spendUsd >= 10 ? "Medium" : "Low";
  const cacheOpportunity = cacheHitRate < 0.2 ? "High" : cacheHitRate < 0.5 ? "Medium" : "Low";
  const hasReliabilityIssue = reliabilityRisk === "High" || reliabilityRisk === "Medium";
  const hasCostIssue = costRisk === "High" || costRisk === "Medium";

  return {
    policyDraft: [
      `단순 ${projectName ? projectName : "지원"} 요청은 gpt-4o-mini를 우선 사용하도록 라우팅하세요.`,
      "프로바이더 오류에 대비해 대체 모델을 유지하세요.",
      blockedRequests > 0
        ? "시크릿/API 키 형태 입력은 안전 차단을 유지하세요."
        : "고위험 입력 패턴은 안전 검사를 유지하세요."
    ],
    recommendations: [
      {
        category: hasReliabilityIssue ? "Reliability" : "Routing",
        text: hasReliabilityIssue
          ? "최근 500 에러 요청을 검토한 뒤 트래픽을 늘리는 것이 좋습니다."
          : "트래픽이 안정적인 동안 현재 라우팅 규칙을 유지하세요."
      },
      {
        category: hasCostIssue ? "Cost" : "Routing",
        text: hasCostIssue
          ? "예측 가능한 저위험 트래픽은 더 저렴한 기본 모델로 이동하세요."
          : "단순 지원 문의는 gpt-4o-mini 우선 라우팅을 권장합니다."
      },
      {
        category: cacheOpportunity === "High" ? "Cache" : "Safety",
        text: cacheOpportunity === "High"
          ? "반복 FAQ형 요청은 캐시 적용 후보로 볼 수 있습니다."
          : "시크릿/API 키 형태 입력은 계속 차단하는 것이 안전합니다."
      }
    ],
    signals: [
      { label: "비용 위험도", level: costRisk },
      { label: "지연 위험도", level: latencyRisk },
      { label: "안정성 위험도", level: reliabilityRisk }
    ],
    summary: buildSummary({
      blockedRequests,
      failedRequests,
      scopeLabel,
      successRate,
      totalRequests
    })
  };
}

function buildSummary({
  blockedRequests,
  failedRequests,
  scopeLabel,
  successRate,
  totalRequests
}: {
  blockedRequests: number;
  failedRequests: number;
  scopeLabel: string;
  successRate: number;
  totalRequests: number;
}) {
  if (successRate < 0.95 || failedRequests > 0) {
    return `${scopeLabel} 기준으로 ${formatCompactNumber(totalRequests)}건의 요청을 분석했습니다. 최근 실패 요청을 검토한 뒤 트래픽을 늘리는 것이 좋습니다.`;
  }

  if (blockedRequests > 0) {
    return `${scopeLabel} 트래픽은 대체로 안정적이며, 안전 정책이 위험 요청을 차단하고 있습니다.`;
  }

  return `${scopeLabel} 트래픽은 안정적입니다. 반복 프로바이더 호출을 줄이도록 라우팅과 캐시 정책을 조정할 수 있습니다.`;
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 1,
    notation: "compact"
  }).format(value);
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
