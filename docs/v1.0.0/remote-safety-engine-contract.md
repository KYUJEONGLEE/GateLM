# RemoteSafetyEngine Contract

This document defines the v1.0.0 baseline contract for the optional Python/FastAPI RemoteSafetyEngine.

RemoteSafetyEngine is a shadow/evaluation path. It is not the v1 production safety authority. The v1 Gateway main path continues to use the Go rule-based SafetyEngine, and the Python/FastAPI service may be off while v1 smoke still passes.

## 1. Scope

RemoteSafetyEngine is used to compare or evaluate safety decisions outside the production blocking path.

It may:

- evaluate a normalized text-only prompt for safety signals.
- return a `SafetyDecision` compatible with the v1 Gateway safety fields.
- provide non-authoritative metadata for shadow/evaluation reports.

It must not:

- mutate GatewayContext.
- replace the rule-based Gateway safety decision.
- change production blocking or redaction behavior.
- return a full provider-bound redacted prompt for Gateway to use.
- require the Python/FastAPI service for v1 smoke.
- add v1 Invocation Log or Event fields without a separate contract change.

## 2. Ownership

| Area | Owner | Review with |
|---|---|---|
| RemoteSafetyEngine contract and FastAPI prototype | AI Safety & Evaluation Lab | Gateway Data Plane |
| Gateway call site, fallback behavior, and runtime wiring | Gateway Data Plane | AI Safety & Evaluation Lab |
| New log/event fields for remote safety | Observability | Gateway Data Plane, AI Safety & Evaluation Lab |

## 3. Evaluate Semantics

```text
Evaluate(ctx, input) -> SafetyDecision
```

`Evaluate` is a pure evaluation call from the Gateway perspective.

- `ctx` carries non-secret request and runtime provenance fields.
- `input` carries normalized safety-evaluation input and active detector config.
- The function returns a `SafetyDecision`.
- It does not mutate GatewayContext.
- It does not decide v1 production blocking.
- It does not decide the provider request payload.

Gateway MAY call RemoteSafetyEngine only in a future shadow/evaluation mode. Current v1 runtime config keeps remote safety disabled.

## 4. Context Schema

RemoteSafetyContext fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `requestId` | string | Y | Gateway request id. |
| `traceId` | string | Y | Trace correlation id. |
| `tenantId` | string | Y | Resolved tenant context. |
| `projectId` | string | Y | Resolved project context. |
| `applicationId` | string | Y | Resolved application context. |
| `configHash` | string | Y | Active runtime config hash. |
| `securityPolicyHash` | string | Y | Active safety policy hash. |
| `routingPolicyHash` | string or null | Y | Active routing policy hash if available. |
| `policyMode` | string | Y | v1 value: `rule_based`. |
| `remoteSafetyMode` | string | Y | v1 shadow value: `shadow`. Current runtime config remains `disabled`. |

Example:

```json
{
  "requestId": "request_01J...",
  "traceId": "trace_01J...",
  "tenantId": "tenant_01J...",
  "projectId": "project_01J...",
  "applicationId": "app_01J...",
  "configHash": "hash_runtime_config_v1_demo",
  "securityPolicyHash": "hash_security_policy_v1_demo",
  "routingPolicyHash": "hash_routing_policy_v1_demo",
  "policyMode": "rule_based",
  "remoteSafetyMode": "shadow"
}
```

The following values MUST NOT be included in `ctx`:

- raw API Key.
- raw App Token.
- Authorization header.
- Provider credential.
- credential hash or secret hash.
- raw response.
- raw provider error body.
- raw detected sensitive value.

## 5. Input Schema

RemoteSafetyInput fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `promptText` | string | Y | Normalized text-only prompt extracted from OpenAI-compatible messages. It is not the raw request body. |
| `requestBodyHash` | string | Y | Hash of the normalized request body. Never include raw credentials. |
| `requestedModel` | string | Y | Client-requested model, for example `auto`. |
| `detectors` | SafetyDetector[] | Y | Active v1 safety detector config. |

