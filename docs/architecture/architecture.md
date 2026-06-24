# GateLM Architecture

> P0 범위 안내: 이 문서는 장기 아키텍처 기준을 포함한다. 현재 구현 목표는 `docs/p0/p0-contract.md`와 `docs/p0/implementation-cut.md`를 우선한다. 이 문서의 `MVP` 또는 `1차 구현` 표현이 P0 문서와 충돌하면 P1/P2 후보 또는 참고 설계로 본다.

## 문서 목적

이 문서는 GateLM 구현자가 시스템 경계, 요청 흐름, 저장소 책임, 모듈 책임을 헷갈리지 않도록 고정하는 기준 문서다.

GateLM은 단순 Chat UI가 아니라 **고객사의 승인된 LLM 사용 경로를 하나의 Gateway로 통합하는 GateLM 플랫폼**이다. 모든 승인된 LLM 요청은 Gateway를 통과해야 하며, Gateway는 인증, 정책, 사용량 통제, 캐시, 라우팅, 마스킹, 로깅을 중앙에서 처리한다.

## 핵심 아키텍처 원칙

- **Gateway 중심 구조**: 고객사 앱, 개발 도구, GateLM Chat UI는 LLM Provider를 직접 호출하지 않는다.
- **Control Plane과 Data Plane 분리**: 관리자 설정과 실제 LLM 요청 처리를 분리한다.
- **응답 경로와 분석 경로 분리**: 사용자 응답에 필요한 처리는 동기 경로에서 수행하고, 로그 저장·집계·알림은 비동기로 처리한다.
- **원문 저장 최소화**: 원문 Prompt/Response는 기본적으로 영속 저장하지 않는다.
- **정책은 Runtime Policy로 관리**: 라우팅, 보안, 예산, Rate Limit 정책을 코드에 하드코딩하지 않는다.
- **계약 우선**: API, Event, DB 구조는 별도 contract 문서에 정의한 뒤 구현한다.
- **MVP 우선**: Kubernetes, Envoy, gRPC, Redis Cluster, RAG, 파일 업로드, OCR, 복잡한 AgentOps Trace는 1차 범위에서 제외한다.

---

## 기준 문서 연결

민감정보 탐지, 마스킹, 차단, 저장 전 처리의 세부 기준은 `pii-masking-policy.md`를 따른다. Gateway stage 위치는 `gateway-flow.md`, masking event 저장 필드는 `llm-log-schema.md`, 저장소 schema는 `db-schema.md`를 함께 따른다.


# 1. 전체 시스템 구조

## 1.1 논리 구조

```text
Customer App / Developer Tool / GateLM Chat UI
        |
        v
AWS ALB + ACM
        |
        v
Go Gateway Core -------------+
        |                     |
        |                     +--> Redis
        |                     |     - Rate Limit counter
        |                     |     - Quota counter
        |                     |     - Active policy cache
        |                     |     - Exact cache
        |                     |     - Short-lived runtime state
        |                     |
        |                     +--> Python AI Service
        |                     |     - Embedding 생성
        |                     |     - 기본 Semantic Cache 보조
        |                     |     - Routing score 보조
        |                     |
        |                     +--> AWS Secrets Manager + KMS
        |                     |     - Provider credential 조회
        |                     |
        |                     +--> LLM Providers
        |                           - OpenAI
        |                           - Anthropic
        |                           - Gemini
        |                           - Local Model
        |
        +--> Redpanda Event Bus
                  |
                  v
              Worker
                  |
                  +--> ClickHouse
                  |     - invocation / attempt analytics
                  |
                  +--> PostgreSQL
                  |     - usage ledger
                  |     - audit log
                  |     - budget ledger
                  |
                  +--> S3-compatible Object Storage
                        - redacted payload
                        - response summary
                        - export artifact

Next.js Web Console
        |
        +--> NestJS Control Plane API
        |       - Tenant / User / Project 관리
        |       - API Key / App Token 관리
        |       - Provider Key 관리
        |       - Policy 관리
        |       - Budget / Quota 관리
        |       - Conversation metadata 관리
        |
        +--> Analytics API
                - Dashboard Overview
                - Request Log
                - Detail Drawer
                - Cost / Token / Latency 조회
```

## 1.2 물리 배포 기준

MVP 배포 기준은 다음과 같다.

```text
Internet
  -> AWS ALB + ACM
  -> EC2 / Docker Compose
       - web-console
       - control-plane-api
       - gateway-core
       - ai-service
       - worker
       - redis
       - redpanda
       - postgres
       - clickhouse
```

1차 구현에서는 Kubernetes, Envoy, gRPC, Redis Cluster를 도입하지 않는다.

---

# 2. 프론트 / 백엔드 / DB / 외부 API 역할

## 2.1 Frontend

### Web Console

역할:

