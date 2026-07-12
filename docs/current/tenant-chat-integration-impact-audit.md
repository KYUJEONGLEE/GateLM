# Tenant Chat Integration Impact Audit

| Field | Value |
|---|---|
| Status | Contract-reconciled impact audit, not a product contract |
| Baseline | `origin/dev` merged into `feat/employee-rate-limit-quota-refinement` |
| Scope | Existing GateLM collision points for a future Tenant Chat handoff |
| Last reviewed | 2026-07-12 |

이 문서는 Chat 팀의 최종 Tenant Chat 설계를 대신하지 않는다. Active 기준은 PR #293의 `docs/tenant-chat` 실행 계약 패키지(`tenant-chat/v1`)이며, 이 문서는 해당 계약을 현재 저장소에 적용할 때의 충돌 지점을 기록한다.

## 1. Executive Result

현재 GateLM의 Application Chat, invocation log, budget ledger, conversation, Dashboard는 Project/Application identity를 중심으로 구현되어 있다.

Tenant Chat v1은 `executionScope.kind=tenant_chat`과 Tenant-only runtime identity를 사용한다. 기존 Project/Application 경로에 가짜 ID를 넣어 재사용하지 않으며 별도 private endpoint, ledger, invocation projection을 사용한다.

제품 의미와 배포 순서는 확정됐고 endpoint request/response, DB DDL, event payload, binding digest, key operation과 RuntimeSnapshot schema는 PR #293에 추가됐다. PR1은 해당 artifact를 기준으로 additive runtime·usage 기반을 구현하며, PR이 `dev`에 병합되면 로컬 verifier의 직접 입력으로 사용한다.

### 1.1 Resolved by the active contract

| Topic | Active decision |
|---|---|
| Runtime identity | Tenant-only `executionScope.kind=tenant_chat` |
| Canonical actor | `(tenantId,userId)` |
| Employee | employee actor entitlement 보조 식별자 |
| Gateway auth | Ed25519 workload JWT, private listener |
| Quota | user monthly confirmed tokens |
| Budget | tenant monthly confirmed cost |
| Correctness source | period/reservation/ledger transaction |
| Retry/fallback | 모든 Provider-confirmed billable attempt 합산 |
| Dashboard | outbox projection, `surface=tenant_chat` discriminator |
| Legacy compatibility | 기존 Project/Application path 변경 없음 |

## 2. Current Product Boundary

| Product path | Runtime identity | Canonical usage identity | Status |
|---|---|---|---|
| Existing Application Chat | Tenant + Project + Application | scoped Employee | Legacy compatibility |
| Project Gateway services | Tenant + Project + optional Application | Project/Application/Employee scope | Active existing behavior |
| Tenant Chat v1 | Tenant-only execution scope | Tenant + User | Active contract, PR1 foundation in progress |

## 3. Database Collision Map

### 3.1 Invocation logs

`p0_llm_invocation_logs`는 `tenant_id`와 `project_id`를 필수 FK로 가진다. `application_id`는 nullable이지만 Project 없는 Tenant-only 요청은 표현할 수 없다.

| Risk | Severity | Why it matters | Contract input required |
|---|---|---|---|
| Tenant Chat에 가짜 Project ID 사용 | High | 비용, 로그, 권한, Dashboard가 기존 Project 사용량으로 오염됨 | Tenant Chat log/ledger ownership |
| `project_id`를 nullable로 변경 | High | 기존 query, API, Web 타입, index 의미가 바뀜 | Additive schema인지 별도 table인지 |
| execution scope discriminator 없음 | High | 두 제품의 요청을 안정적으로 구분할 수 없음 | `executionScope.kind` schema |
| terminal log는 최종 요청 중심 | High | 여러 Provider attempt의 confirmed usage 정산이 부족함 | attempt ledger/event schema |

### 3.2 Budget ledger

`budget_ledger_entries`는 `project_id`가 필수이며 request ID 하나당 한 행이다. 현재 구조만으로 Tenant-only budget과 retry/fallback attempt별 비용을 동시에 표현하기 어렵다.

필요한 결정:

- Tenant Chat이 기존 budget ledger를 확장하는지 별도 atomic usage ledger를 소유하는지
- request와 Provider attempt의 idempotency key
- reservation, settlement, release 상태
- failed primary의 confirmed billable usage 포함 여부

### 3.3 Existing conversation tables

`conversations`와 `chat_messages`는 Tenant, Project, Application FK를 모두 요구한다. 메시지는 `safeContent`를 저장하지만 Tenant Chat 제안의 별도 encrypted history 계약과 동일하지 않다.

Tenant Chat history를 기존 테이블에 저장하면 안 되는 이유:

- Project/Application identity가 필수다.
- 현재 encryption-at-rest field 계약이 없다.
- 기존 API는 `AdminAuthGuard` 기반 Application Chat 경로다.
- Tenant Chat의 사용자별 소유권과 삭제/보존 정책이 확정되지 않았다.

### 3.4 Employee and membership

기존 `employees`와 Tenant membership은 entitlement 확인 자료로 사용할 가능성이 있다. 하지만 Tenant Chat의 canonical actor 또는 usage key로 Employee를 사용한다고 가정하면 안 된다.

확인할 항목:

- canonical actor가 `(tenantId, userId)`인지
- Employee가 필수 entitlement인지 선택 entitlement인지
- membership 또는 Employee 상태 변경의 JWT 반영 지연 허용 시간

