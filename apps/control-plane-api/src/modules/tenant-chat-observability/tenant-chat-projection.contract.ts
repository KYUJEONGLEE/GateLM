import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

import type { TenantChatProjectionEvent } from './tenant-chat-observability.types';
import invocationTerminalEventSchema = require('./invocation-terminal-event.schema.json');
import usageSettlementEventSchema = require('./usage-settlement-event.schema.json');

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
  const validator = selectValidator(eventType);
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

function selectValidator(
  eventType: string | undefined,
): ValidateFunction<TenantChatProjectionEvent> | undefined {
  if (eventType === 'invocation_terminal') {
    return validateInvocationTerminalEvent;
  }
  if (
    eventType === 'usage_reserved' ||
    eventType === 'usage_topped_up' ||
    eventType === 'usage_settled' ||
    eventType === 'usage_released' ||
    eventType === 'usage_unconfirmed'
  ) {
    return validateUsageSettlementEvent;
  }
  return undefined;
}

function formatSchemaError(error: ErrorObject): string {
  const path = error.instancePath || '/';
  return `${path} ${error.message ?? 'is invalid'}`;
}