- 기업 Admin 가입 화면
- Tenant 생성 화면
- 사용자 초대 화면
- Project 생성 화면
- Provider Key 등록 화면
- API Key / App Token 발급 화면
- Policy Control UI
- Dashboard Overview
- Request Log / Detail Drawer

하지 않을 일:

- LLM Provider 직접 호출 금지
- DB 직접 접근 금지
- Provider Key 브라우저 저장 금지
- 비용 계산 로직 보유 금지
- 정책 판정 로직 보유 금지

### GateLM Chat UI

역할:

- 고객사가 별도 LLM UI를 갖고 있지 않을 때 제공하는 텍스트 기반 채팅 UI
- 사용자의 메시지 입력
- `parent_message_id` 기반 Reply-to Context 전달
- Streaming 응답 표시

하지 않을 일:

- 파일 업로드 금지
- 이미지 입력 금지
- OCR 금지
- RAG 기반 문서 검색 금지
- LLM Provider 직접 호출 금지
- Provider Key 노출 금지

Chat UI 요청은 최종적으로 Gateway를 통과해야 한다. 브라우저가 Gateway를 직접 호출하든, Next.js route handler를 통해 프록시하든, Provider 호출은 반드시 Gateway Core만 수행한다.

## 2.2 Backend

### Control Plane API

기술 기준: **NestJS / TypeScript**

역할:

- Tenant 관리
- 사용자 가입, 초대, 멤버십 관리
- Role 관리
- Project 관리
- API Key 발급, 폐기, 회전, scope 관리
- App Token 발급, 만료, 폐기, scope 관리
- Provider Key 등록 및 secret reference 관리
- Runtime Policy 생성, 검증, publish, rollback
- Budget / Quota 설정 관리
- Audit Log 기록
- Chat UI용 conversation metadata 관리
- Gateway가 사용할 active config를 Redis에 배포

하지 않을 일:

- 사용자 LLM 요청을 직접 Provider로 전달하지 않는다.
- Streaming proxy를 담당하지 않는다.
- Gateway의 요청 경로에서 수행할 인증, 마스킹, 캐시, 라우팅을 대신하지 않는다.
- ClickHouse를 직접 프론트에 노출하지 않는다.

### Gateway Core

기술 기준: **Go**

역할:

- OpenAI-compatible Gateway API 제공
- API Key 인증
- App Token 검증
- Tenant / Project / User / App 식별
- Runtime Policy 적용
- Rate Limit / Quota 검사
- 민감정보 탐지 / 마스킹
- Exact Cache 조회 및 저장
- Semantic Cache 조회 요청
- Model Routing 결정 또는 Routing 보조 서비스 호출
- Provider별 요청 포맷 변환
- LLM Provider 호출
- SSE Streaming 중계
- Timeout / Retry / Fallback 처리
- 요청 메타데이터 수집
- 비동기 로그 이벤트 발행

하지 않을 일:

- Tenant 생성, 사용자 초대, 정책 편집 UI 처리 금지
- Dashboard 집계 쿼리 처리 금지
- 장기 분석 데이터를 직접 ClickHouse에 쓰는 로직 금지
- 원문 Prompt/Response 영속 저장 금지
- Provider Key를 로그에 남기기 금지

### AI Service

기술 기준: **Python / FastAPI**

역할:

- Embedding 생성
- 기본 Semantic Cache 후보 조회 보조
- 요청 난이도 또는 비용 기반 routing score 계산 보조
- 향후 운영 리포트 요약 기능의 내부 AI 작업 후보

하지 않을 일:

- 외부 고객에게 직접 노출되는 Gateway API 제공 금지
- Tenant / Project / User 관리 금지
- Provider Key 관리 금지
- Dashboard API 제공 금지

MVP에서 단순 routing은 Gateway 내부에서 처리할 수 있다. 다만 embedding이 필요한 Semantic Cache나 고도화된 routing score는 AI Service 책임으로 둔다.

### Worker

역할:

- Redpanda Event Bus에서 Gateway 이벤트 소비
- Invocation 로그 정규화
- Provider attempt 로그 정규화
- Token / Cost / Latency 보정
- Usage ledger 반영
- Budget ledger 반영
- ClickHouse analytics 저장
- PostgreSQL audit / ledger 저장
- S3-compatible Object Storage에 redacted payload 또는 summary 저장
- 알림 조건 평가

하지 않을 일:

- 사용자 응답 경로를 막지 않는다.
- Provider 호출을 직접 수행하지 않는다.
- Web Console 요청을 직접 처리하지 않는다.

### Analytics API

역할:

- Dashboard Overview 조회
- Request Log 조회
- Detail Drawer 조회
- 비용, 토큰, 지연시간, 오류율, 캐시 적중률 조회
- Project / User / Model / Provider 기준 필터링

MVP에서는 별도 서비스로 분리하지 않고 Control Plane API 내부 모듈로 구현할 수 있다. 코드 생성 시 별도 `analytics-service`를 임의로 만들지 않는다.

