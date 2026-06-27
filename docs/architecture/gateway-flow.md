# GateLM Gateway 요청 흐름

> v1.0.0 범위 안내: 이 문서는 장기 Gateway pipeline 흐름을 포함한다. 현재 Gateway stage와 동작 범위는 `docs/v1.0.0/contracts.md`와 `docs/v1.0.0/implementation-plan.md`를 우선한다. v1.0.0은 text-only, non-stream, rule-based safety, PostgreSQL-backed Rate Limit, Redis Exact Cache를 main path로 둔다. Streaming, Semantic Cache, Budget, Redpanda/ClickHouse 흐름은 v2 후보로 본다. 과거 P0 기준은 `docs/archive/p0/*`에서 참고한다.

## 문서 목적

이 문서는 GateLM Gateway가 사용자 요청을 받아 외부 LLM Provider로 전달하고, 응답을 다시 사용자에게 반환하며, 중간 처리 결과를 로그로 남기는 기준을 정의한다.

이 문서는 다음 작업의 기준이다.

- Go Gateway Core 구현
- Gateway pipeline stage 구현
- Provider Adapter 구현
- Cache / Routing / Masking / Policy / Rate Limit 연동
- Gateway API 테스트 작성
- Worker 로그 저장 흐름 구현
- Request Log / Detail Drawer 데이터 조회 구현
- AI 코딩 도구가 Gateway 흐름을 임의로 바꾸지 못하게 하는 기준

GateLM은 단순 Chat UI가 아니라 **확장 가능한 LLM Gateway 플랫폼**이다. Gateway 흐름은 MVP에서 끝나는 구조가 아니라 Provider, Model, Policy, Event, 배포 방식, 분석 지표가 늘어나는 것을 전제로 설계한다.

---

# 0. 상위 기준 문서

Gateway 흐름을 구현하거나 변경할 때는 아래 문서 순서를 따른다.

```text
master-spec.md
-> project-overview.md
-> architecture.md
-> gateway-flow.md
-> pii-masking-policy.md
-> llm-log-schema.md
-> cost-policy.md
-> dashboard-metrics.md
-> api-spec.md
-> db-schema.md
-> folder-structure.md
-> coding-convention.md
-> ai-coding-rules.md
-> 실제 구현
```

우선순위가 충돌하면 아래 기준을 따른다.

1. 제품 방향은 `project-overview.md`를 따른다.
2. 시스템 경계는 `architecture.md`를 따른다.
3. Gateway 요청 처리 순서는 이 문서를 따른다.
4. 민감정보 detector, masking action, 저장/전송 정책은 `pii-masking-policy.md`를 따른다.
5. 로그 event field와 masking metadata는 `llm-log-schema.md`를 따른다.
6. 비용 계산과 Dashboard 지표는 `cost-policy.md`, `dashboard-metrics.md`를 따른다.
7. HTTP endpoint, request body, response body, error shape은 `api-spec.md`를 따른다.
8. 로그 저장소와 DB schema는 `db-schema.md`를 따른다.
9. 폴더 위치는 `folder-structure.md`를 따른다.
10. 코드 스타일은 `coding-convention.md`를 따른다.
11. AI 작업 제한은 `ai-coding-rules.md`를 따른다.

문서에 없는 Gateway stage, API, Event, DB field, Provider 분기, 정책 타입을 임의로 만들지 않는다. 필요한 경우 먼저 문서를 수정한다.

---

# 1. Gateway 핵심 원칙

## 1.1 모든 승인된 LLM 요청은 Gateway를 통과한다

고객사 앱, 개발 도구, 내부 API Client, GateLM Chat UI는 OpenAI, Anthropic, Gemini 등 외부 Provider를 직접 호출하지 않는다.

```text
Customer App / Developer Tool / GateLM Chat UI
-> GateLM Gateway
-> Provider Routing
-> OpenAI / Anthropic / Gemini / Local Model
```

Provider 직접 호출을 허용하면 비용 통제, 민감정보 보호, 사용량 추적, 정책 적용이 깨진다.

## 1.2 응답 경로와 분석 경로를 분리한다

Gateway는 사용자 응답에 필요한 작업만 동기 경로에서 수행한다.

```text
Response Path:
Client -> Gateway -> Cache or Provider -> Gateway -> Client

Analytics Path:
Gateway -> Redpanda -> Worker -> ClickHouse / PostgreSQL / S3-compatible Object Storage
```

Gateway는 요청 처리 중 DB 분석 테이블에 직접 쓰지 않는다. Gateway는 최소 metadata를 수집한 뒤 event를 발행하고, Worker가 장기 저장소에 기록한다.

## 1.3 확장 가능한 stage 구조를 유지한다

Gateway pipeline은 하나의 거대한 함수가 아니다. 각 단계는 독립 stage로 분리한다.

좋은 방향:

```text
authenticate_api_key
validate_app_token
resolve_request_context
check_rate_limit
apply_runtime_policy
mask_sensitive_data
lookup_cache
route_model
call_provider
publish_event
```

나쁜 방향:

```text
handleChatCompletion 안에 인증, 정책, 캐시, 라우팅, Provider별 분기를 모두 작성
```

신규 Provider, 신규 정책, 신규 cache 방식, 신규 logging 지표가 추가되어도 기존 stage 전체를 갈아엎지 않아야 한다.

## 1.4 Provider와 Model은 닫힌 enum으로 고정하지 않는다

Provider와 Model은 계속 늘어난다.

- `openai`, `anthropic`, `gemini`, `local`, `azure_openai`, `bedrock` 등으로 확장될 수 있다.
- `gpt-4o-mini`, `claude-*`, `gemini-*`, 사내 model alias 등이 추가될 수 있다.
- DB, DTO, Event, Routing Rule에서 Provider/Model을 closed enum으로 막지 않는다.
- 검증은 enum이 아니라 allowlist, provider registry, model registry, runtime policy로 처리한다.

## 1.5 원문 Prompt/Response 저장을 기본 금지한다

원문 Prompt/Response는 요청 처리 중 메모리에서만 사용한다.

기본 저장 대상:

```text
request_id
tenant_id
project_id
application_id
user_id
api_key_id
app_token_id
provider
model
requested_model
routed_provider
routed_model
token count
cost
latency
cache status
routing rule
masking result
redacted prompt
response summary
error class
created_at
```

저장 금지 대상:

```text
raw prompt
raw response
Provider Key 원문
Gateway API Key 원문
App Token 원문
Authorization header 원문
Cookie 원문
```

원문 저장이 필요한 고객사는 별도 opt-in, 암호화, retention, 접근 감사 정책이 있어야 한다. MVP 기본값은 원문 저장 금지다.

## 1.6 Gateway는 Control Plane이 아니다

Gateway는 Data Plane이다.

Gateway가 담당하는 것:

- LLM 요청 수신
- API Key 인증
- App Token 검증
- Tenant / Project / User / Application 식별
- Runtime Policy 적용
- Rate Limit / Quota / Budget 사전 검사
- 민감정보 탐지 / 마스킹 / 차단
- Cache 조회 / 저장
- Model Routing
- Provider 호출
- Streaming 중계
- usage/log event 발행

