# GateLM

GateLM은 기업의 LLM 요청을 승인된 Gateway 경로로 모아 보안, 비용, 정책, 로그, 관측을 중앙에서 관리하게 해주는 B2B LLM Gateway입니다.

현재 구현 목표는 **v2.0.0 organization-based LLMOps Gateway MVP**입니다.

v1.0.0 baseline은 유지하되, 새 구현 판단은 `docs/v2.0.0/contracts.md`와 v2 구현 계획을 우선합니다.

---

## 1. Current Target

v2.0.0의 핵심 흐름은 아래입니다.

```text
Customer App / Employee Chat
-> Gateway
-> RuntimeSnapshot policy
-> safety / budget / cache / routing
-> Actual Provider or Mock fallback
-> Request Log / Detail / Dashboard / Metrics / k6 evidence
```

이번 버전에서 보여줘야 하는 제품 가치는 단순한 Provider proxy가 아니라 운영 가능한 LLMOps Gateway입니다.

- 관리자가 RuntimeConfig를 수정하고 RuntimeSnapshot으로 publish한다.
- Gateway는 published RuntimeSnapshot만 사용한다.
- Actual Provider 1종 이상과 모델 2개 이상을 연결한다.
- Mock fallback은 장애 복구/evidence path로 유지한다.
- budget, safety, exact cache, routing, fallback, streaming outcome을 Request Detail과 Dashboard에서 추적한다.
- k6와 metrics로 병목과 안정성을 설명한다.

---

## 2. Source Of Truth

작업 전 문서는 아래 순서로 확인합니다.

1. `docs/v2.0.0/contracts.md`
2. `docs/v2.0.0/schemas/*.schema.json`
3. `docs/v2.0.0/fixtures/*.fixture.json`
4. `docs/v2.0.0/implementation-plan.md`
5. `docs/v2.0.0/implementation-tasks.md`
6. `docs/README.md`

`contracts.md`와 충돌하면 항상 `contracts.md`를 우선합니다.

구체적인 PR별 작업 위치는 `docs/v2.0.0/implementation-tasks.md`를 봅니다.

---

## 3. Repository Layout

| Path | Purpose |
|---|---|
| `apps/control-plane-api` | Control Plane API, RuntimeConfig/RuntimeSnapshot, Provider catalog, credential reference |
| `apps/gateway-core` | Gateway data plane, pipeline, auth/context, provider adapter, outcomes |
| `apps/web` | Admin/Developer/Employee UI, Request Detail, Dashboard, demo surfaces |
| `apps/ai-service` | Safety/evaluation lab and Python-side evidence work |
| `docs/v2.0.0` | v2 contracts, schema, fixture, implementation plan |
| `scripts/perf` | k6/performance scenario scripts |
| `db/migrations` | shared SQL migration/evidence path when used |

---

## 4. Local Baseline

공식 로컬/CI/agent 기준은 아래로 맞춥니다.

| Runtime | Version |
|---|---|
| Node.js | `22` |
| pnpm | `9.15.0` |
| Go | repo/app docs 기준 |
| Python | repo/app docs 기준 |
| PostgreSQL | `16` |
| Redis | `7` |

루트 `package.json`은 `pnpm@9.15.0`을 사용합니다.

처음 검증할 때는 아래 명령을 우선합니다.

```powershell
pnpm install --frozen-lockfile
```

영향 범위에 따라 추가로 실행합니다.

```powershell
pnpm --filter @gatelm/control-plane-api typecheck
pnpm --filter @gatelm/web typecheck
go test ./...
```

---

## 5. Docker Infrastructure

로컬 개발 인프라는 PostgreSQL, Redis, Mock Provider를 사용합니다.

```powershell
docker compose up -d
docker compose ps
```

기존 컨테이너와 volume을 완전히 초기화해야 할 때만 아래를 사용합니다.

```powershell
docker compose down --remove-orphans -v
docker compose up -d
```

`-v`는 PostgreSQL/Redis volume을 삭제하므로 로컬 데이터가 필요 없는 경우에만 사용합니다.

---

## 6. First Merge Units

v2.0.0 구현은 아래 단위로 병렬화합니다.

| Unit | Branch | Purpose |
|---|---|---|
| 0 | `docs/v2-environment-and-plan-baseline` | Node/pnpm baseline, README/AGENTS pointers, plan/task docs |
| 1 | `feat/gateway-outcome-adoption-gate` | canonical `terminalStatus + domainOutcomes` adoption |
| 2A | `feat/provider-adapter-openai-and-mock-fallback` | Actual OpenAI Provider Adapter and Mock fallback |
| 2B | `feat/runtime-snapshot-live-thin-slice` | RuntimeSnapshot execution view and provenance |
| 3 | `feat/v2-budget-safety-cache-routing` | budget, safety, exact cache, routing order |
| 4 | `feat/streaming-thin-slice` | streaming feel and final outcome logging |
| 5 | `feat/v2-observability-dashboard-k6` | Request Detail, Dashboard, metrics guard, k6 baseline |

상세 작업 파일은 `docs/v2.0.0/implementation-tasks.md`를 기준으로 합니다.

---

## 7. Security Guardrails

아래 값은 API response, DB record, fixture, structured log, metric label, UI에 평문으로 남기지 않습니다.

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

Provider와 Model은 DB enum 또는 code enum으로 고정하지 않습니다.

Gateway는 client-provided budget scope를 신뢰하지 않습니다.

Employee Chat은 Provider를 직접 호출하지 않고 Web BFF/server-side boundary를 통해 Gateway main path를 탑니다.

---

## 8. Completion Criteria

v2.0.0은 아래가 끝났을 때 구현 완료로 봅니다.

- v1.0.0 baseline main path가 계속 동작한다.
- Gateway가 editable RuntimeConfig를 직접 소비하지 않는다.
- RuntimeSnapshot lookup key가 `tenantId/projectId/applicationId`로 고정된다.
- Actual Provider 1종 이상과 모델 2개 이상이 Provider Adapter로 연결된다.
- Mock fallback이 유지된다.
- request-side safety와 budget guard가 Provider 호출 전에 차단할 수 있다.
- Exact Cache hit가 Provider 호출을 건너뛴다.
- Streaming thin slice가 final status를 남긴다.
- Request Log, Request Detail, Dashboard, Metrics가 Gateway-produced outcomes를 소비한다.
- k6 baseline이 v2 핵심 시나리오를 분리한다.
- forbidden sensitive value가 DB/log/fixture/API response/metrics label/UI에 남지 않는다.
