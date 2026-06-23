# GateLM API Spec

> P0 범위 안내: 이 문서는 장기 API 계약을 포함한다. 현재 구현 목표는 `docs/p0/p0-contract.md`와 `docs/p0/implementation-cut.md`의 P0 API 목록을 우선한다. P0 cache status는 `hit/miss/bypass/error`만 사용하고 exact 여부는 `cacheType=exact`로 표현한다. P0 `stream=true` 거부는 HTTP 400 `streaming_not_supported`다. 이 문서의 `MVP` 또는 `1차 구현` 표현이 P0 문서와 충돌하면 P1/P2 후보 또는 참고 설계로 본다.

## 문서 목적

이 문서는 GateLM의 HTTP API 구현 기준이다. NestJS Control Plane API, Go Gateway API, Next.js Web Console, Chat UI, SDK, 테스트 코드가 이 문서를 기준으로 구현된다.

GateLM은 단순 Chat UI가 아니라 **확장 가능한 LLM Gateway 플랫폼**이다. 따라서 API는 현재 MVP만 맞추는 방식이 아니라, Provider, Model, 정책 대상, 배포 방식, 분석 데이터가 늘어나도 기존 계약을 깨지 않도록 설계한다.

---

# 0. 핵심 API 원칙

## 0.1 확장 가능성 원칙

모든 API는 아래 기준을 따른다.

- Provider와 Model은 DB enum처럼 고정하지 않는다. API에서도 `provider`, `model`은 `string`으로 받는다.
- 정책 적용 대상은 특정 엔드포인트에 고정하지 않고 `target.type + target.id` 구조를 기본으로 한다.
- 응답에는 `metadata` 객체를 허용한다. 단, 핵심 비즈니스 필드를 `metadata`에 숨기지 않는다.
- list API는 처음부터 cursor pagination을 지원한다.
- 신규 필드 추가는 backward-compatible해야 한다.
- 기존 필드의 의미 변경, 타입 변경, 삭제는 금지한다.
- 클라이언트는 알 수 없는 enum-like string을 무시하거나 그대로 표시할 수 있어야 한다.
- 대량 로그/분석 조회는 PostgreSQL이 아니라 Analytics API를 통해 ClickHouse 기준으로 조회한다.
- Provider credential, API Key, App Token 원문은 생성/회전 응답에서만 1회 반환한다.

## 0.2 Gateway 우선 원칙

- 고객사 앱, 개발 도구, GateLM Chat UI는 LLM Provider를 직접 호출하지 않는다.
- LLM 호출은 반드시 Gateway API를 통과한다.
- Control Plane API는 설정, 키, 정책, 로그 조회를 담당한다.
- Gateway API는 인증, 정책 검사, Rate Limit, Quota, 마스킹, 캐시, 라우팅, Provider 호출, 이벤트 발행을 담당한다.
- 민감정보 detector/action/replacement와 저장 전 redaction 기준은 `pii-masking-policy.md`를 따른다.
- 마스킹 action의 API 표시값은 `none`, `redacted`, `blocked`를 우선 사용한다.

## 0.3 원문 저장 최소화 원칙

- Request Log API는 기본적으로 원문 Prompt/Response를 반환하지 않는다.
- 반환 가능한 payload는 `redactedPrompt`, `responseSummary`, `promptHash`, `responseHash`, token/cost/latency/cache/routing/masking metadata다.
- 민감정보 detector, action, replacement token, 저장/전송 정책, error response 기준은 `pii-masking-policy.md`를 따른다.
- Gateway API의 masking 표시값은 `none`, `redacted`, `blocked`를 우선 사용한다.
- 원문 저장이 필요한 기능은 별도 tenant 설정과 retention 정책이 먼저 있어야 하며, MVP 기본 API에는 포함하지 않는다.

## 0.4 계약 우선 원칙

- 이 문서에 없는 API를 구현하지 않는다.
- API 변경이 필요하면 먼저 `api-spec.md`를 수정하고, 이후 OpenAPI/YAML, DTO, Controller, 테스트를 수정한다.
- 임시 API가 필요해도 `experimental` 또는 `internal` 영역에 명시한 뒤 구현한다.

---

# 1. API 영역과 Base URL

| 영역 | Base URL | 담당 서비스 | 설명 |
|---|---:|---|---|
| Control Plane API | `/api` | NestJS | Tenant, User, Project, Key, Policy, Budget, Dashboard, Log 조회 |
| Gateway API | `/v1` | Go Gateway Core | OpenAI-compatible LLM 호출 API |
| Health API | `/healthz`, `/readyz` | 각 서비스 | 배포/로드밸런서 상태 확인 |
| Internal API | `/internal` | 내부 서비스 | Worker, 운영 스크립트용. 외부 공개 금지 |

Control Plane API는 현재 `/api`를 사용한다. 향후 breaking change가 필요하면 `/api/v2`를 추가하고 `/api`는 유지한다.

Gateway API는 OpenAI-compatible ecosystem과 호환되도록 `/v1`을 사용한다.

---

# 2. 공통 규칙

## 2.1 JSON Naming

API Request/Response JSON은 `camelCase`를 사용한다.

```json
{
  "projectId": "project_01J...",
  "createdAt": "2026-06-22T06:00:00.000Z"
}
```

DB column은 `snake_case`를 사용하지만 API에 노출하지 않는다.

## 2.2 ID 기준

API에 노출하는 ID는 opaque string이다.

예시:

```text
user_01J...
tenant_01J...
project_01J...
app_01J...
api_key_01J...
app_token_01J...
policy_01J...
request_01J...
```

클라이언트는 ID 내부 구조에 의존하면 안 된다.

## 2.3 Time 기준

모든 timestamp는 UTC ISO-8601 문자열이다.

```json
{
  "createdAt": "2026-06-22T06:00:00.000Z",
  "updatedAt": "2026-06-22T06:10:00.000Z"
}
```

## 2.4 Pagination

List API는 cursor pagination을 기본으로 한다.

Request query:

```text
?limit=50&cursor=eyJ...&sort=-createdAt
```

Response body:

```json
{
  "data": [],
  "pagination": {
    "limit": 50,
    "nextCursor": null,
    "hasMore": false
  }
}
```

기준:

- `limit` 기본값: `50`
- `limit` 최대값: `200`
- 정렬 기본값: `-createdAt`
- 대량 로그 API는 `from`, `to` 기간 필터를 요구할 수 있다.

## 2.5 Request Header

공통 권장 헤더:

| Header | 필요 여부 | 설명 |
|---|---:|---|
| `Authorization` | API별 상이 | Control Plane JWT 또는 Gateway API Key |
| `Content-Type: application/json` | JSON 요청 필수 | Request body가 JSON일 때 사용 |
| `Idempotency-Key` | 생성/회전 요청 권장 | 중복 생성 방지 |
| `X-GateLM-Tenant-Id` | 다중 tenant 사용자 선택 시 선택 | Control Plane에서 현재 tenant 명시 |
| `X-GateLM-Request-Id` | 선택 | 클라이언트가 요청 추적 ID를 지정할 때 사용 |

Gateway 전용 헤더:

| Header | 필요 여부 | 설명 |
|---|---:|---|
| `Authorization: Bearer <apiKey>` | 필수 | Gateway API Key |
| `X-GateLM-App-Token` | 정책에 따라 필수 | Application 접근 토큰 |
| `X-GateLM-End-User-Id` | 선택 | 고객사 내부 사용자 ID. 로그와 정책 판단에 사용 |
| `X-GateLM-Feature-Id` | 선택 | 고객사 기능 ID. 비용/로그 분석에 사용 |
| `X-GateLM-Debug` | 선택 | `true`일 때 응답 metadata 확장. 운영에서는 제한 가능 |

## 2.6 Control Plane 인증

Control Plane API는 기본적으로 JWT Bearer 인증을 사용한다.

```text
Authorization: Bearer <accessToken>
```

인증이 필요한 API는 다음을 확인한다.

1. Access Token 유효성
2. Tenant membership
3. Project membership 또는 Tenant role
4. 요청 리소스가 같은 tenant에 속하는지
5. 필요한 permission scope

## 2.7 Gateway 인증

Gateway API는 API Key와 App Token을 분리한다.

```text
Authorization: Bearer glm_api_xxxxxxxxx
X-GateLM-App-Token: glm_app_token_xxxxxxxxx
```

기준:

- API Key는 tenant/project/application scope를 식별한다.
- App Token은 실제 애플리케이션 접근 권한을 검증한다.
- 정책에 따라 App Token을 optional로 둘 수 있지만, 고객사 앱 연동의 기본은 App Token 검증을 활성화한다.
- Gateway 인증 실패는 Provider 호출 전에 즉시 차단한다.

## 2.8 Role 기준

| Role | 설명 |
|---|---|
| `tenant_admin` | Tenant 전체 설정, 사용자, Provider Key, 전사 정책 관리 |
| `project_admin` | Project 설정, API Key/App Token, 정책, 예산 관리 |
| `developer` | Gateway 연동용 Key/Token 조회, 로그 조회 |
| `employee` | Chat UI 사용 |
| `service_admin` | GateLM 운영자. 내부 운영 API에만 사용 |

권한은 role만으로 끝내지 않고 `permission scope`를 함께 확인한다.

## 2.9 공통 성공 응답 Envelope

Control Plane API는 기본적으로 아래 envelope을 사용한다.

단건:

```json
{
  "data": {
    "id": "project_01J..."
  }
}
```

목록:

```json
{
  "data": [],
  "pagination": {
    "limit": 50,
    "nextCursor": null,
    "hasMore": false
  }
}
```

Gateway API는 OpenAI-compatible response shape을 우선한다. 따라서 Gateway API는 Control Plane envelope을 사용하지 않는다.

## 2.10 공통 Error Response