Gateway가 담당하지 않는 것:

- Tenant 생성
- 사용자 초대
- Project 생성
- Provider Key 등록 UI
- 정책 편집 UI
- Dashboard rendering
- 장기 로그 저장
- 분석 쿼리 API
- Worker retry 처리

---

# 2. 전체 요청 흐름 요약

## 2.1 기본 흐름

```text
1. Client가 OpenAI-compatible request를 GateLM Gateway로 전송
2. AWS ALB + ACM이 TLS 종료 후 Gateway Core로 전달
3. Gateway가 request_id와 trace_id를 생성한다
4. Gateway가 Gateway API Key를 검증한다
5. Gateway가 App Token을 검증한다
6. Gateway가 Tenant / Project / Application / User를 식별한다
7. Gateway가 active config와 runtime policy를 조회한다
8. Gateway가 Rate Limit / Quota / Budget을 Provider 호출 전에 검사한다
9. Gateway가 request body를 text-only 기준으로 검증한다
10. Gateway가 Reply-to Context가 필요한 경우 context를 구성한다
11. Gateway가 민감정보를 탐지한다
12. 정책에 따라 redacted prompt를 만들거나 요청을 차단한다
13. Gateway가 Model Routing을 수행해 selectedProvider/selectedModel을 확정한다
14. Gateway가 selectedProvider/selectedModel을 포함해 Exact Cache key를 생성한다
15. Gateway가 Exact Cache를 조회한다
16. Exact Cache miss이면 Semantic Cache를 조회한다
17. Gateway가 Provider credential을 secret reference 기준으로 조회한다
18. Gateway가 Provider Adapter로 request를 변환한다
19. Gateway가 Provider를 호출하거나 SSE stream을 relay한다
20. Gateway가 Provider response를 OpenAI-compatible response로 변환한다
21. Gateway가 token / cost / latency / cache / routing / masking metadata를 계산한다
22. Cache 저장 조건을 만족하면 cache entry를 저장한다
23. Gateway가 Client에게 응답을 반환한다
24. Gateway가 Redpanda에 usage/log event를 발행한다
25. Worker가 event를 소비해 ClickHouse / PostgreSQL / S3에 저장한다
26. Dashboard와 Request Log API가 저장된 분석 데이터를 조회한다
```

## 2.2 한 줄 기준

```text
Client -> ALB -> Gateway Pipeline -> Cache or Provider -> Client
                       |
                       +-> Redpanda -> Worker -> Analytics Storage
```

응답 경로의 목표는 빠른 응답이다. 분석 경로의 목표는 정확한 기록, 비용 계산, 감사 추적, 대시보드 집계다.

---

# 3. Client 진입 흐름

## 3.1 고객사 앱 / 내부 API Client

고객사 애플리케이션은 기존 Provider endpoint 대신 GateLM Gateway endpoint를 호출한다.

```text
Before:
Customer App -> OpenAI / Anthropic / Gemini

After:
Customer App -> GateLM Gateway -> Provider Routing -> Provider
```

기본 endpoint:

```text
POST /v1/chat/completions
GET  /v1/models
```

기본 headers:

```text
Authorization: Bearer <gateway_api_key>
X-GateLM-App-Token: <app_token>
X-GateLM-End-User-Id: <customer_user_id>
X-GateLM-Feature-Id: <feature_id>
Content-Type: application/json
```

`Authorization`은 Gateway 접근 권한을 검증한다. `X-GateLM-App-Token`은 애플리케이션 단위 사용 권한과 scope를 검증한다. `X-GateLM-End-User-Id`와 `X-GateLM-Feature-Id`는 사용량 추적과 정책 적용에 사용한다.

## 3.2 개발 도구 / CLI / SDK

OpenAI-compatible base URL 설정을 지원하는 도구는 base URL과 API Key를 GateLM 값으로 교체한다.

```text
OpenAI SDK / CLI / IDE
-> baseURL = https://gateway.gatelm.example/v1
-> apiKey  = glm_api_xxx
-> GateLM Gateway
```

도구가 custom header를 지원하지 않는 경우 App Token 전달 방식은 SDK wrapper 또는 project policy로 해결한다. 기본 정책은 App Token required다.

## 3.3 GateLM Chat UI

Chat UI는 Provider를 직접 호출하지 않는다.

```text
Employee
-> GateLM Chat UI
-> Gateway API 또는 Next.js proxy
-> GateLM Gateway
-> Provider
```

Next.js route handler를 사용하는 경우에도 Provider 호출은 Gateway Core만 수행한다. Next.js는 UI session 확인과 Gateway 요청 전달까지만 담당한다.

## 3.4 공식 외부 웹 UI

공식 ChatGPT, Gemini, Claude 웹사이트처럼 endpoint를 바꿀 수 없는 외부 웹 UI는 GateLM Gateway를 투명하게 통과시키지 않는다.

MVP에서는 아래 기능을 만들지 않는다.

- 공식 ChatGPT 웹사이트 트래픽 강제 우회
- 공식 Gemini 웹사이트 트래픽 강제 우회
- 공식 Claude 웹사이트 트래픽 강제 우회
- 브라우저 확장 기반 투명 proxy
- 네트워크 MITM 방식 proxy

승인된 사용 경로는 고객사 앱, 개발 도구, 내부 API Client, GateLM Chat UI다.

---

# 4. Gateway Pipeline 상세

## 4.1 Pipeline 순서

`POST /v1/chat/completions`는 아래 순서로 처리한다.

```text
receive_request
  -> assign_request_id
  -> parse_openai_compatible_payload
  -> authenticate_api_key
  -> validate_app_token
  -> resolve_tenant_project_user_application
  -> load_active_config
  -> check_scope_ip_status_expiry
  -> check_rate_limit
  -> check_quota_budget
  -> validate_text_only_request
  -> validate_requested_model_provider
  -> apply_runtime_policy_precheck
  -> load_reply_to_context_if_needed
  -> detect_sensitive_data
  -> mask_or_block
  -> decide_model_route
  -> normalize_prompt_for_cache
  -> build_cache_key
  -> exact_cache_lookup
  -> semantic_cache_lookup
  -> resolve_provider_credential
  -> convert_provider_request
  -> call_provider_with_timeout_retry_fallback
  -> convert_provider_response
  -> compute_usage_metadata
  -> write_cache_if_eligible
  -> build_client_response
  -> return_response
  -> publish_async_event
```

이 순서를 코드에서 임의로 바꾸면 안 된다. 순서 변경이 필요하면 먼저 이 문서를 수정하고, `architecture.md`, `api-spec.md`, `db-schema.md`, event schema 영향을 함께 검토한다.

## 4.2 Stage별 책임

