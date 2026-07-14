import { expect, test } from "@playwright/test";
import {
  countPendingLiveRequests,
  liveRequestHistoryCutoff,
  mergeLiveRequestHistory
} from "./live-requests-history";
import type { LiveRequestRow } from "@/lib/gateway/live-requests-types";

test("merges real polling rows by request id and keeps newest first", () => {
  const history = [row("req-1", "2026-07-11T00:00:01.000Z")];
  const incoming = [
    row("req-2", "2026-07-11T00:00:02.000Z"),
    { ...row("req-1", "2026-07-11T00:00:01.000Z"), latencyMs: 42 }
  ];

  const merged = mergeLiveRequestHistory(history, incoming);

  expect(merged.map((item) => item.requestId)).toEqual(["req-2", "req-1"]);
  expect(merged[1].latencyMs).toBe(42);
});

test("counts only request ids that arrived after the focus snapshot", () => {
  const snapshot = [row("req-1", "2026-07-11T00:00:01.000Z")];
  const current = [
    row("req-3", "2026-07-11T00:00:03.000Z"),
    row("req-2", "2026-07-11T00:00:02.000Z"),
    row("req-1", "2026-07-11T00:00:01.000Z")
  ];

  expect(countPendingLiveRequests(snapshot, current)).toBe(2);
});

test("drops observed rows that moved outside the selected live range", () => {
  const now = new Date("2026-07-11T00:10:00.000Z").getTime();
  const current = [
    row("req-stale", "2026-07-11T00:04:59.000Z"),
    row("req-current", "2026-07-11T00:09:00.000Z")
  ];

  const merged = mergeLiveRequestHistory(current, [], {
    minimumTimestampMs: liveRequestHistoryCutoff("5m", now)
  });

  expect(merged.map((item) => item.requestId)).toEqual(["req-current"]);
});

function row(requestId: string, timestamp: string): LiveRequestRow {
  return {
    cacheStatus: "MISS",
    category: "general",
    costUsd: 0,
    difficulty: "simple",
    executedModel: "gpt-4o-mini",
    id: requestId,
    latencyMs: 10,
    modelRef: "catalog:general-simple",
    projectId: "project-id",
    projectName: "Project",
    providerFamily: "openai",
    providerId: "provider-openai",
    providerName: "OpenAI",
    requestedModel: "auto",
    requestId,
    routingReason: "category_difficulty_matrix",
    safetyAction: "NONE",
    status: "success",
    statusCode: 200,
    statusLabel: "200 OK",
    timestamp,
    totalTokens: 0,
    userName: null
  };
}