## 2.3 Database / Storage

### PostgreSQL

역할:

- Tenant
- User
- Membership
- Project
- API Key metadata
- App Token metadata
- Provider Key metadata 및 secret reference
- Policy version
- Policy publish state
- Budget / Quota 설정
- Usage ledger
- Budget ledger
- Audit log
- Conversation metadata
- Redacted chat message metadata

저장 금지:

- 기본 정책상 원문 Prompt/Response 저장 금지
- Provider raw secret 저장 금지

### Redis

역할:

- Rate Limit counter
- Quota counter
- Active policy cache
- API Key / App Token validation cache
- Exact Cache
- Short-lived request state
- Idempotency / replay 방지용 short-lived key

주의:

- Redis는 장기 분석 저장소가 아니다.
- Redis에 원문 Prompt를 저장하지 않는다.
- Exact Cache key는 prompt hash, tenant/project, model/routing policy, parent message hash 등을 포함해 충돌과 권한 혼선을 방지한다.

### ClickHouse

역할:

- 대량 invocation 로그 분석
- provider attempt 분석
- token / cost / latency 분석
- cache hit rate 분석
- error rate 분석
- model / provider / project / user 기준 집계

주의:

- ClickHouse는 제품 분석과 대시보드 조회용이다.
- 권한 원장, 정책 원본, Provider Key metadata의 source of truth가 아니다.

### Redpanda

역할:

- Gateway 응답 경로와 분석 경로 분리
- Invocation event 전달
- Metering event 전달
- Masking / Routing / Cache / Error 관련 이벤트 전달

주의:

- Event 이름과 payload schema는 `contracts/events.schema.json`에서 확정한다.
- Gateway 내부에서 임의 event payload를 만들지 않는다.

### S3-compatible Object Storage

역할:

- Redacted payload 저장
- Response summary 저장
- 장기 보관이 필요한 export artifact 저장
- 고객사가 명시적으로 허용한 경우에만 암호화된 원문 payload 저장 가능

주의:

- 원문 저장은 기본값이 아니다.
- 원문 저장이 필요한 경우 별도 tenant policy, encryption, retention 설정이 필요하다.

### AWS Secrets Manager + KMS

역할:

- Provider credential 저장
- Secret 암호화
- Secret rotation 지원
- Gateway가 Provider 호출 시 필요한 credential 조회

주의:

- PostgreSQL에는 secret value가 아니라 secret reference만 저장한다.
- Provider Key는 로그, 이벤트, ClickHouse, Redis에 저장하지 않는다.

## 2.4 External API

### LLM Provider API

대상:

- OpenAI
- Anthropic
- Gemini
- Local Model endpoint

역할:

- 실제 completion / chat completion / streaming 응답 생성

호출 주체:

- **Gateway Core만 호출한다.**

금지:

- Web Console에서 직접 호출 금지
- Chat UI에서 직접 호출 금지
- Control Plane에서 사용자 LLM 요청을 대신 호출 금지
- Worker에서 사용자 요청을 재실행하기 위한 Provider 호출 금지

---

# 3. 요청 흐름

## 3.1 SaaS 온보딩 흐름

```text
1. 기업 Admin이 Web Console 접속
2. 회원가입 또는 로그인
3. Tenant 생성
4. 사용자 초대
5. Project 생성
6. Provider Key 등록
7. Control Plane이 Provider Key를 Secrets Manager에 저장
8. PostgreSQL에는 secret reference만 저장
9. API Key / App Token 발급
10. Budget / Quota / Rate Limit / Security / Routing Policy 설정
11. Control Plane이 active policy와 token metadata를 Redis에 publish
12. 개발자가 고객사 앱의 LLM endpoint를 GateLM Gateway URL로 변경
```

이 흐름은 Control Plane API가 담당한다. Gateway는 Tenant 생성이나 정책 편집을 처리하지 않는다.

## 3.2 고객사 앱 Gateway 요청 흐름

```text
1. Customer App이 OpenAI-compatible request를 GateLM Gateway로 전송
2. AWS ALB가 TLS 종료 및 Gateway로 전달
3. Gateway가 request_id 생성
4. Gateway가 API Key를 검증
5. Gateway가 App Token을 검증
6. Gateway가 Tenant / Project / User / App을 식별
7. Gateway가 active policy를 Redis에서 조회
8. Gateway가 Rate Limit / Quota를 Redis counter로 선차감 또는 검사
9. Gateway가 요청 payload를 파싱
10. Gateway가 민감정보를 탐지
11. 정책에 따라 요청 차단 또는 redacted prompt 생성
12. Gateway가 Reply-to Context 필요 여부를 확인
13. Gateway가 Model Routing으로 selectedProvider/selectedModel을 확정
14. Gateway가 selectedProvider/selectedModel을 포함해 Exact Cache key를 생성
15. Exact Cache hit이면 Provider 호출 없이 응답 반환
16. Exact Cache miss이면 Semantic Cache 후보를 조회
17. Cache miss이면 Provider 호출 수행
18. Gateway가 Provider credential을 secret reference로 조회
19. Gateway가 Provider별 request format으로 변환
20. Gateway가 Provider 호출
21. Provider 응답을 OpenAI-compatible response로 변환
22. Gateway가 token / cost / latency / cache / routing / masking metadata를 계산
23. 캐시 저장 조건을 만족하면 Redis에 cache entry 저장
24. Gateway가 사용자에게 응답 반환
25. Gateway가 Redpanda로 비동기 로그 이벤트 발행
```

