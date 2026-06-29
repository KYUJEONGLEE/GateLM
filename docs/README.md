# GateLM Documentation Guide

이 문서는 팀원과 구현 에이전트가 GateLM 작업을 시작할 때 가장 먼저 읽는 문서다.

GateLM은 기업의 LLM 요청을 승인된 Gateway 경로로 모아 보안, 비용, 정책, 로그, 관측을 중앙에서 관리하게 해주는 B2B LLM Gateway다.

현재 구현 목표는 **v2.0.0 organization-based LLMOps Gateway MVP**다.

---

## 1. Reading Order And Source Of Truth

작업을 시작할 때는 먼저 `docs/README.md`를 읽는다.

문서끼리 충돌하면 아래 Source Of Truth 순서로 판단한다.

1. `docs/v2.0.0/contracts.md`
2. `docs/v2.0.0/schemas/*.schema.json`
3. `docs/v2.0.0/fixtures/*.fixture.json`
4. `docs/v2.0.0/implementation-plan.md`
5. `docs/v2.0.0/implementation-tasks.md`

`contracts.md`는 API, DB, Event, Metrics, Security-sensitive field 판단의 최우선 기준이다.

`implementation-plan.md`는 200줄 안팎의 상위 구현 계획서다.

`implementation-tasks.md`는 실제 PR별 작업 위치와 검증 기준을 담은 코딩용 계획서다.

Reference / Draft 문서는 구현 판단의 보조 자료로만 사용한다.

- `docs/v2.0.0/p0-legacy-field-cleanup.md`: legacy field cleanup 참고 문서
- `docs/v2.0.0/p0-contract-decisions.md`: 공식 계약이 아닌 팀 검토 목록

위 문서의 후보 표현을 공식 API, DB, Event, Metrics, Schema field로 바로 승격하지 않는다.

---

## 2. Supporting References

작업 범위에 따라 아래 문서를 추가로 확인한다.

- 작업 범위에 해당하는 schema/fixture
- 작업 범위에 해당하는 app/module 문서
- `docs/architecture/*`
- `docs/policies/*`
- `docs/archive/*`

역할별 토론 문서는 working draft다.

최종 합의된 내용만 `contracts.md`, schema/fixture, implementation docs로 승격한다.

---

## 3. v2.0.0 Goal

v2.0.0 목표는 v1.0.0 baseline을 깨지 않으면서 조직 기반 LLMOps Gateway MVP를 완성하는 것이다.

핵심 흐름:

```text
Customer App / Employee Chat
-> Gateway
-> RuntimeSnapshot policy
-> budget / safety / cache / routing
-> Actual Provider or Mock fallback
-> Request Log / Detail / Dashboard / Metrics / k6 evidence
```

v2.0.0에서 반드시 설명 가능해야 하는 것:

- 어떤 tenant/project/application 요청인지
- 어떤 RuntimeSnapshot이 실제 적용됐는지
- 어떤 budget scope로 비용과 쿼터가 귀속됐는지
- safety, budget, cache, routing, provider, fallback, streaming 결과가 무엇인지
- Actual Provider가 성공했는지, Mock fallback이 사용됐는지
- Request Detail, Dashboard, Metrics, k6가 같은 outcome을 보고 있는지

---

## 4. v2.0.0 Main Scope

| Area | Main path |
|---|---|
| Control Plane | RuntimeConfig validation/publish, RuntimeSnapshot, Provider/Model catalog, `credentialRef`, budget policy source |
| Gateway | auth/context, RuntimeSnapshot load, budget/rate limit, request-side safety, exact cache, routing, provider, fallback, streaming, logging outcomes |
| Product Experience | Admin/Developer/Employee surfaces, Employee Chat through Application boundary, Request Detail, Dashboard, Demo Scenario Runner |
| Safety | request-side safety outcome and sanitized evidence |
| Observability | Gateway-produced outcomes, Request Log/Detail read model, Dashboard aggregate, metrics label guard, k6/query profile |
| Provider | Actual Provider 1+ and model 2+ through Provider Adapter, with Mock fallback |

---

## 5. Non-Goals For v2.0.0 Core

- raw prompt/raw response storage opt-in
- Semantic Cache live response path
- token-level streaming logging
- response-side safety scan main path
- Employee Chat Provider direct call
- Web Console user request Provider proxy
- `department` budget scope
- provider/model DB enum locking
- mandatory ClickHouse/Redpanda adoption

---

## 6. Team Ownership

| Owner | Bounded context | Main output |
|---|---|---|
| 김규민 | Product Experience & Demo | Employee Chat, Request Detail UI, Dashboard UX, Demo Scenario Runner |
| 재혁님 | Control Plane & Runtime Policy | RuntimeSnapshot publish path, Provider/Model catalog, `credentialRef`, budget policy source |
| 이지섭 | Gateway Data Plane & Governance | Gateway pipeline, outcomes, Provider Adapter boundary, Mock fallback |
| 이윤지 | AI Safety & Evaluation Lab | request-side safety outcome, sanitized detector summary, Semantic Cache evidence |
| 이규정 | Observability, Data Platform & Performance | Request Log/Detail read model, Dashboard aggregate, metrics guard, k6/query profile |

---

## 7. Security Rules

아래 값은 DB, log, fixture, API response, metric label, UI에 평문으로 남기지 않는다.

- raw prompt
- raw response
- raw detected value
- raw prompt fragment
- API Key
- App Token
- Provider Key
- Authorization header
- provider raw error body
- actual secret

실제 secret이나 개인정보처럼 보이는 값은 seed, test, snapshot, fixture에도 넣지 않는다.

---

## 8. Implementation Docs

| Document | Purpose |
|---|---|
| `docs/v2.0.0/contracts.md` | 공식 계약 기준 |
| `docs/v2.0.0/implementation-plan.md` | 상위 구현 계획 |
| `docs/v2.0.0/implementation-tasks.md` | PR별 실제 작업 계획 |
| `docs/v2.0.0/schemas/` | JSON Schema |
| `docs/v2.0.0/fixtures/` | 최소 fixture |
| `docs/v2.0.0/p0-legacy-field-cleanup.md` | legacy field cleanup 기준 참고 문서 |
| `docs/v2.0.0/p0-contract-decisions.md` | 공식 계약 전 팀 검토 목록 |
| `docs/archive/` | 과거 P0/v1 기록 |

과거 문서는 배경 이해에만 사용한다. v2 계약과 충돌하면 v2 계약을 우선한다.
