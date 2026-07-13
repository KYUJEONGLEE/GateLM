import {
  expect,
  type APIRequestContext,
  test
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { LiveInvocationLogRecord as InvocationLogRecord } from "../src/lib/gateway/live-observability-contract";
import type { LiveRequestRow } from "../src/lib/gateway/live-requests-types";

const tenantId = "tenant_demo_acme";
const dashboardPath = `/tenants/${tenantId}/dashboard?range=1d`;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
const controlPlaneBaseUrl = (
  process.env.GATELM_CONTROL_PLANE_BASE_URL ??
  process.env.CONTROL_PLANE_BASE_URL ??
  "http://localhost:3001"
).replace(/\/+$/, "");

test.beforeEach(async ({ context, page, request }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const sessionCookie = await createConsoleSessionCookie(request);
  await context.addCookies([
    {
      name: "gatelm_session",
      url: baseURL,
      value: sessionCookie
    },
    {
      name: "gatelm_locale",
      url: baseURL,
      value: "ko"
    }
  ]);

  await page.route("**/api/dashboard/live-requests?**", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        data: {
          generatedAt: "2026-07-11T00:10:06.000Z",
          requestedModelOptions: ["auto"],
          projectNameSource: "control-plane",
          rows: liveRows()
        }
      }),
      contentType: "application/json",
      status: 200
    });
  });

  await page.route("**/api/request-logs/detail?**", async (route) => {
    const requestId = new URL(route.request().url()).searchParams.get("requestId") ?? "req-live-1";

    await route.fulfill({
      body: JSON.stringify({
        data: detailRecord(requestId)
      }),
      contentType: "application/json",
      status: 200
    });
  });
});

