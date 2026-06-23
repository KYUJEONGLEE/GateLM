# GateLM Agent Implementation Guide

이 문서는 Codex, Claude Code 같은 구현 에이전트가 GateLM 작업을 시작할 때 가장 먼저 읽어야 하는 기준 문서다.

GateLM은 기업의 승인된 LLM 사용 경로를 하나의 Gateway로 통합해 비용 절감, 사용량 통제, 민감정보 보호, 운영 가시성을 제공하는 B2B LLM Gateway 플랫폼이다.

GateLM은 단순 Chat UI가 아니다. 핵심은 LLM Gateway다.

---

## 1. 작업 전 필수 읽기 순서

작업을 시작하기 전에 아래 문서를 순서대로 확인한다.

1. `docs/README.md`

   * 문서 구조와 전체 읽는 순서를 확인한다.

2. 이 문서의 프로젝트 목표와 P0 범위

   * GateLM의 문제 정의, 타깃 사용자, 제품 방향을 확인한다.

3. `docs/p0/implementation-cut.md`

   * 지금 구현해야 하는 P0 범위와 제외 범위를 확인한다.

4. `docs/p0/demo-acceptance.md`

   * 최종 데모 합격 기준과 실패 기준을 확인한다.

5. `docs/architecture/architecture.md`

   * 시스템 경계, Gateway 중심 구조, Control Plane / Data Plane 분리를 확인한다.

6. `docs/architecture/gateway-flow.md`

   * 인증, App Token 검증, 정책 검사, 마스킹, 캐시, 라우팅, Provider 호출, 로깅 흐름을 확인한다.

7. `docs/architecture/api-spec.md`

   * Control Plane API와 Gateway API 계약을 확인한다.

8. `docs/architecture/db-schema.md`

   * 장기 DB 설계 기준을 확인한다.

9. `docs/p0/p0-db-migration-plan.md`

   * P0에서 실제로 만들 DB table 범위를 확인한다.

10. `docs/architecture/llm-log-schema.md`

    * 장기 요청 로그와 이벤트 스키마 기준을 확인한다.

11. `docs/p0/p0-log-event-payload.md`

    * P0에서 반드시 저장할 request log / event payload 필드를 확인한다.

12. `docs/policies/pii-masking-policy.md`

    * Provider 호출 전 민감정보 탐지, 마스킹, 차단 기준을 확인한다.

13. `docs/policies/coding-convention.md`

    * 코드 스타일과 계층별 책임을 확인한다.

14. `docs/policies/ai-coding-rules.md`

    * AI 에이전트가 코드 작성 전 반드시 지켜야 하는 작업 규칙을 확인한다.

15. `docs/p0/local-dev.md`

    * 로컬 실행 방식, seed 데이터, mock provider 기준을 확인한다.

16. `docs/p0/mock-provider.md`

    * mock provider 동작과 acceptance 기준을 확인한다.

문서 경로가 다르면 추측하지 말고 현재 repository의 실제 파일 구조를 먼저 확인한다.

---

## 2. 문서 우선순위

문서끼리 충돌하면 아래 순서로 판단한다.

1. `docs/p0/implementation-cut.md`
2. `docs/p0/demo-acceptance.md`
3. `docs/architecture/gateway-flow.md`
4. `docs/architecture/api-spec.md`
5. `docs/p0/p0-db-migration-plan.md`
6. `docs/p0/p0-log-event-payload.md`
7. `docs/architecture/db-schema.md`
8. `docs/architecture/llm-log-schema.md`
9. `docs/policies/pii-masking-policy.md`
10. `docs/policies/coding-convention.md`
11. `docs/policies/ai-coding-rules.md`

P0 구현 중에는 장기 설계보다 P0 acceptance 통과가 우선이다.
단, 보안 기준은 단순화를 이유로 낮추지 않는다.

---

## 3. P0 구현 목표

P0 목표는 완성형 LLM 운영 제품 전체가 아니라 Gateway vertical slice를 끝까지 동작시키는 것이다.

P0 핵심 흐름은 다음이다.

```text
Admin onboarding
-> Tenant / Project / Application / Provider Connection
-> API Key / App Token 발급
-> Gateway request
-> API Key / App Token 인증
-> Tenant / Project / Application 식별
-> Provider 호출 전 민감정보 마스킹 또는 차단
-> Exact Cache
-> model=auto Simple Routing
-> Provider Adapter 호출
-> Usage Log
-> Request Log / Detail
-> Dashboard Overview
```

P0는 기능 수가 아니라 end-to-end 흐름이 기준이다.

---

## 4. P0 필수 범위

아래 기능은 P0에서 빠지면 안 된다.