`promptText` may contain sensitive values. It is a transient sensitive input. RemoteSafetyEngine MUST NOT store, log, return, snapshot, or include `promptText` or substrings from it in errors.

SafetyDetector fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `type` | string | Y | One of the v1 detector types. |
| `enabled` | boolean | Y | Detector enabled state. |
| `action` | string | Y | `redact` or `block`. |
| `placeholder` | string | Y | Replacement token for preview generation. |

Allowed detector types:

```text
email
phone_number
resident_registration_number
api_key
authorization_header
jwt
private_key
```

Example:

```json
{
  "promptText": "Send a short support reply to demo@example.com.",
  "requestBodyHash": "hash_request_body_v1_demo",
  "requestedModel": "auto",
  "detectors": [
    {
      "type": "email",
      "enabled": true,
      "action": "redact",
      "placeholder": "[EMAIL_REDACTED]"
    }
  ]
}
```

## 6. SafetyDecision Schema

RemoteSafetyEngine returns the v1 `SafetyDecision` shape under the endpoint response envelope.

| Field | Type | Required | Notes |
|---|---|---:|---|
| `action` | string | Y | `none`, `redacted`, or `blocked`. |
| `detectedTypes` | string[] | Y | Unique detector type list. |
| `detectedCount` | integer | Y | Total detection count. Must be `>= detectedTypes.length`. |
| `redactedPromptPreview` | string or null | Y | Short redacted preview only. Must not include raw sensitive values. |
| `blockReason` | string or null | Y | v1 blocking reason. |
| `securityPolicyHash` | string | Y | Echoes the active safety policy hash used for evaluation. |

Action values:

| Value | Meaning |
|---|---|
| `none` | No detector matched. This is the v1 allow-equivalent value. |
| `redacted` | One or more redact detectors matched. |
| `blocked` | One or more block detectors matched. |

Do not use `allow`, `redact`, or `block` as `SafetyDecision.action` values in v1.

Reason code:

- v1 allows `blockReason=null` for `none` and `redacted`.
- v1 allows `blockReason="sensitive_data_blocked"` for `blocked`.
- timeout, 5xx, invalid response, or validation failure are adapter/service errors, not `SafetyDecision.blockReason` values.

`detectedTypeCounts` is not a first-class `SafetyDecision` field in v1. If present, it belongs only under response `metadata` and Gateway/Observability MUST NOT rely on it in v1.

RemoteSafetyEngine response MUST NOT include:

- raw detected value.
- detected offset.
- sensitive sample.
- raw prompt fragment.
- raw request body.
- Authorization header.
- API Key, App Token, or Provider credential material.

## 7. FastAPI Endpoint Contract

### 7.1 Endpoints

| Method | Path | Required for v1 smoke | Notes |
|---|---|---:|---|
| `POST` | `/internal/v1/safety/evaluate` | N | Internal shadow/evaluation endpoint. |
| `GET` | `/healthz` | N for Gateway smoke | Process alive check for AI Service. |
| `GET` | `/readyz` | N for Gateway smoke | AI Service dependency readiness check. |

Gateway `/readyz` MUST NOT treat RemoteSafetyEngine readiness as a required v1 dependency.

### 7.2 Versioning

The endpoint uses path versioning:

```text
/internal/v1/safety/evaluate
```

The request body also carries a contract version:

```text
remote-safety.v1
```

Breaking request/response changes require a new contract version and either a new path version or explicit dual-version support.

### 7.3 Request Body

Top-level shape:

```json
{
  "contractVersion": "remote-safety.v1",
  "ctx": {
    "requestId": "request_01J...",
    "traceId": "trace_01J...",
    "tenantId": "tenant_01J...",
    "projectId": "project_01J...",
    "applicationId": "app_01J...",
    "configHash": "hash_runtime_config_v1_demo",
    "securityPolicyHash": "hash_security_policy_v1_demo",
    "routingPolicyHash": "hash_routing_policy_v1_demo",
    "policyMode": "rule_based",
    "remoteSafetyMode": "shadow"
  },
  "input": {
    "promptText": "Send a short support reply to demo@example.com.",
    "requestBodyHash": "hash_request_body_v1_demo",
    "requestedModel": "auto",
    "detectors": [
      {
        "type": "email",
        "enabled": true,
        "action": "redact",
        "placeholder": "[EMAIL_REDACTED]"
      }
    ]
  }
}
```

