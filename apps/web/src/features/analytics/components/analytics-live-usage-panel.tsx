"use client";

import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Minus,
  RefreshCw,
  TrendingDown,
  TrendingUp
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type {
  AnalyticsLiveUsage,
  AnalyticsLiveUsageBucket,
  AnalyticsLiveUsageProject
} from "@/features/analytics/analytics-live-usage-contract";
import {
  analyticsLiveUsageSignature,
  initialAnalyticsLivePollingState,
  nextAnalyticsLivePoll
} from "@/features/analytics/analytics-live-polling";
import { AnalyticsLiveRequestTrendChart } from "@/features/analytics/components/analytics-charts";
import { parseAnalyticsLiveUsage } from "@/features/analytics/analytics-live-usage-contract";
import type { AnalyticsReadModel } from "@/features/analytics/analytics-read-model";
import type { AnalyticsRequestVolumePoint } from "@/features/analytics/analytics-usage-merge";
import type { ProjectRecord } from "@/lib/control-plane/projects-types";
import type { LiveAnalyticsRange } from "@/lib/gateway/live-analytics-performance";
import type { Locale } from "@/lib/i18n/locale";

export type AnalyticsUsageFallback = {
  dataAsOf: string | null;
  dataState: AnalyticsReadModel["dataState"];
  rateLimitedRequestCount: number;
  requestCount: number;
  requestVolume: AnalyticsRequestVolumePoint[];
  sourceMix: Array<{ id: string; value: number }>;
};

type LiveState = "error" | "idle" | "loading" | "live" | "unavailable";

