import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

import type { TenantChatProjectionEvent } from './tenant-chat-observability.types';
import invocationTerminalEventSchema = require('./invocation-terminal-event.schema.json');
import invocationTerminalEventV2Schema = require('./invocation-terminal-event-v2.schema.json');
import usageSettlementEventSchema = require('./usage-settlement-event.schema.json');
import usageSettlementEventV2Schema = require('./usage-settlement-event-v2.schema.json');
import usageSettlementEventV3Schema = require('./usage-settlement-event-v3.schema.json');

const projectionEventAjv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
  strictTypes: false,
});
addFormats(projectionEventAjv);

const validateUsageSettlementEvent =
  projectionEventAjv.compile<TenantChatProjectionEvent>(
    usageSettlementEventSchema,
  );
const validateInvocationTerminalEvent =
  projectionEventAjv.compile<TenantChatProjectionEvent>(
    invocationTerminalEventSchema,
  );
const validateUsageSettlementEventV2 =
  projectionEventAjv.compile<TenantChatProjectionEvent>(
    usageSettlementEventV2Schema,
  );
const validateInvocationTerminalEventV2 =
  projectionEventAjv.compile<TenantChatProjectionEvent>(
    invocationTerminalEventV2Schema,
  );
const validateUsageSettlementEventV3 =
  projectionEventAjv.compile<TenantChatProjectionEvent>(
    usageSettlementEventV3Schema,
  );

export class TenantChatProjectionContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantChatProjectionContractError';
  }
}

export function validateTenantChatProjectionEvent(
  payload: unknown,
): asserts payload is TenantChatProjectionEvent {
  const eventType = readEventType(payload);
  const validator = selectValidator(eventType, readSchemaVersion(payload));
  if (validator?.(payload)) {
    return;
  }

  const details = (validator?.errors ?? [])
    .map(formatSchemaError)
    .join('; ');
  throw new TenantChatProjectionContractError(
    `Tenant Chat projection event schema validation failed${details ? `: ${details}` : ''}`,
  );
}

function readEventType(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return undefined;
  }
  const eventType = (payload as Record<string, unknown>).eventType;
  return typeof eventType === 'string' ? eventType : undefined;
}

function readSchemaVersion(payload: unknown): number | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return undefined;
  }
  const schemaVersion = (payload as Record<string, unknown>).schemaVersion;
  return Number.isSafeInteger(schemaVersion) ? Number(schemaVersion) : undefined;
}

function selectValidator(
  eventType: string | undefined,
  schemaVersion: number | undefined,
): ValidateFunction<TenantChatProjectionEvent> | undefined {
  const v2 = schemaVersion === 2;
  if (eventType === 'invocation_terminal') {
    return v2 ? validateInvocationTerminalEventV2 : validateInvocationTerminalEvent;
  }
  if (
    eventType === 'usage_reserved' ||
    eventType === 'usage_topped_up' ||
    eventType === 'usage_settled' ||
    eventType === 'usage_released' ||
    eventType === 'usage_unconfirmed'
  ) {
    if (schemaVersion === 3) {
      return validateUsageSettlementEventV3;
    }
    return v2 ? validateUsageSettlementEventV2 : validateUsageSettlementEvent;
  }
  return undefined;
}

function formatSchemaError(error: ErrorObject): string {
  const path = error.instancePath || '/';
  return `${path} ${error.message ?? 'is invalid'}`;
}