## 3.3 Streaming 요청 흐름

```text
1. Client가 stream=true로 Gateway 요청
2. Gateway가 인증, 정책, 마스킹, 캐시, 라우팅을 먼저 수행
3. Cache hit이면 저장된 응답을 streaming 형태로 재생할 수 있다
4. Cache miss이면 Provider streaming API 호출
5. Gateway가 Provider SSE chunk를 OpenAI-compatible SSE chunk로 변환
6. Gateway가 Client로 chunk를 즉시 전달
7. stream 종료 시 token / latency / error 상태를 정리
8. Gateway가 최종 invocation event를 Redpanda에 발행
9. Worker가 최종 로그를 저장한다
```

Streaming 중간에 Provider 오류가 발생하면 Gateway는 가능한 경우 fallback route를 시도한다. 이미 일부 chunk가 사용자에게 전송된 뒤에는 응답 형태가 깨질 수 있으므로, fallback 가능 여부는 streaming policy에서 결정한다.

## 3.4 Chat UI Reply-to Context 흐름

```text
1. Employee가 GateLM Chat UI에서 특정 AI 응답에 답장
2. Chat UI가 current message와 parent_message_id를 함께 전송
3. Gateway가 parent_message_id를 기준으로 필요한 부모 질문/응답 context를 조회
4. Gateway가 직계 부모 질문/응답만 context에 포함
5. 부모 응답이 길면 요약 또는 잘라낸 내용을 사용
6. Gateway가 current message + parent context로 Provider request 구성
7. context token 사용량을 별도로 기록
8. cache key에는 current message hash와 parent message hash를 함께 반영
```

기본 정책은 전체 대화 기록을 매번 보내지 않는다. Reply-to Context는 P1 후보이며, P0에서는 no-op으로 둔다.

## 3.5 차단 요청 흐름

아래 조건에서는 Gateway가 Provider 호출 전에 요청을 차단한다.

- API Key 없음
- API Key 만료 또는 폐기
- App Token 만료 또는 폐기
- Tenant / Project 비활성화
- 허용되지 않은 model/provider 요청
- Rate Limit 초과
- Quota 초과
- Budget 초과
- Security Policy에 따른 민감정보 차단
- Runtime Policy 평가 실패 또는 block

차단된 요청도 로그 이벤트를 발행한다. 단, Provider 비용은 발생하지 않아야 한다.

---

# 4. 모듈별 책임

## 4.1 코드 모듈 기준

아래 이름은 권장 구조다. 실제 디렉터리명은 팀 합의에 맞출 수 있지만, 책임 경계는 유지한다.

```text
apps/
  web-console/
    - Next.js Web Console
    - Dashboard UI
    - Policy Control UI
    - Text-only Chat UI

services/
  control-plane-api/
    - Tenant/User/Project 관리
    - Key/Token 관리
    - Provider Key metadata 관리
    - Policy 관리
    - Budget/Quota 설정 관리
    - Analytics API module
    - Conversation metadata API

  gateway-core/
    - OpenAI-compatible Gateway API
    - Auth / Policy / Rate Limit / Quota enforcement
    - Masking
    - Cache
    - Routing
    - Provider adapter
    - Streaming proxy
    - Event publishing

  ai-service/
    - Embedding
    - Semantic Cache helper
    - Routing score helper

  worker/
    - Event consumer
    - Usage log processor
    - Cost/Token/Latency normalization
    - ClickHouse writer
    - PostgreSQL ledger/audit writer
    - S3 payload writer

contracts/
  - api.openapi.yaml
  - events.schema.json
  - db_schema.md
  - policy.schema.json

infra/
  - docker-compose
  - terraform
  - github-actions
```

## 4.2 Web Console 책임

Web Console은 사용자가 시스템을 조작하는 화면이다.

담당:

- Admin onboarding
- Tenant / Project / User 관리 화면
- Provider Key 등록 화면
- API Key / App Token 관리 화면
- Policy Control UI
- Dashboard Overview
- Request Log / Detail Drawer
- Text-only Chat UI

금지:

- Provider 호출 코드 생성
- DB client 코드 생성
- 비용 계산 기준 하드코딩
- 정책 평가 로직 하드코딩
- Provider Key localStorage 저장