export function AnalyticsLiveUsagePanel({
  fallback,
  locale,
  projectId,
  projects,
  range,
  tenantId
}: {
  fallback: AnalyticsUsageFallback;
  locale: Locale;
  projectId: string;
  projects: ProjectRecord[];
  range: LiveAnalyticsRange;
  tenantId: string;
}) {
  const text = usageText[locale];
  const unknownProjectName = locale === "ko" ? "알 수 없는 프로젝트" : "Unknown project";
  const [isLiveEnabled, setIsLiveEnabled] = useState(false);
  const [liveState, setLiveState] = useState<LiveState>("idle");
  const [snapshot, setSnapshot] = useState<AnalyticsLiveUsage | null>(null);
  const [isVisible, setIsVisible] = useState(true);
  const [retryToken, setRetryToken] = useState(0);
  const snapshotSignature = useRef<string | null>(null);

  useEffect(() => {
    const updateVisibility = () => setIsVisible(document.visibilityState === "visible");
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => {
    setSnapshot(null);
    snapshotSignature.current = null;
    setLiveState((current) => current === "unavailable" ? current : "idle");
  }, [projectId, range, tenantId]);

  useEffect(() => {
    if (!isLiveEnabled || !isVisible) {
      return undefined;
    }

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let pollingState = initialAnalyticsLivePollingState;

    const schedule = (delayMs: number) => {
      if (!disposed) {
        timer = setTimeout(() => void poll(), delayMs);
      }
    };

    const poll = async () => {
      controller = new AbortController();
      setLiveState((current) => current === "live" ? current : "loading");
      const query = new URLSearchParams({ range, tenantId });
      if (projectId) {
        query.set("projectId", projectId);
      }

      const response = await fetch(`/api/analytics/live-usage?${query.toString()}`, {
        cache: "no-store",
        signal: controller.signal
      }).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return undefined;
        }
        return undefined;
      });
      if (disposed || controller.signal.aborted) {
        return;
      }

      if (response?.status === 503) {
        setLiveState("unavailable");
        setIsLiveEnabled(false);
        return;
      }

      const payload = response?.ok
        ? await response.json().catch(() => undefined) as { data?: unknown } | undefined
        : undefined;
      const nextSnapshot = parseAnalyticsLiveUsage(payload?.data);
      if (disposed || controller.signal.aborted) {
        return;
      }
      if (!nextSnapshot) {
        setLiveState("error");
        const nextPoll = nextAnalyticsLivePoll(pollingState, { status: "error" });
        pollingState = nextPoll.state;
        schedule(nextPoll.delayMs);
        return;
      }

      const nextSignature = analyticsLiveUsageSignature(nextSnapshot);
      const changed = snapshotSignature.current !== nextSignature;
      snapshotSignature.current = nextSignature;
      setSnapshot(nextSnapshot);
      setLiveState("live");
      const nextPoll = nextAnalyticsLivePoll(pollingState, {
        changed,
        status: "success"
      });
      pollingState = nextPoll.state;
      schedule(nextPoll.delayMs);
    };

    void poll();
    return () => {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
      }
      controller?.abort();
    };
  }, [isLiveEnabled, isVisible, projectId, range, retryToken, tenantId]);

  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects]
  );
  const fallbackBuckets = useMemo(
    () => toFallbackBuckets(fallback.requestVolume, range),
    [fallback.requestVolume, range]
  );
  const displayBuckets = snapshot?.buckets ?? fallbackBuckets;
  const displayProjects = snapshot?.projects
    ?? fallback.sourceMix.map((row) => fallbackProject(row.id, row.value));
  const totalRequests = snapshot?.summary.requestCount ?? fallback.requestCount;
  const rateLimitedRequests =
    snapshot?.summary.rateLimitedRequestCount ?? fallback.rateLimitedRequestCount;
  const currentRps = snapshot?.summary.currentIncomingRps;
  const stateLabel = liveState === "live"
    ? text.live
    : liveState === "error"
      ? text.delayed
      : liveState === "unavailable"
        ? text.unavailable
        : text.static;
  const dataAsOf = snapshot?.dataFreshness.generatedAt ?? fallback.dataAsOf;

  return (
    <section className="analytics-v3-panel analytics-live-usage">
      <header className="analytics-v3-panel-topline analytics-live-panel-topline">
        <h2>{text.title}</h2>
        <div className="analytics-live-controls">
          <div className="analytics-v3-data-state" data-state={stateTone(liveState, fallback.dataState)}>
            <i />
            <strong>{stateLabel}</strong>
            <span>{formatDataTime(dataAsOf, locale)}</span>
          </div>
          {liveState === "error" && isLiveEnabled ? (
            <button
              className="analytics-live-retry"
              onClick={() => setRetryToken((value) => value + 1)}
              type="button"
            >
              <RefreshCw aria-hidden="true" size={17} />
              {text.retry}
            </button>
          ) : null}
          <label className="analytics-live-switch">
            <span>{text.liveView}</span>
            <input
              checked={isLiveEnabled}
              disabled={liveState === "unavailable"}
              onChange={(event) => {
                setIsLiveEnabled(event.currentTarget.checked);
                if (event.currentTarget.checked) {
                  setLiveState("loading");
                } else if (liveState !== "unavailable") {
                  setLiveState("idle");
                  setSnapshot(null);
                  snapshotSignature.current = null;
                }
              }}
              role="switch"
              type="checkbox"
            />
            <i aria-hidden="true" />
          </label>
        </div>
      </header>

      {liveState === "unavailable" ? (
        <div className="analytics-live-unavailable" role="status">
          <AlertTriangle aria-hidden="true" size={18} />
          {text.unavailableHelp}
        </div>
      ) : null}

      <section className="analytics-v3-executive-band" data-accent="usage">
        <article className="analytics-v3-executive-lead">
          <div>
            <Activity aria-hidden="true" size={24} />
            <span>{text.totalRequests}</span>
          </div>
          <AnimatedMetric value={formatCompact(totalRequests)} />
          <small>{text.selectedRange}</small>
        </article>
        <article className="analytics-v3-executive-metric analytics-live-rate-limited-metric">
          <span>{text.rateLimited}</span>
          <AnimatedMetric value={formatCompact(rateLimitedRequests)} />
          <small>{formatPercent(safeRatio(rateLimitedRequests, totalRequests))}</small>
        </article>
        <article className="analytics-v3-executive-metric">
          <span>{text.currentRps}</span>
          <AnimatedMetric value={currentRps === undefined ? "—" : formatRps(currentRps)} />
          <small>{text.currentWindow}</small>
        </article>
      </section>

      <div className="analytics-live-workspace">
        <section className="analytics-v3-analysis-surface">
          <div className="analytics-v3-section-heading">
            <div>
              <h3>{text.requestTrend}</h3>
              <p>{text.requestTrendSub}</p>
            </div>
            {snapshot ? <strong>{formatRps(snapshot.summary.peakIncomingRps)} peak</strong> : null}
          </div>
          {displayBuckets.length > 0 ? (
            <AnalyticsLiveRequestTrendChart
              ariaLabel={text.requestTrend}
              buckets={displayBuckets}
              locale={locale}
              rateLimitStartedAt={snapshot?.rateLimitStartedAt ?? null}
              showBreakdown={Boolean(snapshot)}
            />
          ) : (
            <AnalyticsLiveEmpty label={text.noData} />
          )}
        </section>

        <section className="analytics-v3-analysis-surface analytics-live-top-projects">
          <div className="analytics-v3-section-heading">
            <div>
              <h3>{text.topProjects}</h3>
              <p>{text.topProjectsSub}</p>
            </div>
          </div>
          {displayProjects.length > 0 ? (
            <ol>
              {displayProjects.slice(0, 3).map((project, index) => (
                <TopProjectRow
                  index={index}
                  key={project.projectId}
                  locale={locale}
                  maxRequests={Math.max(1, displayProjects[0]?.requestCount ?? 1)}
                  project={project}
                  projectName={projectById.get(project.projectId)?.name ?? unknownProjectName}
                  showTrend={Boolean(snapshot)}
                  tenantId={tenantId}
                />
              ))}
            </ol>
          ) : (
            <AnalyticsLiveEmpty label={text.noData} />
          )}
        </section>
      </div>

      <section className="analytics-live-impact">
        <div className="analytics-v3-section-heading">
          <div>
            <h3>{text.policyImpact}</h3>
            <p>{text.policyImpactSub}</p>
          </div>
        </div>
        <div className="analytics-live-impact-table" role="table">
          <div className="analytics-live-impact-header" role="row">
            <span role="columnheader">{text.project}</span>
            <span role="columnheader">{text.currentRps}</span>
            <span role="columnheader">{text.ratePolicy}</span>
            <span role="columnheader">{text.outcome}</span>
            <span role="columnheader">{text.rate}</span>
          </div>
          {displayProjects.map((project) => {
            const projectRecord = projectById.get(project.projectId);
            return (
              <div className="analytics-live-impact-row" key={project.projectId} role="row">
                <div data-label={text.project} role="cell">
                  <Link href={policyHref(tenantId, project.projectId)}>
                    {projectRecord?.name ?? unknownProjectName}
                  </Link>
                </div>
                <div data-label={text.currentRps} role="cell">
                  {snapshot ? formatRps(project.currentIncomingRps) : "—"}
                </div>
                <div data-label={text.ratePolicy} role="cell">
                  {formatRateLimit(projectRecord, locale)}
                </div>
                <div data-label={text.outcome} role="cell">
                  {snapshot ? (
                    <OutcomeBar
                      locale={locale}
                      processed={project.processedRequestCount}
                      rateLimited={project.rateLimitedRequestCount}
                    />
                  ) : "—"}
                </div>
                <div data-label={text.rate} role="cell">
                  {snapshot ? formatPercent(project.rateLimitedRate) : "—"}
                </div>
              </div>
            );
          })}
          {displayProjects.length === 0 ? <AnalyticsLiveEmpty label={text.noData} /> : null}
        </div>
      </section>
    </section>
  );
}