* `/v1/chat/completions`
* `/v1/models`
* API Key 인증
* App Token 검증
* Tenant / Project / Application 식별
* mock provider 또는 provider adapter 호출
* Provider 호출 전 민감정보 마스킹/차단
* Exact Cache
* `model=auto` Simple Routing
* Usage Log
* Request Log 목록
* Request Detail Drawer
* Dashboard Overview
* 최소 Web Console

---

## 5. P0에서 구현하지 않을 것

다음은 P0 필수가 아니다. 사용자가 명시적으로 지시하지 않으면 구현하지 않는다.

* Semantic Cache 실제 embedding/vector store
* AI Service routing score
* SSE Streaming
* 복잡한 Runtime Policy 엔진
* CEL Policy editor/evaluator
* Policy publish / rollback UI
* Custom regex detector UI
* AWS Secrets Manager + KMS 실제 연동
* S3 Object Storage 실제 연동
* Terraform / AWS / Kubernetes 배포
* RAG
* 파일 업로드
* 이미지 입력
* OCR
* 복잡한 AgentOps Trace
* 공식 ChatGPT / Gemini / Claude 웹사이트 트래픽 강제 우회

P0에서는 JSON config 기반 정책, local secret resolver, mock provider를 허용한다.

---

## 6. 확장성 원칙

모든 코드는 P0 구현이라도 확장 가능하게 작성한다.

확장 가능성이 필요한 지점은 다음이다.

* Provider
* Model
* Policy
* Gateway pipeline stage
* Sensitive Data Detector
* Cache backend
* Routing strategy
* Event payload
* Log storage
* Secret resolver

반드시 지킬 것:

* Provider와 Model을 enum으로 고정하지 않는다.
* Provider별 로직은 Provider Adapter 안에 둔다.
* Gateway handler에 provider별 조건문을 흩뿌리지 않는다.
* Gateway pipeline은 stage 단위로 추가/교체 가능하게 둔다.
* Sensitive Data Detector는 registry 구조로 추가 가능하게 둔다.
* Cache는 interface를 두고 Redis 구현에 의존하게 한다.
* Routing은 strategy 또는 service로 분리한다.
* Secret 조회는 SecretResolver interface를 통해 처리한다.
* 정책 판단은 하드코딩하지 않고 config/policy object를 통해 처리한다.
* Event payload는 문서에 정의된 필드만 사용한다.

금지 예시:

```text
if provider == "openai" { ... }
if model == "gpt-4o-mini" { ... }
if tenantId == "demo" { ... }
store rawPrompt in database
create API not defined in docs
create DB table not defined in docs
```

허용 방향:

```text
ProviderRegistry -> ProviderAdapter
Pipeline -> Stage
DetectorRegistry -> Detector
RoutingService -> RoutingStrategy
CacheStore interface -> RedisCacheStore
SecretResolver interface -> LocalSecretResolver
```

확장성을 이유로 P0 범위를 넘는 기능을 임의로 구현하지 않는다.
확장성은 interface와 책임 분리로 확보하고, 과한 인프라를 추가하지 않는다.

---

## 7. 작업 판단 기준

* 문서에 정의된 API, DB, Event, Policy 구조를 우선한다.
* 문서에 없는 API, DB table, Event payload, Gateway stage를 임의로 만들지 않는다.
* P0 작업에서는 데모 시나리오를 끝까지 통과시키는 것이 최우선이다.
* 비용 절감, 사용량 통제, 민감정보 보호, 운영 가시성 중 하나에도 연결되지 않는 기능은 우선순위를 낮춘다.
* Provider 호출 전 인증, App Token 검증, 민감정보 처리, 로그 기록 흐름이 빠지면 안 된다.
* 원문 Prompt/Response는 기본적으로 영속 저장하지 않는다.
* API Key, App Token, Provider Key 원문은 로그, DB, 응답, 테스트 fixture에 저장하지 않는다.
* Gateway 외부에서 LLM Provider를 직접 호출하지 않는다.
* 화면부터 크게 만들지 않는다. Gateway vertical slice가 먼저다.

---

## 8. Provider 호출 기준

LLM Provider 호출은 Gateway Core의 Provider Adapter에서만 수행한다.

금지:

* Web Console에서 Provider 직접 호출
* Chat UI에서 Provider 직접 호출
* Control Plane API에서 사용자 LLM 요청을 Provider로 proxy
* Worker에서 사용자 요청을 Provider로 재실행
* Frontend에서 Provider SDK import
* Gateway 외부 모듈에서 Provider별 request/response 변환

P0에서는 mock provider가 필수다.
실제 Provider는 시간이 남을 때 1개만 선택한다.

