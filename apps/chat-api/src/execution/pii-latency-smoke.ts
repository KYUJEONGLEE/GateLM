import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

import { AppModule } from '@/app.module';
import { signAccessJwt } from '@/auth/auth.crypto';
import { ControlPlaneClient } from '@/auth/control-plane.client';
import { PrismaService } from '@/database/prisma.service';

import { ExecutionBridgeService } from './execution-bridge.service';

const TENANT_ID = '00000000-0000-4000-8000-000000000100';
const USER_ID = '00000000-0000-4000-8000-000000000900';
const SESSION_ID = '00000000-0000-4000-8000-000000000903';

interface SidecarMetrics {
  calls: number;
  hybridCalls: number;
  fallbacks: number;
}

function integerEnv(name: string, fallback: number, minimum: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(value) && value >= minimum ? value : fallback;
}

function nearestRank(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(ordered.length - 1, Math.ceil(ordered.length * quantile) - 1));
  return Number(ordered[index].toFixed(3));
}

function metricValue(line: string): number {
  const value = Number.parseFloat(line.slice(line.lastIndexOf(' ') + 1));
  return Number.isFinite(value) ? value : 0;
}

async function sidecarMetrics(): Promise<SidecarMetrics> {
  const response = await fetch('http://gateway-core:8080/metrics');
  if (!response.ok) throw new Error('GatewayMetricsUnavailable');
  const lines = (await response.text()).split('\n');
  let calls = 0;
  let hybridCalls = 0;
  let fallbacks = 0;
  for (const line of lines) {
    if (!line.includes('surface="tenant_chat"')) continue;
    if (line.startsWith('gatelm_ai_safety_sidecar_calls_total{')) {
      const value = metricValue(line);
      calls += value;
      if (line.includes('inference_path="hybrid"')) hybridCalls += value;
    } else if (line.startsWith('gatelm_ai_safety_sidecar_fallback_total{')) {
      fallbacks += metricValue(line);
    }
  }
  return { calls, hybridCalls, fallbacks };
}