## 4.3 Control Plane API 책임

Control Plane API는 설정과 관리의 source of truth다.

담당:

- 인증/인가
- Tenant lifecycle
- Project lifecycle
- Membership / Role
- API Key / App Token lifecycle
- Provider Key metadata / secret reference
- Policy authoring / validation / publish / rollback
- Budget / Quota 설정
- Audit Log
- active config Redis publish
- Analytics 조회 API

금지:

- Provider streaming proxy 구현
- 사용자 LLM completion 요청 처리
- Gateway 내부 요청 흐름 우회
- 원문 Prompt/Response 기본 저장

## 4.4 Gateway Core 책임

Gateway Core는 GateLM의 Data Plane이다.

담당:

- LLM 요청 동기 처리
- 인증/인가 enforcement
- 정책 enforcement
- 비용 발생 전 차단
- 민감정보 마스킹
- Cache hit 처리
- Provider 호출
- Streaming 중계
- Fallback 처리
- 비동기 event 발행

금지:

- 관리자 CRUD API 구현
- Dashboard aggregation 구현
- ClickHouse 직접 분석 쿼리 제공
- 장기 로그 저장 책임 보유
- Provider Key 평문 저장

## 4.5 Worker 책임

Worker는 분석 경로의 처리자다.

담당:

- Redpanda event consume
- 로그 정규화
- token/cost/latency 계산 보정
- ClickHouse 저장
- PostgreSQL ledger/audit 저장
- S3 저장
- alert 조건 평가

금지:

- 사용자 요청 응답 경로 개입
- Provider 호출 재실행
- Gateway 인증 로직 중복 구현

## 4.6 AI Service 책임

AI Service는 Gateway를 보조하는 내부 서비스다.

담당:

- Embedding
- Semantic similarity 계산 보조
- Routing score 계산 보조

금지:

- 외부 Gateway API 노출
- Provider Key 관리
- Tenant / User / Project 관리
- 대시보드 API 제공

---

# 5. Gateway 흐름 상세

## 5.1 Gateway pipeline

```text
receive_request
  -> assign_request_id
  -> parse_openai_compatible_payload
  -> authenticate_api_key
  -> validate_app_token
  -> resolve_tenant_project_user_app
  -> load_active_policy
  -> check_rate_limit
  -> check_quota_budget
  -> validate_requested_model_provider
  -> apply_runtime_policy_precheck
  -> load_reply_to_context_if_needed
  -> detect_sensitive_data
  -> mask_or_block
  -> decide_model_route
  -> build_cache_key
  -> exact_cache_lookup
  -> semantic_cache_lookup
  -> resolve_provider_credential
  -> convert_provider_request
  -> call_provider_with_timeout_retry_fallback
  -> convert_provider_response
  -> compute_usage_metadata
  -> write_cache_if_eligible
  -> return_response
  -> publish_async_event
```

## 5.2 Gateway 단계별 책임

| 단계 | 책임 | 실패 시 동작 |
|---|---|---|
| Request parse | OpenAI-compatible payload 검증 | 400 반환, Provider 호출 없음 |
| API Key auth | Gateway 접근 주체 인증 | 401 반환, Provider 호출 없음 |
| App Token validation | 앱 단위 접근 권한 확인 | 401/403 반환, Provider 호출 없음 |
| Tenant/Project resolve | 요청 소유 조직 식별 | 403/404 반환, Provider 호출 없음 |
| Policy load | active runtime policy 조회 | 정책 조회 실패 시 fail-closed 기본 |
| Rate Limit | RPM/TPM/동시 요청 수 검사 | 429 반환, Provider 호출 없음 |
| Quota/Budget | 비용 발생 전 예산 검사 | 402/429/403 계열 반환, Provider 호출 없음 |
| Sensitive Data | 개인정보/API Key 등 탐지 | mask 또는 block |
| Cache | 반복 요청 비용 절감 | hit이면 Provider 호출 없음 |
| Routing | 비용/난이도 기반 모델 선택 | 허용 route 없으면 block |
| Provider call | 실제 LLM 호출 | timeout/retry/fallback |
| Usage metadata | token/cost/latency 계산 | 계산 실패 시 event에 error flag 포함 |
| Event publish | 비동기 분석 경로 연결 | 응답은 반환하되 structured log 남김 |

## 5.3 Cache 기준

### Exact Cache

Exact Cache는 Redis를 사용한다.

Cache key 구성 요소:

```text
tenant_id
project_id
normalized_prompt_hash
model_or_route_policy_hash
system_prompt_hash
parent_message_hash
security_policy_hash
```

저장 값:

```text
redacted_response
provider
model
prompt_tokens
completion_tokens
cost_saved_estimate
created_at
expires_at
```

원문 Prompt는 cache value에 저장하지 않는다.

### Semantic Cache