| Stage | 책임 | 실패 시 동작 | 로그 기준 |
|---|---|---|---|
| `receive_request` | HTTP method, path, content-type 수신 | 404/405/415 | 기술 로그만 |
| `assign_request_id` | request_id, trace_id 생성 또는 수용 | 생성 실패 시 500 | 모든 후속 로그에 포함 |
| `parse_openai_compatible_payload` | OpenAI-compatible body 파싱 | 400 | invalid_request event |
| `authenticate_api_key` | Gateway API Key 검증 | 401 | auth_failed event |
| `validate_app_token` | App Token 검증 | 401/403 | app_token_denied event |
| `resolve_tenant_project_user_application` | 요청 소유 context 식별 | 403/404 | resolve_failed event |
| `load_active_config` | active policy/config 조회 | fail-closed 기본 | policy_load_failed event |
| `check_rate_limit` | RPM/TPM/동시 요청 제한 | 429 | rate_limited event |
| `check_quota_budget` | quota/budget 사전 검사 | 402/429 | quota_or_budget_blocked event |
| `validate_text_only_request` | 파일/이미지/audio 입력 차단 | 400 | invalid_request event |
| `apply_runtime_policy_precheck` | CEL 기반 정책 평가 | 403 | policy_blocked event |
| `load_reply_to_context_if_needed` | parent message context 구성 | 정책에 따라 continue/block | context_loaded event |
| `detect_sensitive_data` | 이메일/전화번호/API Key 등 탐지 | 탐지 결과 생성 | masking event |
| `mask_or_block` | redacted prompt 생성 또는 차단 | 403 | sensitive_data_blocked event |

민감정보 detector type, 기본 action, masking format, 저장 금지 field는 `pii-masking-policy.md`를 따른다.
| `build_cache_key` | prompt hash/cache key 생성 | miss로 처리 가능 | cache_key_error flag |
| `exact_cache_lookup` | 동일 요청 cache 조회 | hit이면 Provider 호출 생략 | cache_hit event |
| `semantic_cache_lookup` | 유사 요청 cache 조회 | 실패 시 miss | semantic_cache_error flag |
| `decide_model_route` | Provider/Model 선택 | 허용 route 없으면 403/404 | routing_decided event |
| `resolve_provider_credential` | secret reference로 credential 조회 | 502/503 | credential_resolve_failed event |
| `convert_provider_request` | Provider별 요청 포맷 변환 | 500/502 | provider_request_convert_failed event |
| `call_provider_with_timeout_retry_fallback` | 실제 Provider 호출 | retry/fallback 후 502/504 | provider_attempt event |
| `convert_provider_response` | OpenAI-compatible response 변환 | 502 | provider_response_convert_failed event |
| `compute_usage_metadata` | token/cost/latency 계산 | 응답은 유지, error flag | usage_metadata event |
| `write_cache_if_eligible` | cache 저장 | 실패해도 응답 유지 | cache_write_failed flag |
| `build_client_response` | response body/header 구성 | 500 | response_build_failed event |
| `return_response` | 사용자에게 응답 반환 | HTTP write error | transport log |
| `publish_async_event` | Redpanda event 발행 | 응답은 유지, metric/alert | event_publish_failed log |

## 4.3 Stage input/output 기준

각 stage는 공통 `GatewayRequestContext`를 입력받고, 필요한 필드만 갱신한다.

필수 context 필드:

```text
request_id
trace_id
started_at
client_ip
user_agent
api_key_id
app_token_id
tenant_id
project_id
application_id
end_user_id
feature_id
requested_model
requested_stream
policy_snapshot_id
rate_limit_result
quota_result
budget_result
masking_result
cache_status
routing_result
provider_attempts
usage_metadata
response_metadata
error_metadata
```

Stage는 raw API Key, raw App Token, Provider Key 원문을 context에 보관하지 않는다. 인증 직후에는 hash, key id, secret reference만 남긴다.

## 4.4 Stage 확장 규칙

신규 stage를 추가할 때는 아래 조건을 만족해야 한다.

1. stage 이름과 책임이 명확해야 한다.
2. 기존 stage의 책임을 중복하지 않아야 한다.
3. 실패 시 HTTP status와 GateLM error code가 정의되어야 한다.
4. event/log에 남길 metadata가 정의되어야 한다.
5. raw prompt/response/key를 저장하지 않아야 한다.
6. `api-spec.md`, `db-schema.md`, event schema 영향 여부를 먼저 확인해야 한다.
7. stage 순서 변경이 필요한 경우 이 문서와 `architecture.md`를 먼저 수정해야 한다.

---

# 5. 인증과 요청 식별 흐름

## 5.1 Gateway API Key 인증

```text
1. Authorization header에서 Bearer token 추출
2. raw token은 즉시 hash 처리
3. Redis 또는 active config에서 key hash 조회
4. key status, expires_at, revoked_at 확인
5. key scope 확인
6. api_key_id, tenant_id, project_id 후보를 context에 저장
7. raw token은 메모리에서도 즉시 폐기
```

실패 시 Provider를 호출하지 않는다.

Error 기준:

```text
401 invalid_api_key
403 invalid_app_token
403 scope_mismatch
```

## 5.2 App Token 검증

```text
1. X-GateLM-App-Token header 추출
2. token hash 계산
3. application_id와 app_token_id 조회
4. token status, expires_at, revoked_at 확인
5. token scope와 project binding 확인
6. IP allowlist 또는 origin policy가 있으면 검사
7. app_token_id, application_id를 context에 저장
```

기본 정책은 App Token required다. 특정 project에서 optional을 허용할 수 있지만, 이 경우에도 `api-spec.md`와 Runtime Policy에 명시되어야 한다.

## 5.3 End User 식별

`X-GateLM-End-User-Id`는 고객사 내부 사용자 ID다.

규칙:

- 없을 수 있다.
- 있으면 로그와 정책 평가에 사용한다.
- GateLM 사용자 계정 ID와 혼동하지 않는다.
- PII가 섞이지 않도록 고객사에는 opaque id 사용을 권장한다.

## 5.4 Feature 식별

`X-GateLM-Feature-Id`는 고객사 기능 단위 식별자다.

예시:

```text
support-reply
sales-email-draft
internal-code-review
chat-ui-default
```

Feature ID는 비용 분석, routing policy, quota policy, dashboard filter에 사용한다.

---

# 6. 정책 / Rate Limit / Quota / Budget 흐름

## 6.1 Active Policy 조회

Gateway는 요청마다 Control Plane DB를 직접 무겁게 조회하지 않는다.

기본 흐름:

```text
Control Plane에서 정책 생성/수정/배포
-> PostgreSQL에 policy version 저장
-> Redis에 active policy snapshot 배포
-> Gateway가 Redis에서 active policy snapshot 조회
-> Gateway가 요청 경로에서 정책 적용
```

Redis에 active snapshot이 없거나 손상된 경우 기본은 fail-closed다. 단, 운영 정책으로 일부 non-critical policy만 fail-open을 허용할 수 있다. 이 예외는 반드시 policy type별로 문서화한다.

## 6.2 Rate Limit 검사

Rate Limit은 Provider 호출 전에 검사한다.

대상은 확장 가능해야 한다.

