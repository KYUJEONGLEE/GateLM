# Tenant Chat Contract Intake Checklist

| Field | Value |
|---|---|
| Status | Active intake assessment, not a contract |
| Consumer | Gateway, Control Plane, Web Console owners |
| Provider | Tenant Chat product team |
| Last reviewed | 2026-07-12 |

이 문서는 Chat 팀의 최종 설계를 누락 없이 구현 계획으로 변환하기 위한 체크리스트다. Active 계약은 `docs/tenant-chat` 실행 계약 패키지이며 계약 ID는 `tenant-chat/v1`이다. OpenAPI, DDL, schema와 vector에 없는 값을 임의로 추측해 구현하지 않는다.

## Contract Intake Status

### Received and binding

- 제품 경계와 Tenant-only execution scope
- `(tenantId,userId)` canonical actor와 Employee entitlement 역할
- private endpoint 3종과 public listener 분리
- Ed25519 workload JWT identity, claim 목록, TTL, replay 의미
- user token quota와 tenant cost budget 상태/threshold
- reservation, top-up, settlement, release, unconfirmed 의미
- retry/fallback의 모든 confirmed billable attempt 정산
- ledger record 이름, idempotency tuple, event 이름
- 주요 HTTP error code
- Dashboard discriminator와 집계 목록
- exact-only cache 범위
- additive migration과 deployment 순서

### Received execution artifacts

- admission/cancel/completion request, response, SSE schema
- DB record별 column, type, FK, unique, check, index schema
- event별 payload와 event version schema
- `bindingDigest` canonicalization 규칙과 test vector
- Ed25519 public key distribution, rotation, revoke 환경 계약
- RuntimeSnapshot Tenant Chat policy schema와 digest material
- reservation estimate/top-up 계산식과 pricing provenance schema
- writer/reader/migration ownership matrix

### Remaining implementation decisions

- encrypted history의 물리 schema와 key lifecycle은 Chat API 소유 범위에서 확정
- 현재 단일 DB user인 Compose를 분리할 least-privilege role/grant 적용 방식
- `employeeId`의 tenant-admin 허용 여부와 same-tenant 방어선
- terminal replay 시 assistant content 복구 경계

## 1. Product Boundary

- [ ] 기존 Application Chat과 Tenant Chat의 경계가 명시됐다.
- [ ] Tenant Chat의 product/service 명칭이 확정됐다.
- [ ] `chat-web`, `chat-api`, Gateway, Control Plane의 책임이 구분됐다.
- [ ] 기존 Project/Application 경로에서 재사용하는 요소와 재사용하지 않는 요소가 적혔다.
- [ ] feature flag 또는 rollout 단위가 정의됐다.

## 2. Execution Scope

- [ ] execution scope JSON 또는 schema가 제공됐다.
- [ ] scope kind의 정확한 field와 enum 값이 제공됐다.
- [ ] Tenant-only scope에서 Project/Application ID의 존재 여부가 명시됐다.
- [ ] client-provided scope를 거절하거나 무시하는 규칙이 명시됐다.
- [ ] Dashboard와 request log에서 사용할 discriminator가 제공됐다.

확인할 최소 예시:

```json
{
  "kind": "<contract-value>",
  "tenantId": "uuid"
}
```

위 예시는 placeholder이며 실제 field 이름은 Chat 팀 계약을 따른다.

## 3. Workload JWT

- [ ] signing algorithm이 확정됐다.
- [ ] issuer가 확정됐다.
- [ ] audience가 확정됐다.
- [ ] subject의 의미가 확정됐다.
- [ ] 필수 custom claim schema가 제공됐다.
- [ ] 최대 TTL이 확정됐다.
- [ ] 허용 clock skew가 확정됐다.
- [ ] `jti` 또는 replay 방지 규칙이 확정됐다.
- [ ] public key discovery와 rotation 방식이 확정됐다.
- [ ] signing key compromise와 revoke 절차가 정의됐다.
- [ ] private Gateway network 경계가 정의됐다.

## 4. Identity And Entitlement

- [ ] canonical actor identity가 확정됐다.
- [ ] Tenant membership 검증 주체가 확정됐다.
- [ ] User 상태 검증 주체가 확정됐다.
- [ ] Employee entitlement 필요 여부가 확정됐다.
- [ ] Employee 비활성화 반영 지연 허용 시간이 정해졌다.
- [ ] 서로 다른 Tenant에 같은 User가 있을 때 scope 규칙이 정해졌다.
- [ ] 브라우저 identity field를 신뢰하지 않는 테스트가 정의됐다.

