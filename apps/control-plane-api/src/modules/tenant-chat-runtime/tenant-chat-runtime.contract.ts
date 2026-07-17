import { createHash } from 'node:crypto';

import Ajv2020, { type ErrorObject } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

import type {
  TenantChatPricing,
  TenantChatRoutingCategory,
  TenantChatRoutingPolicyV2Bridge,
  TenantChatRuntimePolicies,
  TenantChatRuntimeSnapshotDocument,
} from './tenant-chat-runtime.types';
import tenantRuntimeSnapshotSchema = require('./tenant-runtime-snapshot.schema.json');

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const TENANT_CHAT_MODEL_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const SHA256_DIGEST_PATTERN = /^sha256:[A-Za-z0-9_-]{43}$/;
const tenantRuntimeSnapshotAjv = new Ajv2020({ allErrors: true, strict: true });
addFormats(tenantRuntimeSnapshotAjv);
const validateTenantRuntimeSnapshotSchema =
  tenantRuntimeSnapshotAjv.compile<TenantChatRuntimeSnapshotDocument>(
    tenantRuntimeSnapshotSchema,
  );

export class TenantChatRuntimeContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantChatRuntimeContractError';
  }
}

export function validateTenantChatRuntimeSnapshot(
  snapshot: unknown,
): void {
  assertTenantRuntimeSnapshotSchema(snapshot);
  assertOpaqueId(snapshot.snapshotId, 'snapshotId');
  assertOpaqueId(snapshot.tenantId, 'tenantId');
  assertOpaqueId(snapshot.publishedBy, 'publishedBy');
  assertPositiveInteger(snapshot.version, 'version');
  assertPositiveInteger(snapshot.policyVersion, 'policyVersion');
  assertPositiveInteger(snapshot.employeeNoticeVersion, 'employeeNoticeVersion');
  assertDigest(snapshot.digest, 'digest');
  assertDateTime(snapshot.publishedAt, 'publishedAt');

  validatePricing(snapshot.pricing);
  validatePolicies(snapshot.policies, snapshot.pricing);

  const pricingDigest = computeTenantChatPricingDigest(snapshot.pricing);
  if (snapshot.pricing.digest !== pricingDigest) {
    throw new TenantChatRuntimeContractError(
      `pricing.digest does not match the canonical pricing payload: expected ${pricingDigest}`,
    );
  }

  const snapshotDigest = computeTenantChatSnapshotDigest(snapshot);
  if (snapshot.digest !== snapshotDigest) {
    throw new TenantChatRuntimeContractError(
      `snapshot.digest does not match the canonical snapshot payload: expected ${snapshotDigest}`,
    );
  }
}

export function computeTenantChatPricingDigest(
  pricing: TenantChatPricing,
): string {
  const { digest: _digest, ...digestPayload } = pricing;
  return sha256Digest(digestPayload);
}

export function computeTenantChatSnapshotDigest(
  snapshot: TenantChatRuntimeSnapshotDocument,
): string {
  const {
    digest: _digest,
    publishedAt: _publishedAt,
    publishedBy: _publishedBy,
    ...digestPayload
  } = snapshot;
  return sha256Digest(digestPayload);
}

export function computeTenantChatPolicyDigest(
  policies: TenantChatRuntimePolicies,
): string {
  return sha256Digest(policies);
}

export function computeTenantChatRoutingPolicyHash(
  policy: Omit<TenantChatRoutingPolicyV2Bridge, 'routingPolicyHash'>,
): string {
  return sha256HexDigest(policy);
}

export function computeTenantChatSafetyPolicyDigest(
  safety: Omit<TenantChatRuntimePolicies['safety'], 'policyDigest'>,
): string {
  return sha256Digest(safety);
}

export function canonicalizeTenantChatJson(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TenantChatRuntimeContractError(
        'canonical JSON cannot contain a non-finite number',
      );
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    assertValidUnicode(value);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeTenantChatJson(item)).join(',')}]`;
  }
  if (isRecord(value)) {
    const properties = Object.keys(value)
      .sort()
      .map((key) => {
        const propertyValue = value[key];
        if (propertyValue === undefined) {
          throw new TenantChatRuntimeContractError(
            `canonical JSON cannot contain undefined at ${key}`,
          );
        }
        assertValidUnicode(key);
        return `${JSON.stringify(key)}:${canonicalizeTenantChatJson(propertyValue)}`;
      });
    return `{${properties.join(',')}}`;
  }

  throw new TenantChatRuntimeContractError(
    `canonical JSON cannot contain ${typeof value}`,
  );
}

function sha256Digest(value: unknown): string {
  const canonical = canonicalizeTenantChatJson(value);
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('base64url')}`;
}

