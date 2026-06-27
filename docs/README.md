# GateLM Documentation Guide

이 문서는 Codex, Claude Code 같은 구현 에이전트와 팀원이 GateLM 작업을 시작할 때 가장 먼저 읽는 기준 문서다.

GateLM은 기업의 LLM 요청을 승인된 Gateway 경로로 모아 보안, 비용, 정책, 로그, 관측을 중앙에서 관리하게 해주는 B2B LLM Gateway다.

---

## 1. Current Source Of Truth

현재 구현 기준은 **v1.0.0 baseline**이다.

| 구분 | 기준 |
|---|---|
| 현재 구현 계획 | `docs/v1.0.0/implementation-plan.md` |
| 현재 구현 계약 | `docs/v1.0.0/contracts.md` |
| 과거 P0 기록 | `docs/archive/p0/*` |
| 장기 설계 참고 | `docs/architecture/*`, `docs/reference/*` |
| 보안/코딩 정책 | `docs/policies/*` |

문서끼리 충돌하면 아래 순서로 판단한다.

1. `docs/v1.0.0/contracts.md`
2. `docs/v1.0.0/implementation-plan.md`
3. 작업 범위에 맞는 `docs/architecture/*`
4. 작업 범위에 맞는 `docs/policies/*`
5. `docs/archive/p0/*`
6. `docs/reference/*`

`docs/archive/p0/*`는 이전 3~5일 P0 구현 기록이다. 구현 근거를 찾을 때 참고할 수 있지만, 새 v1.0.0 작업의 우선 계약으로 사용하지 않는다.

---

## 2. Required Reading Order

작업을 시작하기 전에 아래 순서로 확인한다.

1. `docs/README.md`
2. `docs/v1.0.0/implementation-plan.md`
3. `docs/v1.0.0/contracts.md`
4. 작업 종류별 세부 문서

작업 종류별 세부 문서:

| 작업 | 함께 볼 문서 |
|---|---|
| API | `docs/architecture/api-spec.md` |
| Gateway flow | `docs/architecture/gateway-flow.md` |
| DB / migration | `docs/architecture/db-schema.md` |
| Request log / event | `docs/architecture/llm-log-schema.md` |
| Dashboard metrics | `docs/architecture/dashboard-metrics.md` |
| PII / safety | `docs/policies/pii-masking-policy.md` |
| 코드 스타일 | `docs/policies/coding-convention.md` |
| AI 작업 규칙 | `docs/policies/ai-coding-rules.md` |

장기 설계 문서에 P0, MVP, P1/P2 표현이 남아 있더라도 v1.0.0 계약과 충돌하면 v1.0.0 계약을 우선한다.

---

## 3. v1.0.0 Baseline Goal

v1.0.0 목표는 “요청이 한 번 돈다”가 아니라, 제품처럼 설명 가능한 B2B LLM Gateway baseline을 만드는 것이다.

핵심 흐름:

```text
Admin이 Project / Application / Provider / API Key / App Token을 준비한다
-> Customer Demo App이 GateLM Gateway로 요청한다
-> Gateway가 API Key와 App Token을 검증한다
-> Gateway가 tenantId / projectId / applicationId context를 확정한다
-> applicationId 기준 PostgreSQL-backed Rate Limit을 적용한다
-> rule-based safety가 redaction 또는 block을 수행한다
-> model=auto 요청은 selectedProvider와 routingReason을 남긴다
-> 동일 safe request는 Exact Cache로 Provider 호출을 건너뛴다
-> Mock Provider 또는 fallback-ready 실제 Provider adapter가 응답한다
-> requestId로 Request Log / Detail / Dashboard / Metrics까지 추적한다
-> k6 baseline으로 현재 병목과 v2 개선 방향을 설명한다
```

---

## 4. v1.0.0 Required Scope

v1.0.0 main path에 포함되는 범위:

- Customer Demo App은 고객사 앱 역할로 Gateway만 호출한다.
- Control Plane은 Project, Application, Provider, API Key, App Token, Runtime Config를 만든다.
- Gateway는 `/v1/chat/completions`, `/v1/models`, auth, context, rate limit, provider call을 처리한다.
- Safety는 rule-based redaction/block을 main path로 사용한다.
- Rate Limit은 `applicationId` 기준 PostgreSQL-backed fixed window로 구현한다.
- Exact Cache는 Redis miss -> hit와 provider bypass를 보여준다.
- Routing은 `model=auto`를 selected provider/model/reason으로 확정한다.
- Observability는 requestId로 Log, Detail, Dashboard, Metrics를 연결한다.
- Performance는 k6 baseline으로 RPS, p95 latency, cache hit, rate limit 병목을 측정한다.

v1.0.0 main path에서 제외되는 범위:

- Redis Rate Limit
- Redpanda event pipeline
- ClickHouse analytics
- Semantic Cache
- Streaming
- Runtime Policy Editor 고도화
- RAG/FAQ chatbot을 GateLM core 기능으로 구현하는 것

제외 범위는 v2 evidence path 또는 고객사 앱 예시로 둔다.

---

## 5. Team Ownership

역할은 레이어 쪼개기가 아니라 사람별 관심 분야와 기술 bounded context 기준으로 나눈다.

| Owner | Bounded context | Main tech |
|---|---|---|
| 김규민 | Product Experience & Demo | Next.js |
| 재혁님 | Control Plane & Runtime Policy | NestJS |
| 이지섭 | Gateway Data Plane & Governance | Go |
| 이윤지 | AI Safety & Evaluation Lab | Python/FastAPI |
| 이규정 | Observability, Data Platform & Performance | PostgreSQL, metrics, k6 |

구체적인 R&R과 producer/consumer 계약은 `docs/v1.0.0/contracts.md`를 따른다.

---

## 6. Engineering Rules

모든 코드는 v1.0.0 baseline이라도 확장 가능하게 작성한다.

- Provider와 Model을 enum으로 고정하지 않는다.
- Provider별 로직은 Provider Adapter 안에 둔다.
- Gateway handler에 provider별 조건문을 흩뿌리지 않는다.
- Gateway pipeline은 stage 단위로 추가/교체 가능하게 둔다.
- Sensitive Data Detector는 registry 구조로 추가 가능하게 둔다.
- Cache, Routing, Rate Limit, Secret 조회는 interface를 통해 분리한다.
- 정책 판단은 하드코딩하지 않고 config/policy object를 통해 처리한다.
- 확장성을 이유로 v1.0.0 범위를 넘는 기능을 임의로 구현하지 않는다.

---

## 7. Never Do Without Explicit Approval

아래 작업은 명시적 지시와 계약 변경 없이 하지 않는다.

- 문서에 없는 API 생성
- 문서에 없는 DB table/column 생성
- 문서에 없는 Event field 추가
- raw prompt 저장
- raw response 저장
- Provider Key 평문 저장
- API Key/App Token 평문 저장
- Authorization header 로그 출력
- Web Console에서 Provider 직접 호출
- Control Plane에서 사용자 LLM 요청을 Provider로 proxy
- Worker에서 Provider 요청 재실행
- cache key에 raw prompt 사용
- masking stage를 cache 뒤로 이동
- 실제 secret이나 개인정보를 seed/test/snapshot에 사용

---

## 8. Planning Template

코드나 계약을 변경하기 전에는 먼저 아래 계획을 제시한다.

```text
목표:
수정 예정 파일:
새로 생성할 파일:
참조 문서:
API 변경 여부:
DB 변경 여부:
Event 변경 여부:
보안 영향:
테스트 계획:
완료 기준:
```
