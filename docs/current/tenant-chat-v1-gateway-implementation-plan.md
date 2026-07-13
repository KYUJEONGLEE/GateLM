# Tenant Chat v1 GateLM Implementation Plan

| Field | Value |
|---|---|
| Status | PR1 implementation in progress |
| Contract | `docs/tenant-chat`, contract ID `tenant-chat/v1` |
| Contract baseline | `origin/dev @ b7d1a740` |
| Target | Control Plane, Gateway, projector, Web Console |
| Legacy impact | Existing Project/Application and public `/v1` remain unchanged |
| Last reviewed | 2026-07-12 |

## 1. 목표

신규 Tenant Chat 요청에 `(tenantId,userId)` 기준 사용자 quota와 Tenant 비용 budget을 정확하고 중복 없이 적용한다.

기존 Application Chat에 숨은 Project/Application ID를 만들지 않고, Tenant Chat 전용 RuntimeSnapshot, private Gateway, usage ledger와 Dashboard projection을 additive하게 구축한다.

## 2. 왜 필요한지

기존 Gateway는 Project/Application API key와 RuntimeSnapshot을 중심으로 실행된다. Tenant Chat은 Chat API가 사용자를 인증하고 Gateway에는 서명된 workload JWT로 Tenant-only 실행 결정을 전달한다.

기존 Project employee policy나 terminal log를 usage source로 재사용하면 Tenant Chat 비용이 Project에 섞이고, 동시 요청과 primary/fallback 사용량을 정확하게 예약·정산할 수 없다.

## 3. 2줄 요약

정확성 기준은 Redis 카운터나 Dashboard log가 아니라 Tenant Chat period/reservation/ledger transaction이다.

구현은 additive runtime·DB 기반, private Gateway 실행, projector·Dashboard의 3개 PR로 나눈다.

## 4. 고정 계약

- 계약 ID는 release 이름이 아닌 `tenant-chat/v1`이다.
- execution scope는 Tenant-only이며 Project/Application field를 허용하지 않는다.
- canonical actor와 user quota key는 `(tenantId,userId)`다.
- `employeeId`는 entitlement와 관리자 조회를 위한 보조 식별자다.
- Chat API는 usage table을 직접 갱신하지 않는다.
- Gateway가 admission, reservation, attempt, ledger와 outbox를 기록한다.
- Control Plane이 RuntimeConfig/Snapshot/pricing을 발행한다.
- projector가 invocation log와 Dashboard read model을 작성한다.
- exact cache hit은 request rate만 소비하고 token/cost debit은 0이다.
- primary/fallback의 모든 confirmed billable attempt를 합산한다.
- raw content, JWT, secret, provider raw error를 usage DB/log/metric에 저장하지 않는다.

## 5. PR1 - Runtime And Usage Foundation

### 5.1 완성할 흐름

```text
Control Plane policy/pricing input
-> tenant-chat/v1 validation
-> immutable Tenant RuntimeSnapshot publish
-> tenantId active pointer
-> Gateway가 읽을 snapshot/pricing provenance 준비
-> admission/period/reservation/attempt/ledger/outbox/log table 준비
```

PR1은 Tenant Chat traffic을 받거나 Provider를 호출하지 않는다. 후속 Gateway가 계약을 해석하지 않고 바로 writer를 구현할 수 있는 저장·검증 기반을 완성한다.

### 5.2 RuntimeConfig/Snapshot/pricing

- 기존 Project/Application runtime table은 수정하지 않는다.
- Tenant Chat 전용 config, pricing catalog, immutable snapshot, active pointer를 추가한다.
- snapshot lookup key는 Tenant 하나이며 version은 단조 증가한다.
- snapshot과 pricing digest는 RFC 8785 JCS + SHA-256 vector로 검증한다.
- pricing은 USD micro-unit과 regular input/output/provider cache-read 단가를 pin한다.
- warning/economy/hard-stop 순서와 enabled economy route를 publish 전에 검증한다.
- 같은 version과 다른 digest는 conflict로 거부한다.
- 외부 Control Plane endpoint는 별도 API 계약 전까지 추가하지 않는다.

### 5.3 Gateway-owned usage schema

다음 8개 record를 `docs/tenant-chat/db/tenant-chat-usage.sql`과 같은 의미로 additive migration에 추가한다.

1. `TenantChatRequestAdmission`
2. `TenantChatUserTokenPeriod`
3. `TenantChatTenantCostPeriod`
4. `TenantChatUsageReservation`
5. `TenantChatProviderAttempt`
6. `TenantChatUsageLedgerEntry`
7. `TenantChatInvocationOutbox`
8. `TenantChatInvocationLog`

필수 불변조건:

- admission unique key: `(tenantId,userId,idempotencyKey)`
- attempt primary key: `(requestId,attemptNo)`
- ledger primary key: `(requestId,ledgerVersion)`
- outbox unique key: `(aggregateId,eventType,eventVersion)`
- token과 micro-USD balance는 음수가 될 수 없음
- reservation은 user period와 tenant cost period를 같은 tenant key로 참조
- Project/Application FK와 legacy sentinel row를 만들지 않음
- migration은 CREATE/INDEX/FK/CHECK만 사용하는 expand-first 방식