function AnimatedMetric({ value }: { value: string }) {
  return <strong className="analytics-live-value" key={value}>{value}</strong>;
}

function TopProjectRow({
  index,
  locale,
  maxRequests,
  project,
  projectName,
  showTrend,
  tenantId
}: {
  index: number;
  locale: Locale;
  maxRequests: number;
  project: AnalyticsLiveUsageProject;
  projectName: string;
  showTrend: boolean;
  tenantId: string;
}) {
  const trendText = project.trend === "up"
    ? project.deltaPercent === null
      ? (locale === "ko" ? "신규" : "New")
      : `+${formatOneDecimal(project.deltaPercent)}%`
    : project.trend === "down"
      ? `${formatOneDecimal(project.deltaPercent ?? 0)}%`
      : (locale === "ko" ? "안정" : "Stable");
  const TrendIcon = project.trend === "up"
    ? TrendingUp
    : project.trend === "down"
      ? TrendingDown
      : Minus;

  return (
    <li data-rank={index + 1}>
      <div className="analytics-live-project-line">
        <span>{index + 1}</span>
        <Link href={policyHref(tenantId, project.projectId)} title={projectName}>
          {projectName}
        </Link>
        {showTrend ? (
          <em data-trend={project.trend}>
            <TrendIcon aria-hidden="true" size={17} />
            {trendText}
          </em>
        ) : null}
        <strong>{formatCompact(project.requestCount)}</strong>
      </div>
      <div className="analytics-live-project-bar" aria-hidden="true">
        <i style={{ width: `${Math.max(3, (project.requestCount / maxRequests) * 100)}%` }} />
      </div>
    </li>
  );
}

