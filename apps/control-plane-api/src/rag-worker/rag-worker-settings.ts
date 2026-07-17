import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validateRagRuntimeConfig } from '@gatelm/rag-config';
import { hostname } from 'node:os';

const OPAQUE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export type RagWorkerSettingsShape = Readonly<{
  workerId: string;
  pollIntervalMs: number;
  leaseDurationMs: number;
  retryBaseMs: number;
  retryCapMs: number;
  embeddingBatchSize: number;
  aiServiceBaseUrl: URL;
  aiServiceToken: string;
  gatewayBaseUrl: URL;
  workloadActiveKid: string;
  workloadSigningJwkFile: string;
  bindingHmacKeysFile: string;
}>;

@Injectable()
export class RagWorkerSettings {
  readonly value: RagWorkerSettingsShape;

  constructor(config: ConfigService) {
    // The worker has its own Nest entrypoint, so it must repeat the fixed
    // profile validation normally performed by the HTTP application's env
    // validator before it can claim any persisted RAG job.
    validateRagRuntimeConfig(process.env);
    const workerId = optionalString(config, 'RAG_WORKER_ID') ??
      `rag_worker_${hostname().replace(/[^A-Za-z0-9_-]/g, '_')}_${process.pid}`;
    if (!OPAQUE_ID.test(workerId)) throw new Error('RAG_WORKER_ID is invalid');
    this.value = Object.freeze({
      workerId,
      pollIntervalMs: boundedInteger(config, 'RAG_WORKER_POLL_INTERVAL_MS', 1_000, 100, 60_000),
      leaseDurationMs: boundedInteger(config, 'RAG_WORKER_LEASE_DURATION_MS', 120_000, 10_000, 600_000),
      retryBaseMs: boundedInteger(config, 'RAG_WORKER_RETRY_BASE_MS', 1_000, 100, 60_000),
      retryCapMs: boundedInteger(config, 'RAG_WORKER_RETRY_CAP_MS', 300_000, 1_000, 3_600_000),
      embeddingBatchSize: boundedInteger(config, 'RAG_WORKER_EMBEDDING_BATCH_SIZE', 64, 1, 128),
      aiServiceBaseUrl: requiredHttpUrl(config, 'RAG_WORKER_AI_SERVICE_BASE_URL'),
      aiServiceToken: requiredSecret(config, 'RAG_WORKER_AI_SERVICE_TOKEN'),
      gatewayBaseUrl: requiredHttpUrl(config, 'RAG_WORKER_GATEWAY_BASE_URL'),
      workloadActiveKid: requiredOpaque(config, 'RAG_WORKER_EMBEDDING_ACTIVE_KID'),
      workloadSigningJwkFile: requiredPath(config, 'RAG_WORKER_EMBEDDING_SIGNING_JWK_FILE'),
      bindingHmacKeysFile: requiredPath(config, 'RAG_WORKER_EMBEDDING_BINDING_HMAC_KEYS_FILE'),
    });
    if (this.value.retryCapMs < this.value.retryBaseMs) {
      throw new Error('RAG_WORKER_RETRY_CAP_MS must be greater than or equal to RAG_WORKER_RETRY_BASE_MS');
    }
    if (isProductionLike()) {
      if (config.get<string>('RAG_OBJECT_STORE_DRIVER') !== 's3') {
        throw new Error('RAG_OBJECT_STORE_DRIVER must be s3 for the RAG worker in production-like environments');
      }
      if (isLocalEndpoint(this.value.aiServiceBaseUrl) || isLocalEndpoint(this.value.gatewayBaseUrl)) {
        throw new Error('RAG worker local endpoints are not allowed in production-like environments');
      }
      if (isWeakSecret(this.value.aiServiceToken)) {
        throw new Error('RAG_WORKER_AI_SERVICE_TOKEN must be a non-placeholder value of at least 32 characters in production-like environments');
      }
    }
  }
}

function optionalString(config: ConfigService, key: string): string | undefined {
  const value = config.get<string>(key)?.trim();
  return value || undefined;
}

function requiredSecret(config: ConfigService, key: string): string {
  const value = optionalString(config, key);
  if (!value || value.length < 16) throw new Error(`${key} is required`);
  return value;
}

function requiredPath(config: ConfigService, key: string): string {
  const value = optionalString(config, key);
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function requiredOpaque(config: ConfigService, key: string): string {
  const value = optionalString(config, key);
  if (!value || !OPAQUE_ID.test(value)) throw new Error(`${key} is invalid`);
  return value;
}

function requiredHttpUrl(config: ConfigService, key: string): URL {
  const value = optionalString(config, key);
  if (!value) throw new Error(`${key} is required`);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${key} is invalid`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${key} is invalid`);
  }
  return parsed;
}

function boundedInteger(
  config: ConfigService,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = optionalString(config, key);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function isProductionLike(): boolean {
  const deployment = (process.env.GATELM_DEPLOYMENT_ENV ?? process.env.DEPLOYMENT_MODE ?? process.env.NODE_ENV ?? '').trim().toLowerCase();
  return ['production', 'prod', 'staging', 'stage', 'selfhost', 'self_host', 'aws', 'aws_triage', 'aws-triage', 'release'].includes(deployment);
}

function isLocalEndpoint(url: URL): boolean {
  return ['localhost', '127.0.0.1', '::1'].includes(url.hostname) || url.hostname.endsWith('.localhost');
}

function isWeakSecret(value: string): boolean {
  const normalized = value.toLowerCase();
  return value.length < 32 || ['changeme', 'example', 'placeholder', 'replace-me', 'dev-only', 'demo'].some((term) => normalized.includes(term));
}