async function main(): Promise<void> {
  const prompt = process.env.PII_LATENCY_PROMPT;
  if (!prompt) throw new Error('PiiLatencyPromptRequired');
  const warmupRequests = integerEnv('PII_LATENCY_WARMUP_REQUESTS', 20, 0);
  const measuredRequests = integerEnv('PII_LATENCY_MEASURED_REQUESTS', 200, 1);
  const targetP95Ms = integerEnv('PII_LATENCY_TARGET_P95_MS', 500, 1);
  const reportPath = process.env.PII_LATENCY_REPORT_PATH;

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const prisma = app.get(PrismaService);
    const config = app.get(ConfigService);
    const entitlement = await app.get(ControlPlaneClient).entitlement(USER_ID, TENANT_ID);
    const session = await prisma.tenantChatSession.upsert({
      where: { id: SESSION_ID },
      create: {
        id: SESSION_ID,
        userId: USER_ID,
        selectedTenantId: TENANT_ID,
        deviceIdHash: 'sha256:synthetic-pii-latency-device',
        sessionVersion: 1,
        expiresAt: new Date(Date.now() + 20 * 60 * 1000),
      },
      update: {
        selectedTenantId: TENANT_ID,
        deviceIdHash: 'sha256:synthetic-pii-latency-device',
        sessionVersion: 1,
        expiresAt: new Date(Date.now() + 20 * 60 * 1000),
        revokedAt: null,
        revokeReason: null,
      },
    });
    const now = Math.floor(Date.now() / 1000);
    const accessToken = signAccessJwt({
      actorAuthzVersion: entitlement.actorAuthzVersion,
      actorKind: entitlement.actorKind,
      aud: 'gatelm-chat-web',
      deviceIdHash: session.deviceIdHash,
      exp: now + 900,
      iat: now,
      iss: 'gatelm-chat-api',
      jti: randomUUID(),
      nbf: now - 1,
      sessionVersion: session.sessionVersion,
      sid: session.id,
      sub: session.userId,
      tenantAuthzVersion: entitlement.tenantAuthzVersion,
      tenantId: entitlement.tenantId,
      ...(entitlement.employeeId ? { employeeId: entitlement.employeeId } : {}),
    }, config.getOrThrow<string>('TENANT_CHAT_ACCESS_JWT_SECRET'));
    const bridge = app.get(ExecutionBridgeService);
    const before = await sidecarMetrics();

    const runOnce = async (candidatePrompt = prompt): Promise<{ latencyMs: number; outcome: string }> => {
      const started = performance.now();
      const handle = await bridge.authorizeAndAdmit(accessToken);
      const result = await bridge.complete(
        handle,
        { messages: [{ role: 'user', content: candidatePrompt }], stream: true },
        {
          estimatedInputTokens: 64,
          maxOutputTokens: 64,
          requestedTier: 'standard',
          cacheStrategy: 'off',
        },
      );
      return {
        latencyMs: performance.now() - started,
        outcome: result.final.terminalOutcome,
      };
    };

    const discoveryPath = process.env.PII_LATENCY_DISCOVERY_CORPUS_PATH;
    if (discoveryPath) {
      const records = (await readFile(discoveryPath, 'utf8')).split(/\r?\n/u).filter(Boolean);
      let previous = before;
      const confirmationsRequired = integerEnv('PII_LATENCY_DISCOVERY_CONFIRMATIONS', 2, 2);
      let testedCases = 0;
      let selectedCaseId: string | null = null;
      let errors = 0;
      for (const line of records) {
        const record = JSON.parse(line) as { caseId?: unknown; text?: unknown; spans?: unknown };
        if (typeof record.caseId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(record.caseId)) continue;
        if (typeof record.text !== 'string' || record.text.trim() === '') continue;
        if (!Array.isArray(record.spans) || record.spans.length === 0) continue;
        const candidateBefore = previous;
        for (let confirmation = 0; confirmation < confirmationsRequired; confirmation += 1) {
          try {
            await runOnce(record.text);
          } catch {
            errors += 1;
          }
        }
        testedCases += 1;
        const current = await sidecarMetrics();
        if (current.hybridCalls - candidateBefore.hybridCalls >= confirmationsRequired) {
          selectedCaseId = record.caseId;
          break;
        }
        previous = current;
      }
      const report = {
        schemaVersion: 'gatelm.pii-v36-model-active-discovery.v1',
        testedCases,
        confirmationsRequired,
        selectedCaseId,
        errors,
        rawTextIncluded: false,
        status: selectedCaseId ? 'pass' : 'fail',
      };
      process.stdout.write(`${JSON.stringify(report)}\n`);
      if (!selectedCaseId) process.exitCode = 1;
      return;
    }

    const corpusBenchmarkPath = process.env.PII_LATENCY_CORPUS_BENCHMARK_PATH;
    if (corpusBenchmarkPath) {
      const records = (await readFile(corpusBenchmarkPath, 'utf8')).split(/\r?\n/u).filter(Boolean);
      let previous = before;
      let inspectedCases = 0;
      let modelActiveWarmups = 0;
      let errors = 0;
      const latencies: number[] = [];
      const outcomes: Record<string, number> = {};
      for (const line of records) {
        const record = JSON.parse(line) as { caseId?: unknown; text?: unknown; spans?: unknown };
        if (typeof record.caseId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(record.caseId)) continue;
        if (typeof record.text !== 'string' || record.text.trim() === '') continue;
        if (!Array.isArray(record.spans) || record.spans.length === 0) continue;
        let result: { latencyMs: number; outcome: string } | null = null;
        try {
          result = await runOnce(record.text);
        } catch {
          errors += 1;
        }
        inspectedCases += 1;
        const current = await sidecarMetrics();
        const modelActive = current.hybridCalls > previous.hybridCalls;
        previous = current;
        if (!modelActive || !result) continue;
        if (modelActiveWarmups < warmupRequests) {
          modelActiveWarmups += 1;
          continue;
        }
        latencies.push(result.latencyMs);
        outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
        if (latencies.length >= measuredRequests) break;
      }
      const p95 = nearestRank(latencies, 0.95);
      const sidecarCalls = previous.calls - before.calls;
      const hybridCalls = previous.hybridCalls - before.hybridCalls;
      const fallbackCalls = previous.fallbacks - before.fallbacks;
      const gates = {
        enoughModelActiveWarmups: modelActiveWarmups === warmupRequests,
        enoughModelActiveMeasurements: latencies.length === measuredRequests,
        allMeasuredRequestsSucceeded: outcomes.succeeded === measuredRequests,
        noErrors: errors === 0,
        p95AtOrBelowTarget: p95 !== null && p95 <= targetP95Ms,
        noSidecarFallback: fallbackCalls === 0,
      };
      const report = {
        schemaVersion: 'gatelm.pii-v36-tenant-chat-corpus-latency.v1',
        target: 'chat_api_private_gateway_provider_model_active_unique_corpus',
        input: { warmupRequests, measuredRequests, targetP95Ms },
        corpus: { inspectedCases, rawTextIncluded: false },
        latencyMs: {
          p50: nearestRank(latencies, 0.5),
          p95,
          max: latencies.length > 0 ? Number(Math.max(...latencies).toFixed(3)) : null,
        },
        outcome: { outcomes, errors, measuredModelActiveRequests: latencies.length },
        sidecarMetricsDelta: { calls: sidecarCalls, hybridCalls, fallbacks: fallbackCalls },
        gates,
        status: Object.values(gates).every(Boolean) ? 'pass' : 'fail',
      };
      const serialized = `${JSON.stringify(report)}\n`;
      if (reportPath) await writeFile(reportPath, serialized, 'utf8');
      process.stdout.write(serialized);
      if (report.status !== 'pass') process.exitCode = 1;
      return;
    }

    let warmupFailures = 0;
    for (let index = 0; index < warmupRequests; index += 1) {
      try {
        const result = await runOnce();
        if (result.outcome !== 'succeeded') warmupFailures += 1;
      } catch {
        warmupFailures += 1;
      }
    }

    const latencies: number[] = [];
    const outcomes: Record<string, number> = {};
    const sanitizedErrorNames: Record<string, number> = {};
    let errors = 0;
    for (let index = 0; index < measuredRequests; index += 1) {
      try {
        const result = await runOnce();
        latencies.push(result.latencyMs);
        outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
      } catch (error) {
        errors += 1;
        const name = error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name)
          ? error.name
          : 'UnknownError';
        sanitizedErrorNames[name] = (sanitizedErrorNames[name] ?? 0) + 1;
      }
    }

    const after = await sidecarMetrics();
    const p95 = nearestRank(latencies, 0.95);
    const sidecarCalls = after.calls - before.calls;
    const hybridCalls = after.hybridCalls - before.hybridCalls;
    const fallbackCalls = after.fallbacks - before.fallbacks;
    const gates = {
      allRequestsSucceeded: outcomes.succeeded === measuredRequests && errors === 0,
      noWarmupFailure: warmupFailures === 0,
      p95AtOrBelowTarget: p95 !== null && p95 <= targetP95Ms,
      sidecarObserved: sidecarCalls > 0,
      modelActiveSidecarObserved: hybridCalls > 0,
      noSidecarFallback: fallbackCalls === 0,
    };
    const report = {
      schemaVersion: 'gatelm.pii-v36-tenant-chat-latency.v1',
      target: 'chat_api_private_gateway_provider',
      input: { warmupRequests, measuredRequests, targetP95Ms },
      latencyMs: {
        p50: nearestRank(latencies, 0.5),
        p95,
        max: latencies.length > 0 ? Number(Math.max(...latencies).toFixed(3)) : null,
      },
      outcome: { outcomes, errors, sanitizedErrorNames, warmupFailures },
      sidecarMetricsDelta: { calls: sidecarCalls, hybridCalls, fallbacks: fallbackCalls },
      gates,
      status: Object.values(gates).every(Boolean) ? 'pass' : 'fail',
    };
    const serialized = `${JSON.stringify(report)}\n`;
    if (reportPath) await writeFile(reportPath, serialized, 'utf8');
    process.stdout.write(serialized);
    if (report.status !== 'pass') process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.name : 'PiiLatencySmokeFailed'}\n`);
  process.exitCode = 1;
});