function OutcomeBar({
  locale,
  processed,
  rateLimited
}: {
  locale: Locale;
  processed: number;
  rateLimited: number;
}) {
  const total = processed + rateLimited;
  const limitedWidth = total > 0 ? (rateLimited / total) * 100 : 0;
  return (
    <div
      className="analytics-live-outcome"
      title={locale === "ko"
        ? `처리됨 ${formatCompact(processed)} · 제한됨 ${formatCompact(rateLimited)}`
        : `Processed ${formatCompact(processed)} · rate limited ${formatCompact(rateLimited)}`}
    >
      <div aria-hidden="true">
        <i style={{ width: `${100 - limitedWidth}%` }} />
        <b style={{ width: `${limitedWidth}%` }} />
      </div>
      <span>{formatCompact(processed)} / {formatCompact(rateLimited)}</span>
    </div>
  );
}

function AnalyticsLiveEmpty({ label }: { label: string }) {
  return <div className="analytics-live-empty">{label}</div>;
}

function toFallbackBuckets(
  points: AnalyticsRequestVolumePoint[],
  range: LiveAnalyticsRange
): AnalyticsLiveUsageBucket[] {
  const bucketSeconds: Record<LiveAnalyticsRange, number> = {
    "15m": 60,
    "1h": 300,
    "1d": 3600,
    "1w": 86400
  };
  return points.flatMap((point) => {
    const periodStart = Date.parse(point.bucket);
    if (Number.isNaN(periodStart)) {
      return [];
    }
    return [{
      incomingRps: point.requests / bucketSeconds[range],
      periodEnd: new Date(periodStart + bucketSeconds[range] * 1000).toISOString(),
      periodStart: new Date(periodStart).toISOString(),
      processedRequestCount: point.requests,
      processedRps: point.requests / bucketSeconds[range],
      rateLimitedRequestCount: 0,
      rateLimitedRps: 0,
      requestCount: point.requests
    }];
  });
}

function fallbackProject(projectId: string, requests: number): AnalyticsLiveUsageProject {
  return {
    currentIncomingRps: 0,
    deltaPercent: null,
    processedRequestCount: requests,
    projectId,
    rateLimitedRate: 0,
    rateLimitedRequestCount: 0,
    requestCount: requests,
    trend: "stable"
  };
}

function formatRateLimit(project: ProjectRecord | undefined, locale: Locale) {
  const policy = project?.rateLimit;
  if (!policy) {
    return locale === "ko" ? "정책 없음" : "No policy";
  }
  if (!policy.enabled) {
    return locale === "ko" ? "비활성" : "Disabled";
  }
  const refill = policy.limit / policy.windowSeconds;
  return locale === "ko"
    ? `지속 ${formatRps(refill)} · 순간 ${formatCompact(policy.limit)}건`
    : `${formatRps(refill)} sustained · ${formatCompact(policy.limit)} burst`;
}