## 5. Private Gateway API

- [ ] method와 path가 제공됐다.
- [ ] request JSON schema가 제공됐다.
- [ ] streaming request/response schema가 제공됐다.
- [ ] 필수/선택 header가 제공됐다.
- [ ] request ID 생성 및 retry 재사용 규칙이 제공됐다.
- [ ] max input/output token 규칙이 제공됐다.
- [ ] timeout과 cancellation 규칙이 제공됐다.
- [ ] error response schema가 제공됐다.

## 6. Cache Boundary

- [ ] cache lookup 주체가 확정됐다.
- [ ] cache hit 시 quota와 budget 차감 여부가 확정됐다.
- [ ] semantic cache와 exact cache 적용 범위가 확정됐다.
- [ ] cache key에서 Tenant/User/Conversation을 사용하는 규칙이 확정됐다.
- [ ] 다른 User 또는 Tenant 간 cache 격리 규칙이 확정됐다.

## 7. User Quota

- [ ] quota identity가 확정됐다.
- [ ] period와 timezone이 확정됐다.
- [ ] input, output, total 중 어떤 token을 차감하는지 확정됐다.
- [ ] confirmed token의 정의가 제공됐다.
- [ ] cache miss 동시 요청의 reservation 규칙이 제공됐다.
- [ ] quota 초과 HTTP status와 error code가 확정됐다.
- [ ] quota reset과 관리자 조정 규칙이 제공됐다.
- [ ] quota read API 또는 event가 제공됐다.

## 8. Tenant Budget

- [ ] budget identity가 확정됐다.
- [ ] 비용 통화와 integer 단위가 확정됐다.
- [ ] confirmed cost의 정의가 제공됐다.
- [ ] pre-provider reservation 또는 estimate 규칙이 제공됐다.
- [ ] budget 초과 HTTP status와 error code가 확정됐다.
- [ ] Provider pricing 변경 시 정산 규칙이 제공됐다.
- [ ] 수동 조정과 reconciliation 규칙이 제공됐다.

## 9. Retry And Fallback Settlement

- [ ] logical request ID가 확정됐다.
- [ ] Provider attempt ID가 확정됐다.
- [ ] idempotency unique key가 확정됐다.
- [ ] 실패한 primary의 confirmed billable usage 포함 여부가 확정됐다.
- [ ] fallback 성공 시 합산 규칙이 확정됐다.
- [ ] timeout 후 늦게 도착한 Provider usage 처리 규칙이 확정됐다.
- [ ] duplicate settlement 처리 규칙이 확정됐다.
- [ ] unknown usage 상태와 후속 reconciliation 규칙이 확정됐다.

## 10. Ledger And Events

- [ ] durable usage source가 확정됐다.
- [ ] ledger table 또는 event schema가 제공됐다.
- [ ] reservation, settlement, release 상태가 정의됐다.
- [ ] request와 attempt cardinality가 정의됐다.
- [ ] transaction 또는 outbox 경계가 정의됐다.
- [ ] event versioning 규칙이 제공됐다.
- [ ] consumer retry와 dead-letter 처리 규칙이 제공됐다.
- [ ] retention과 archival 규칙이 제공됐다.

## 11. Encrypted History

- [ ] history DB 소유 서비스가 확정됐다.
- [ ] encryption algorithm과 key ownership이 확정됐다.
- [ ] key rotation 방식이 확정됐다.
- [ ] conversation ownership identity가 확정됐다.
- [ ] retention, deletion, export 규칙이 확정됐다.
- [ ] Gateway가 history 원문을 저장하지 않는 경계가 명시됐다.
- [ ] log와 error에 history 원문이 노출되지 않는 테스트가 정의됐다.

## 12. Request Log And Dashboard

- [ ] execution scope discriminator가 확정됐다.
- [ ] product surface discriminator가 확정됐다.
- [ ] canonical actor display 규칙이 확정됐다.
- [ ] Tenant Chat request log schema가 제공됐다.
- [ ] Dashboard 집계 지표가 제공됐다.
- [ ] Project/Application 집계와 Tenant Chat 집계의 합산 규칙이 확정됐다.
- [ ] 사용량 freshness/SLA가 확정됐다.
- [ ] 권한별 조회 범위가 확정됐다.