```text
tenant
project
application
api_key
app_token
end_user
feature
future: department, group, environment
```

기본 제한:

```text
RPM
TPM
concurrent_requests
```

검사 결과:

```text
allowed
blocked
remaining
reset_at
rule_id
target_type
target_id
```

초과 시 Provider를 호출하지 않는다.

## 6.3 Quota / Budget 검사

Quota와 Budget은 비용 발생 전에 사전 검사한다.

```text
1. 현재 tenant/project/application/user budget 상태 조회
2. estimated token과 estimated cost 계산
3. budget threshold 또는 hard limit 확인
4. 초과 시 Provider 호출 전 차단
5. 허용 시 usage reservation 또는 pre-check result 기록
```

정확한 사용량 정산은 Provider 응답 후 Worker가 usage ledger와 budget ledger에 반영한다.

Error 기준:

```text
402 budget_exceeded
429 quota_exceeded
```

## 6.4 Runtime Policy 검사

Runtime Policy는 코드에 하드코딩하지 않는다.

검사 대상 예시:

```text
requested_model
messages length
end_user_id
feature_id
tenant_id
project_id
application_id
request_metadata
estimated_tokens
security_detection_result
budget_state
provider_health
```

정책 결과:

```text
allow
block
redact
route
require_low_cost_model
require_human_review
```

MVP에서는 `allow`, `block`, `redact`, `route` 중심으로 구현한다.

---

# 7. 요청 Payload 검증 흐름

## 7.1 OpenAI-compatible request 우선

Gateway API는 OpenAI-compatible request shape을 우선 지원한다.

기본 body:

```json
{
  "model": "auto",
  "messages": [
    {
      "role": "user",
      "content": "Write a short refund response."
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

## 7.2 MVP Text-only 제한

MVP는 text-only request만 허용한다.

거부 대상:

```text
image content
file content
audio content
multipart upload
OCR request
RAG document search request
tool call 기반 파일 분석
```

Error 기준:

```text
400 invalid_request_error
```

## 7.3 Metadata 기준

`metadata`에는 비민감 식별자만 넣는다.

허용 예시:

```json
{
  "customerTicketId": "ticket-123",
  "workflow": "support-reply",
  "environment": "production"
}
```

금지 예시:

```json
{
  "customerEmail": "alex@example.com",
  "apiKey": "sk-...",
  "rawPrompt": "...",
  "password": "..."
}
```

Gateway는 metadata도 민감정보 검사 대상에 포함할 수 있다.

---

# 8. Reply-to Context 흐름

## 8.1 기본 원칙

Provider는 이전 대화를 자동으로 기억하지 않는다. 필요한 context는 매 요청마다 Gateway가 구성해 Provider에 전달한다.

Reply-to Context는 P1 후보이며, P0에서는 no-op으로 둔다. P1에서 구현할 때는 전체 대화 기록을 매번 보내지 않고 **Reply-to Context**를 우선 적용한다.

```text
1. 사용자가 특정 AI 응답에 답장
2. Chat UI가 parent_message_id를 함께 전송
3. Gateway가 parent_message_id 기준으로 부모 질문/응답 조회
4. Gateway가 직계 부모 질문/응답만 context에 포함
5. 부모 응답이 길면 요약 또는 truncate 적용
6. Gateway가 현재 질문 + 부모 context로 Provider request 구성
7. context token 사용량을 별도로 기록
8. cache key에는 current message hash와 parent message hash를 함께 반영
```

## 8.2 Context 조회 위치

Chat message metadata는 Control Plane DB 또는 Chat storage에 존재한다. Gateway는 필요한 context만 조회한다.

주의:

- 전체 conversation을 매번 불러오지 않는다.
- parent chain을 무한히 따라가지 않는다.
- 직계 부모만 기본 포함한다.
- token budget을 초과하면 요약 또는 잘라내기를 적용한다.
- context에 포함된 텍스트도 민감정보 탐지와 마스킹 대상이다.

## 8.3 Cache key 반영

Reply-to Context가 있으면 cache key는 현재 질문만으로 만들면 안 된다.

Cache key 구성 요소:

```text
tenant_id
project_id
application_id
normalized_current_message_hash
parent_message_hash
system_prompt_hash
policy_snapshot_hash
model_or_route_policy_hash
security_policy_hash
```

---

# 9. 민감정보 탐지 / 마스킹 흐름

민감정보 detector, action, replacement token, 저장 전 마스킹, 외부 LLM 요청 전 마스킹 기준은 `pii-masking-policy.md`를 따른다.

## 9.1 탐지 시점

민감정보 탐지는 Provider 호출 전에 수행한다.

대상:

```text
messages[].content
system prompt
Reply-to Context
metadata
GateLM extension fields 중 free-form text
```

기본 탐지 대상:

```text
email
phone number
resident_registration_number
API key pattern
access token pattern
password-like pattern
employee id
internal account id
internal confidential keyword
```

## 9.2 정책 동작

```text
allow -> 그대로 진행
redact -> redacted prompt로 Provider 호출
block -> Provider 호출 전 차단
```

`redact`인 경우:

```text
raw prompt       = 메모리에서만 사용
redacted prompt  = Provider 호출에 사용
log payload      = redacted prompt만 포함
```

`block`인 경우:

```text
Provider 호출 없음
Cache 조회/저장 없음
사용자에게 sensitive_data_blocked error 반환
Redpanda에 masking.blocked event 발행
```

`redact`인 경우에도 Provider에는 redacted payload만 전달한다. raw PII는 Provider Adapter에 넘기지 않는다.

## 9.3 로그 기준

마스킹 로그에는 아래 정보만 남긴다.

```text
request_id
tenant_id
project_id
application_id
masking_action
masking_rule_id
detected_types
redaction_count
redacted_prompt
created_at
```

원문 탐지값은 저장하지 않는다.

---

# 10. Cache 흐름

## 10.1 Cache 조회 순서

```text
1. 요청 payload normalize
2. context와 policy snapshot 반영
3. Model Routing으로 selectedProvider/selectedModel 확정
4. selectedProvider/selectedModel을 포함해 exact cache key 생성
5. Redis에서 Exact Cache 조회
6. hit이면 Provider 호출 없이 응답 생성
7. miss이면 Semantic Cache 조회
8. Semantic Cache hit이면 정책에 따라 응답 생성
9. 모든 cache miss이면 Provider 호출로 진행
```

## 10.2 Exact Cache

Exact Cache는 동일 요청 반복 비용을 줄이기 위한 1차 cache다.

Key 구성 요소:

```text
tenant_id
project_id
application_id
normalized_prompt_hash
parent_message_hash
requested_model_or_route_policy_hash
system_prompt_hash
security_policy_hash
cache_version
```

Value 저장 항목:

```text
redacted_response
provider
model
prompt_tokens
completion_tokens
estimated_cost_saved_usd
created_at
expires_at
policy_snapshot_id
```

저장 금지:

```text
raw prompt
raw response
API Key
App Token
Provider Key
```

## 10.3 Semantic Cache

Semantic Cache는 유사 요청을 감지하기 위한 확장 지점이다.

MVP 기준:

- 기본 Semantic Cache 흐름만 둔다.
- embedding이 필요한 경우 AI Service를 사용한다.
- AI Service 실패 시 cache miss로 처리하고 Provider 호출로 진행한다.
- Vector DB 등 신규 인프라는 별도 문서와 schema가 확정되기 전 임의 도입하지 않는다.

## 10.4 Cache hit 응답

Cache hit이면 Provider를 호출하지 않는다.

응답 metadata:

```text
cache_status = hit
cache_type = exact
routed_provider = cached provider
routed_model = cached model
estimated_cost_usd = 0 또는 saved cost 기준
```

HTTP header:

```text
X-GateLM-Cache-Status: hit
X-GateLM-Routed-Provider: openai
X-GateLM-Routed-Model: gpt-4o-mini
```

Cache hit도 usage/log event를 발행한다. Dashboard에서 비용 절감 효과를 확인해야 하기 때문이다.

## 10.5 Cache write

Provider 응답 후 아래 조건을 만족하면 cache를 저장한다.

```text
request success
policy allows cache
response is cacheable
no block action
redacted prompt 기준으로 안전
tenant/project cache setting enabled
TTL 설정 가능
```

Cache write 실패는 사용자 응답을 실패시키지 않는다. 실패 정보는 event metadata와 structured log에 남긴다.

---

# 11. Model Routing 흐름

## 11.1 Routing 입력

Routing은 다음 입력을 사용한다.

```text
tenant_id
project_id
application_id
end_user_id
feature_id
requested_model
allowed_provider_model_list
policy_snapshot
prompt_length
estimated_prompt_tokens
request_class
cache_status
budget_state
provider_health
fallback_policy
routing_hint
```

## 11.2 Routing 결과

Routing 결과는 반드시 명시적으로 남긴다.

```text
requested_model
routing_mode
selected_provider
selected_model
routing_rule_id
routing_reason
fallback_candidates
fallback_used
estimated_cost_usd
```

## 11.3 Routing 규칙

기본 규칙:

- `model = auto`이면 Runtime Policy와 routing rule을 기준으로 Provider/Model을 선택한다.
- `gate_lm.routing.mode = pinned`이면 요청자가 지정한 provider/model hint를 고려한다.
- pinned 요청도 project allowlist와 policy를 통과해야 한다.
- 단순 요청은 저비용 모델로 라우팅할 수 있다.
- 허용되지 않은 Provider/Model로 라우팅하면 안 된다.
- Provider 상태가 degraded이면 fallback 후보를 사용할 수 있다.

## 11.4 Routing 확장성

Routing은 `if provider == "openai"` 방식으로 구현하지 않는다.

좋은 방향:

```text
RoutingEngine
-> ProviderRegistry
-> ModelRegistry
-> PolicyEvaluator
-> ProviderHealthStore
-> CostEstimator
```

신규 Provider 추가 시 routing engine은 provider registry를 통해 후보를 인식해야 한다. Gateway pipeline 전체에 Provider별 분기를 흩뿌리지 않는다.

---

# 12. Provider 전달 흐름

## 12.1 Provider credential 조회

Provider credential은 request body로 받지 않는다.

기본 흐름:

```text
1. Routing 결과로 provider_connection_id 또는 secret_ref 결정
2. Gateway가 secret_ref 기준으로 credential 조회
3. credential은 Provider 호출 직전에만 메모리에 존재
4. 로그, event, response에 credential 원문을 남기지 않음
5. 호출 후 credential reference만 metadata에 남김
```

Provider credential 저장은 AWS Secrets Manager + KMS 기준이다. Self-hosted/Hybrid 확장 시에도 secret storage interface를 유지한다.

## 12.2 Provider Adapter 책임

Provider Adapter는 Provider별 request/response 차이를 흡수한다.

담당:

```text
OpenAI-compatible request -> Provider request 변환
Provider response -> OpenAI-compatible response 변환
Provider error -> GateLM error model 변환
Provider streaming chunk -> OpenAI-compatible SSE chunk 변환
Provider usage 추출
Provider-specific retry 가능 여부 판단
```

Provider Adapter 외부에서 Provider별 포맷 분기 코드를 만들지 않는다.

## 12.3 Provider 호출

Provider 호출은 timeout, retry, circuit breaker, fallback 정책을 따른다.

기본 흐름:

```text
1. selected provider/model로 1차 attempt 시작
2. timeout 설정 적용
3. retry 가능한 오류인지 판단
4. retry 가능하면 exponential backoff 적용
5. provider health와 fallback policy 확인
6. fallback 가능하면 대체 provider/model attempt 수행
7. 최종 성공 또는 실패 결과를 Gateway response로 변환
8. 모든 attempt metadata를 event에 포함
```

## 12.4 Provider Attempt 기록

각 attempt마다 아래 metadata를 남긴다.

```text
attempt_index
provider
model
started_at
ended_at
latency_ms
status
error_class
http_status
retryable
fallback_from
fallback_reason
prompt_tokens
completion_tokens
estimated_cost_usd
actual_cost_usd
```

원문 request/response body는 attempt log에 저장하지 않는다.

---

# 13. 응답 반환 흐름

## 13.1 Non-stream 응답

Non-stream 요청 흐름:

```text
1. Gateway가 Provider response 또는 Cache response를 받는다
2. OpenAI-compatible response body로 변환한다
3. usage metadata를 계산한다
4. gate_lm metadata를 response에 포함할지 결정한다
5. 공통 response header를 설정한다
6. Client에게 200 response를 반환한다
7. 최종 invocation event를 Redpanda에 발행한다
```

응답 예시:

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
    "selectedProvider": "mock",
    "selectedModel": "mock-fast",
    "cacheStatus": "miss",
    "routingReason": "low_cost",
    "maskingAction": "redacted",
    "estimatedCostUsd": "0.001240",
    "latencyMs": 820
  }
}
```

## 13.2 Response Headers

Gateway는 아래 header를 반환한다.

```text
X-GateLM-Request-Id: request_01J...
X-GateLM-Cache-Status: hit | miss | bypass | error
X-GateLM-Routed-Provider: openai
X-GateLM-Routed-Model: gpt-4o-mini
X-GateLM-Masking-Action: none | redacted | blocked
X-GateLM-Estimated-Cost-Usd: 0.001240
```

`X-GateLM-Request-Id`는 모든 정상/오류 응답에 포함한다.

## 13.3 Error 응답

Gateway API error shape은 OpenAI-compatible 형식을 따른다.

예시:

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

주요 error:

```text
400 invalid_request_error
401 invalid_api_key
403 invalid_app_token
403 scope_mismatch
403 policy_blocked
403 sensitive_data_blocked
404 not_found
429 rate_limited
429 quota_exceeded
402 budget_exceeded
502 provider_error
504 provider_timeout
```

Error message에는 raw prompt, raw response, API Key, App Token, Provider Key를 포함하지 않는다.