Control Plane API error shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request body is invalid.",
    "details": {
      "fieldErrors": {
        "name": ["name is required"]
      }
    },
    "requestId": "request_01J...",
    "retryable": false
  }
}
```

Gateway API error shape은 OpenAI-compatible 형식을 따른다.

```json
{
  "error": {
    "message": "Project quota exceeded.",
    "type": "gatelm_quota_error",
    "param": null,
    "code": "quota_exceeded",
    "request_id": "request_01J..."
  }
}
```

## 2.11 공통 Error Code

| HTTP Status | Control Plane Code | Gateway Code | 설명 |
|---:|---|---|---|
| 400 | `VALIDATION_ERROR` | `invalid_request_error` | 요청 형식 오류 |
| 401 | `UNAUTHENTICATED` | `invalid_api_key` | 인증 실패 |
| 403 | `FORBIDDEN` | `permission_denied` | 권한 없음 |
| 404 | `NOT_FOUND` | `not_found` | 리소스 없음 |
| 409 | `CONFLICT` | `conflict` | 중복/상태 충돌 |
| 422 | `POLICY_VALIDATION_FAILED` | `policy_validation_failed` | 정책 검증 실패 |
| 429 | `RATE_LIMITED` | `rate_limited` | Rate Limit 초과 |
| 429 | `QUOTA_EXCEEDED` | `quota_exceeded` | Quota 초과 |
| 402 | `BUDGET_EXCEEDED` | `budget_exceeded` | 예산 초과로 차단 |
| 403 | `POLICY_BLOCKED` | `policy_blocked` | Runtime Policy 차단 |
| 403 | `SENSITIVE_DATA_BLOCKED` | `sensitive_data_blocked` | 민감정보 정책 차단 |
| 502 | `PROVIDER_ERROR` | `provider_error` | Provider 오류 |
| 504 | `PROVIDER_TIMEOUT` | `provider_timeout` | Provider timeout |
| 500 | `INTERNAL_ERROR` | `internal_error` | 내부 오류 |

## 2.12 상태값 확장 기준

상태값은 string으로 둔다. 서버는 아래 값을 우선 사용하되, 클라이언트는 새로운 값이 추가되어도 깨지면 안 된다.

공통 status 예시:

```text
active, inactive, pending, revoked, expired, deleted, archived
```

정책 action 예시:

```text
allow, block, warn, mask, route, fallback
```

---

# 3. Endpoint Summary

## 3.1 Auth / Account

| Method | Endpoint | 인증 | 설명 |
|---|---|---:|---|
| POST | `/api/auth/signup` | No | 기업 Admin 계정 생성 |
| POST | `/api/auth/login` | No | 로그인 |
| POST | `/api/auth/refresh` | Refresh Token | Access Token 재발급 |
| POST | `/api/auth/logout` | Yes | 로그아웃 |
| GET | `/api/auth/me` | Yes | 현재 사용자/tenant/project 권한 조회 |
| POST | `/api/auth/invitations/accept` | No | 초대 수락 후 계정 연결 |

## 3.2 Tenants / Members / Invitations

| Method | Endpoint | 인증 | 설명 |
|---|---|---:|---|
| POST | `/api/tenants` | Yes | Tenant 생성 |
| GET | `/api/tenants` | Yes | 내가 속한 Tenant 목록 |
| GET | `/api/tenants/:tenantId` | Yes | Tenant 상세 |
| PATCH | `/api/tenants/:tenantId` | Tenant Admin | Tenant 수정 |
| DELETE | `/api/tenants/:tenantId` | Tenant Admin | Tenant soft delete 요청 |
| GET | `/api/tenants/:tenantId/members` | Tenant Member | Tenant member 목록 |
| PATCH | `/api/tenants/:tenantId/members/:userId` | Tenant Admin | Member role/status 수정 |
| DELETE | `/api/tenants/:tenantId/members/:userId` | Tenant Admin | Member 제거 |
| POST | `/api/tenants/:tenantId/invitations` | Tenant Admin | 사용자 초대 |
| GET | `/api/tenants/:tenantId/invitations` | Tenant Admin | 초대 목록 |
| DELETE | `/api/tenants/:tenantId/invitations/:invitationId` | Tenant Admin | 초대 취소 |

## 3.3 Projects / Project Members

| Method | Endpoint | 인증 | 설명 |
|---|---|---:|---|
| POST | `/api/projects` | Tenant Admin | Project 생성 |
| GET | `/api/projects` | Yes | Project 목록 |
| GET | `/api/projects/:projectId` | Project Member | Project 상세 |
| PATCH | `/api/projects/:projectId` | Project Admin | Project 수정 |
| DELETE | `/api/projects/:projectId` | Tenant Admin | Project soft delete |
| GET | `/api/projects/:projectId/members` | Project Member | Project member 목록 |
| PUT | `/api/projects/:projectId/members/:userId` | Project Admin | Project member 추가/수정 |
| DELETE | `/api/projects/:projectId/members/:userId` | Project Admin | Project member 제거 |

## 3.4 Applications / App Tokens

| Method | Endpoint | 인증 | 설명 |
|---|---|---:|---|
| POST | `/api/projects/:projectId/applications` | Project Admin | Application 생성 |
| GET | `/api/projects/:projectId/applications` | Project Member | Application 목록 |
| GET | `/api/applications/:applicationId` | Project Member | Application 상세 |
| PATCH | `/api/applications/:applicationId` | Project Admin | Application 수정 |
| DELETE | `/api/applications/:applicationId` | Project Admin | Application soft delete |
| POST | `/api/applications/:applicationId/app-tokens` | Project Admin | App Token 생성. 원문 1회 반환 |
| GET | `/api/applications/:applicationId/app-tokens` | Project Member | App Token 목록. 원문 미반환 |
| DELETE | `/api/app-tokens/:appTokenId` | Project Admin | App Token 폐기 |

## 3.5 API Keys

| Method | Endpoint | 인증 | 설명 |
|---|---|---:|---|
| POST | `/api/projects/:projectId/api-keys` | Project Admin | Gateway API Key 생성. 원문 1회 반환 |
| GET | `/api/projects/:projectId/api-keys` | Project Member | API Key 목록. 원문 미반환 |
| GET | `/api/api-keys/:apiKeyId` | Project Member | API Key 상세 |
| PATCH | `/api/api-keys/:apiKeyId` | Project Admin | API Key metadata/scope 수정 |
| POST | `/api/api-keys/:apiKeyId/rotate` | Project Admin | API Key 회전. 새 원문 1회 반환 |
| DELETE | `/api/api-keys/:apiKeyId` | Project Admin | API Key 폐기 |

## 3.6 Provider Connections

| Method | Endpoint | 인증 | 설명 |
|---|---|---:|---|
| POST | `/api/provider-connections` | Tenant/Project Admin | Provider credential 등록 |
| GET | `/api/provider-connections` | Tenant/Project Member | Provider connection 목록 |
| GET | `/api/provider-connections/:providerConnectionId` | Tenant/Project Member | Provider connection 상세 |
| PATCH | `/api/provider-connections/:providerConnectionId` | Tenant/Project Admin | Provider connection 수정 |
| POST | `/api/provider-connections/:providerConnectionId/test` | Tenant/Project Admin | Provider 연결 테스트 |
| POST | `/api/provider-connections/:providerConnectionId/rotate-key` | Tenant/Project Admin | Provider key 회전 |
| DELETE | `/api/provider-connections/:providerConnectionId` | Tenant/Project Admin | Provider connection 폐기 |

## 3.7 Models / Allowlist

| Method | Endpoint | 인증 | 설명 |
|---|---|---:|---|
| GET | `/api/models` | Yes | 전역 model catalog 조회 |
| GET | `/api/projects/:projectId/models` | Project Member | Project에서 사용 가능한 모델 조회 |
| PUT | `/api/projects/:projectId/models/allowlist` | Project Admin | Project model allowlist 설정 |

## 3.8 Runtime Policies / Policy Bindings

| Method | Endpoint | 인증 | 설명 |
|---|---|---:|---|
| GET | `/api/policies` | Tenant/Project Member | Policy 목록 |
| POST | `/api/policies` | Tenant/Project Admin | Policy 생성 |
| GET | `/api/policies/:policyId` | Tenant/Project Member | Policy 상세 |
| PATCH | `/api/policies/:policyId` | Tenant/Project Admin | Policy metadata 수정 |
| DELETE | `/api/policies/:policyId` | Tenant/Project Admin | Policy soft delete |
| POST | `/api/policies/validate` | Tenant/Project Admin | Policy expression 검증 |
| GET | `/api/policies/:policyId/versions` | Tenant/Project Member | Policy version 목록 |
| POST | `/api/policies/:policyId/versions` | Tenant/Project Admin | Policy version 생성 |
| POST | `/api/policies/:policyId/versions/:versionId/publish` | Tenant/Project Admin | 특정 version publish |
| POST | `/api/policies/:policyId/rollback` | Tenant/Project Admin | 이전 version으로 rollback |
| POST | `/api/policy-bindings` | Tenant/Project Admin | Policy를 target에 연결 |
| DELETE | `/api/policy-bindings/:bindingId` | Tenant/Project Admin | Policy binding 해제 |

## 3.9 Sensitive Data Rules

| Method | Endpoint | Auth | 설명 |
|---|---|---|---|
| GET | `/api/sensitive-data-rules` | Tenant/Project Member | 민감정보 탐지/마스킹 규칙 목록 |
| POST | `/api/sensitive-data-rules` | Tenant/Project Admin | tenant custom rule 생성 |
| GET | `/api/sensitive-data-rules/:ruleId` | Tenant/Project Member | 민감정보 규칙 상세 |
| PATCH | `/api/sensitive-data-rules/:ruleId` | Tenant/Project Admin | 민감정보 규칙 수정 |
| DELETE | `/api/sensitive-data-rules/:ruleId` | Tenant/Project Admin | 민감정보 규칙 soft delete |
| POST | `/api/sensitive-data-rules/validate` | Tenant/Project Admin | custom regex/keyword rule 검증 |

규칙의 detector type, 기본 action, replacement, 보안 리뷰 기준은 `pii-masking-policy.md`를 따른다. 기본 목록 API는 raw pattern을 노출하지 않고 `patternPreview` 또는 `patternHash`만 반환한다.

## 3.10 Rate Limit / Quota / Budget

| Method | Endpoint | 인증 | 설명 |
|---|---|---:|---|
| GET | `/api/projects/:projectId/rate-limit-rules` | Project Member | Rate limit rule 조회 |
| PUT | `/api/projects/:projectId/rate-limit-rules` | Project Admin | Rate limit rule 일괄 설정 |
| GET | `/api/projects/:projectId/quota-rules` | Project Member | Quota rule 조회 |
| PUT | `/api/projects/:projectId/quota-rules` | Project Admin | Quota rule 일괄 설정 |
| GET | `/api/projects/:projectId/budget-policy` | Project Member | Budget policy 조회 |
| PUT | `/api/projects/:projectId/budget-policy` | Project Admin | Budget policy 설정 |
| GET | `/api/projects/:projectId/usage/summary` | Project Member | 사용량/예산 요약 |

## 3.10 Dashboard / Logs / Analytics

| Method | Endpoint | 인증 | 설명 |
|---|---|---:|---|
| GET | `/api/dashboard/overview` | Tenant/Project Member | Dashboard overview |
| GET | `/api/projects/:projectId/logs` | Project Member | Request log 목록 |
| GET | `/api/llm-requests/:requestId` | Project Member | LLM request detail drawer |
| GET | `/api/llm-requests/:requestId/events` | Project Member | Cache/Masking/Routing/Attempt event |
| GET | `/api/analytics/costs` | Tenant/Project Member | 비용 분석 |
| GET | `/api/analytics/tokens` | Tenant/Project Member | 토큰 분석 |
| GET | `/api/analytics/latency` | Tenant/Project Member | latency/TTFT 분석 |
| GET | `/api/analytics/cache` | Tenant/Project Member | cache hit 분석 |
| GET | `/api/analytics/routing` | Tenant/Project Member | routing decision 분석 |
| GET | `/api/analytics/masking` | Tenant/Project Member | masking event 분석 |

## 3.11 Chat UI

| Method | Endpoint | 인증 | 설명 |
|---|---|---:|---|
| POST | `/api/chat/conversations` | Yes | Conversation 생성 |
| GET | `/api/chat/conversations` | Yes | Conversation 목록 |
| GET | `/api/chat/conversations/:conversationId` | Yes | Conversation 상세 |
| PATCH | `/api/chat/conversations/:conversationId` | Yes | Conversation 제목/상태 수정 |
| DELETE | `/api/chat/conversations/:conversationId` | Yes | Conversation soft delete |
| GET | `/api/chat/conversations/:conversationId/messages` | Yes | Message 목록 |
| POST | `/api/chat/conversations/:conversationId/messages` | Yes | Text-only message 생성 및 Gateway 호출 |
| GET | `/api/chat/messages/:messageId` | Yes | Message 상세 |

## 3.12 Gateway API

| Method | Endpoint | 인증 | 설명 |
|---|---|---:|---|
| GET | `/v1/models` | Gateway API Key | 사용 가능한 모델 목록. OpenAI-compatible |
| POST | `/v1/chat/completions` | Gateway API Key + App Token | Chat Completions. OpenAI-compatible, SSE streaming 지원 |

## 3.13 Health

| Method | Endpoint | 인증 | 설명 |
|---|---|---:|---|
| GET | `/healthz` | No | Process alive check |
| GET | `/readyz` | No | Dependency readiness check |

---

# 4. 공통 Schema

## 4.1 TargetRef

정책, 제한, 예산, API Key scope 등 확장 가능한 대상 참조에 사용한다.

```json
{
  "type": "project",
  "id": "project_01J..."
}
```

허용 `type` 초기값:

```text
tenant, project, group, user, application, api_key, app_token
```

향후 `department`, `environment`, `feature`, `service_account` 등을 추가할 수 있다.

## 4.2 Money

금액은 float가 아니라 decimal string으로 표현한다.

```json
{
  "amount": "120.50",
  "currency": "USD"
}
```

## 4.3 Usage

```json
{
  "promptTokens": 120,
  "completionTokens": 240,
  "totalTokens": 360,
  "contextTokens": 80,
  "cachedTokens": 0
}
```

## 4.4 Cost

```json
{
  "estimatedCostUsd": "0.001240",
  "inputCostUsd": "0.000120",
  "outputCostUsd": "0.001120",
  "cacheSavingsUsd": "0.000000"
}
```

## 4.5 Audit Actor

```json
{
  "actorType": "user",
  "actorId": "user_01J...",
  "actorEmail": "admin@example.com"
}
```

## 4.6 Metadata

```json
{
  "metadata": {
    "environment": "production",
    "team": "platform",
    "feature": "support-chat"
  }
}
```

기준:

- `metadata`는 flat object를 권장한다.
- value는 string/number/boolean/null만 권장한다.
- 민감정보, provider key, raw prompt는 저장하지 않는다.

---

# 5. Auth / Account API

## 5.1 POST `/api/auth/signup`

기업 Admin 계정을 생성한다.

인증: No

Request Body:

```json
{
  "email": "admin@example.com",
  "password": "correct-horse-battery-staple",
  "name": "Kim Admin",
  "companyName": "Example Corp",
  "metadata": {
    "signupSource": "landing"
  }
}
```

Response Body `201`:

```json
{
  "data": {
    "user": {
      "id": "user_01J...",
      "email": "admin@example.com",
      "name": "Kim Admin",
      "createdAt": "2026-06-22T06:00:00.000Z"
    },
    "accessToken": "jwt_access_token",
    "refreshToken": "jwt_refresh_token"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`: email/password/name 형식 오류
- `409 CONFLICT`: 이미 가입된 email

## 5.2 POST `/api/auth/login`

인증: No

Request Body:

```json
{
  "email": "admin@example.com",
  "password": "correct-horse-battery-staple"
}
```

Response Body `200`:

```json
{
  "data": {
    "accessToken": "jwt_access_token",
    "refreshToken": "jwt_refresh_token",
    "user": {
      "id": "user_01J...",
      "email": "admin@example.com",
      "name": "Kim Admin"
    }
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `401 UNAUTHENTICATED`

## 5.3 POST `/api/auth/refresh`

인증: Refresh Token

Request Body:

```json
{
  "refreshToken": "jwt_refresh_token"
}
```

Response Body `200`:

```json
{
  "data": {
    "accessToken": "new_jwt_access_token",
    "refreshToken": "new_jwt_refresh_token"
  }
}
```

Error Response:

- `401 UNAUTHENTICATED`: refresh token 만료 또는 폐기

## 5.4 POST `/api/auth/logout`

인증: Yes

Request Body:

```json
{
  "refreshToken": "jwt_refresh_token"
}
```

Response Body `204`: Empty

Error Response:

- `401 UNAUTHENTICATED`

## 5.5 GET `/api/auth/me`

현재 사용자와 접근 가능한 tenant/project를 조회한다.

인증: Yes

Request Body: 없음

Response Body `200`:

```json
{
  "data": {
    "user": {
      "id": "user_01J...",
      "email": "admin@example.com",
      "name": "Kim Admin"
    },
    "tenants": [
      {
        "id": "tenant_01J...",
        "name": "Example Corp",
        "role": "tenant_admin"
      }
    ],
    "projects": [
      {
        "id": "project_01J...",
        "tenantId": "tenant_01J...",
        "name": "Support Bot",
        "role": "project_admin"
      }
    ]
  }
}
```

Error Response:

- `401 UNAUTHENTICATED`

## 5.6 POST `/api/auth/invitations/accept`

초대 토큰을 수락하고 tenant membership을 생성한다.

인증: No. 이미 로그인한 사용자가 호출할 수도 있다.

Request Body:

```json
{
  "invitationToken": "invite_token",
  "email": "employee@example.com",
  "password": "optional-if-new-user",
  "name": "Lee Employee"
}
```

Response Body `200`:

```json
{
  "data": {
    "tenantId": "tenant_01J...",
    "userId": "user_01J...",
    "role": "employee",
    "accessToken": "jwt_access_token",
    "refreshToken": "jwt_refresh_token"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `404 NOT_FOUND`: 초대 토큰 없음
- `409 CONFLICT`: 이미 수락된 초대

---

# 6. Tenant / Member / Invitation API

## 6.1 POST `/api/tenants`

Tenant를 생성한다.

인증: Yes

Request Body:

```json
{
  "name": "Example Corp",
  "slug": "example-corp",
  "plan": "starter",
  "metadata": {
    "industry": "software"
  }
}
```

Response Body `201`:

```json
{
  "data": {
    "id": "tenant_01J...",
    "name": "Example Corp",
    "slug": "example-corp",
    "plan": "starter",
    "status": "active",
    "createdAt": "2026-06-22T06:00:00.000Z",
    "updatedAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `409 CONFLICT`: slug 중복

## 6.2 GET `/api/tenants`

인증: Yes

Query Parameters:

| Name | Required | 설명 |
|---|---:|---|
| `limit` | No | 기본 50 |
| `cursor` | No | 다음 페이지 cursor |

Request Body: 없음

Response Body `200`:

```json
{
  "data": [
    {
      "id": "tenant_01J...",
      "name": "Example Corp",
      "slug": "example-corp",
      "status": "active",
      "role": "tenant_admin",
      "createdAt": "2026-06-22T06:00:00.000Z",
      "updatedAt": "2026-06-22T06:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "nextCursor": null,
    "hasMore": false
  }
}
```

Error Response:

- `401 UNAUTHENTICATED`

## 6.3 GET `/api/tenants/:tenantId`

인증: Tenant Member

Request Body: 없음

Response Body `200`:

```json
{
  "data": {
    "id": "tenant_01J...",
    "name": "Example Corp",
    "slug": "example-corp",
    "plan": "starter",
    "status": "active",
    "settings": {
      "rawPayloadStorageEnabled": false,
      "defaultRetentionDays": 90
    },
    "createdAt": "2026-06-22T06:00:00.000Z",
    "updatedAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `401 UNAUTHENTICATED`
- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 6.4 PATCH `/api/tenants/:tenantId`

인증: Tenant Admin

Request Body:

```json
{
  "name": "Example Corporation",
  "settings": {
    "defaultRetentionDays": 90,
    "rawPayloadStorageEnabled": false
  },
  "metadata": {
    "industry": "software"
  }
}
```

Response Body `200`:

```json
{
  "data": {
    "id": "tenant_01J...",
    "name": "Example Corporation",
    "status": "active",
    "updatedAt": "2026-06-22T06:10:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 6.5 DELETE `/api/tenants/:tenantId`

Tenant 삭제 요청이다. 실제 삭제는 soft delete와 retention 정책을 따른다.

인증: Tenant Admin

Request Body:

```json
{
  "reason": "customer_requested",
  "confirm": true
}
```

Response Body `202`:

```json
{
  "data": {
    "id": "tenant_01J...",
    "status": "deletion_requested",
    "requestedAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`
- `409 CONFLICT`: 삭제할 수 없는 상태

## 6.6 GET `/api/tenants/:tenantId/members`

인증: Tenant Member

Query Parameters:

| Name | Required | 설명 |
|---|---:|---|
| `role` | No | role filter |
| `status` | No | status filter |
| `limit` | No | pagination |
| `cursor` | No | pagination |

Request Body: 없음

Response Body `200`:

```json
{
  "data": [
    {
      "userId": "user_01J...",
      "email": "employee@example.com",
      "name": "Lee Employee",
      "role": "employee",
      "status": "active",
      "joinedAt": "2026-06-22T06:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "nextCursor": null,
    "hasMore": false
  }
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 6.7 PATCH `/api/tenants/:tenantId/members/:userId`

인증: Tenant Admin

Request Body:

```json
{
  "role": "project_admin",
  "status": "active"
}
```

Response Body `200`:

```json
{
  "data": {
    "tenantId": "tenant_01J...",
    "userId": "user_01J...",
    "role": "project_admin",
    "status": "active",
    "updatedAt": "2026-06-22T06:10:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 6.8 DELETE `/api/tenants/:tenantId/members/:userId`

인증: Tenant Admin

Request Body:

```json
{
  "reason": "left_company"
}
```

Response Body `204`: Empty

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`
- `409 CONFLICT`: 마지막 tenant_admin 제거 시도

## 6.9 POST `/api/tenants/:tenantId/invitations`

인증: Tenant Admin

Request Body:

```json
{
  "email": "new.employee@example.com",
  "role": "employee",
  "projectIds": ["project_01J..."],
  "expiresAt": "2026-07-22T06:00:00.000Z"
}
```

Response Body `201`:

```json
{
  "data": {
    "id": "invitation_01J...",
    "tenantId": "tenant_01J...",
    "email": "new.employee@example.com",
    "role": "employee",
    "status": "pending",
    "inviteUrl": "https://app.gatelm.example/invitations/accept?token=...",
    "expiresAt": "2026-07-22T06:00:00.000Z",
    "createdAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`
- `409 CONFLICT`: 이미 active member

## 6.10 GET `/api/tenants/:tenantId/invitations`

인증: Tenant Admin

Request Body: 없음

Response Body `200`:

```json
{
  "data": [
    {
      "id": "invitation_01J...",
      "email": "new.employee@example.com",
      "role": "employee",
      "status": "pending",
      "expiresAt": "2026-07-22T06:00:00.000Z",
      "createdAt": "2026-06-22T06:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "nextCursor": null,
    "hasMore": false
  }
}
```

Error Response:

- `403 FORBIDDEN`

## 6.11 DELETE `/api/tenants/:tenantId/invitations/:invitationId`

인증: Tenant Admin

Request Body:

```json
{
  "reason": "sent_to_wrong_email"
}
```

Response Body `204`: Empty

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`
- `409 CONFLICT`: 이미 수락됨

---

# 7. Project API

## 7.1 POST `/api/projects`

Project를 생성한다.

인증: Tenant Admin

Request Body:

```json
{
  "tenantId": "tenant_01J...",
  "name": "Support Bot",
  "slug": "support-bot",
  "description": "Customer support LLM workload",
  "metadata": {
    "environment": "production",
    "ownerTeam": "support-platform"
  }
}
```

Response Body `201`:

```json
{
  "data": {
    "id": "project_01J...",
    "tenantId": "tenant_01J...",
    "name": "Support Bot",
    "slug": "support-bot",
    "status": "active",
    "createdAt": "2026-06-22T06:00:00.000Z",
    "updatedAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`
- `409 CONFLICT`: tenant 내 slug 중복

## 7.2 GET `/api/projects`

인증: Yes

Query Parameters:

| Name | Required | 설명 |
|---|---:|---|
| `tenantId` | 권장 | Tenant 기준 조회 |
| `status` | No | status filter |
| `limit` | No | pagination |
| `cursor` | No | pagination |

Request Body: 없음

Response Body `200`:

```json
{
  "data": [
    {
      "id": "project_01J...",
      "tenantId": "tenant_01J...",
      "name": "Support Bot",
      "slug": "support-bot",
      "status": "active",
      "role": "project_admin",
      "createdAt": "2026-06-22T06:00:00.000Z",
      "updatedAt": "2026-06-22T06:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "nextCursor": null,
    "hasMore": false
  }
}
```

Error Response:

- `401 UNAUTHENTICATED`
- `403 FORBIDDEN`

## 7.3 GET `/api/projects/:projectId`

인증: Project Member

Request Body: 없음

Response Body `200`:

```json
{
  "data": {
    "id": "project_01J...",
    "tenantId": "tenant_01J...",
    "name": "Support Bot",
    "slug": "support-bot",
    "description": "Customer support LLM workload",
    "status": "active",
    "settings": {
      "appTokenRequired": true,
      "defaultCacheMode": "auto",
      "defaultRoutingMode": "auto"
    },
    "createdAt": "2026-06-22T06:00:00.000Z",
    "updatedAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 7.4 PATCH `/api/projects/:projectId`

인증: Project Admin

Request Body:

```json
{
  "name": "Support Assistant",
  "description": "Support LLM workload",
  "settings": {
    "appTokenRequired": true,
    "defaultCacheMode": "auto",
    "defaultRoutingMode": "auto"
  },
  "metadata": {
    "ownerTeam": "support-platform"
  }
}
```

Response Body `200`:

```json
{
  "data": {
    "id": "project_01J...",
    "name": "Support Assistant",
    "updatedAt": "2026-06-22T06:10:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 7.5 DELETE `/api/projects/:projectId`

인증: Tenant Admin

Request Body:

```json
{
  "reason": "project_archived"
}
```

Response Body `202`:

```json
{
  "data": {
    "id": "project_01J...",
    "status": "archived",
    "deletedAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`
- `409 CONFLICT`: active API Key가 있어 archive 전 확인 필요

## 7.6 GET `/api/projects/:projectId/members`

인증: Project Member

Request Body: 없음

Response Body `200`:

```json
{
  "data": [
    {
      "userId": "user_01J...",
      "email": "developer@example.com",
      "name": "Park Dev",
      "role": "developer",
      "status": "active",
      "createdAt": "2026-06-22T06:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "nextCursor": null,
    "hasMore": false
  }
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 7.7 PUT `/api/projects/:projectId/members/:userId`

Project membership을 추가하거나 role을 수정한다.

인증: Project Admin

Request Body:

```json
{
  "role": "developer",
  "status": "active"
}
```

Response Body `200`:

```json
{
  "data": {
    "projectId": "project_01J...",
    "userId": "user_01J...",
    "role": "developer",
    "status": "active",
    "updatedAt": "2026-06-22T06:10:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 7.8 DELETE `/api/projects/:projectId/members/:userId`

인증: Project Admin

Request Body:

```json
{
  "reason": "no_longer_on_project"
}
```

Response Body `204`: Empty

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`
- `409 CONFLICT`: 마지막 project_admin 제거 시도

---

# 8. Applications / App Tokens API

## 8.1 POST `/api/projects/:projectId/applications`

Gateway를 호출할 고객사 애플리케이션을 등록한다.

인증: Project Admin

Request Body:

```json
{
  "name": "Support Web App",
  "slug": "support-web-app",
  "description": "Production support frontend",
  "environment": "production",
  "metadata": {
    "service": "support-web"
  }
}
```

Response Body `201`:

```json
{
  "data": {
    "id": "app_01J...",
    "projectId": "project_01J...",
    "name": "Support Web App",
    "slug": "support-web-app",
    "environment": "production",
    "status": "active",
    "createdAt": "2026-06-22T06:00:00.000Z",
    "updatedAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`
- `409 CONFLICT`: project 내 slug 중복

## 8.2 GET `/api/projects/:projectId/applications`

인증: Project Member

Request Body: 없음

Response Body `200`:

```json
{
  "data": [
    {
      "id": "app_01J...",
      "projectId": "project_01J...",
      "name": "Support Web App",
      "environment": "production",
      "status": "active",
      "createdAt": "2026-06-22T06:00:00.000Z",
      "updatedAt": "2026-06-22T06:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "nextCursor": null,
    "hasMore": false
  }
}
```

Error Response:

- `403 FORBIDDEN`

## 8.3 GET `/api/applications/:applicationId`

인증: Project Member

Request Body: 없음

Response Body `200`:

```json
{
  "data": {
    "id": "app_01J...",
    "projectId": "project_01J...",
    "name": "Support Web App",
    "slug": "support-web-app",
    "environment": "production",
    "status": "active",
    "metadata": {
      "service": "support-web"
    },
    "createdAt": "2026-06-22T06:00:00.000Z",
    "updatedAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 8.4 PATCH `/api/applications/:applicationId`

인증: Project Admin

Request Body:

```json
{
  "name": "Support Web App",
  "description": "Updated description",
  "status": "active",
  "metadata": {
    "service": "support-web"
  }
}
```

Response Body `200`:

```json
{
  "data": {
    "id": "app_01J...",
    "status": "active",
    "updatedAt": "2026-06-22T06:10:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 8.5 DELETE `/api/applications/:applicationId`

인증: Project Admin

Request Body:

```json
{
  "reason": "application_retired"
}
```

Response Body `202`:

```json
{
  "data": {
    "id": "app_01J...",
    "status": "archived",
    "deletedAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 8.6 POST `/api/applications/:applicationId/app-tokens`

Application 접근용 App Token을 생성한다. 원문 token은 이 응답에서만 1회 반환한다.

인증: Project Admin

Request Body:

```json
{
  "name": "Production token",
  "expiresAt": "2026-12-31T23:59:59.000Z",
  "scopes": ["gateway:chat.completions"],
  "allowedIpCidrs": ["203.0.113.0/24"],
  "metadata": {
    "owner": "support-platform"
  }
}
```

Response Body `201`:

```json
{
  "data": {
    "id": "app_token_01J...",
    "applicationId": "app_01J...",
    "name": "Production token",
    "token": "glm_app_token_xxxxxxxxxxxxxxxxx",
    "tokenPreview": "glm_app_token_xxxx...wxyz",
    "scopes": ["gateway:chat.completions"],
    "status": "active",
    "expiresAt": "2026-12-31T23:59:59.000Z",
    "createdAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`
- `409 CONFLICT`: 같은 이름의 active token 존재

## 8.7 GET `/api/applications/:applicationId/app-tokens`

App Token 목록을 조회한다. 원문 token은 반환하지 않는다.

인증: Project Member

Request Body: 없음

Response Body `200`:

```json
{
  "data": [
    {
      "id": "app_token_01J...",
      "applicationId": "app_01J...",
      "name": "Production token",
      "tokenPreview": "glm_app_token_xxxx...wxyz",
      "scopes": ["gateway:chat.completions"],
      "status": "active",
      "lastUsedAt": "2026-06-22T06:20:00.000Z",
      "expiresAt": "2026-12-31T23:59:59.000Z",
      "createdAt": "2026-06-22T06:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "nextCursor": null,
    "hasMore": false
  }
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 8.8 DELETE `/api/app-tokens/:appTokenId`

App Token을 폐기한다. Hard delete가 아니라 revoke 처리한다.

인증: Project Admin

Request Body:

```json
{
  "reason": "rotation"
}
```

Response Body `200`:

```json
{
  "data": {
    "id": "app_token_01J...",
    "status": "revoked",
    "revokedAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`
- `409 CONFLICT`: 이미 revoked

---

# 9. API Keys API

## 9.1 POST `/api/projects/:projectId/api-keys`

Gateway API Key를 생성한다. 원문 key는 이 응답에서만 1회 반환한다.

인증: Project Admin

Request Body:

```json
{
  "name": "Production Gateway Key",
  "scopes": ["gateway:chat.completions", "gateway:models.read"],
  "applicationId": "app_01J...",
  "expiresAt": "2026-12-31T23:59:59.000Z",
  "allowedIpCidrs": ["203.0.113.0/24"],
  "metadata": {
    "environment": "production"
  }
}
```

Response Body `201`:

```json
{
  "data": {
    "id": "api_key_01J...",
    "projectId": "project_01J...",
    "applicationId": "app_01J...",
    "name": "Production Gateway Key",
    "key": "glm_api_xxxxxxxxxxxxxxxxx",
    "keyPreview": "glm_api_xxxx...wxyz",
    "scopes": ["gateway:chat.completions", "gateway:models.read"],
    "status": "active",
    "expiresAt": "2026-12-31T23:59:59.000Z",
    "createdAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`
- `409 CONFLICT`: 같은 이름의 active key 존재

## 9.2 GET `/api/projects/:projectId/api-keys`

인증: Project Member

Request Body: 없음

Response Body `200`:

```json
{
  "data": [
    {
      "id": "api_key_01J...",
      "projectId": "project_01J...",
      "applicationId": "app_01J...",
      "name": "Production Gateway Key",
      "keyPreview": "glm_api_xxxx...wxyz",
      "scopes": ["gateway:chat.completions", "gateway:models.read"],
      "status": "active",
      "lastUsedAt": "2026-06-22T06:20:00.000Z",
      "expiresAt": "2026-12-31T23:59:59.000Z",
      "createdAt": "2026-06-22T06:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "nextCursor": null,
    "hasMore": false
  }
}
```

Error Response:

- `403 FORBIDDEN`

## 9.3 GET `/api/api-keys/:apiKeyId`

인증: Project Member

Request Body: 없음

Response Body `200`:

```json
{
  "data": {
    "id": "api_key_01J...",
    "projectId": "project_01J...",
    "applicationId": "app_01J...",
    "name": "Production Gateway Key",
    "keyPreview": "glm_api_xxxx...wxyz",
    "scopes": ["gateway:chat.completions", "gateway:models.read"],
    "allowedIpCidrs": ["203.0.113.0/24"],
    "status": "active",
    "lastUsedAt": "2026-06-22T06:20:00.000Z",
    "expiresAt": "2026-12-31T23:59:59.000Z",
    "createdAt": "2026-06-22T06:00:00.000Z",
    "updatedAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 9.4 PATCH `/api/api-keys/:apiKeyId`

인증: Project Admin

Request Body:

```json
{
  "name": "Production Gateway Key",
  "scopes": ["gateway:chat.completions", "gateway:models.read"],
  "allowedIpCidrs": ["203.0.113.0/24"],
  "status": "active",
  "metadata": {
    "environment": "production"
  }
}
```

Response Body `200`:

```json
{
  "data": {
    "id": "api_key_01J...",
    "status": "active",
    "updatedAt": "2026-06-22T06:10:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 9.5 POST `/api/api-keys/:apiKeyId/rotate`

기존 API Key를 폐기하고 새 key를 발급한다. 새 원문 key는 이 응답에서만 1회 반환한다.

인증: Project Admin

Request Body:

```json
{
  "reason": "scheduled_rotation",
  "revokePreviousImmediately": true
}
```

Response Body `201`:

```json
{
  "data": {
    "previousApiKeyId": "api_key_01J...",
    "previousStatus": "revoked",
    "apiKey": {
      "id": "api_key_01K...",
      "projectId": "project_01J...",
      "name": "Production Gateway Key",
      "key": "glm_api_new_xxxxxxxxxxxxxxxxx",
      "keyPreview": "glm_api_new_xxxx...wxyz",
      "scopes": ["gateway:chat.completions", "gateway:models.read"],
      "status": "active",
      "createdAt": "2026-06-22T06:00:00.000Z"
    }
  }
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`
- `409 CONFLICT`: 이미 revoked

## 9.6 DELETE `/api/api-keys/:apiKeyId`

인증: Project Admin

Request Body:

```json
{
  "reason": "compromised"
}
```

Response Body `200`:

```json
{
  "data": {
    "id": "api_key_01J...",
    "status": "revoked",
    "revokedAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`
- `409 CONFLICT`: 이미 revoked

---

# 10. Provider Connections API

## 10.1 POST `/api/provider-connections`

LLM Provider credential을 등록한다. Provider key 원문은 Secrets Manager에 저장하고, API 응답에는 반환하지 않는다.

인증: Tenant Admin 또는 Project Admin

Request Body:

```json
{
  "target": {
    "type": "project",
    "id": "project_01J..."
  },
  "provider": "openai",
  "name": "OpenAI Production",
  "credential": {
    "apiKey": "sk-..."
  },
  "defaultModel": "gpt-4o-mini",
  "status": "active",
  "metadata": {
    "region": "global"
  }
}
```

Response Body `201`:

```json
{
  "data": {
    "id": "provider_conn_01J...",
    "target": {
      "type": "project",
      "id": "project_01J..."
    },
    "provider": "openai",
    "name": "OpenAI Production",
    "defaultModel": "gpt-4o-mini",
    "credentialPreview": "sk-...abcd",
    "secretRef": "aws-secrets-manager://gatelm/...",
    "status": "active",
    "createdAt": "2026-06-22T06:00:00.000Z",
    "updatedAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`
- `409 CONFLICT`: 같은 target/provider active connection 중복

## 10.2 GET `/api/provider-connections`

인증: Tenant/Project Member

Query Parameters:

| Name | Required | 설명 |
|---|---:|---|
| `tenantId` | No | tenant 기준 조회 |
| `projectId` | No | project 기준 조회 |
| `provider` | No | provider filter |
| `status` | No | status filter |

Request Body: 없음

Response Body `200`:

```json
{
  "data": [
    {
      "id": "provider_conn_01J...",
      "target": {
        "type": "project",
        "id": "project_01J..."
      },
      "provider": "openai",
      "name": "OpenAI Production",
      "defaultModel": "gpt-4o-mini",
      "credentialPreview": "sk-...abcd",
      "status": "active",
      "lastTestedAt": "2026-06-22T06:20:00.000Z",
      "createdAt": "2026-06-22T06:00:00.000Z",
      "updatedAt": "2026-06-22T06:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "nextCursor": null,
    "hasMore": false
  }
}
```

Error Response:

- `403 FORBIDDEN`

## 10.3 GET `/api/provider-connections/:providerConnectionId`

인증: Tenant/Project Member

Request Body: 없음

Response Body `200`:

```json
{
  "data": {
    "id": "provider_conn_01J...",
    "target": {
      "type": "project",
      "id": "project_01J..."
    },
    "provider": "openai",
    "name": "OpenAI Production",
    "defaultModel": "gpt-4o-mini",
    "credentialPreview": "sk-...abcd",
    "status": "active",
    "health": {
      "status": "healthy",
      "lastCheckedAt": "2026-06-22T06:20:00.000Z",
      "lastError": null
    },
    "createdAt": "2026-06-22T06:00:00.000Z",
    "updatedAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 10.4 PATCH `/api/provider-connections/:providerConnectionId`

인증: Tenant/Project Admin

Request Body:

```json
{
  "name": "OpenAI Production",
  "defaultModel": "gpt-4o-mini",
  "status": "active",
  "metadata": {
    "region": "global"
  }
}
```

Response Body `200`:

```json
{
  "data": {
    "id": "provider_conn_01J...",
    "status": "active",
    "updatedAt": "2026-06-22T06:10:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 10.5 POST `/api/provider-connections/:providerConnectionId/test`

Provider credential과 기본 모델 호출 가능 여부를 테스트한다. 테스트 요청도 audit log를 남긴다.

인증: Tenant/Project Admin

Request Body:

```json
{
  "model": "gpt-4o-mini",
  "timeoutMs": 10000
}
```

Response Body `200`:

```json
{
  "data": {
    "providerConnectionId": "provider_conn_01J...",
    "provider": "openai",
    "model": "gpt-4o-mini",
    "status": "healthy",
    "latencyMs": 420,
    "testedAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`
- `502 PROVIDER_ERROR`
- `504 PROVIDER_TIMEOUT`

## 10.6 POST `/api/provider-connections/:providerConnectionId/rotate-key`

Provider credential을 회전한다. 새 credential 원문은 저장만 하고 응답하지 않는다.

인증: Tenant/Project Admin

Request Body:

```json
{
  "credential": {
    "apiKey": "sk-new-..."
  },
  "reason": "scheduled_rotation"
}
```

Response Body `200`:

```json
{
  "data": {
    "providerConnectionId": "provider_conn_01J...",
    "credentialPreview": "sk-new-...wxyz",
    "rotatedAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 10.7 DELETE `/api/provider-connections/:providerConnectionId`

Provider connection을 폐기한다. Provider key는 Secrets Manager에서 비활성화/삭제 schedule을 건다.

인증: Tenant/Project Admin

Request Body:

```json
{
  "reason": "provider_removed"
}
```

Response Body `202`:

```json
{
  "data": {
    "id": "provider_conn_01J...",
    "status": "revoked",
    "revokedAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`
- `409 CONFLICT`: active routing rule에서 사용 중

---

# 11. Models / Allowlist API

## 11.1 GET `/api/models`

전역 model catalog를 조회한다. Provider/model은 확장 가능하므로 서버가 아는 목록만 반환한다.

인증: Yes

Query Parameters:

| Name | Required | 설명 |
|---|---:|---|
| `provider` | No | provider filter |
| `capability` | No | `chat`, `embedding`, `vision` 등. MVP는 `chat` 중심 |
| `status` | No | status filter |

Request Body: 없음

Response Body `200`:

```json
{
  "data": [
    {
      "provider": "openai",
      "model": "gpt-4o-mini",
      "displayName": "GPT-4o mini",
      "capabilities": ["chat", "streaming"],
      "status": "active",
      "pricing": {
        "inputPerMillionTokensUsd": "0.150000",
        "outputPerMillionTokensUsd": "0.600000"
      },
      "metadata": {}
    }
  ],
  "pagination": {
    "limit": 50,
    "nextCursor": null,
    "hasMore": false
  }
}
```

Error Response:

- `401 UNAUTHENTICATED`

## 11.2 GET `/api/projects/:projectId/models`

Project에서 현재 사용 가능한 모델 목록을 반환한다. Provider connection, allowlist, policy를 반영한다.

인증: Project Member

Request Body: 없음

Response Body `200`:

```json
{
  "data": [
    {
      "provider": "openai",
      "model": "gpt-4o-mini",
      "alias": "fast-low-cost",
      "allowed": true,
      "defaultForRouting": true,
      "capabilities": ["chat", "streaming"],
      "reason": null
    }
  ]
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 11.3 PUT `/api/projects/:projectId/models/allowlist`

Project model allowlist를 일괄 설정한다.

인증: Project Admin

Request Body:

```json
{
  "rules": [
    {
      "provider": "openai",
      "model": "gpt-4o-mini",
      "alias": "fast-low-cost",
      "allowed": true,
      "reason": "default low-cost route"
    },
    {
      "provider": "openai",
      "model": "gpt-4o",
      "allowed": true,
      "reason": "complex tasks only"
    }
  ]
}
```

Response Body `200`:

```json
{
  "data": {
    "projectId": "project_01J...",
    "ruleCount": 2,
    "updatedAt": "2026-06-22T06:10:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`
- `404 NOT_FOUND`

---

# 12. Runtime Policies API

## 12.1 GET `/api/policies`

Policy 목록을 조회한다.

인증: Tenant/Project Member

Query Parameters:

| Name | Required | 설명 |
|---|---:|---|
| `tenantId` | No | tenant 기준 조회 |
| `projectId` | No | project 기준 조회 |
| `type` | No | `routing`, `security`, `budget`, `rate_limit`, `guardrail` |
| `status` | No | status filter |
| `limit` | No | pagination |
| `cursor` | No | pagination |

Request Body: 없음

Response Body `200`:

```json
{
  "data": [
    {
      "id": "policy_01J...",
      "tenantId": "tenant_01J...",
      "projectId": "project_01J...",
      "name": "Default Security Policy",
      "type": "security",
      "status": "active",
      "activeVersionId": "policy_ver_01J...",
      "createdAt": "2026-06-22T06:00:00.000Z",
      "updatedAt": "2026-06-22T06:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "nextCursor": null,
    "hasMore": false
  }
}
```

Error Response:

- `403 FORBIDDEN`

## 12.2 POST `/api/policies`

Policy container를 생성한다. 실제 정책 expression은 version으로 생성한다.

인증: Tenant/Project Admin

Request Body:

```json
{
  "tenantId": "tenant_01J...",
  "projectId": "project_01J...",
  "name": "Default Routing Policy",
  "type": "routing",
  "description": "Route simple requests to low-cost models",
  "metadata": {
    "owner": "platform"
  }
}
```

Response Body `201`:

```json
{
  "data": {
    "id": "policy_01J...",
    "tenantId": "tenant_01J...",
    "projectId": "project_01J...",
    "name": "Default Routing Policy",
    "type": "routing",
    "status": "draft",
    "activeVersionId": null,
    "createdAt": "2026-06-22T06:00:00.000Z",
    "updatedAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`
- `409 CONFLICT`: 같은 scope/name 중복

## 12.3 GET `/api/policies/:policyId`

인증: Tenant/Project Member

Request Body: 없음

Response Body `200`:

```json
{
  "data": {
    "id": "policy_01J...",
    "tenantId": "tenant_01J...",
    "projectId": "project_01J...",
    "name": "Default Routing Policy",
    "type": "routing",
    "status": "active",
    "activeVersionId": "policy_ver_01J...",
    "bindings": [
      {
        "id": "policy_binding_01J...",
        "target": {
          "type": "project",
          "id": "project_01J..."
        },
        "priority": 100,
        "status": "active"
      }
    ],
    "createdAt": "2026-06-22T06:00:00.000Z",
    "updatedAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 12.4 PATCH `/api/policies/:policyId`

Policy metadata만 수정한다. Published version의 expression은 수정하지 않는다.

인증: Tenant/Project Admin

Request Body:

```json
{
  "name": "Default Routing Policy",
  "description": "Updated description",
  "status": "active",
  "metadata": {
    "owner": "platform"
  }
}
```

Response Body `200`:

```json
{
  "data": {
    "id": "policy_01J...",
    "updatedAt": "2026-06-22T06:10:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 12.5 DELETE `/api/policies/:policyId`

Policy를 soft delete한다. Active binding이 있으면 먼저 binding을 해제해야 한다.

인증: Tenant/Project Admin

Request Body:

```json
{
  "reason": "replaced_by_new_policy"
}
```

Response Body `202`:

```json
{
  "data": {
    "id": "policy_01J...",
    "status": "archived",
    "deletedAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`
- `409 CONFLICT`: active binding 존재

## 12.6 POST `/api/policies/validate`

CEL expression과 schema를 검증한다. DB에 저장하지 않는다.

인증: Tenant/Project Admin

Request Body:

```json
{
  "type": "routing",
  "language": "cel",
  "expression": "request.estimatedTokens < 1000 ? route('openai', 'gpt-4o-mini') : route('openai', 'gpt-4o')",
  "schemaVersion": "2026-06-01",
  "sampleContext": {
    "request": {
      "estimatedTokens": 300,
      "provider": "openai",
      "model": "auto"
    }
  }
}
```

Response Body `200`:

```json
{
  "data": {
    "valid": true,
    "diagnostics": [],
    "evaluatedResult": {
      "action": "route",
      "provider": "openai",
      "model": "gpt-4o-mini"
    }
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `422 POLICY_VALIDATION_FAILED`

## 12.7 GET `/api/policies/:policyId/versions`

인증: Tenant/Project Member

Request Body: 없음

Response Body `200`:

```json
{
  "data": [
    {
      "id": "policy_ver_01J...",
      "policyId": "policy_01J...",
      "version": 3,
      "status": "published",
      "language": "cel",
      "schemaVersion": "2026-06-01",
      "createdBy": "user_01J...",
      "createdAt": "2026-06-22T06:00:00.000Z",
      "publishedAt": "2026-06-22T06:10:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "nextCursor": null,
    "hasMore": false
  }
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 12.8 POST `/api/policies/:policyId/versions`

새 immutable policy version을 생성한다.

인증: Tenant/Project Admin

Request Body:

```json
{
  "language": "cel",
  "schemaVersion": "2026-06-01",
  "expression": "request.estimatedTokens < 1000 ? route('openai', 'gpt-4o-mini') : route('openai', 'gpt-4o')",
  "parameters": {
    "lowCostModel": "gpt-4o-mini",
    "fallbackModel": "gpt-4o"
  },
  "changeNote": "Add low-cost routing rule"
}
```

Response Body `201`:

```json
{
  "data": {
    "id": "policy_ver_01J...",
    "policyId": "policy_01J...",
    "version": 3,
    "status": "draft",
    "language": "cel",
    "schemaVersion": "2026-06-01",
    "createdAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`
- `422 POLICY_VALIDATION_FAILED`

## 12.9 POST `/api/policies/:policyId/versions/:versionId/publish`

해당 version을 active version으로 publish한다. Gateway active policy cache 갱신 이벤트를 발행한다.

인증: Tenant/Project Admin

Request Body:

```json
{
  "changeNote": "Publish low-cost routing policy"
}
```

Response Body `200`:

```json
{
  "data": {
    "policyId": "policy_01J...",
    "activeVersionId": "policy_ver_01J...",
    "publishedAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`
- `409 CONFLICT`: 이미 published 또는 draft가 아님
- `422 POLICY_VALIDATION_FAILED`

## 12.10 POST `/api/policies/:policyId/rollback`

이전 published version으로 rollback한다. Version row를 수정하지 않고 active binding만 교체한다.

인증: Tenant/Project Admin

Request Body:

```json
{
  "targetVersionId": "policy_ver_01J...",
  "reason": "high error rate after latest policy"
}
```

Response Body `200`:

```json
{
  "data": {
    "policyId": "policy_01J...",
    "activeVersionId": "policy_ver_01J...",
    "rolledBackAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`
- `409 CONFLICT`: target version이 published 가능한 상태가 아님

## 12.11 POST `/api/policy-bindings`

Policy를 target에 연결한다.

인증: Tenant/Project Admin

Request Body:

```json
{
  "policyId": "policy_01J...",
  "policyVersionId": "policy_ver_01J...",
  "target": {
    "type": "project",
    "id": "project_01J..."
  },
  "priority": 100,
  "status": "active"
}
```

Response Body `201`:

```json
{
  "data": {
    "id": "policy_binding_01J...",
    "policyId": "policy_01J...",
    "policyVersionId": "policy_ver_01J...",
    "target": {
      "type": "project",
      "id": "project_01J..."
    },
    "priority": 100,
    "status": "active",
    "createdAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`
- `409 CONFLICT`: 같은 target/type/priority 충돌

## 12.12 DELETE `/api/policy-bindings/:bindingId`

인증: Tenant/Project Admin

Request Body:

```json
{
  "reason": "policy_replaced"
}
```

Response Body `204`: Empty

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`

---

# 13. Rate Limit / Quota / Budget API

## 13.1 GET `/api/projects/:projectId/rate-limit-rules`

인증: Project Member

Request Body: 없음

Response Body `200`:

```json
{
  "data": [
    {
      "id": "rate_rule_01J...",
      "target": {
        "type": "project",
        "id": "project_01J..."
      },
      "metric": "rpm",
      "limit": 60,
      "windowSeconds": 60,
      "action": "block",
      "status": "active",
      "createdAt": "2026-06-22T06:00:00.000Z",
      "updatedAt": "2026-06-22T06:00:00.000Z"
    }
  ]
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 13.2 PUT `/api/projects/:projectId/rate-limit-rules`

Project의 rate limit rule을 일괄 교체한다.

인증: Project Admin

Request Body:

```json
{
  "rules": [
    {
      "target": {
        "type": "project",
        "id": "project_01J..."
      },
      "metric": "rpm",
      "limit": 60,
      "windowSeconds": 60,
      "action": "block"
    },
    {
      "target": {
        "type": "project",
        "id": "project_01J..."
      },
      "metric": "tpm",
      "limit": 100000,
      "windowSeconds": 60,
      "action": "block"
    }
  ]
}
```

Response Body `200`:

```json
{
  "data": {
    "projectId": "project_01J...",
    "ruleCount": 2,
    "updatedAt": "2026-06-22T06:10:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`

## 13.3 GET `/api/projects/:projectId/quota-rules`

인증: Project Member

Request Body: 없음

Response Body `200`:

```json
{
  "data": [
    {
      "id": "quota_rule_01J...",
      "target": {
        "type": "user",
        "id": "user_01J..."
      },
      "metric": "total_tokens",
      "limit": 1000000,
      "period": "monthly",
      "action": "block",
      "status": "active",
      "createdAt": "2026-06-22T06:00:00.000Z",
      "updatedAt": "2026-06-22T06:00:00.000Z"
    }
  ]
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 13.4 PUT `/api/projects/:projectId/quota-rules`

인증: Project Admin

Request Body:

```json
{
  "rules": [
    {
      "target": {
        "type": "project",
        "id": "project_01J..."
      },
      "metric": "total_tokens",
      "limit": 10000000,
      "period": "monthly",
      "action": "block"
    }
  ]
}
```

Response Body `200`:

```json
{
  "data": {
    "projectId": "project_01J...",
    "ruleCount": 1,
    "updatedAt": "2026-06-22T06:10:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`

## 13.5 GET `/api/projects/:projectId/budget-policy`

인증: Project Member

Request Body: 없음

Response Body `200`:

```json
{
  "data": {
    "id": "budget_policy_01J...",
    "projectId": "project_01J...",
    "period": "monthly",
    "limit": {
      "amount": "100.00",
      "currency": "USD"
    },
    "thresholds": [
      {
        "ratio": 0.8,
        "action": "warn"
      },
      {
        "ratio": 1.0,
        "action": "block"
      }
    ],
    "status": "active",
    "createdAt": "2026-06-22T06:00:00.000Z",
    "updatedAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 13.6 PUT `/api/projects/:projectId/budget-policy`

인증: Project Admin

Request Body:

```json
{
  "period": "monthly",
  "limit": {
    "amount": "100.00",
    "currency": "USD"
  },
  "thresholds": [
    {
      "ratio": 0.8,
      "action": "warn"
    },
    {
      "ratio": 1.0,
      "action": "block"
    }
  ],
  "status": "active"
}
```

Response Body `200`:

```json
{
  "data": {
    "projectId": "project_01J...",
    "budgetPolicyId": "budget_policy_01J...",
    "updatedAt": "2026-06-22T06:10:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`

## 13.7 GET `/api/projects/:projectId/usage/summary`

인증: Project Member

Query Parameters:

| Name | Required | 설명 |
|---|---:|---|
| `from` | Yes | ISO timestamp 또는 date |
| `to` | Yes | ISO timestamp 또는 date |
| `groupBy` | No | `day`, `model`, `provider`, `user`, `application` |

Request Body: 없음

Response Body `200`:

```json
{
  "data": {
    "projectId": "project_01J...",
    "range": {
      "from": "2026-06-01T00:00:00.000Z",
      "to": "2026-06-22T23:59:59.999Z"
    },
    "totals": {
      "requests": 1234,
      "promptTokens": 100000,
      "completionTokens": 200000,
      "totalTokens": 300000,
      "estimatedCostUsd": "42.250000",
      "cacheSavingsUsd": "8.120000"
    },
    "budget": {
      "limitUsd": "100.00",
      "usedUsd": "42.25",
      "remainingUsd": "57.75",
      "status": "ok"
    }
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`

# 13.9 Sensitive Data Rules API

민감정보 규칙 API는 `pii-masking-policy.md`와 `db-schema.md`의 `sensitive_data_rules` 기준을 따른다. System default rule은 hard delete하지 않고, tenant custom rule은 soft delete한다.

## 13.9.1 GET `/api/sensitive-data-rules`

인증: Tenant/Project Member

Query Parameters:

| 이름 | 타입 | 필수 | 설명 |
|---|---:|---:|---|
| `tenantId` | string | Y | tenant id |
| `projectId` | string | N | project scoped rules 포함 여부 |
| `detectorType` | string | N | detector type filter |
| `status` | string | N | `active`, `disabled` |
| `includePattern` | boolean | N | 기본 `false`. Tenant Admin 또는 Security Admin만 `true` 허용 |

Request Body: 없음

Response Body `200`:

```json
{
  "data": [
    {
      "id": "rule_01J...",
      "tenantId": "tenant_01J...",
      "name": "Default Email Redaction",
      "detectorType": "email",
      "action": "redact",
      "replacement": "[EMAIL_REDACTED]",
      "severity": "medium",
      "status": "active",
      "patternPreview": null,
      "patternHash": null,
      "createdAt": "2026-06-22T00:00:00.000Z",
      "updatedAt": "2026-06-22T00:00:00.000Z"
    }
  ]
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`

## 13.9.2 POST `/api/sensitive-data-rules`

인증: Tenant/Project Admin

Request Body:

```json
{
  "tenantId": "tenant_01J...",
  "name": "Block Internal Project Codename",
  "detectorType": "internal_keyword",
  "pattern": "Project Aurora",
  "action": "block",
  "replacement": "[INTERNAL_KEYWORD_REDACTED]",
  "severity": "critical",
  "metadata": {
    "description": "Internal codename must not be sent to external providers"
  }
}
```

Response Body `201`:

```json
{
  "data": {
    "id": "rule_01J...",
    "tenantId": "tenant_01J...",
    "name": "Block Internal Project Codename",
    "detectorType": "internal_keyword",
    "action": "block",
    "replacement": "[INTERNAL_KEYWORD_REDACTED]",
    "severity": "critical",
    "status": "active",
    "createdAt": "2026-06-22T00:00:00.000Z",
    "updatedAt": "2026-06-22T00:00:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`
- `409 DUPLICATE_RULE`

## 13.9.3 GET `/api/sensitive-data-rules/:ruleId`

인증: Tenant/Project Member

Request Body: 없음

Response Body `200`:

```json
{
  "data": {
    "id": "rule_01J...",
    "tenantId": "tenant_01J...",
    "name": "Default API Key Block",
    "detectorType": "api_key",
    "action": "redact",
    "replacement": "[API_KEY_REDACTED]",
    "severity": "critical",
    "status": "active",
    "patternPreview": null,
    "metadata": {},
    "createdAt": "2026-06-22T00:00:00.000Z",
    "updatedAt": "2026-06-22T00:00:00.000Z"
  }
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 13.9.4 PATCH `/api/sensitive-data-rules/:ruleId`

인증: Tenant/Project Admin

Request Body:

```json
{
  "name": "Redact Internal Employee IDs",
  "action": "redact",
  "replacement": "[EMPLOYEE_ID_REDACTED]",
  "severity": "medium",
  "status": "active",
  "metadata": {
    "reviewTicket": "SEC-123"
  }
}
```

Response Body `200`:

```json
{
  "data": {
    "id": "rule_01J...",
    "name": "Redact Internal Employee IDs",
    "action": "redact",
    "replacement": "[EMPLOYEE_ID_REDACTED]",
    "severity": "medium",
    "status": "active",
    "updatedAt": "2026-06-22T00:00:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`
- `404 NOT_FOUND`
- `409 SECURITY_REVIEW_REQUIRED`

## 13.9.5 DELETE `/api/sensitive-data-rules/:ruleId`

인증: Tenant/Project Admin

Request Body: 없음

Response Body `200`:

```json
{
  "data": {
    "id": "rule_01J...",
    "deleted": true,
    "deletedAt": "2026-06-22T00:00:00.000Z"
  }
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`
- `409 ACTIVE_POLICY_BINDING_EXISTS`

## 13.9.6 POST `/api/sensitive-data-rules/validate`

인증: Tenant/Project Admin

Request Body:

```json
{
  "detectorType": "custom_regex",
  "pattern": "EMP-[0-9]{6}",
  "testText": "employee id is EMP-123456"
}
```

Response Body `200`:

```json
{
  "data": {
    "valid": true,
    "detectedCount": 1,
    "detectedTypes": ["custom_regex"],
    "warnings": []
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `400 REGEX_TOO_COMPLEX`
- `403 FORBIDDEN`

---

---

# 14. Dashboard / Logs / Analytics API

## 14.1 GET `/api/dashboard/overview`

Dashboard overview 데이터를 조회한다.

인증: Tenant/Project Member

Query Parameters:

| Name | Required | 설명 |
|---|---:|---|
| `tenantId` | No | tenant dashboard |
| `projectId` | No | project dashboard |
| `from` | Yes | 조회 시작 |
| `to` | Yes | 조회 종료 |

Request Body: 없음

Response Body `200`:

```json
{
  "data": {
    "range": {
      "from": "2026-06-01T00:00:00.000Z",
      "to": "2026-06-22T23:59:59.999Z"
    },
    "totals": {
      "requests": 1234,
      "successfulRequests": 1200,
      "failedRequests": 34,
      "totalTokens": 300000,
      "estimatedCostUsd": "42.250000",
      "cacheHitRate": 0.31,
      "averageLatencyMs": 820,
      "p95LatencyMs": 2100
    },
    "budget": {
      "limitUsd": "100.00",
      "usedUsd": "42.25",
      "status": "ok"
    },
    "providerHealth": [
      {
        "provider": "openai",
        "status": "healthy",
        "errorRate": 0.01,
        "averageLatencyMs": 780
      }
    ],
    "alerts": [
      {
        "id": "alert_event_01J...",
        "type": "budget_threshold",
        "severity": "warning",
        "message": "Project reached 80% of monthly budget."
      }
    ]
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`

## 14.2 GET `/api/projects/:projectId/logs`

Request Log 목록을 조회한다. 원문 Prompt/Response는 반환하지 않는다.

인증: Project Member

Query Parameters:

| Name | Required | 설명 |
|---|---:|---|
| `from` | Yes | 조회 시작 |
| `to` | Yes | 조회 종료 |
| `status` | No | `success`, `cache_hit`, `blocked`, `error`, `cancelled` |
| `provider` | No | provider filter |
| `model` | No | model filter |
| `cacheStatus` | No | P0: `hit`, `miss`, `bypass`, `error`. Exact/Semantic 구분은 `cacheType` |
| `userId` | No | GateLM user ID |
| `applicationId` | No | Application ID |
| `requestId` | No | request ID exact search |
| `limit` | No | pagination |
| `cursor` | No | pagination |

Request Body: 없음

Response Body `200`:

```json
{
  "data": [
    {
      "requestId": "request_01J...",
      "tenantId": "tenant_01J...",
      "projectId": "project_01J...",
      "applicationId": "app_01J...",
      "userId": "user_01J...",
      "provider": "openai",
      "model": "gpt-4o-mini",
      "status": "success",
      "cacheStatus": "miss",
      "routingDecision": "low_cost_model",
      "maskingAction": "redacted",
      "usage": {
        "promptTokens": 120,
        "completionTokens": 240,
        "totalTokens": 360
      },
      "cost": {
        "estimatedCostUsd": "0.001240"
      },
      "latency": {
        "totalMs": 820,
        "ttftMs": 240
      },
      "createdAt": "2026-06-22T06:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "nextCursor": null,
    "hasMore": false
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`: 기간 누락/오류
- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 14.3 GET `/api/llm-requests/:requestId`

Detail Drawer에 필요한 단일 요청 상세를 조회한다.

인증: Project Member

Query Parameters:

| Name | Required | 설명 |
|---|---:|---|
| `include` | No | `events`, `attempts`, `redactedPayload` 조합 가능 |

Request Body: 없음

Response Body `200`:

```json
{
  "data": {
    "requestId": "request_01J...",
    "tenantId": "tenant_01J...",
    "projectId": "project_01J...",
    "applicationId": "app_01J...",
    "apiKeyId": "api_key_01J...",
    "appTokenId": "app_token_01J...",
    "userId": "user_01J...",
    "featureId": "support-reply",
    "provider": "openai",
    "requestedModel": "auto",
    "routedModel": "gpt-4o-mini",
    "status": "success",
    "cache": {
      "status": "miss",
      "keyHash": "sha256:...",
      "savingsUsd": "0.000000"
    },
    "routing": {
      "decision": "low_cost_model",
      "ruleId": "policy_ver_01J...",
      "reason": "estimated token count below threshold"
    },
    "masking": {
      "action": "redacted",
      "detectedTypes": ["email"],
      "redactionCount": 1
    },
    "usage": {
      "promptTokens": 120,
      "completionTokens": 240,
      "contextTokens": 80,
      "totalTokens": 440
    },
    "cost": {
      "estimatedCostUsd": "0.001240",
      "cacheSavingsUsd": "0.000000"
    },
    "latency": {
      "totalMs": 820,
      "gatewayMs": 50,
      "providerMs": 770,
      "ttftMs": 240
    },
    "payload": {
      "redactedPrompt": "Please email [EMAIL_REDACTED] about the refund.",
      "responseSummary": "The assistant drafted a refund email response.",
      "promptHash": "sha256:...",
      "responseHash": "sha256:..."
    },
    "error": null,
    "createdAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 14.4 GET `/api/llm-requests/:requestId/events`

요청에 연결된 provider attempt, cache, masking, routing event를 조회한다.

인증: Project Member

Request Body: 없음

Response Body `200`:

```json
{
  "data": {
    "requestId": "request_01J...",
    "events": [
      {
        "type": "routing",
        "timestamp": "2026-06-22T06:00:00.010Z",
        "data": {
          "requestedModel": "auto",
          "routedProvider": "openai",
          "routedModel": "gpt-4o-mini",
          "reason": "low_cost_model"
        }
      },
      {
        "type": "masking",
        "timestamp": "2026-06-22T06:00:00.020Z",
        "data": {
          "action": "redacted",
          "detectedTypes": ["email"]
        }
      },
      {
        "type": "provider_attempt",
        "timestamp": "2026-06-22T06:00:00.050Z",
        "data": {
          "provider": "openai",
          "model": "gpt-4o-mini",
          "status": "success",
          "latencyMs": 770
        }
      }
    ]
  }
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 14.5 GET `/api/analytics/costs`

비용 분석 데이터를 조회한다.

인증: Tenant/Project Member

Query Parameters:

| Name | Required | 설명 |
|---|---:|---|
| `tenantId` | No | tenant 기준 |
| `projectId` | No | project 기준 |
| `from` | Yes | 조회 시작 |
| `to` | Yes | 조회 종료 |
| `groupBy` | No | `day`, `project`, `provider`, `model`, `user`, `application` |

Request Body: 없음

Response Body `200`:

```json
{
  "data": {
    "groupBy": "day",
    "series": [
      {
        "key": "2026-06-22",
        "estimatedCostUsd": "12.340000",
        "cacheSavingsUsd": "2.120000",
        "requestCount": 420
      }
    ]
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`

## 14.6 GET `/api/analytics/tokens`

인증: Tenant/Project Member

Query Parameters: `/api/analytics/costs`와 동일

Request Body: 없음

Response Body `200`:

```json
{
  "data": {
    "groupBy": "model",
    "series": [
      {
        "key": "gpt-4o-mini",
        "promptTokens": 100000,
        "completionTokens": 200000,
        "totalTokens": 300000,
        "requestCount": 1000
      }
    ]
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`

## 14.7 GET `/api/analytics/latency`

인증: Tenant/Project Member

Query Parameters: `/api/analytics/costs`와 동일

Request Body: 없음

Response Body `200`:

```json
{
  "data": {
    "groupBy": "provider",
    "series": [
      {
        "key": "openai",
        "averageLatencyMs": 820,
        "p50LatencyMs": 700,
        "p95LatencyMs": 2100,
        "averageTtftMs": 240,
        "requestCount": 1000
      }
    ]
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`

## 14.8 GET `/api/analytics/cache`

인증: Tenant/Project Member

Query Parameters: `/api/analytics/costs`와 동일

Request Body: 없음

Response Body `200`:

```json
{
  "data": {
    "groupBy": "day",
    "series": [
      {
        "key": "2026-06-22",
        "requestCount": 420,
        "exactHits": 80,
        "semanticHits": 20,
        "misses": 320,
        "hitRate": 0.2381,
        "estimatedSavingsUsd": "2.120000"
      }
    ]
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`

## 14.9 GET `/api/analytics/routing`

인증: Tenant/Project Member

Query Parameters: `/api/analytics/costs`와 동일

Request Body: 없음

Response Body `200`:

```json
{
  "data": {
    "groupBy": "model",
    "series": [
      {
        "key": "gpt-4o-mini",
        "routedCount": 900,
        "fallbackCount": 12,
        "averageCostUsd": "0.001200"
      }
    ]
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`

## 14.10 GET `/api/analytics/masking`

마스킹 분석 API의 detector type, action, 원문 비노출 기준은 `pii-masking-policy.md`를 따른다.

인증: Tenant/Project Member

Query Parameters: `/api/analytics/costs`와 동일

Request Body: 없음

Response Body `200`:

```json
{
  "data": {
    "groupBy": "detectedType",
    "series": [
      {
        "key": "email",
        "detectorType": "email",
        "severity": "medium",
        "detectedCount": 120,
        "redactedCount": 118,
        "blockedCount": 2
      }
    ]
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`

---

# 15. Chat UI API

Chat UI는 고객사가 자체 LLM UI를 갖고 있지 않을 때 제공하는 옵션이다. MVP는 text-only다.

금지:

- 파일 업로드 API 금지
- 이미지 입력 API 금지
- OCR API 금지
- RAG 문서 검색 API 금지

Chat UI가 보내는 LLM 요청도 최종적으로 Gateway를 통과해야 한다.

## 15.1 POST `/api/chat/conversations`

Conversation을 생성한다.

인증: Yes

Request Body:

```json
{
  "projectId": "project_01J...",
  "title": "Refund policy question",
  "metadata": {
    "source": "web-console"
  }
}
```

Response Body `201`:

```json
{
  "data": {
    "id": "conversation_01J...",
    "projectId": "project_01J...",
    "title": "Refund policy question",
    "status": "active",
    "createdAt": "2026-06-22T06:00:00.000Z",
    "updatedAt": "2026-06-22T06:00:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`

## 15.2 GET `/api/chat/conversations`

인증: Yes

Query Parameters:

| Name | Required | 설명 |
|---|---:|---|
| `projectId` | Yes | Project 기준 조회 |
| `status` | No | status filter |
| `limit` | No | pagination |
| `cursor` | No | pagination |

Request Body: 없음

Response Body `200`:

```json
{
  "data": [
    {
      "id": "conversation_01J...",
      "projectId": "project_01J...",
      "title": "Refund policy question",
      "status": "active",
      "lastMessageAt": "2026-06-22T06:20:00.000Z",
      "createdAt": "2026-06-22T06:00:00.000Z",
      "updatedAt": "2026-06-22T06:20:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "nextCursor": null,
    "hasMore": false
  }
}
```

Error Response:

- `403 FORBIDDEN`

## 15.3 GET `/api/chat/conversations/:conversationId`

인증: Yes

Request Body: 없음

Response Body `200`:

```json
{
  "data": {
    "id": "conversation_01J...",
    "projectId": "project_01J...",
    "title": "Refund policy question",
    "status": "active",
    "createdAt": "2026-06-22T06:00:00.000Z",
    "updatedAt": "2026-06-22T06:20:00.000Z"
  }
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 15.4 PATCH `/api/chat/conversations/:conversationId`

인증: Yes

Request Body:

```json
{
  "title": "Refund workflow question",
  "status": "active"
}
```

Response Body `200`:

```json
{
  "data": {
    "id": "conversation_01J...",
    "title": "Refund workflow question",
    "updatedAt": "2026-06-22T06:10:00.000Z"
  }
}
```

Error Response:

- `400 VALIDATION_ERROR`
- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 15.5 DELETE `/api/chat/conversations/:conversationId`

인증: Yes

Request Body:

```json
{
  "reason": "user_deleted"
}
```

Response Body `204`: Empty

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 15.6 GET `/api/chat/conversations/:conversationId/messages`

인증: Yes

Query Parameters:

| Name | Required | 설명 |
|---|---:|---|
| `limit` | No | pagination |
| `cursor` | No | pagination |

Request Body: 없음

Response Body `200`:

```json
{
  "data": [
    {
      "id": "message_01J...",
      "conversationId": "conversation_01J...",
      "parentMessageId": null,
      "role": "user",
      "content": "Please help me write a refund response.",
      "status": "completed",
      "llmRequestId": "request_01J...",
      "createdAt": "2026-06-22T06:00:00.000Z"
    },
    {
      "id": "message_01K...",
      "conversationId": "conversation_01J...",
      "parentMessageId": "message_01J...",
      "role": "assistant",
      "content": "Here is a concise refund response...",
      "status": "completed",
      "llmRequestId": "request_01J...",
      "createdAt": "2026-06-22T06:00:10.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "nextCursor": null,
    "hasMore": false
  }
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`

## 15.7 POST `/api/chat/conversations/:conversationId/messages`

Text-only user message를 생성하고 Gateway를 호출한다. `parentMessageId`가 있으면 Reply-to Context를 적용한다.

인증: Yes

Request Body:

```json
{
  "content": "Make it more concise.",
  "parentMessageId": "message_01K...",
  "model": "auto",
  "stream": false,
  "gateLm": {
    "cacheMode": "auto",
    "routingMode": "auto"
  },
  "metadata": {
    "ui": "chat"
  }
}
```

Response Body `201`:

```json
{
  "data": {
    "userMessage": {
      "id": "message_01L...",
      "conversationId": "conversation_01J...",
      "parentMessageId": "message_01K...",
      "role": "user",
      "content": "Make it more concise.",
      "status": "completed",
      "createdAt": "2026-06-22T06:00:00.000Z"
    },
    "assistantMessage": {
      "id": "message_01M...",
      "conversationId": "conversation_01J...",
      "parentMessageId": "message_01L...",
      "role": "assistant",
      "content": "Here is the concise version...",
      "status": "completed",
      "llmRequestId": "request_01J...",
      "createdAt": "2026-06-22T06:00:10.000Z"
    },
    "gateway": {
      "requestId": "request_01J...",
      "provider": "openai",
      "model": "gpt-4o-mini",
      "cacheStatus": "miss",
      "routingDecision": "low_cost_model",
      "maskingAction": "none"
    }
  }
}
```

Streaming Response `200` with `text/event-stream` when `stream=true`:

```text
event: message.created
data: {"messageId":"message_01M...","llmRequestId":"request_01J..."}

event: delta
data: {"content":"Here"}

event: delta
data: {"content":" is"}

event: message.completed
data: {"messageId":"message_01M...","llmRequestId":"request_01J..."}
```

Error Response:

- `400 VALIDATION_ERROR`: 빈 content, 파일/이미지 입력 시도
- `403 FORBIDDEN`
- `404 NOT_FOUND`
- `429 RATE_LIMITED`
- `402 BUDGET_EXCEEDED`
- `403 POLICY_BLOCKED`
- `403 SENSITIVE_DATA_BLOCKED`
- `502 PROVIDER_ERROR`

## 15.8 GET `/api/chat/messages/:messageId`

인증: Yes

Request Body: 없음

Response Body `200`:

```json
{
  "data": {
    "id": "message_01M...",
    "conversationId": "conversation_01J...",
    "parentMessageId": "message_01L...",
    "role": "assistant",
    "content": "Here is the concise version...",
    "status": "completed",
    "llmRequestId": "request_01J...",
    "createdAt": "2026-06-22T06:00:10.000Z"
  }
}
```

Error Response:

- `403 FORBIDDEN`
- `404 NOT_FOUND`

---

# 16. Gateway API

Gateway API는 OpenAI-compatible 구조를 우선한다. 기존 OpenAI SDK 사용자는 base URL과 API Key만 바꾸는 것을 목표로 한다.

Base URL:

```text
https://gateway.gatelm.example/v1
```

공통 Gateway Headers:

```text
Authorization: Bearer glm_api_xxxxxxxxxxxxxxxxx
X-GateLM-App-Token: glm_app_token_xxxxxxxxxxxxxxxxx
X-GateLM-End-User-Id: customer-user-123
X-GateLM-Feature-Id: support-reply
Content-Type: application/json
```

Gateway 응답 공통 headers:

| Header | 설명 |
|---|---|
| `X-GateLM-Request-Id` | GateLM request ID |
| `X-GateLM-Cache-Status` | P0: `hit`, `miss`, `bypass`, `error` |
| `X-GateLM-Routed-Provider` | 실제 호출 provider |
| `X-GateLM-Routed-Model` | 실제 호출 model |
| `X-GateLM-Masking-Action` | `none`, `redacted`, `blocked` |
| `X-GateLM-Estimated-Cost-Usd` | 추정 비용 |

## 16.1 GET `/v1/models`

Gateway API Key 기준으로 호출 가능한 모델 목록을 반환한다.

인증: Gateway API Key

Request Body: 없음

Response Body `200`:

```json
{
  "object": "list",
  "data": [
    {
      "id": "gpt-4o-mini",
      "object": "model",
      "created": 1710000000,
      "owned_by": "openai",
      "gate_lm": {
        "provider": "openai",
        "allowed": true,
        "alias": "fast-low-cost",
        "capabilities": ["chat", "streaming"]
      }
    },
    {
      "id": "auto",
      "object": "model",
      "created": 1710000000,
      "owned_by": "gatelm",
      "gate_lm": {
        "provider": "gatelm",
        "allowed": true,
        "alias": "policy-routed",
        "capabilities": ["chat", "streaming"]
      }
    }
  ]
}
```

Error Response:

- `401 invalid_api_key`
- `403 permission_denied`
- `429 rate_limited`

## 16.2 POST `/v1/chat/completions`

OpenAI-compatible Chat Completions API다. GateLM은 이 요청 안에서 인증, App Token 검증, Rate Limit, Quota, Runtime Policy, 민감정보 마스킹, Cache, Model Routing, Provider 호출, 비동기 이벤트 발행을 수행한다.

인증: Gateway API Key + App Token. Project 정책에 따라 App Token optional 가능하지만 기본은 required.

Request Body:

```json
{
  "model": "auto",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    },
    {
      "role": "user",
      "content": "Write a short refund response to alex@example.com."
    }
  ],
  "temperature": 0.2,
  "max_tokens": 512,
  "stream": false,
  "metadata": {
    "customerTicketId": "ticket-123"
  },
  "gate_lm": {
    "cache": {
      "mode": "auto"
    },
    "routing": {
      "mode": "auto"
    },
    "context": {
      "parentMessageId": null
    },
    "responseMetadata": true
  }
}
```

OpenAI-compatible 필드 우선 지원:

| Field | Required | 설명 |
|---|---:|---|
| `model` | Yes | 요청 모델 또는 `auto` |
| `messages` | Yes | text-only messages. image/file content 금지 |
| `temperature` | No | Provider로 전달 가능한 경우 전달 |
| `max_tokens` | No | Provider별 필드로 변환 |
| `stream` | No | SSE streaming 여부 |
| `metadata` | No | 로그용 비민감 metadata |

GateLM extension field:

| Field | Required | 설명 |
|---|---:|---|
| `gate_lm.cache.mode` | No | `auto`, `bypass`, `force_exact` |
| `gate_lm.routing.mode` | No | `auto`, `pinned` |
| `gate_lm.routing.provider` | No | pinned일 때 provider hint |
| `gate_lm.routing.model` | No | pinned일 때 model hint |
| `gate_lm.context.parentMessageId` | No | Reply-to Context |
| `gate_lm.responseMetadata` | No | response body에 GateLM metadata 포함 여부 |

Response Body `200` non-stream:

```json
{
  "id": "chatcmpl_01J...",
  "object": "chat.completion",
  "created": 1782108000,
  "model": "gpt-4o-mini",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hi Alex, we can help with your refund request..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 120,
    "completion_tokens": 80,
    "total_tokens": 200
  },
  "gate_lm": {
    "requestId": "request_01J...",
    "tenantId": "tenant_01J...",
    "projectId": "project_01J...",
    "applicationId": "app_01J...",
    "requestedModel": "auto",
    "routedProvider": "openai",
    "routedModel": "gpt-4o-mini",
    "cacheStatus": "miss",
    "routingDecision": "low_cost_model",
    "maskingAction": "redacted",
    "estimatedCostUsd": "0.001240",
    "latencyMs": 820
  }
}
```

Streaming Response `200` with `text/event-stream`:

```text
data: {"id":"chatcmpl_01J...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl_01J...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}

data: {"id":"chatcmpl_01J...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"gate_lm":{"requestId":"request_01J...","cacheStatus":"miss","routedProvider":"openai","routedModel":"gpt-4o-mini"}}

data: [DONE]
```

Error Response:

```json
{
  "error": {
    "message": "Project quota exceeded.",
    "type": "gatelm_quota_error",
    "param": null,
    "code": "quota_exceeded",
    "request_id": "request_01J..."
  }
}
```

주요 Error:

- `400 invalid_request_error`: `messages` 누락, image/file content 포함, 지원하지 않는 필드
- `401 invalid_api_key`: API Key 없음/오류/만료
- `403 permission_denied`: App Token 오류, scope 부족
- `403 policy_blocked`: Runtime Policy 차단
- `403 sensitive_data_blocked`: 민감정보 정책이 block으로 설정됨
- `404 not_found`: 요청 모델 또는 project 설정 없음
- `429 rate_limited`: RPM/TPM/동시 요청 초과
- `429 quota_exceeded`: quota 초과
- `402 budget_exceeded`: budget 초과
- `502 provider_error`: Provider 오류
- `504 provider_timeout`: Provider timeout

## 16.3 Gateway 처리 순서

`POST /v1/chat/completions`는 아래 순서로 처리한다.

```text
1. Request ID 생성 또는 X-GateLM-Request-Id 수용
2. API Key 인증
3. Tenant / Project / Application 식별
4. App Token 검증
5. Scope / IP allowlist / status / expiresAt 확인
6. Rate Limit / Quota / Budget pre-check
7. Runtime Policy pre-check
8. Text-only validation
9. 민감정보 탐지
10. Mask 또는 Block
11. Reply-to Context 조회 및 prompt 구성
12. Exact Cache 조회
13. Semantic Cache 조회
14. Model Routing
15. Provider credential 조회
16. Provider request 변환
17. Provider 호출 또는 SSE relay
18. Token / Cost / Latency 계산
19. Cache write 판단
20. 사용자에게 응답 반환
21. Redpanda에 usage/log event 발행
```

## 16.4 Gateway에서 지원하지 않는 요청

MVP에서는 아래 요청을 거부한다.

- `messages[].content`가 image/file/audio part를 포함하는 요청
- file upload 관련 multipart 요청
- OCR 요청
- RAG 문서 검색 요청
- Provider key를 request body로 직접 전달하는 요청
- raw prompt/response 저장을 강제하는 요청

---

# 17. Health API

## 17.1 GET `/healthz`

Process alive check.

인증: No

Request Body: 없음

Response Body `200`:

```json
{
  "status": "ok",
  "service": "gateway-core",
  "time": "2026-06-22T06:00:00.000Z"
}
```

Error Response:

- `500 INTERNAL_ERROR`

## 17.2 GET `/readyz`

Dependency readiness check.

인증: No

Request Body: 없음

Response Body `200`:

```json
{
  "status": "ready",
  "service": "gateway-core",
  "dependencies": {
    "redis": "ok",
    "redpanda": "ok",
    "postgres": "ok",
    "clickhouse": "ok"
  },
  "time": "2026-06-22T06:00:00.000Z"
}
```

Error Response `503`:

```json
{
  "status": "not_ready",
  "service": "gateway-core",
  "dependencies": {
    "redis": "ok",
    "redpanda": "error"
  },
  "time": "2026-06-22T06:00:00.000Z"
}
```

---

# 18. 구현 우선순위

## 18.1 MVP에서 반드시 구현할 API

1차 구현에서 우선순위가 가장 높은 API는 아래다.

```text
POST /api/auth/signup
POST /api/auth/login
GET  /api/auth/me
POST /api/tenants
POST /api/tenants/:tenantId/invitations
POST /api/auth/invitations/accept
POST /api/projects
GET  /api/projects
GET  /api/projects/:projectId
POST /api/provider-connections
POST /api/provider-connections/:providerConnectionId/test
POST /api/projects/:projectId/applications
POST /api/applications/:applicationId/app-tokens
POST /api/projects/:projectId/api-keys
GET  /api/projects/:projectId/api-keys
PUT  /api/projects/:projectId/rate-limit-rules
PUT  /api/projects/:projectId/quota-rules
PUT  /api/projects/:projectId/budget-policy
GET  /api/dashboard/overview
GET  /api/projects/:projectId/logs
GET  /api/llm-requests/:requestId
POST /api/chat/conversations
POST /api/chat/conversations/:conversationId/messages
GET  /v1/models
POST /v1/chat/completions
GET  /healthz
GET  /readyz
```

## 18.2 MVP에서 미뤄도 되는 API

아래 API는 확장 설계에는 포함하지만 1차 데모에서 필수는 아니다.

```text
GET  /api/analytics/tokens
GET  /api/analytics/latency
GET  /api/analytics/routing
GET  /api/analytics/masking
POST /api/policies/:policyId/rollback
POST /api/policy-bindings
DELETE /api/policy-bindings/:bindingId
```

단, Runtime Policy를 제대로 보여주려면 policy validate/create/version/publish 흐름은 최소 구현하는 편이 좋다.

---

# 19. 구현 금지 사항

- 공식 ChatGPT, Gemini, Claude 웹사이트 트래픽을 투명하게 강제 우회하는 API를 만들지 않는다.
- 파일 업로드 API를 만들지 않는다.
- 이미지 입력 API를 만들지 않는다.
- OCR API를 만들지 않는다.
- RAG 문서 검색 API를 만들지 않는다.
- Provider API Key 원문을 조회하는 API를 만들지 않는다.
- API Key/App Token 원문을 재조회하는 API를 만들지 않는다.
- Request Log에서 raw prompt/raw response를 기본 반환하지 않는다.
- Gateway 요청이 아닌 경로에서 LLM Provider를 직접 호출하는 API를 만들지 않는다.
- API 문서에 없는 endpoint를 controller에 임의로 추가하지 않는다.
- Provider/model을 enum으로 고정해서 migration 없이는 추가할 수 없게 만들지 않는다.
- 특정 정책 대상만 지원하도록 DB/API를 좁게 만들지 않는다. `target.type + target.id` 구조를 유지한다.

---

# 20. API 구현 체크리스트

새 API를 만들거나 수정할 때 아래를 확인한다.

```text
[ ] api-spec.md에 endpoint가 먼저 정의되어 있다.
[ ] Method, Endpoint, Request Body, Response Body, Error Response, 인증 여부가 명시되어 있다.
[ ] OpenAPI contract로 옮길 수 있는 schema 구조다.
[ ] tenant/project authorization check가 있다.
[ ] list API는 cursor pagination을 사용한다.
[ ] write API는 audit log를 남긴다.
[ ] key/token/credential 원문을 응답에 반복 노출하지 않는다.
[ ] raw prompt/response를 기본 반환하지 않는다.
[ ] provider/model 값은 확장 가능한 string으로 처리한다.
[ ] 정책 대상은 target.type + target.id 구조를 사용한다.
[ ] createdAt/updatedAt은 UTC ISO-8601로 응답한다.
[ ] error response는 공통 shape을 따른다.
[ ] Gateway API는 OpenAI-compatible shape을 우선한다.
[ ] 테스트는 success, validation error, auth error, forbidden, not found를 포함한다.
```

---

# 24. PII Masking Policy API 기준

민감정보 감지/마스킹 관련 API 응답은 `pii-masking-policy.md`와 `llm-log-schema.md`를 따른다.

## 24.1 공통 masking field

Request Log, Detail Drawer, Gateway metadata에서 사용하는 공통 field는 아래 기준이다.

```json
{
  "masking": {
    "action": "redacted",
    "detectedTypes": ["email", "phone_number"],
    "detectedCount": 2,
    "policyVersionId": "policy_ver_01J...",
    "redactedPromptPreview": "[EMAIL_REDACTED] 에게 [PHONE_NUMBER_REDACTED] 로 연락..."
  }
}
```

Allowed values:

| Field | Values |
|---|---|
| `masking.action` / `maskingAction` | `none`, `redacted`, `blocked` |
| `detectedTypes[]` | `email`, `phone_number`, `resident_registration_number`, `api_key`, `authorization_header`, `jwt`, `account_id`, `employee_id`, `internal_keyword`, `unknown` 등 확장 가능 string |

금지:

- raw detected value 반환
- raw prompt/raw response 반환
- sampleHash 기본 반환
- API Key prefix/suffix 반환

## 24.2 Block error response

민감정보 정책으로 차단된 요청은 Provider를 호출하지 않는다.

```json
{
  "error": {
    "code": "SENSITIVE_DATA_BLOCKED",
    "message": "Request blocked by GateLM security policy.",
    "details": {
      "requestId": "request_01J...",
      "detectedTypes": ["api_key"],
      "action": "blocked"
    }
  }
}
```

HTTP status는 기본 `422`를 사용한다. 인증/인가 정책 차단과 결합된 경우 `403`을 사용할 수 있다.

## 24.3 Analytics masking API 제한

`GET /api/analytics/masking`은 aggregate만 반환한다. raw sample, raw prompt, raw response, sampleHash 목록 반환 API를 만들지 않는다.