---

## 9. 민감정보 처리 기준

Provider 호출 전에 민감정보를 탐지하고 action을 결정한다.

P0 기본 action:

```text
email                         -> redact
phone_number                  -> redact
resident_registration_number  -> block
api_key                       -> block
authorization_header          -> block
jwt                           -> block
private_key                   -> block
```

Redaction placeholder는 원문 일부를 남기지 않는다.

허용:

```text
[EMAIL_REDACTED]
[PHONE_NUMBER_REDACTED]
[RESIDENT_REGISTRATION_NUMBER_REDACTED]
[API_KEY_REDACTED]
[AUTHORIZATION_HEADER_REDACTED]
[JWT_REDACTED]
[SECRET_REDACTED]
```

금지:

```text
u***@company.com
010-****-1234
sk-...abcd
900101-1******
```

---

## 10. 저장 금지 데이터

아래 데이터는 DB, Redis, ClickHouse, S3, 로그, 테스트 snapshot, API response에 저장하거나 출력하지 않는다.

* raw prompt
* raw response
* Provider API Key 원문
* Gateway API Key 원문
* App Token 원문
* Authorization header 원문
* Cookie 원문
* raw provider error body
* raw detected sensitive value
* 실제 secret
* 실제 개인정보

저장 가능한 값:

* redactedPromptPreview
* responseSummary
* promptHash
* responseHash
* token metadata
* cost metadata
* latency metadata
* cache metadata
* routing metadata
* masking metadata
* requestId
* tenantId
* projectId
* applicationId
* apiKeyId
* appTokenId

---

## 11. Gateway Pipeline 기준

Gateway request는 기본적으로 아래 순서를 따른다.