---

# 14. Streaming 응답 흐름

## 14.1 Streaming 기본 흐름

`stream = true` 요청은 SSE로 처리한다.

```text
1. Client가 stream=true로 Gateway에 요청
2. Gateway가 인증, 정책, 마스킹, cache, routing을 먼저 수행
3. Cache hit이면 저장된 응답을 streaming 형태로 재생할 수 있다
4. Cache miss이면 Provider streaming API 호출
5. Provider Adapter가 provider chunk를 OpenAI-compatible SSE chunk로 변환
6. Gateway가 Client로 chunk를 즉시 전달
7. 마지막 chunk에 request_id, cache_status, selected_provider, selected_model metadata를 포함한다
8. data: [DONE] 전송
9. stream 종료 후 token / latency / error 상태를 정리한다
10. Gateway가 최종 invocation event를 Redpanda에 발행한다
```

## 14.2 Streaming chunk 예시

```text
data: {"id":"chatcmpl_01J...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl_01J...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}

data: {"id":"chatcmpl_01J...","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"gate_lm":{"requestId":"request_01J...","cacheStatus":"miss","selectedProvider":"mock","selectedModel":"mock-fast"}}

data: [DONE]
```

## 14.3 Streaming 로그 기준

Streaming 중에는 chunk 원문을 장기 저장하지 않는다.

저장 대상:

```text
request_id
stream = true
provider
model
started_at
first_token_at
ttft_ms
completed_at
total_latency_ms
prompt_tokens
completion_tokens
status
error_class
cache_status
routing_result
masking_result
response_summary
```

`response_summary`는 원문 전체 응답이 아니라 요약 또는 짧은 preview만 허용한다. 원문 응답 저장은 고객사 opt-in이 없으면 금지한다.

## 14.4 Streaming 중 오류

Provider streaming 중 오류가 발생하면 상황별로 처리한다.

| 상황 | 처리 |
|---|---|
| 아직 chunk를 보내기 전 | fallback 가능하면 fallback 시도 |
| 일부 chunk 전송 후 | fallback은 streaming policy에 따름 |
| Provider timeout | 가능한 경우 error chunk 후 종료 |
| Client disconnect | Provider stream 취소, event에는 client_aborted 기록 |
| Event publish 실패 | response는 이미 완료, structured log와 metric 기록 |

이미 일부 chunk가 전송된 뒤에는 응답 형식이 깨질 수 있으므로 fallback 가능 여부를 보수적으로 판단한다.

---

# 15. 차단 요청 흐름

## 15.1 Provider 호출 전 차단 대상

아래 경우 Gateway는 Provider를 호출하지 않는다.

```text
API Key 없음/오류/만료/폐기
App Token 없음/오류/만료/폐기
scope 부족
IP allowlist 위반
Tenant/Project/Application 비활성
Rate Limit 초과
Quota 초과
Budget 초과
Runtime Policy block
민감정보 정책 block
지원하지 않는 image/file/audio/multipart 요청
허용되지 않은 Provider/Model 요청
Provider credential 없음
```

## 15.2 차단 흐름

```text
1. 차단 stage에서 error metadata 생성
2. Provider 호출 생략
3. Cache 조회 또는 저장 생략
4. OpenAI-compatible error response 생성
5. X-GateLM-Request-Id header 포함
6. Client에게 error 반환
7. Redpanda에 blocked event 발행
8. Worker가 ClickHouse/PostgreSQL에 차단 기록 저장
9. Dashboard에서 차단 사유 확인 가능
```

## 15.3 차단 event 공통 필드

```text
event_id
event_type
request_id
trace_id
tenant_id
project_id
application_id
api_key_id
app_token_id
end_user_id
feature_id
blocked_stage
error_code
error_class
policy_rule_id
masking_rule_id
rate_limit_rule_id
quota_rule_id
budget_policy_id
created_at
```

원문 prompt는 포함하지 않는다. 필요한 경우 redacted prompt만 포함한다.

---

# 16. 로그 저장 흐름

## 16.1 중간에 로그를 저장하는 위치

정확한 기준은 아래다.

```text
Gateway 동기 처리 중:
- 장기 DB에 직접 저장하지 않는다.
- RequestContext에 metadata를 메모리로 누적한다.
- 민감하지 않은 structured application log만 남긴다.

Gateway 처리 종료 시:
- 최종 상태를 Redpanda event로 발행한다.
- Provider attempt, cache, routing, masking, error metadata를 event에 포함한다.

Worker 처리 시:
- Redpanda event를 consume한다.
- schema validation과 idempotency check를 수행한다.
- ClickHouse / PostgreSQL / S3에 저장한다.
```

따라서 “중간 로그 저장 위치”는 DB가 아니라 `Gateway RequestContext`와 `Redpanda Event`다. 장기 저장은 Worker가 담당한다.

## 16.2 로그 이벤트 발행 시점

Gateway는 아래 terminal state 또는 주요 event에 대해 Redpanda event를 발행한다.

```text
invocation.completed
invocation.failed
invocation.blocked
provider.attempt.completed
provider.attempt.failed
cache.hit
cache.miss
cache.write_failed
routing.decided
masking.detected
masking.blocked
rate_limit.blocked
quota.blocked
budget.blocked
policy.blocked
stream.completed
stream.failed
```

정식 event name과 payload schema는 `packages/contracts/events` 또는 `contracts/events.schema.json`에서 확정한다. 코드에서 임의 event field를 추가하지 않는다.

## 16.3 Gateway event 기본 payload

기본 payload:

```json
{
  "eventId": "event_01J...",
  "eventType": "invocation.completed",
  "eventVersion": 1,
  "requestId": "request_01J...",
  "traceId": "trace_01J...",
  "tenantId": "tenant_01J...",
  "projectId": "project_01J...",
  "applicationId": "app_01J...",
  "apiKeyId": "api_key_01J...",
  "appTokenId": "app_token_01J...",
  "endUserId": "customer-user-123",
  "featureId": "support-reply",
  "requestedModel": "auto",
  "selectedProvider": "mock",
  "selectedModel": "mock-fast",
  "cacheStatus": "miss",
  "routing": {
    "ruleId": "rule_01J...",
    "reason": "low_cost",
    "fallbackUsed": false
  },
  "masking": {
    "action": "redacted",
    "detectedTypes": ["email"],
    "redactionCount": 1
  },
  "usage": {
    "promptTokens": 120,
    "completionTokens": 80,
    "totalTokens": 200,
    "estimatedCostUsd": "0.001240"
  },
  "latency": {
    "totalMs": 820,
    "providerMs": 690,
    "ttftMs": null
  },
  "status": "success",
  "error": null,
  "redactedPrompt": "Write a short refund response to [EMAIL].",
  "responseSummary": "Short refund response generated.",
  "createdAt": "2026-06-22T06:00:00.000Z"
}
```

## 16.4 Worker 저장 흐름