### 5.4 PR1 검증

- contract pricing/snapshot digest vector 재현
- 잘못된 threshold와 economy route publish 거부
- Prisma schema format/validate
- migration의 8개 usage table 및 destructive statement guard
- Control Plane typecheck와 관련 단위 테스트
- 기존 Project/Application schema diff 없음 확인

## 6. PR2 - Private Gateway And Usage Transactions

### 6.1 완성할 흐름

```text
Chat API workload JWT
-> private admission
-> request rate/concurrency slot
-> completion binding consume
-> exact cache/safety/routing
-> token+cost atomic reservation
-> provider/fallback attempt
-> confirmed settlement/release
-> outbox
```

### 6.2 구현 범위

- host port를 publish하지 않는 private listener와 3개 endpoint
- Ed25519/JWKS의 issuer/audience/type/kid/phase 검증
- Redis `jti` exactly-once consume과 continuity fail-closed
- RFC 8785 payload/binding digest 및 HMAC vector 검증
- admission TTL 30초, request rate와 active concurrency
- exact cache hit의 zero-debit 처리
- user token과 tenant cost를 한 transaction에서 예약
- fallback 호출 전 exposure top-up
- 모든 billable attempt 정산과 unused reservation release
- 15분 pending-unconfirmed 및 late usage exactly-once settlement
- usage transition과 terminal outbox를 ledger transaction에 함께 기록

### 6.3 PR2 검증

- JWT replay, wrong phase/audience/kid/body binding 거부
- admission create/replay/conflict/cancel/expire
- 동시 reservation에서 hard stop 초과 없음
- primary/fallback 모든 confirmed usage 합산
- exact cache와 pre-call failure의 confirmed debit 0
- public `/v1` route와 host port 비노출

## 7. PR3 - Projection, Dashboard And Integration

### 7.0 구현 상태와 소유권 경계

- GateLM은 ordered outbox projector, `tenant_chat` invocation read model, tenant 관리자 조회 API와 Web Dashboard를 소유한다.
- projector는 `TENANT_CHAT_PROJECTOR_ENABLED=true`일 때만 실행하며 기존 컨테이너에서는 기본 비활성화한다.
- Chat API의 workload JWT 발급, 사용자 인증, 암호화 대화 저장, assistant final 저장과 SSE 처리는 구현하지 않는다.
- Chat API contract test와 양쪽 end-to-end 연결은 Chat API endpoint가 전달된 뒤 공동 검증으로 수행한다.
- 개인 quota hard block 제거와 economy-only 전환은 active contract revision이 필요한 별도 정책 변경으로 추적한다.

### 7.1 완성할 흐름

```text
usage/terminal outbox
-> ordered projector
-> tenant_chat invocation log
-> user quota/tenant budget aggregate
-> Dashboard/Request Detail
-> Chat API integration E2E
```

### 7.2 구현 범위

- duplicate event no-op, version gap replay와 DLQ/incident 처리
- `surface=tenant_chat`, `executionScope.kind=tenant_chat` projection
- user quota state와 tenant budget state 집계
- confirmed token/cost, cache, route, provider, fallback, latency 집계
- pending/unconfirmed exposure와 projection lag 표시
- 기존 Application Chat과 `surface=project_application|tenant_chat` discriminated union으로만 결합
- 메인 Dashboard에서 전체·Project/Application·Tenant Chat 조회 모드 제공
- confirmed cost 시계열을 같은 bucket으로 합산하고 부분 장애를 명시
- `/tenant-chat`은 별도 UI 대신 기존 Dashboard의 Tenant Chat 모드로 연결
- Compose secret/JWKS/private network wiring
- Chat API contract test와 end-to-end 연결

### 7.3 PR3 검증

- event 중복·역순·gap 복구
- tenant isolation과 관리자 authorization
- metric label의 tenant/user/employee/request/digest 금지
- raw prompt/response/credential/provider error 비노출
- admission부터 Dashboard까지 E2E
- legacy Application Chat/public `/v1` 회귀

## 8. 계약 확인 필요 항목

후속 계약 revision 대상으로 다음 차이를 추적한다.

1. `employeeId`가 employee actor에서만 존재하는지, 실제 직원인 tenant admin에도 허용되는지
2. admission/log의 `employee_id`가 같은 tenant Employee임을 DB FK 또는 writer 검증 중 어디서 보장하는지
3. Gateway terminal 완료 뒤 Chat API가 assistant ciphertext 저장 전에 장애가 나면 응답 본문을 어떻게 복구하는지
4. `userId`별 quota/rate-limit override를 어느 versioned schema에 저장하고 snapshot과 어떻게 결합하는지

이 항목은 계약 파일·field·상태 전이를 지정해 수정하며 임의로 의미를 선택하지 않는다.

## 9. 완료 기준

- Tenant Chat은 Project/Application 없이 실행된다.
- quota와 budget의 correctness source가 DB transaction으로 고정된다.
- RuntimeSnapshot과 pricing provenance를 재현할 수 있다.
- retry/fallback/late usage가 중복 정산되지 않는다.
- Dashboard projection 장애가 quota 판단을 바꾸지 않는다.
- 기존 Application Chat과 public `/v1` 동작이 유지된다.