Semantic Cache는 AI Service의 embedding 기능을 사용한다.

P0에서는 Semantic Cache를 구현하지 않는다. 장기적으로 Vector DB 같은 신규 인프라를 붙일 때는 저장 방식과 schema를 먼저 확정한 뒤 구현한다.

## 5.4 Routing 기준

Routing은 다음 입력을 사용한다.

- tenant policy
- project policy
- requested model
- allowed provider/model list
- prompt length
- estimated token count
- request class
- budget state
- provider health
- fallback policy

Routing 결과는 반드시 로그에 남긴다.

```text
requested_model
selected_provider
selected_model
routing_rule_id
routing_reason
fallback_used
```

단순 요청은 저비용 모델로 보낼 수 있다. 단, policy에서 허용하지 않은 Provider/Model로 라우팅하면 안 된다.

## 5.5 Masking 기준

Gateway는 Provider 호출 전에 민감정보를 탐지한다.

기본 탐지 대상:

- 이메일
- 전화번호
- 주민등록번호
- API Key 패턴
- 계정 정보 패턴
- 사내 기밀 키워드 패턴

정책 동작:

```text
allow      -> 그대로 진행
mask       -> redacted prompt로 Provider 호출
block      -> Provider 호출 전 차단
```

로그에는 masking result와 redacted prompt만 저장한다. 원문 저장은 기본적으로 금지한다.

## 5.6 Provider Adapter 기준

Provider Adapter는 Provider별 request/response 차이를 Gateway 내부에서 흡수한다.

담당:

- OpenAI-compatible request를 Provider request로 변환
- Provider response를 OpenAI-compatible response로 변환
- Provider error를 GateLM error model로 변환
- Streaming chunk 변환
- Token usage 추출

Provider Adapter 외부 모듈에서 Provider별 포맷 분기 코드를 만들지 않는다.

---

# 6. 로그 저장 흐름

## 6.1 기본 원칙

로그 저장은 사용자 응답 경로와 분리한다.

```text
Gateway response path:
Client -> Gateway -> Provider or Cache -> Client

Analytics path:
Gateway -> Redpanda -> Worker -> ClickHouse / PostgreSQL / S3
```

Gateway는 요청 처리에 필요한 최소 메타데이터를 수집한 뒤 event를 발행한다. Worker가 이를 소비해 장기 저장소에 기록한다.

## 6.2 로그 이벤트 발행 시점

Gateway는 다음 시점에 로그 이벤트를 발행한다.

```text
1. 요청이 정상 완료된 경우
2. Provider 호출 전 차단된 경우
3. Provider 호출 실패 또는 timeout 발생한 경우
4. Retry 또는 fallback이 발생한 경우
5. Cache hit으로 Provider 호출을 생략한 경우
6. Masking 또는 block이 발생한 경우
7. Rate Limit / Quota / Budget 초과가 발생한 경우
```

정식 event name과 payload schema는 `contracts/events.schema.json`에서만 확정한다.

## 6.3 로그 데이터 항목

Gateway가 event에 포함해야 하는 기본 항목은 다음과 같다.

```text
request_id
trace_id
tenant_id
project_id
user_id
app_token_id
api_key_id
provider
model
requested_model
selected_model
routing_rule_id
routing_reason
cache_status
masking_result
rate_limit_result
quota_result
prompt_tokens
completion_tokens
estimated_cost
actual_cost
latency_ms
ttft_ms
status
error_code
error_message_class
redacted_prompt
response_summary
created_at
```

주의:

- API Key 원문은 저장하지 않는다.
- App Token 원문은 저장하지 않는다.
- Provider Key 원문은 저장하지 않는다.
- 원문 Prompt/Response는 기본 저장하지 않는다.
- error_message에 원문 prompt가 섞이지 않도록 정규화한다.

## 6.4 Worker 저장 흐름

```text
1. Worker가 Redpanda에서 event consume
2. event schema validation
3. 중복 event idempotency 확인
4. token/cost/latency 값 보정
5. ClickHouse에 analytics row 저장
6. PostgreSQL에 usage ledger / budget ledger / audit log 저장
7. redacted payload 또는 response summary가 크면 S3에 저장
8. alert 조건 평가
9. 처리 실패 시 retry 또는 dead-letter 처리
```

## 6.5 저장소별 로그 책임

| 저장소 | 저장 대상 | 목적 |
|---|---|---|
| ClickHouse | invocation, provider attempt, latency, token, cost, cache, routing, masking metadata | 대시보드와 분석 |
| PostgreSQL | usage ledger, budget ledger, audit log, policy change audit | 정합성이 중요한 원장과 감사 |
| S3-compatible Storage | redacted payload, response summary, export artifact | 큰 payload와 장기 보관 |
| Redis | rate limit counter, quota counter, exact cache | 빠른 동기 처리 |
| Redpanda | event stream | 응답 경로와 분석 경로 분리 |