```text
1. Worker가 Redpanda에서 event consume
2. eventVersion과 schema validation 수행
3. event_id 기준 idempotency 확인
4. token/cost/latency 값 보정
5. ClickHouse에 invocation/provider attempt/cache/routing/masking row 저장
6. PostgreSQL에 usage ledger, budget ledger, audit log 저장
7. redacted payload 또는 response summary가 큰 경우 S3에 저장
8. alert 조건 평가
9. 실패 시 retry 또는 dead-letter 처리
```

## 16.5 저장소별 책임

| 저장소 | 저장 대상 | 책임 |
|---|---|---|
| Redis | rate limit counter, quota counter, exact cache, active policy snapshot | 빠른 동기 조회 |
| Redpanda | Gateway event stream | 응답 경로와 분석 경로 분리 |
| ClickHouse | invocation, provider attempt, token, cost, latency, cache, routing, masking metadata | 대시보드 / 분석 / 로그 검색 |
| PostgreSQL | tenant/project/config, usage ledger, budget ledger, audit log | 정합성 / 감사 / 원장 |
| S3-compatible Object Storage | 큰 redacted payload, response summary, export artifact | 장기 보관 / 대용량 payload |
| Secrets Manager + KMS | Provider credential | credential 격리 / 회전 |
| Structured stdout log | request_id 중심 기술 로그 | 장애 대응 / 운영 metric 보조 |

## 16.6 Event 발행 실패

Redpanda event 발행 실패가 발생해도 사용자 응답을 무조건 실패시키지는 않는다.

필수 처리:

```text
1. request_id 포함 structured log 기록
2. event_publish_failed metric 증가
3. 짧은 bounded retry 수행
4. retry 실패 시 local fallback log 또는 dead-letter buffer 사용 가능
5. billing-critical event 누락 가능성을 운영 알림으로 전달
```

Event Bus 장애를 이유로 Provider 응답 자체를 실패시키는 것은 기본 정책이 아니다. 단, 고객사 정책이 “billing event guarantee required”로 설정된 경우 fail-closed 옵션을 둘 수 있다. 이 옵션은 Runtime Policy와 운영 문서에 명시되어야 한다.

---

# 17. Dashboard 조회 흐름

## 17.1 Request Log 조회

```text
1. Admin이 Web Console에서 Request Log 화면 진입
2. Next.js가 Control Plane API 호출
3. Control Plane API가 Analytics API 또는 ClickHouse 조회
4. Request 목록 반환
5. 사용자가 특정 request 선택
6. Detail Drawer에서 request_id 기준 상세 조회
7. ClickHouse/PostgreSQL/S3에서 metadata, ledger, redacted payload 조회
8. UI에 비용, 토큰, 캐시, 라우팅, 마스킹, 오류 정보를 표시
```

Dashboard는 Gateway를 직접 조회하지 않는다. Gateway는 운영 요청을 처리하는 Data Plane이지 분석 API 서버가 아니다.

## 17.2 Detail Drawer 표시 기준

표시 가능:

```text
request_id
tenant_id
project_id
application_id
end_user_id
feature_id
provider/model
requested/routed model
status/error code
latency/TTFT
token/cost
cache status
routing decision
masking action
fallback path
redacted prompt
response summary
```

기본 표시 금지:

```text
raw prompt
raw response
API Key 원문
App Token 원문
Provider Key 원문
Authorization header
```

---

# 18. 실패 처리 기준

## 18.1 Fail-closed 대상

아래 오류는 기본적으로 fail-closed다.

```text
API Key 검증 실패
App Token 검증 실패
Tenant/Project/Application 비활성
Policy 조회 실패
Budget hard limit 상태 확인 실패
Provider credential 조회 실패
민감정보 block 정책 적용
허용 모델 검증 실패
```

Fail-closed는 Provider 호출 전 차단을 의미한다.

## 18.2 Fail-open 가능 대상

아래 오류는 정책에 따라 fail-open이 가능하다.

```text
Exact Cache 조회 실패 -> miss 처리
Semantic Cache 조회 실패 -> miss 처리
Cache write 실패 -> 응답 유지
Usage metadata 일부 계산 실패 -> 응답 유지, event에 error flag
Event publish 실패 -> 응답 유지, structured log/metric/alert
Dashboard 집계 실패 -> 사용자 LLM 응답과 무관
```

Fail-open은 반드시 event 또는 structured log에 남긴다.

## 18.3 Provider 오류

Provider 오류 처리 순서:

```text
1. Provider error class 분류
2. retry 가능한 오류인지 판단
3. timeout/retry/backoff 적용
4. circuit breaker 상태 반영
5. fallback route 가능 여부 확인
6. fallback route 호출
7. 모든 route 실패 시 GateLM provider_error 또는 provider_timeout 반환
8. provider_attempts metadata 기록
```

## 18.4 Client disconnect

Client가 연결을 끊으면 Gateway는 가능한 한 Provider 호출을 취소한다.

처리:

```text
1. request context canceled
2. Provider stream/request cancel
3. Redis concurrent counter release
4. partial usage metadata 계산 가능하면 기록
5. event status = client_aborted
6. raw partial response 저장 금지
```

---

# 19. 확장 설계 기준

## 19.1 신규 Provider 추가

신규 Provider는 아래 순서로 추가한다.

```text
1. Provider capability 정의
2. Provider Adapter 구현
3. Provider Registry 등록
4. Model Registry 또는 provider model sync 추가
5. Provider credential schema 확인
6. Routing policy에서 후보로 사용 가능하게 설정
7. Provider attempt event에 provider string 그대로 기록
8. Gateway pipeline 순서 변경 없이 테스트 추가
```

금지:

```text
Gateway handler 곳곳에 if provider == "new_provider" 추가
Provider별 API Key를 request body로 받기
Provider 원문 response를 그대로 Client에 반환
Provider response 전체를 로그 저장
```

## 19.2 신규 Policy 추가

신규 Policy는 아래 순서로 추가한다.

```text
1. policy-spec 또는 policy schema 수정
2. Control Plane policy validation 추가
3. Runtime Policy evaluator 확장
4. Gateway stage 입력/출력 영향 검토
5. Event payload version 검토
6. Dashboard 표시 필요 여부 검토
7. 테스트 추가
```

정책은 코드에 하드코딩하지 않는다.

## 19.3 신규 Cache 방식 추가

신규 cache 방식은 Exact/Semantic 흐름을 깨지 않고 추가한다.

예시:

```text
decide_model_route
-> exact_cache_lookup
-> semantic_cache_lookup
-> future_cache_lookup
```

신규 cache는 cache key 구성, selectedProvider/selectedModel, security policy hash, TTL, invalidation 기준을 문서화해야 한다.

## 19.4 신규 로그 지표 추가

신규 로그 지표는 event versioning을 따른다.

규칙:

- 기존 field 의미를 바꾸지 않는다.
- 필수 field를 함부로 추가해 기존 consumer를 깨지 않는다.
- optional field 또는 eventVersion bump를 사용한다.
- ClickHouse schema 변경은 `db-schema.md`를 먼저 수정한다.
- Dashboard 사용 여부를 명확히 한다.