function sha256HexDigest(value: unknown): string {
  const canonical = canonicalizeTenantChatJson(value);
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

function validatePricing(pricing: TenantChatPricing): void {
  assertPositiveInteger(pricing.version, 'pricing.version');
  assertDigest(pricing.digest, 'pricing.digest');
  if (pricing.currency !== 'USD') {
    throw new TenantChatRuntimeContractError('pricing.currency must be USD');
  }
  if (pricing.unit !== 'micro_usd_per_1m_tokens') {
    throw new TenantChatRuntimeContractError(
      'pricing.unit must be micro_usd_per_1m_tokens',
    );
  }
  assertDateTime(pricing.effectiveAt, 'pricing.effectiveAt');
  if (pricing.routes.length < 1 || pricing.routes.length > 32) {
    throw new TenantChatRuntimeContractError(
      'pricing.routes must contain between 1 and 32 routes',
    );
  }

  const routeIds = new Set<string>();
  for (const [index, route] of pricing.routes.entries()) {
    const prefix = `pricing.routes[${index}]`;
    assertOpaqueId(route.routeId, `${prefix}.routeId`);
    assertOpaqueId(route.providerId, `${prefix}.providerId`);
    assertModelKey(route.modelKey, `${prefix}.modelKey`);
    assertNonnegativeInteger(
      route.inputMicroUsdPerMillionTokens,
      `${prefix}.inputMicroUsdPerMillionTokens`,
    );
    assertNonnegativeInteger(
      route.outputMicroUsdPerMillionTokens,
      `${prefix}.outputMicroUsdPerMillionTokens`,
    );
    if (route.pricingStatus === 'unavailable') {
      if (
        route.pricingSource !== 'unavailable' ||
        route.inputMicroUsdPerMillionTokens !== 0 ||
        route.outputMicroUsdPerMillionTokens !== 0 ||
        (route.cacheReadInputMicroUsdPerMillionTokens ?? 0) !== 0
      ) {
        throw new TenantChatRuntimeContractError(
          `${prefix} with unavailable pricing must use the unavailable source and zero monetary rates`,
        );
      }
    }
    if (
      route.pricingStatus === 'available' &&
      route.pricingSource === 'unavailable'
    ) {
      throw new TenantChatRuntimeContractError(
        `${prefix}.pricingSource cannot be unavailable when pricing is available`,
      );
    }
    if (route.cacheReadInputMicroUsdPerMillionTokens !== undefined) {
      assertNonnegativeInteger(
        route.cacheReadInputMicroUsdPerMillionTokens,
        `${prefix}.cacheReadInputMicroUsdPerMillionTokens`,
      );
      if (
        route.cacheReadInputMicroUsdPerMillionTokens >
        route.inputMicroUsdPerMillionTokens
      ) {
        throw new TenantChatRuntimeContractError(
          `${prefix}.cacheReadInputMicroUsdPerMillionTokens must not exceed regular input price`,
        );
      }
    }
    if (routeIds.has(route.routeId)) {
      throw new TenantChatRuntimeContractError(
        `pricing routeId ${route.routeId} is duplicated`,
      );
    }
    routeIds.add(route.routeId);
  }
}

function assertTenantRuntimeSnapshotSchema(
  snapshot: unknown,
): asserts snapshot is TenantChatRuntimeSnapshotDocument {
  if (validateTenantRuntimeSnapshotSchema(snapshot)) {
    return;
  }
  const details = (validateTenantRuntimeSnapshotSchema.errors ?? [])
    .map(formatSchemaError)
    .join('; ');
  throw new TenantChatRuntimeContractError(
    `RuntimeSnapshot schema validation failed${details ? `: ${details}` : ''}`,
  );
}

function formatSchemaError(error: ErrorObject): string {
  const path = error.instancePath || '/';
  return `${path} ${error.message ?? 'is invalid'}`;
}

function validatePolicies(
  policies: TenantChatRuntimePolicies,
  pricing: TenantChatPricing,
): void {
  assertPositiveInteger(policies.rateLimit.requests, 'policies.rateLimit.requests');
  assertPositiveInteger(
    policies.rateLimit.windowSeconds,
    'policies.rateLimit.windowSeconds',
  );
  assertPositiveInteger(
    policies.concurrency.maxActiveAdmissionsPerUser,
    'policies.concurrency.maxActiveAdmissionsPerUser',
  );
  if (policies.concurrency.admissionTtlSeconds !== 30) {
    throw new TenantChatRuntimeContractError(
      'policies.concurrency.admissionTtlSeconds must be 30',
    );
  }

  validateQuotaPolicy(policies);
  validateBudgetPolicy(policies);

  const pricingByRoute = new Map(
    pricing.routes.map((route) => [route.routeId, route] as const),
  );
  const runtimeByRoute = new Map<string, (typeof policies.routing.routes)[number]>();
  const runtimeByModelRef = new Map<
    string,
    (typeof policies.routing.routes)[number]
  >();
  const routingPolicy = policies.routing.policy;
  if (
    policies.routing.routes.length < 1 ||
    policies.routing.routes.length > 32
  ) {
    throw new TenantChatRuntimeContractError(
      'policies.routing.routes must contain between 1 and 32 routes',
    );
  }

  for (const [index, route] of policies.routing.routes.entries()) {
    const prefix = `policies.routing.routes[${index}]`;
    assertOpaqueId(route.routeId, `${prefix}.routeId`);
    assertOpaqueId(route.providerId, `${prefix}.providerId`);
    assertModelKey(route.modelKey, `${prefix}.modelKey`);
    if (routingPolicy) {
      if (!route.modelRef) {
        throw new TenantChatRuntimeContractError(
          `${prefix}.modelRef is required by the Routing v2 compatibility bridge`,
        );
      }
      assertModelKey(route.modelRef, `${prefix}.modelRef`);
      if (runtimeByModelRef.has(route.modelRef)) {
        throw new TenantChatRuntimeContractError(
          `runtime modelRef ${route.modelRef} is duplicated`,
        );
      }
      runtimeByModelRef.set(route.modelRef, route);
    } else if (!route.tier) {
      throw new TenantChatRuntimeContractError(
        `${prefix}.tier is required by a legacy routing snapshot`,
      );
    }
    if (runtimeByRoute.has(route.routeId)) {
      throw new TenantChatRuntimeContractError(
        `runtime routeId ${route.routeId} is duplicated`,
      );
    }
    const priceRoute = pricingByRoute.get(route.routeId);
    if (
      !priceRoute ||
      priceRoute.providerId !== route.providerId ||
      priceRoute.modelKey !== route.modelKey
    ) {
      throw new TenantChatRuntimeContractError(
        `${prefix} must have matching immutable pricing provenance`,
      );
    }
    if (
      routingPolicy &&
      (priceRoute.pricingStatus === undefined ||
        priceRoute.pricingSource === undefined)
    ) {
      throw new TenantChatRuntimeContractError(
        `${prefix} must declare pricingStatus and pricingSource for Routing v2`,
      );
    }
    runtimeByRoute.set(route.routeId, route);
  }

  if (routingPolicy) {
    validateRoutingPolicyV2Bridge(
      routingPolicy,
      policies.routing.manualModelRef,
      runtimeByModelRef,
    );
  } else {
    const hasEconomyRoute = policies.routing.routes.some(
      (route) => route.enabled && route.tier === 'economy',
    );
    if (!hasEconomyRoute) {
      throw new TenantChatRuntimeContractError(
        'at least one enabled economy route is required',
      );
    }
  }

  if (policies.fallback.routeIds.length > 3) {
    throw new TenantChatRuntimeContractError(
      'policies.fallback.routeIds cannot contain more than 3 routes',
    );
  }
  assertIntegerInRange(
    policies.fallback.maxAttempts,
    1,
    4,
    'policies.fallback.maxAttempts',
  );
  const fallbackIds = new Set<string>();
  for (const routeId of policies.fallback.routeIds) {
    if (fallbackIds.has(routeId)) {
      throw new TenantChatRuntimeContractError(
        `fallback routeId ${routeId} is duplicated`,
      );
    }
    const route = runtimeByRoute.get(routeId);
    if (!route?.enabled) {
      throw new TenantChatRuntimeContractError(
        `fallback routeId ${routeId} must reference an enabled runtime route`,
      );
    }
    fallbackIds.add(routeId);
  }
  if (
    policies.fallback.enabled &&
    fallbackIds.size === 0 &&
    !routingPolicy
  ) {
    throw new TenantChatRuntimeContractError(
      'enabled fallback requires at least one routeId',
    );
  }

  const routedProviders = new Set(
    policies.routing.routes.map((route) => route.providerId),
  );
  const tokenRateProviders = new Set<string>();
  for (const [index, provider] of policies.providerTokenRate.providers.entries()) {
    const prefix = `policies.providerTokenRate.providers[${index}]`;
    assertOpaqueId(provider.providerId, `${prefix}.providerId`);
    assertPositiveInteger(provider.limitTokens, `${prefix}.limitTokens`);
    assertPositiveInteger(provider.windowSeconds, `${prefix}.windowSeconds`);
    if (!routedProviders.has(provider.providerId)) {
      throw new TenantChatRuntimeContractError(
        `${prefix}.providerId must reference a routed provider`,
      );
    }
    if (tokenRateProviders.has(provider.providerId)) {
      throw new TenantChatRuntimeContractError(
        `${prefix}.providerId is duplicated`,
      );
    }
    tokenRateProviders.add(provider.providerId);
  }
  for (const providerId of routedProviders) {
    if (!tokenRateProviders.has(providerId)) {
      throw new TenantChatRuntimeContractError(
        `policies.providerTokenRate must define routed provider ${providerId}`,
      );
    }
  }

  assertPositiveInteger(policies.cache.ttlSeconds, 'policies.cache.ttlSeconds');
  assertPositiveInteger(
    policies.cache.maxEntriesPerUser,
    'policies.cache.maxEntriesPerUser',
  );
  assertOpaqueId(policies.cache.keySetId, 'policies.cache.keySetId');
  assertDigest(policies.safety.policyDigest, 'policies.safety.policyDigest');
  const detectorTypes = new Set<string>();
  for (const [index, detector] of policies.safety.detectorSet.entries()) {
    const prefix = `policies.safety.detectorSet[${index}]`;
    if (detectorTypes.has(detector.detectorType)) {
      throw new TenantChatRuntimeContractError(
        `${prefix}.detectorType is duplicated`,
      );
    }
    if (
      detector.action === 'allow' &&
      ['resident_registration_number', 'api_key', 'authorization_header', 'jwt', 'private_key'].includes(
        detector.detectorType,
      )
    ) {
      throw new TenantChatRuntimeContractError(
        `${prefix}.action cannot allow a mandatory protected detector`,
      );
    }
    detectorTypes.add(detector.detectorType);
  }
  assertPositiveInteger(
    policies.streaming.maxDurationSeconds,
    'policies.streaming.maxDurationSeconds',
  );
  if (policies.streaming.finalEventRequired !== true) {
    throw new TenantChatRuntimeContractError(
      'policies.streaming.finalEventRequired must be true',
    );
  }
}

const ROUTING_CATEGORIES: TenantChatRoutingCategory[] = [
  'general',
  'code',
  'translation',
  'summarization',
  'reasoning',
];

function validateRoutingPolicyV2Bridge(
  policy: TenantChatRoutingPolicyV2Bridge,
  manualModelRef: string | undefined,
  runtimeByModelRef: ReadonlyMap<
    string,
    TenantChatRuntimePolicies['routing']['routes'][number]
  >,
): void {
  const { routingPolicyHash: _routingPolicyHash, ...hashPayload } = policy;
  const expectedHash = computeTenantChatRoutingPolicyHash(hashPayload);
  if (policy.routingPolicyHash !== expectedHash) {
    throw new TenantChatRuntimeContractError(
      `policies.routing.policy.routingPolicyHash does not match the canonical policy payload: expected ${expectedHash}`,
    );
  }
  if (!manualModelRef) {
    throw new TenantChatRuntimeContractError(
      'policies.routing.manualModelRef is required by the Routing v2 compatibility bridge',
    );
  }
  const manualRoute = runtimeByModelRef.get(manualModelRef);
  if (!manualRoute?.enabled) {
    throw new TenantChatRuntimeContractError(
      'policies.routing.manualModelRef must reference an enabled runtime modelRef',
    );
  }

  for (const category of ROUTING_CATEGORIES) {
    for (const difficulty of ['simple', 'complex'] as const) {
      const modelRefs = policy.routes[category][difficulty].modelRefs;
      for (const modelRef of modelRefs) {
        const route = runtimeByModelRef.get(modelRef);
        if (!route?.enabled) {
          throw new TenantChatRuntimeContractError(
            `policies.routing.policy.routes.${category}.${difficulty} references unavailable modelRef ${modelRef}`,
          );
        }
      }
    }
  }
}

function validateQuotaPolicy(policies: TenantChatRuntimePolicies): void {
  const quota = policies.quota;
  assertIanaTimezone(quota.timezone, 'policies.quota.timezone');
  assertNonnegativeInteger(
    quota.defaultMonthlyTokenLimit,
    'policies.quota.defaultMonthlyTokenLimit',
  );
  assertIntegerInRange(quota.warningPercent, 1, 99, 'policies.quota.warningPercent');
  assertIntegerInRange(quota.economyPercent, 2, 119, 'policies.quota.economyPercent');
  assertIntegerInRange(quota.hardStopPercent, 3, 1000, 'policies.quota.hardStopPercent');
  if (
    !(
      quota.warningPercent < quota.economyPercent &&
      quota.economyPercent < quota.hardStopPercent
    )
  ) {
    throw new TenantChatRuntimeContractError(
      'quota thresholds must satisfy warning < economy < hard stop',
    );
  }
  const employeeLimits = quota.employeeWeeklyTokenLimits;
  if (employeeLimits === undefined) {
    return;
  }
  if (employeeLimits.length > 10_000) {
    throw new TenantChatRuntimeContractError(
      'policies.quota.employeeWeeklyTokenLimits cannot contain more than 10000 entries',
    );
  }
  const employeeIds = new Set<string>();
  for (const [index, limit] of employeeLimits.entries()) {
    const prefix = `policies.quota.employeeWeeklyTokenLimits[${index}]`;
    assertOpaqueId(limit.employeeId, `${prefix}.employeeId`);
    assertNonnegativeInteger(limit.limitTokens, `${prefix}.limitTokens`);
    if (limit.limitTokens > quota.defaultMonthlyTokenLimit) {
      throw new TenantChatRuntimeContractError(
        `${prefix}.limitTokens cannot exceed policies.quota.defaultMonthlyTokenLimit`,
      );
    }
    if (employeeIds.has(limit.employeeId)) {
      throw new TenantChatRuntimeContractError(
        `${prefix}.employeeId is duplicated`,
      );
    }
    employeeIds.add(limit.employeeId);
  }
}

function validateBudgetPolicy(policies: TenantChatRuntimePolicies): void {
  const budget = policies.budget;
  assertIanaTimezone(budget.timezone, 'policies.budget.timezone');
  assertNonnegativeInteger(
    budget.monthlyLimitMicroUsd,
    'policies.budget.monthlyLimitMicroUsd',
  );
  assertIntegerInRange(
    budget.warningPercent,
    1,
    98,
    'policies.budget.warningPercent',
  );
  assertIntegerInRange(
    budget.economyPercent,
    2,
    99,
    'policies.budget.economyPercent',
  );
  if (
    !(
      budget.warningPercent < budget.economyPercent &&
      budget.economyPercent < budget.hardStopPercent
    )
  ) {
    throw new TenantChatRuntimeContractError(
      'budget thresholds must satisfy warning < economy < hard stop',
    );
  }
}

function assertOpaqueId(value: string, path: string): void {
  if (!OPAQUE_ID_PATTERN.test(value)) {
    throw new TenantChatRuntimeContractError(`${path} is not a valid opaque ID`);
  }
}

function assertModelKey(value: string, path: string): void {
  if (!TENANT_CHAT_MODEL_KEY_PATTERN.test(value)) {
    throw new TenantChatRuntimeContractError(`${path} is not a valid model key`);
  }
}

function assertDigest(value: string, path: string): void {
  if (!SHA256_DIGEST_PATTERN.test(value)) {
    throw new TenantChatRuntimeContractError(`${path} is not a valid digest`);
  }
}

function assertDateTime(value: string, path: string): void {
  if (!value || Number.isNaN(Date.parse(value))) {
    throw new TenantChatRuntimeContractError(`${path} is not a valid date-time`);
  }
}

function assertPositiveInteger(value: number, path: string): void {
  assertIntegerInRange(value, 1, Number.MAX_SAFE_INTEGER, path);
}

function assertNonnegativeInteger(value: number, path: string): void {
  assertIntegerInRange(value, 0, Number.MAX_SAFE_INTEGER, path);
}

function assertIntegerInRange(
  value: number,
  minimum: number,
  maximum: number,
  path: string,
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TenantChatRuntimeContractError(
      `${path} must be an integer between ${minimum} and ${maximum}`,
    );
  }
}

function assertIanaTimezone(value: string, path: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
  } catch {
    throw new TenantChatRuntimeContractError(`${path} is not an IANA timezone`);
  }
}

function assertValidUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TenantChatRuntimeContractError(
          'canonical JSON cannot contain an unpaired surrogate',
        );
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TenantChatRuntimeContractError(
        'canonical JSON cannot contain an unpaired surrogate',
      );
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