test("opens Focus View and nested Request Detail drawer at the intended desktop sizes", async ({
  page
}) => {
  await page.goto(dashboardPath);

  const compact = page.locator('.dashboard-live-requests-panel[data-live-view="compact"]');
  await expect(compact).toBeVisible();
  await expect(compact.locator("tbody tr")).toHaveCount(5);

  await compact.getByRole("button", { name: "Open Live Requests focus view" }).click();

  const focus = page.locator(".live-requests-focus-dialog");
  await expect(focus).toBeVisible();
  await expect
    .poll(async () => (await focus.boundingBox())?.width ?? 0)
    .toBeGreaterThanOrEqual(1795);
  const focusBox = await focus.boundingBox();
  expect(focusBox?.width).toBeGreaterThanOrEqual(1795);
  expect(focusBox?.width).toBeLessThanOrEqual(1815);
  expect(focusBox?.height).toBeGreaterThanOrEqual(940);
  expect(focusBox?.height).toBeLessThanOrEqual(960);

  const targetDetail = focus.getByRole("button", {
    name: "Open request detail req-live-1"
  });
  await targetDetail.click();

  const drawer = page.locator(".request-detail-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "요청 상세" })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "요청 흐름" })).toBeVisible();
  const requestSummary = drawer.getByLabel("요청 요약");
  await expect(
    requestSummary.getByRole("group", { name: "핵심 수치" })
  ).toBeVisible();
  await expect(
    requestSummary.getByRole("group", { name: "요청 컨텍스트" })
  ).toBeVisible();
  for (const label of [
    "요청 시각",
    "프로젝트",
    "애플리케이션",
    "요청 모델",
    "최종 결과",
    "총 처리 시간",
    "사용 토큰",
    "예상 비용"
  ]) {
    await expect(requestSummary.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(drawer.locator(".gateway-pipeline-stage")).toHaveCount(7);
  await expect(drawer.locator(".gateway-pipeline-flow-dot")).toHaveCount(1);
  await expect(drawer.locator('.gateway-pipeline[data-route="provider"]')).toHaveCount(1);
  await expect(drawer.locator('.gateway-pipeline[data-cache-outcome="miss"]')).toHaveCount(1);
  await expect(drawer.locator(".gateway-pipeline-cache-label")).toHaveText("캐시 미스");
  await expect(
    drawer.locator('.gateway-pipeline-stage[data-stage="cache"] .gateway-pipeline-status')
  ).toHaveText("미사용");
  await expect(drawer.getByText("Gateway Pipeline 이란?", { exact: true })).toHaveCount(0);
  await expect(drawer.locator(".gateway-pipeline-fallback")).toHaveCount(0);

  const drawerBox = await drawer.boundingBox();
  expect(drawerBox?.width).toBeGreaterThanOrEqual(1590);
  expect(drawerBox?.width).toBeLessThanOrEqual(1610);

  await drawer.getByRole("button", { name: "요청 상세 닫기" }).click();
  await expect(drawer).toBeHidden();
  await expect(targetDetail).toBeFocused();

  await focus.getByRole("button", { name: "Close Live Requests focus view" }).click();
  await expect(focus).toBeHidden();
  await expect(compact).toBeVisible();
});

test("keeps the existing Request Logs detail route working with the redesigned panel", async ({
  page
}) => {
  await page.setViewportSize({ width: 1448, height: 1253 });
  await page.goto(`/tenants/${tenantId}/request-logs?requestId=req-live-1&projectId=project-demo`);

  const aside = page.locator(".request-log-detail-aside");
  await expect(aside).toBeVisible();
  await expect(aside.getByRole("heading", { name: "요청 흐름" })).toBeVisible();

  const pipelineScene = aside.locator(".gateway-pipeline-scene");
  const sceneBox = await pipelineScene.boundingBox();
  const stageBoxes = await aside.locator(".gateway-pipeline-stage").evaluateAll((stages) =>
    stages.map((stage) => {
      const box = stage.getBoundingClientRect();
      return { bottom: box.bottom, top: box.top };
    })
  );
  expect(sceneBox).not.toBeNull();
  expect(Math.max(...stageBoxes.map((box) => box.bottom))).toBeLessThanOrEqual(
    sceneBox!.y + sceneBox!.height + 1
  );

  const pipelineBox = await aside.locator(".gateway-pipeline").boundingBox();
  const detailsTitleBox = await aside.locator(".request-detail-sections-title").boundingBox();
  expect(pipelineBox).not.toBeNull();
  expect(detailsTitleBox).not.toBeNull();
  expect(detailsTitleBox!.y).toBeGreaterThanOrEqual(
    pipelineBox!.y + pipelineBox!.height
  );

  const summaryBox = await aside.locator(".request-detail-summary").boundingBox();
  const summaryItemBoxes = await aside.locator(".request-detail-summary-item").evaluateAll((items) =>
    items.map((item) => item.getBoundingClientRect().bottom)
  );
  expect(summaryBox).not.toBeNull();
  expect(Math.max(...summaryItemBoxes)).toBeLessThanOrEqual(
    summaryBox!.y + summaryBox!.height + 1
  );

  await aside
    .locator(".request-detail-accordion summary")
    .filter({ hasText: "적용된 정책" })
    .click();
  const policyDetails = aside
    .locator(".request-detail-accordion")
    .filter({ hasText: "적용된 정책" });
  await expect(aside.getByText("예산 범위 유형", { exact: true })).toBeVisible();
  await expect(aside.getByText("예산 범위 ID", { exact: true })).toBeVisible();
  await expect(policyDetails.getByText("애플리케이션", { exact: true })).toBeVisible();
  await expect(policyDetails.getByText("기본 애플리케이션", { exact: true })).toBeVisible();

  await aside
    .locator(".request-detail-accordion summary")
    .filter({ hasText: "라우팅 결정" })
    .click();
  await expect(aside.getByText("표준 라우팅", { exact: true })).toBeVisible();

  const cacheSummary = aside
    .locator(".request-detail-accordion > summary")
    .filter({ hasText: /^캐시 결과$/ });
  const cacheDetails = cacheSummary.locator("..");
  await cacheSummary.click();
  await expect(
    cacheDetails.getByText("정확 일치 · 캐시 미스", { exact: true })
  ).toBeVisible();
  await expect(aside.getByText("standard routing", { exact: true })).toHaveCount(0);
  await expect(aside.getByText("exact:miss", { exact: true })).toHaveCount(0);
});

test("follows cache-hit and terminal guardrail routes without inventing later stages", async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(dashboardPath);
  await page
    .locator('.dashboard-live-requests-panel[data-live-view="compact"]')
    .getByRole("button", { name: "Open Live Requests focus view" })
    .click();

  const focus = page.locator(".live-requests-focus-dialog");
  const drawer = page.locator(".request-detail-drawer");
  const applyPendingRequests = focus.getByRole("button", {
    name: /새 요청 \d+건 반영/
  });
  if (await applyPendingRequests.isVisible()) {
    await applyPendingRequests.click();
  }

  await focus.getByRole("button", { name: "Open request detail req-live-2" }).click();
  await expect(drawer.locator('.gateway-pipeline[data-route="cache"]')).toHaveCount(1);
  await expect(drawer.locator(".gateway-pipeline-cache-branch[data-active]")).toHaveCount(1);
  await expect(
    drawer.locator('.gateway-pipeline-stage[data-stage="adapter"][data-tone="skipped"]')
  ).toHaveCount(1);
  await expect(drawer.locator(".gateway-pipeline-flow-dot")).toHaveCSS("opacity", "0");
  await drawer.getByRole("button", { name: "요청 상세 닫기" }).click();

  await focus.getByRole("button", { name: "Open request detail req-live-3" }).click();
  await expect(drawer.locator('.gateway-pipeline[data-route="stopped"]')).toHaveCount(1);
  await expect(
    drawer.locator('.gateway-pipeline-stage[data-stage="guardrails"][data-tone="error"]')
  ).toHaveCount(1);
  await expect(drawer.locator('.gateway-pipeline-path-terminal[data-tone="error"]')).toHaveCount(1);
  const safetySummary = drawer
    .locator(".request-detail-accordion > summary")
    .filter({ hasText: /^적용된 정책$/ });
  await safetySummary.click();
  await expect(
    safetySummary.locator("..").getByText("이메일", { exact: true })
  ).toBeVisible();
  await drawer.getByRole("button", { name: "요청 상세 닫기" }).click();

  await focus.getByRole("button", { name: "Open request detail req-live-4" }).click();
  await expect(drawer.locator('.gateway-pipeline[data-route="stopped"]')).toHaveCount(1);
  await expect(
    drawer.locator('.gateway-pipeline-stage[data-stage="guardrails"][data-tone="warning"]')
  ).toHaveCount(1);
  await expect(drawer.locator('.gateway-pipeline-path-terminal[data-tone="warning"]')).toHaveCount(1);
});

function liveRows(): LiveRequestRow[] {
  return Array.from({ length: 5 }, (_, index) => {
    const sequence = index + 1;
    return {
      cacheStatus: sequence === 2 ? "HIT" : "MISS",
      category: sequence === 3 ? "code" : "general",
      costUsd: 0.00012 * sequence,
      difficulty: sequence === 3 ? "complex" : "simple",
      id: `req-live-${sequence}`,
      latencyMs: sequence === 2 ? 18 : 310 + sequence * 37,
      modelRef: sequence === 3 ? "catalog:code-complex" : "catalog:general-simple",
      projectId: "project-demo",
      projectName: "Customer Support",
      requestedModel: "auto",
      requestId: `req-live-${sequence}`,
      routingReason: "category_difficulty_matrix",
      safetyAction: sequence === 3 ? "MASKED" : "NONE",
      status: "success",
      statusCode: 200,
      statusLabel: "200 OK",
      timestamp: `2026-07-11T00:10:0${6 - sequence}.000Z`,
      totalTokens: 120 + sequence * 10,
      userName: sequence % 2 === 0 ? "Demo Operator" : null
    };
  });
}

function detailRecord(requestId: string): InvocationLogRecord {
  const baseOutcomes: NonNullable<InvocationLogRecord["domainOutcomes"]> = {
    auth: { outcome: "passed" },
    budget: { outcome: "allowed" },
    cache: { outcome: "miss" },
    fallback: { outcome: "not_needed" },
    logging: { outcome: "written" },
    provider: { outcome: "success" },
    rateLimit: { outcome: "allowed" },
    routing: { outcome: "selected" },
    runtime: { outcome: "snapshot_active" },
    safety: { outcome: "passed" },
    streaming: { outcome: "not_streaming" }
  };
  const base: InvocationLogRecord = {
    apiKeyId: "not-exposed",
    appTokenId: "not-exposed",
    applicationId: "application-demo",
    budgetScope: {
      budgetScopeId: "application-demo",
      budgetScopeType: "application",
      resolvedBy: "default_application"
    },
    cacheHitRequestId: null,
    cacheKeyHash: null,
    cacheStatus: "miss",
    cacheType: "exact",
    category: "general",
    completedAt: "2026-07-11T00:10:06.000Z",
    completionTokens: 82,
    costMicroUsd: 120,
    createdAt: "2026-07-11T00:10:05.000Z",
    domainOutcomes: baseOutcomes,
    difficulty: "simple",
    endUserId: null,
    endpoint: "/v1/chat/completions",
    errorCode: null,
    errorMessage: null,
    errorStage: null,
    featureId: null,
    httpStatus: 200,
    latencyMs: 420,
    maskingAction: "none",
    maskingDetectedCount: 0,
    maskingDetectedTypes: [],
    metadata: { runtime: { runtimeSnapshot: null } },
    method: "POST",
    modelRef: "catalog:general-simple",
    projectId: "project-demo",
    promptHash: "sanitized-hash",
    promptTokens: 48,
    providerAttempt: {
      providerId: "openai",
      modelId: "gpt-4o-mini",
      outcome: "succeeded",
      latencyMs: 360,
      sanitizedErrorCode: null
    },
    providerCalled: true,
    providerLatencyMs: 360,
    rateLimitDecision: {
      allowed: true,
      durationMs: 1,
      limit: 60,
      reason: "within_limit",
      remaining: 59,
      resetAt: "2026-07-11T00:11:00.000Z",
      retryAfterSeconds: 0,
      scope: "application",
      scopeId: "application-demo",
      windowSeconds: 60,
      windowStart: "2026-07-11T00:10:00.000Z"
    },
    redactedPromptPreview: null,
    requestBodyHash: "sanitized-hash",
    requestedModel: "auto",
    requestId,
    routingReason: "standard routing",
    savedCostMicroUsd: 0,
    source: "playwright",
    status: "success",
    stream: false,
    terminalStatus: "success",
    tenantId,
    totalTokens: 130,
    traceId: "trace-playwright"
  };

  if (requestId === "req-live-2") {
    return {
      ...base,
      cacheStatus: "hit",
      domainOutcomes: {
        ...baseOutcomes,
        cache: { outcome: "hit" },
        provider: { outcome: "not_called" }
      },
      modelRef: null,
      providerCalled: false,
      providerLatencyMs: null,
      providerAttempt: null
    };
  }

  if (requestId === "req-live-3") {
    return {
      ...terminalDetailRecord(base, baseOutcomes, "blocked"),
      maskingDetectedCount: 1,
      maskingDetectedTypes: ["email"],
      safetySummary: {
        detectedCount: 1,
        detectorCategories: [],
        maskingAction: "blocked",
        outcome: "blocked"
      }
    };
  }

  if (requestId === "req-live-4") {
    return terminalDetailRecord(base, baseOutcomes, "rate_limited");
  }

  return base;
}

function terminalDetailRecord(
  base: InvocationLogRecord,
  baseOutcomes: NonNullable<InvocationLogRecord["domainOutcomes"]>,
  terminalStatus: "blocked" | "rate_limited"
): InvocationLogRecord {
  const rateLimited = terminalStatus === "rate_limited";

  return {
    ...base,
    cacheStatus: "bypassed",
    domainOutcomes: {
      ...baseOutcomes,
      cache: { outcome: "bypassed" },
      provider: { outcome: "not_called" },
      rateLimit: { outcome: rateLimited ? "rate_limited" : "allowed" },
      routing: { outcome: "skipped" },
      safety: { outcome: rateLimited ? "not_checked" : "blocked" }
    },
    httpStatus: rateLimited ? 429 : 403,
    modelRef: null,
    providerCalled: false,
    providerLatencyMs: null,
    providerAttempt: null,
    routingReason: null,
    status: terminalStatus,
    terminalStatus
  };
}

async function createConsoleSessionCookie(request: APIRequestContext) {
  const signupResponse = await request.post(`${controlPlaneBaseUrl}/api/auth/signup`, {
    data: {
      email: `live-requests-e2e-${randomUUID()}@example.invalid`,
      name: "Live Requests E2E",
      password: "correct-horse-battery-staple"
    }
  });
  expect(signupResponse.ok()).toBeTruthy();

  const organizationResponse = await request.post(
    `${controlPlaneBaseUrl}/api/auth/organizations`,
    {
      data: {
        organizationName: `Live Requests E2E ${randomUUID().slice(0, 8)}`
      }
    }
  );
  expect(organizationResponse.ok()).toBeTruthy();

  const sessionCookie = getSetCookieValue(
    organizationResponse.headersArray(),
    "gatelm_session"
  );
  if (!sessionCookie) {
    throw new Error("Control plane did not issue a gatelm_session cookie.");
  }

  return sessionCookie;
}

function getSetCookieValue(
  headers: { name: string; value: string }[],
  cookieName: string
) {
  for (const header of headers) {
    if (header.name.toLowerCase() !== "set-cookie") {
      continue;
    }

    const [nameValue] = header.value.split(";");
    const separatorIndex = nameValue.indexOf("=");
    const name = separatorIndex >= 0 ? nameValue.slice(0, separatorIndex) : "";
    const value = separatorIndex >= 0 ? nameValue.slice(separatorIndex + 1) : "";

    if (name === cookieName) {
      return value;
    }
  }

  return null;
}