function policyHref(tenantId: string, projectId: string) {
  return `/tenants/${encodeURIComponent(tenantId)}/projects/${encodeURIComponent(projectId)}/policies?tab=rate-limit`;
}

function stateTone(
  liveState: LiveState,
  fallbackState: AnalyticsReadModel["dataState"]
) {
  if (liveState === "error") return "stale";
  if (liveState === "unavailable") return "unavailable";
  if (liveState === "live") return "live";
  return fallbackState;
}

function formatDataTime(value: string | null, locale: Locale) {
  if (!value || Number.isNaN(Date.parse(value))) return "";
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC"
  }).format(new Date(value));
}

function formatCompact(value: number) {
  const absolute = Math.abs(value);
  const units = [
    { divisor: 1_000_000_000, suffix: "B" },
    { divisor: 1_000_000, suffix: "M" },
    { divisor: 1_000, suffix: "K" }
  ];
  const unit = units.find((item) => absolute >= item.divisor);
  if (!unit) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
  }
  return `${Number((value / unit.divisor).toFixed(1))}${unit.suffix}`;
}

function formatRps(value: number) {
  return `${formatOneDecimal(value)} RPS`;
}

function formatOneDecimal(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function formatPercent(value: number) {
  return `${formatOneDecimal(Math.max(0, value) * 100)}%`;
}

function safeRatio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

const usageText = {
  en: {
    currentRps: "Current incoming RPS",
    currentWindow: "Average over the latest completed 5 seconds",
    delayed: "Live update delayed",
    live: "Live data",
    liveView: "Live view",
    noData: "No requests in the selected range.",
    outcome: "Processed / limited",
    policyImpact: "Project request-limit impact",
    policyImpactSub: "Observed traffic outcomes and the active Token Bucket boundary",
    project: "Project",
    rate: "Limited rate",
    rateLimited: "Rate-limited requests",
    ratePolicy: "Sustained / burst",
    requestTrend: "Request volume",
    requestTrendSub: "Incoming, processed, and rate-limited requests per second",
    retry: "Retry now",
    selectedRange: "Selected time range",
    static: "Static aggregate",
    title: "Usage",
    topProjects: "Top project traffic",
    topProjectsSub: "Projects with the most requests in this range",
    totalRequests: "Total requests",
    unavailable: "Live unavailable",
    unavailableHelp: "This Gateway does not provide live usage. Static aggregates remain available."
  },
  ko: {
    currentRps: "현재 수신 RPS",
    currentWindow: "최근 완료된 5초 평균",
    delayed: "라이브 갱신 지연",
    live: "실시간 데이터",
    liveView: "라이브 보기",
    noData: "선택한 기간에 요청이 없습니다.",
    outcome: "처리됨 / 제한됨",
    policyImpact: "프로젝트별 요청 제한 영향",
    policyImpactSub: "관측된 처리 결과와 활성 Token Bucket 경계를 함께 봅니다",
    project: "프로젝트",
    rate: "제한율",
    rateLimited: "제한된 요청",
    ratePolicy: "지속 충전량 / 순간 최대",
    requestTrend: "요청 추이",
    requestTrendSub: "초당 수신·처리·제한 요청",
    retry: "지금 다시 시도",
    selectedRange: "선택 기간 누적",
    static: "정적 집계",
    title: "사용량",
    topProjects: "상위 프로젝트 트래픽",
    topProjectsSub: "선택 기간 요청이 집중된 프로젝트",
    totalRequests: "전체 요청",
    unavailable: "라이브 사용 불가",
    unavailableHelp: "현재 Gateway는 라이브 사용량을 지원하지 않습니다. 정적 집계는 계속 표시됩니다."
  }
} satisfies Record<Locale, Record<string, string>>;