## 6.6 실패 처리

### Event Bus 발행 실패

Gateway가 Redpanda에 event 발행을 실패해도 사용자 응답을 무조건 실패시키지는 않는다. 단, 다음은 반드시 수행한다.

- structured application log에 request_id와 실패 원인 기록
- metric 증가
- 가능하면 짧은 retry 수행
- billing-critical event 누락 가능성을 운영 알림으로 전달

### Worker 저장 실패

Worker 저장 실패는 retry 대상이다.

- 일시적 DB 오류: retry
- schema validation 실패: dead-letter
- 중복 event: idempotent ignore
- ClickHouse 실패: analytics 저장 retry
- PostgreSQL ledger 실패: ledger 저장 retry 및 alert

---

# 7. 데이터 접근 규칙

## 7.1 Frontend 접근 규칙

Frontend는 아래 API만 호출한다.

```text
Web Console -> Control Plane API
Web Console -> Analytics API
Chat UI -> Gateway API 또는 Next.js proxy -> Gateway API
```

Frontend는 다음에 직접 접근하지 않는다.

```text
PostgreSQL
Redis
ClickHouse
Redpanda
S3
Secrets Manager
LLM Provider API
```

## 7.2 Gateway 접근 규칙

Gateway가 접근할 수 있는 저장소와 서비스:

```text
Redis
AI Service
Secrets Manager / credential resolver
Redpanda
LLM Provider API
Conversation context API 또는 context store
```

Gateway가 직접 처리하지 않을 것:

```text
Tenant 생성
User 초대
Policy 편집
Dashboard 집계 API
장기 로그 분석 쿼리
```

## 7.3 Control Plane 접근 규칙

Control Plane이 접근할 수 있는 저장소와 서비스:

```text
PostgreSQL
Redis
Secrets Manager + KMS
ClickHouse read path, if Analytics API를 내부 모듈로 구현하는 경우
```

Control Plane이 하지 않을 것:

```text
사용자 LLM 요청 Provider proxy
SSE streaming 중계
Gateway cache hit 처리
Gateway masking enforcement 대체
```

## 7.4 Worker 접근 규칙

Worker가 접근할 수 있는 저장소와 서비스:

```text
Redpanda
ClickHouse
PostgreSQL
S3-compatible Object Storage
```

Worker가 하지 않을 것:

```text
Client 응답 반환
Provider completion 호출
API Key 인증 판단
Runtime Policy enforcement
```

---

# 8. 외부 연동 흐름

## 8.1 고객사 앱 연동

고객사 앱은 기존 OpenAI API 호출 구조를 최대한 유지하되, base URL과 인증 정보를 GateLM으로 변경한다.

```text
Before:
Customer App -> OpenAI API

After:
Customer App -> GateLM Gateway OpenAI-compatible API -> Provider Routing -> OpenAI / Anthropic / Gemini / Local Model
```

공식 ChatGPT, Gemini, Claude 웹사이트처럼 endpoint를 바꿀 수 없는 외부 웹 UI를 투명하게 강제 우회하는 기능은 MVP 범위가 아니다.

## 8.2 개발 도구 / CLI 연동

OpenAI-compatible base URL 설정을 지원하는 IDE, CLI, 내부 API Client는 Gateway로 연결할 수 있다.

```text
Developer Tool / CLI / Internal API Client
  -> GateLM Gateway
  -> Provider Routing
  -> LLM Provider
```

## 8.3 Chat UI 연동

고객사가 자체 LLM UI를 갖고 있지 않으면 GateLM Chat UI를 사용한다.

```text
Employee
  -> GateLM Chat UI
  -> GateLM Gateway
  -> Cache or LLM Provider
```

Chat UI는 옵션이다. GateLM의 핵심 제품은 Gateway다.

---

# 9. 보안 경계

## 9.1 Provider Key 관리

```text
Web Console 입력
  -> Control Plane API
  -> AWS Secrets Manager + KMS 저장
  -> PostgreSQL에는 secret reference만 저장
  -> Gateway는 Provider 호출 시 secret reference로 credential 조회
```

금지:

- Provider Key를 PostgreSQL에 평문 저장 금지
- Provider Key를 Redis에 저장 금지
- Provider Key를 event payload에 포함 금지
- Provider Key를 로그에 출력 금지
- Provider Key를 브라우저에 전달 금지

## 9.2 Prompt / Response 저장 정책

기본 저장:

```text
redacted_prompt
response_summary
metadata
```

기본 미저장:

```text
raw_prompt
raw_response
```

원문 저장이 필요한 경우:

```text
tenant policy에서 명시 허용
+ 별도 암호화
+ retention 설정
+ audit log 기록
```

## 9.3 Policy 적용 위치