All JSON fields use `camelCase`.

### 7.4 Success Response

Response uses an envelope so decision and non-authoritative metadata stay separate.

HTTP status: `200`.

```json
{
  "decision": {
    "action": "redacted",
    "detectedTypes": ["email"],
    "detectedCount": 1,
    "redactedPromptPreview": "Send a short support reply to [EMAIL_REDACTED].",
    "blockReason": null,
    "securityPolicyHash": "hash_security_policy_v1_demo"
  },
  "metadata": {
    "contractVersion": "remote-safety.v1",
    "engineVersion": "safety-lab-local",
    "latencyMs": 12,
    "detectedTypeCounts": {
      "email": 1
    }
  }
}
```

Gateway adapter converts only `decision` into `SafetyDecision`. `metadata` is shadow/evaluation-only and MUST NOT affect v1 production behavior.

### 7.5 Validation Error Response

FastAPI/Pydantic default validation errors MUST NOT be returned directly if they echo rejected input values. Return a sanitized error shape instead.

HTTP status: `400`.

```json
{
  "error": {
    "code": "invalid_remote_safety_request",
    "message": "Invalid remote safety request.",
    "requestId": "request_01J...",
    "retryable": false,
    "fields": [
      {
        "path": "input.promptText",
        "code": "required"
      }
    ]
  }
}
```

Rules:

- `requestId` uses `ctx.requestId` when it is valid and available. Otherwise the service generates a new request id for error correlation.
- `message` must be static and must not include raw input.
- `fields[].path` may include only field paths.
- `fields[].code` may include only stable validation codes.
- rejected values, prompt text, raw headers, credentials, provider error bodies, and exception strings MUST NOT be returned.
- logs for validation failures may include `requestId`, `tenantId`, and operation name, but not `promptText`.

### 7.6 Service Error Response

Service errors use the same sanitized envelope.

HTTP status: `503` for unavailable dependency or timeout, `500` for unexpected internal error.

```json
{
  "error": {
    "code": "remote_safety_unavailable",
    "message": "Remote safety service is unavailable.",
    "requestId": "request_01J...",
    "retryable": true,
    "fields": []
  }
}
```

Gateway treats RemoteSafetyEngine timeout, 5xx, invalid response, and validation failure as remote safety adapter failures. These failures MUST NOT fail the client request in v1 and MUST NOT override the rule-based decision.

## 8. Gateway Fallback and Shadow Behavior

Current v1 runtime config keeps:

```json
{
  "remoteSafety": {
    "enabled": false,
    "mode": "disabled"
  }
}
```

When `remoteSafety.enabled=false`, Gateway does not call `/internal/v1/safety/evaluate`.

Introducing `mode=shadow` into active Gateway runtime config requires a separate docs/schema contract change. If shadow mode is introduced:

- remote result remains non-authoritative.
- rule-based safety remains the production decision.
- remote timeout, 5xx, invalid response, or validation error does not fail the request.
- sync shadow timeout should default to 300 ms.
- sync shadow timeout upper bound should not exceed 1 second.
- model-based heavy evaluation belongs in offline/async evaluation, not the Gateway hot path.

v1 Invocation Log does not store remote safety output. If remote safety output must be observable, add `metadata.remoteSafety` or equivalent fields through a separate Observability contract change.

## 9. Security Checklist

RemoteSafetyEngine implementation and tests must verify:

- raw API Key, raw App Token, Authorization header, and Provider credentials never enter request/response/error/log output.
- `promptText` is treated as transient sensitive input.
- raw prompt, raw response, raw detected value, raw prompt fragment, detected offset, and sensitive sample are not returned.
- validation errors are sanitized and do not echo rejected values.
- `redactedPromptPreview` contains only redacted placeholders for detected sensitive values.
- service failure cannot break v1 smoke or production Gateway main path.