## 4. API Collision Map

### 4.1 Existing Gateway route

기존 `/v1/chat/completions`는 Project API Key와 기존 runtime snapshot을 중심으로 동작한다. Tenant Chat private workload JWT를 같은 인증 middleware에 암묵적으로 추가하면 public Project 경로의 보안 의미가 바뀐다.

권장 경계:

- 기존 public Project route는 호환 유지
- Tenant Chat은 Chat 팀이 지정한 private route/namespace 사용
- private route는 workload JWT 전용 audience와 issuer 검증
- 브라우저는 private Gateway route를 직접 호출하지 않음

### 4.2 Existing conversation API

`/api/chat/conversations`는 기존 Control Plane Application Chat 경로다. Tenant Chat의 chat-api와 encrypted history API로 재사용한다고 가정하지 않는다.

### 4.3 Existing employee API

`/admin/v1/projects/:projectId/employees/:employeeId`는 Project employee guard 설정용이다. Tenant Chat user quota API가 아니다.

## 5. Redis Collision Map

현재 확인된 주요 prefix:

```text
gatelm:rate_limit:token_bucket:v1
gatelm:rate_limit:fixed_window:v1
gatelm:employee_daily_tokens:v1
```

Tenant Chat은 다음 이유로 기존 employee key를 재사용하면 안 된다.

- 기존 key identity가 Tenant + Project + Employee다.
- Tenant Chat actor와 execution scope가 다를 수 있다.
- quota가 monthly confirmed-token 또는 tenant confirmed-cost일 수 있다.
- hard block과 reservation semantics가 기존 employee downgrade와 다르다.

Chat 팀 계약을 받기 전에는 Tenant Chat prefix를 확정하지 않는다. 전달 후에도 기존 prefix와 겹치지 않는 versioned namespace를 사용한다.

## 6. Request Log And Dashboard Collision Map

### 6.1 Gateway read APIs

기존 request log API와 Web client는 Project ID로 요청을 fan-out하고 필터링한다. `projectId`가 없는 Tenant Chat 요청은 현재 목록에 자연스럽게 들어갈 수 없다.

### 6.2 Web read model

현재 주요 read model은 다음 값을 전제로 한다.

- `tenantId`
- `projectId`
- `applicationId`
- Project name lookup
- Project별 비용 집계
- `endUserId`를 employee directory와 연결

Tenant Chat 통합 전에 필요한 discriminator:

- execution scope kind
- product surface
- canonical actor kind
- scope-specific display name

필드 이름과 enum은 Chat 팀 계약을 그대로 사용한다. 현재 코드에서 임의로 `tenant_chat` 필드를 만들지 않는다.

## 7. Authentication And Security Gaps

현재 Gateway에는 Tenant Chat workload JWT verifier와 전용 signing key rotation 계약이 없다.

필수 전달물:

- JWT algorithm
- issuer와 audience
- 필수 claim
- key discovery 또는 rotation 방식
- 최대 TTL와 clock skew
- replay 방지 기준
- entitlement 검증 주체
- private network 또는 service authentication 조건

브라우저가 제공한 Tenant, User, Employee, Scope, Budget scope는 모든 경우에 권한 근거로 사용하면 안 된다.

## 8. Deployment And Service Topology

현재 저장소의 `apps/application`은 기존 Application Chat surface다. 제안된 별도 `chat-web`, `chat-api` 서비스는 현재 구현된 것으로 간주하지 않는다.

계약 수신 후 확인할 사항:

- 새 서비스가 같은 monorepo에 들어오는지 별도 repository인지
- Gateway private route의 network exposure
- signing key와 encryption key의 secret ownership
- migration 실행 주체
- chat-api와 Gateway 배포 순서
- rollback 시 ledger/event 호환성

기존 port `3000`, `3001`, `3002`, `8080`은 이번 준비 작업에서 변경하지 않는다.

## 9. Changes Safe Before Handoff

- 기존 Application Chat smoke와 Project employee policy regression 유지
- 직원별 Provider/Model 무효 계약 제거
- Tenant Chat collision point 문서화
- 계약 수신 체크리스트 준비
- 기존 Project/Application 경로의 회귀 테스트 실행

## 10. Changes Blocked Until Versioned Schema Artifacts

- 8개 Tenant Chat record의 column, constraint, index가 없는 DB migration
- admission/cancel/completion request와 response body가 없는 private handler
- `bindingDigest` canonicalization test vector가 없는 JWT binding 검증
- public key discovery/rotation 환경 계약이 없는 Ed25519 verifier
- payload와 version schema가 없는 outbox producer/projector
- encryption field와 key lifecycle schema가 없는 chat history
- SSE final/error frame schema가 없는 streaming response
- pricing/snapshot provenance schema가 없는 settlement implementation

## 11. Plan Impact

Active 계약과 versioned schema artifact를 기준으로 다음 순서로 진행한다.

1. endpoint, DB, event, digest schema artifact를 저장소에 반영한다.
2. additive DB migration과 least-privilege role을 구현한다.
3. Control Plane period/reservation/ledger transaction을 구현한다.
4. Gateway private admission/cancel/completion과 JWT verifier를 traffic-off 상태로 구현한다.
5. outbox projector와 Tenant Chat Dashboard read model을 연결한다.
6. Chat API와 encrypted history 경로를 통합한다.
7. tenant feature flag, E2E, legacy `/v1` regression을 실행한다.