| Policy 종류 | 설정 위치 | 적용 위치 |
|---|---|---|
| Routing Policy | Control Plane | Gateway |
| Security Policy | Control Plane | Gateway |
| Rate Limit Policy | Control Plane | Gateway + Redis |
| Budget / Quota Policy | Control Plane | Gateway + Redis, Worker + PostgreSQL |
| Guardrail Policy | Control Plane | Gateway |
| Retention Policy | Control Plane | Worker + S3/PostgreSQL |

정책 설정은 Control Plane에서 하지만, 사용자 LLM 요청에 대한 최종 enforcement는 Gateway에서 수행한다.

---

# 10. 구현 금지 사항

아래 코드는 명시적 지시 없이 생성하지 않는다.

- Web Console에서 LLM Provider 직접 호출 코드
- Control Plane에서 사용자 completion을 Provider로 proxy하는 코드
- Worker에서 Provider completion을 재실행하는 코드
- Gateway 외부 모듈에서 Provider별 request/response 변환 코드
- ClickHouse를 Frontend에서 직접 조회하는 코드
- Redis를 Frontend에서 직접 조회하는 코드
- Provider Key를 DB에 평문 저장하는 코드
- 원문 Prompt/Response를 기본 저장하는 코드
- 파일 업로드, 이미지 입력, OCR, RAG 관련 코드
- Kubernetes manifest
- Envoy 설정
- gRPC service
- Redis Cluster 설정
- OPA server 연동 코드
- 복잡한 AgentOps Trace 구현

---

# 11. MVP 기준 아키텍처 체크리스트

구현물이 아래 조건을 만족해야 MVP 아키텍처에 부합한다.

```text
[ ] 고객사 앱이 GateLM Gateway를 통해 LLM 요청을 보낼 수 있다.
[ ] Gateway API가 OpenAI-compatible request를 받을 수 있다.
[ ] Gateway가 API Key를 검증한다.
[ ] Gateway가 App Token을 검증한다.
[ ] Gateway가 Tenant / Project / User를 식별한다.
[ ] Gateway가 Rate Limit / Quota를 Provider 호출 전에 검사한다.
[ ] Gateway가 Runtime Policy를 적용한다.
[ ] Gateway가 민감정보를 Provider 호출 전에 mask 또는 block한다.
[ ] Gateway가 Exact Cache hit 시 Provider 호출을 생략한다.
[ ] Gateway가 기본 Semantic Cache 흐름을 갖는다.
[ ] Gateway가 기본 Model Routing을 수행한다.
[ ] Gateway가 Provider 호출 Proxy를 수행한다.
[ ] Gateway가 SSE Streaming을 중계한다.
[ ] Gateway가 token / cost / latency를 기록한다.
[ ] Gateway가 Redpanda로 비동기 이벤트를 발행한다.
[ ] Worker가 이벤트를 소비해 ClickHouse / PostgreSQL / S3에 저장한다.
[ ] Dashboard가 Overview와 Request Log를 보여준다.
[ ] Detail Drawer에서 cost, token, latency, cache, routing, masking 결과를 확인할 수 있다.
[ ] Control Plane에서 Tenant / Project / User / Key / Token / Policy를 관리할 수 있다.
[ ] Chat UI는 텍스트 기반만 지원한다.
[ ] Reply-to Context는 parent_message_id 기반으로 동작한다.
[ ] 원문 Prompt/Response는 기본 저장하지 않는다.
```

---

# 12. 최종 기준

GateLM의 전체 구조는 다음 문장으로 요약된다.

```text
Control Plane은 설정을 관리하고,
Gateway는 모든 승인된 LLM 요청을 집행하며,
Worker는 로그와 분석을 비동기로 저장하고,
Dashboard는 저장된 운영 데이터를 보여준다.
```

어떤 기능을 구현하든 이 경계를 깨면 안 된다.


---

# 부록. 민감정보 정책 연계

민감정보 탐지/마스킹의 세부 정책은 `pii-masking-policy.md`를 따른다.

- Gateway는 Provider 호출 전에 민감정보를 탐지하고 정책에 따라 mask 또는 block한다.
- 영속 저장소에는 raw prompt/raw response를 기본 저장하지 않는다.
- 로그 저장 흐름은 `gateway-flow.md`, `llm-log-schema.md`, `db-schema.md`를 함께 따른다.

---

# 13. PII Masking Policy 연계

민감정보 탐지/마스킹 기준은 `pii-masking-policy.md`를 따른다. 아키텍처상 masking은 Gateway 응답 경로 안에서 Provider 호출 전에 실행되고, masking event 저장은 분석 경로에서 비동기로 처리한다.

```text
Gateway Request Context
-> PII / Secret Detection
-> Security Policy Evaluation
-> Redaction or Block
-> Cache / Routing / Provider
-> Redpanda masking event
-> Worker
-> ClickHouse llm_masking_events
```

raw prompt/raw response/raw sensitive sample은 기본적으로 영속 저장하지 않는다.