## 13. Privacy And Observability

- [ ] raw prompt/response 저장 금지 또는 허용 범위가 확정됐다.
- [ ] Provider raw error 처리 규칙이 확정됐다.
- [ ] credential redaction 규칙이 확정됐다.
- [ ] metric name과 허용 label이 제공됐다.
- [ ] Tenant/User/Employee/Request ID가 metric label에서 금지됐다.
- [ ] trace와 log correlation 방식이 확정됐다.
- [ ] audit event 범위가 확정됐다.

## 14. Deployment And Migration

- [ ] DB migration 소유자가 확정됐다.
- [ ] migration backward compatibility가 검토됐다.
- [ ] chat-api와 Gateway 배포 순서가 제공됐다.
- [ ] JWT key 배포 순서가 제공됐다.
- [ ] feature flag enable 순서가 제공됐다.
- [ ] rollback 시 ledger/event 호환성이 검토됐다.
- [ ] 기존 Application Chat 회귀 검증이 포함됐다.

## 15. Acceptance Evidence

- [ ] 정상 non-streaming 요청 evidence
- [ ] 정상 streaming 요청 evidence
- [ ] cache hit quota 미차감 evidence
- [ ] user quota hard block evidence
- [ ] tenant budget hard block evidence
- [ ] primary failure와 fallback settlement evidence
- [ ] retry idempotency evidence
- [ ] Tenant/User entitlement rejection evidence
- [ ] encrypted history evidence
- [ ] Dashboard/read model 분리 evidence
- [ ] raw sensitive data 비노출 evidence
- [ ] metric cardinality evidence

## 16. Intake Decision Record

계약을 전달받은 뒤 아래 표를 채운다.

| Decision | Chat contract value | GateLM impact | Owner | Status |
|---|---|---|---|---|
| Product namespace | `tenant-chat/v1`, legacy와 분리 | 별도 schema/API/read model | Chat + Gateway | Received |
| Execution scope | `surface=tenant_chat`, `kind=tenant_chat`, Tenant-only | Project/Application sentinel 금지 | Chat | Received |
| Canonical actor | `(tenantId,userId)` | Employee key 재사용 금지 | Chat + Control Plane | Received |
| JWT profile | EdDSA/Ed25519, dedicated typ/iss/aud, 30s default | private verifier와 jti consume 필요 | Chat + Gateway | Schema/vector/key operation received |
| Private endpoint | admissions, cancel, completions | public `/v1`와 listener 분리 | Gateway | OpenAPI/SSE received |
| User quota | monthly confirmed tokens, 80/100/120 | period/reservation ledger 필요 | Gateway | DDL/event schema received |
| Tenant budget | monthly confirmed cost, 80/90/100 | atomic same-transaction reservation 필요 | Gateway | DDL/event schema received |
| Usage source | period/reservation/ledger transaction | p0 log는 correctness source 아님 | Gateway | DDL/event schema received |
| Retry/fallback settlement | 모든 confirmed billable attempt 합산 | attempt와 late settlement 필요 | Gateway | transition vector received |
| Dashboard discriminator | surface와 execution scope kind | additive outbox projection/read model | Projector + Web | aggregate/event schema received |

## 17. Handoff Completion Gate

다음 조건을 모두 만족해야 Tenant Chat 구현 계획을 실행 가능한 상태로 확정한다.

1. API, JWT, ledger/event, error schema가 versioned artifact로 제공됐다.
2. identity, quota, budget, retry/fallback의 의미가 모호하지 않다.
3. Chat 팀과 Gateway 팀의 ownership이 겹치지 않는다.
4. DB와 Dashboard의 additive migration 경로가 설명됐다.
5. 보안과 개인정보 불변조건의 테스트 방법이 있다.
6. 배포와 rollback 순서가 있다.

현재 판정:

- 2, 3, 6은 Active 계약으로 충족했다.
- 1은 의미와 error code는 충족했지만 API/DB/event schema artifact가 남았다.
- 4는 additive 방향이 확정됐지만 실제 migration schema가 남았다.
- 5는 불변조건은 확정됐지만 schema 기반 acceptance fixture가 남았다.