```text
receive_request
-> assign_request_id
-> parse_openai_compatible_payload
-> authenticate_api_key
-> validate_app_token
-> resolve_tenant_project_user_application
-> load_active_config
-> check_rate_limit
-> check_quota_budget
-> validate_text_only_request
-> validate_requested_model_provider
-> apply_runtime_policy_precheck
-> detect_sensitive_data
-> mask_or_block
-> normalize_prompt_for_cache
-> build_cache_key
-> exact_cache_lookup
-> semantic_cache_lookup
-> decide_model_route
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

P0에서는 일부 stage를 no-op 또는 disabled로 둘 수 있다.
하지만 민감정보 탐지와 마스킹은 cache lookup과 provider call보다 먼저 실행되어야 한다.

---

## 12. Cache 기준

Exact Cache는 Redis 기반으로 구현한다.

Cache key는 raw prompt가 아니라 redacted prompt 기준으로 만든다.

Cache key material에는 최소 아래 정보를 포함한다.

* tenantId
* projectId
* applicationId
* selectedProvider
* selectedModel
* normalizedRedactedPrompt
* securityPolicyHash 또는 configHash
* routingPolicyHash 또는 configHash

동일 safe request의 1회차는 cache miss, 2회차는 cache hit가 되어야 한다.

Cache hit 시 Provider/mock 호출 count가 증가하면 안 된다.

Block 요청은 cache lookup을 하지 않는다.

---

## 13. Routing 기준

P0에서는 simple routing만 구현한다.

기본 기준:

```text
model=auto
-> 짧은 prompt는 low-cost model 선택
-> 기본 모델은 mock-balanced
-> low-cost 모델은 mock-fast
```

Request Detail에서는 반드시 아래를 구분해서 기록한다.

* requestedModel
* selectedModel
* requestedProvider
* selectedProvider
* routingReason

Provider와 Model은 DB enum으로 고정하지 않는다.
문자열로 받고, allowlist/config/registry/policy로 검증한다.

---

## 14. DB 기준

P0 DB는 `docs/p0/p0-db-migration-plan.md`를 우선한다.

P0 필수 저장소:

```text
PostgreSQL
Redis
```

P1 권장 저장소:

```text
Redpanda
ClickHouse
```

P0에서는 ClickHouse/Redpanda가 불안정하면 PostgreSQL direct writer를 허용한다.
단, 코드와 주석에 `P0 shortcut`임을 명시한다.

DB 원칙:

* Provider/Model은 enum으로 고정하지 않는다.
* 비용은 float가 아니라 micro USD integer로 저장한다.
* Tenant-scoped table은 tenant_id를 포함한다.
* API Key/App Token/Provider Key 원문은 저장하지 않는다.
* raw prompt/raw response는 저장하지 않는다.
* 삭제는 기본 soft delete 또는 revoke다.

---

## 15. Event / Log 기준

P0에서는 하나의 DTO로 처리할 수 있다.

```text
InvocationFinishedPayload
```

다만 외부 contract와 저장 payload의 eventType은 아래 값을 따른다.

```text
success    -> invocation.completed
cache_hit  -> invocation.completed
blocked    -> invocation.blocked
error      -> invocation.failed
cancelled  -> invocation.cancelled
```

모든 요청은 request log를 남긴다.

* success 요청
* cache hit 요청
* blocked 요청
* error 요청
* cancelled 요청

Blocked request도 반드시 기록한다.
Blocked request의 costMicroUsd는 0이다.

---

## 16. 코드 작성 전 계획 필수

코드를 수정하기 전에는 먼저 아래 계획을 제시한다.

```text
목표:
수정 예정 파일:
새로 생성할 파일:
참조 문서:
API 변경 여부:
DB 변경 여부:
Event 변경 여부:
Policy 변경 여부:
보안 영향:
테스트 계획:
완료 기준:
```

계획 없이 바로 파일을 수정하지 않는다.

---

## 17. 변경 단위

한 번에 하나의 목적만 처리한다.

좋은 작업 단위:

```text
- /v1/chat/completions handler 추가
- API Key 검증 stage 추가
- App Token 검증 stage 추가
- masking detector 추가
- exact cache stage 추가
- p0 invocation log writer 추가
- Request Detail API 추가
```

나쁜 작업 단위:

```text
- 인증, Gateway, DB, Dashboard, Worker를 한 번에 구현
- 전체 폴더 구조 재정리
- API/DB/Event 계약을 문서 없이 변경
- 임의 공통 유틸 폴더 대량 생성
```

---

## 18. 보안 리뷰 대상

다음 변경은 보안 리뷰 대상이다.

* API Key 발급, 검증, 폐기
* App Token 발급, 검증, 폐기
* Provider Key 저장 또는 조회
* SecretResolver
* 민감정보 탐지, 마스킹, 차단
* raw prompt/raw response 저장 정책
* Authorization header 처리
* Request Log / Detail 응답 필드
* Tenant / Project scope 검증

보안 관련 코드에서는 실제 secret처럼 보이는 값을 예시, seed, test, snapshot에 넣지 않는다.

---

## 19. 테스트 기준

기능 변경에는 테스트 또는 수동 검증이 따라야 한다.

최소 검증:

```text
- healthz / readyz
- safe request 성공
- invalid API Key 차단
- invalid App Token 차단
- email redaction
- phone redaction
- credential-like token block
- JWT block
- RRN block
- exact cache miss -> hit
- model=auto simple routing
- Request Log 기록
- Request Detail 필드 확인
- Dashboard Overview 숫자 확인
```

테스트 fixture에 실제 secret이나 개인정보를 넣지 않는다.

허용:

```text
example.invalid
test_secret_token_redacted_for_demo_only
glm_api_test_redacted
glm_app_token_test_redacted
```

---

## 20. 완료 기준

작업이 완료되었다고 말하려면 다음을 함께 제시한다.

* 변경 요약
* 수정한 파일 목록
* 새로 만든 파일 목록
* API / DB / Event 변경 여부
* 보안 영향 여부
* 테스트 결과
* 남은 리스크
* 다음 작업 제안

---

## 21. 절대 금지 사항

아래는 명시적 승인 없이 절대 하지 않는다.

* raw prompt 저장
* raw response 저장
* Provider Key 평문 저장
* API Key/App Token 평문 저장
* Authorization header 로그 출력
* Cookie 로그 출력
* Provider raw error body 전체 저장
* Web Console에서 Provider 직접 호출
* Control Plane에서 사용자 LLM 요청을 Provider로 proxy
* Worker에서 Provider 요청 재실행
* tenant/project scope 없는 request log 조회
* 문서에 없는 API 생성
* 문서에 없는 DB table/column 생성
* 문서에 없는 Event field 추가
* Provider/Model을 DB enum으로 고정
* cache key에 raw prompt 사용
* masking stage를 cache 뒤로 이동
* block 요청의 로그 생략
* 실제 secret을 seed/test/snapshot에 사용

---

## 22. 구현 우선순위

작업 우선순위는 아래 순서다.

```text
1. docker compose + health check
2. Control Plane P0 schema/API
3. Gateway /v1/chat/completions + mock provider
4. API Key / App Token 인증
5. Tenant / Project / Application context
6. 민감정보 masking/block
7. Exact Cache
8. Simple Routing
9. Invocation Log 저장
10. Request Log / Detail API
11. Dashboard Overview API
12. Web Console
13. Demo App 또는 Text-only Chat UI
14. 통합 테스트
```

화면부터 만들지 않는다.
Gateway vertical slice가 먼저다.