## 19.5 Self-hosted / Hybrid 확장

SaaS 기본 구조를 유지하되 Gateway/Data Plane은 향후 고객사 인프라에 둘 수 있다.

따라서 Gateway는 아래 interface를 직접 구현에 고정하지 않는다.

```text
PolicySnapshotStore
RateLimitStore
CacheStore
EventPublisher
SecretResolver
ProviderRegistry
RoutingEngine
MaskingEngine
```

구현체는 SaaS, Self-hosted, Hybrid 배포에 따라 교체 가능해야 한다.

---

# 20. 구현 금지 사항

Gateway 흐름에서 아래 구현은 금지한다.

```text
Frontend가 Provider를 직접 호출
Control Plane API가 Provider를 직접 호출
Worker가 Provider를 직접 호출
Gateway가 Dashboard용 분석 쿼리를 직접 처리
Gateway가 ClickHouse에 동기 write
Gateway가 PostgreSQL usage ledger에 요청마다 직접 write
Gateway가 request body에서 Provider Key를 수신
Gateway가 raw prompt/raw response를 기본 저장
Gateway가 API Key/App Token 원문을 로그에 남김
Provider별 분기를 handler 곳곳에 작성
Provider/Model을 DB enum으로 고정
문서에 없는 Gateway stage 추가
문서에 없는 event field 추가
공식 ChatGPT/Gemini/Claude 웹 트래픽을 투명 proxy 처리
MVP에서 image/file/audio/OCR/RAG 요청 처리
```

예외가 필요하면 먼저 `project-overview.md`, `architecture.md`, `gateway-flow.md`, `api-spec.md`, `db-schema.md`를 수정하고 리뷰를 거친다.

---

# 21. MVP Gateway 구현 체크리스트

MVP Gateway 구현은 아래 항목을 만족해야 한다.

```text
[ ] POST /v1/chat/completions를 OpenAI-compatible shape으로 받는다
[ ] GET /v1/models를 Gateway API Key 기준으로 반환한다
[ ] Request ID를 모든 요청에 부여한다
[ ] Gateway API Key를 검증한다
[ ] App Token을 검증한다
[ ] Tenant / Project / Application / End User / Feature를 식별한다
[ ] Rate Limit을 Provider 호출 전에 검사한다
[ ] Quota / Budget을 Provider 호출 전에 검사한다
[ ] Runtime Policy pre-check를 수행한다
[ ] Text-only request만 허용한다
[ ] image/file/audio/multipart/OCR/RAG 요청을 거부한다
[ ] Reply-to Context를 parent_message_id 기준으로 구성한다
[ ] 민감정보를 Provider 호출 전에 탐지한다
[ ] 정책에 따라 mask 또는 block한다
[ ] Exact Cache hit 시 Provider 호출을 생략한다
[ ] 기본 Semantic Cache 흐름을 갖는다
[ ] Model Routing을 수행한다
[ ] Provider credential을 secret reference로 조회한다
[ ] Provider Adapter로 request/response를 변환한다
[ ] Provider timeout/retry/fallback metadata를 남긴다
[ ] SSE Streaming을 중계한다
[ ] token / cost / latency / TTFT를 계산한다
[ ] cache/routing/masking 결과를 response header 또는 gate_lm metadata로 반환한다
[ ] Redpanda에 invocation event를 발행한다
[ ] Worker가 event를 ClickHouse/PostgreSQL/S3에 저장한다
[ ] 원문 Prompt/Response를 기본 저장하지 않는다
[ ] Request Log Detail Drawer에서 요청 흐름을 추적할 수 있다
```

---

# 22. AI 구현자 지침

AI가 Gateway 관련 코드를 작성할 때는 아래 규칙을 따른다.

1. 먼저 이 문서의 어떤 section을 구현하는지 밝힌다.
2. 한 번에 하나의 pipeline stage 또는 작은 흐름만 구현한다.
3. 기존 stage 순서를 바꾸지 않는다.
4. Provider별 분기를 handler에 직접 쓰지 않는다.
5. 신규 Provider는 Provider Adapter와 Registry로만 추가한다.
6. DB schema가 필요하면 `db-schema.md`를 먼저 수정한다.
7. API shape이 바뀌면 `api-spec.md`를 먼저 수정한다.
8. Event payload가 바뀌면 event schema를 먼저 수정한다.
9. 보안 관련 코드는 리뷰 없이 merge하지 않는다.
10. raw prompt, raw response, key 원문을 로그에 남기지 않는다.
11. 구현이 커지면 stage 단위로 나눠 작업한다.
12. Gateway 흐름과 무관한 폴더를 새로 만들지 않는다.

AI가 아래 요청을 받으면 즉시 멈추고 문서 수정 또는 리뷰 필요성을 설명해야 한다.

```text
Gateway stage 순서 변경
Provider 직접 호출 경로 추가
raw prompt 저장 추가
Provider Key를 request body로 받는 변경
ClickHouse 동기 write 추가
Gateway가 Dashboard 분석 API까지 담당하는 변경
파일/이미지/OCR/RAG를 MVP Gateway에 추가하는 변경
문서에 없는 endpoint/event/db table 추가
```

---

# 23. 최종 기준

Gateway 구현의 최종 기준은 아래 문장이다.

```text
GateLM Gateway는 승인된 LLM 요청을 중앙에서 통제하는 Data Plane이다.
Gateway는 인증, 정책, 사용량 제한, 마스킹, 캐시, 라우팅, Provider 호출, 응답 변환까지만 동기 처리하고,
로그 저장과 분석은 Redpanda와 Worker를 통해 비동기로 처리한다.
```

이 기준을 깨는 구현은 MVP가 돌아가더라도 GateLM의 제품 방향과 맞지 않는다.

---

# 22. 민감정보 마스킹 흐름 기준

민감정보 탐지와 마스킹의 세부 정책은 `pii-masking-policy.md`를 따른다. Gateway 흐름에서는 아래 순서를 고정한다.

```text
Conversation Context 조립
-> PII / Secret Detection
-> Security Policy Evaluation
-> action = block 이면 Provider 호출 전 차단
-> action = redact 이면 redacted prompt 생성
-> Routing으로 selectedProvider/selectedModel 확정
-> redacted prompt와 selectedProvider/selectedModel 기준 Cache Key 생성
-> Cache 조회
-> Provider 호출
-> 비동기 masking/log event 발행
```

중요 기준:

- raw prompt 기준 cache key를 만들지 않는다.
- raw prompt를 embedding provider 또는 vector store로 보내지 않는다.
- P0에서는 `resident_registration_number`, `api_key`, `authorization_header`, `jwt`, `private_key`를 Provider 호출 전 block한다.
- P0에서는 `email`, `phone_number`를 redacted prompt로 Provider에 전달한다.
- block 요청도 request log와 masking metadata를 남긴다.
- masking event 발행 실패가 기본적으로 사용자 응답을 실패시키지는 않지만, technical log와 metric에는 반드시 남긴다.
