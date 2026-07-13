# GateLM Tenant Chat Implementation Plan

상태: **Active**
계약: `docs/tenant-chat/contracts.md`

## 1. 목표

기존 Project/Application Gateway 경로를 보존하면서 신규 Tenant Chat을 demo 가능한 end-to-end 제품으로 만든다. 구현은 작은 결과물을 빠르게 확인하되 contract boundary, migration compatibility, security guardrail을 생략하지 않는다.

첫 polishing 진입 조건은 다음 흐름이다.

```text
admin demo tenant/policy/provider seed
-> employee invite/login
-> chat-web conversation
-> chat-api encrypted history
-> private Gateway snapshot/rate/quota/provider/fallback
-> confirmed usage settlement
-> admin Dashboard/detail
-> local/self-host smoke
```

## 2. 작업 원칙

- 이 문서와 contract는 Tenant Chat workstream에서 active다. 별도 조직 합의를 기다리지 않고 구현할 수 있다.
- 다른 팀/Codex의 review는 contract defect를 찾는 입력이다. active 의미 변경은 explicit revision으로 처리한다.
- 기존 `apps/application`, public `/v1`, v2.0 RuntimeSnapshot/Request Log 의미를 바꾸지 않는다.
- demo-critical vertical slice를 먼저 통과시키고 enterprise 고도화는 follow-up으로 둔다.
- DB는 additive expand-first, route는 feature flag off-first, deployment는 reader-first다.
- 민감정보, raw content, secret, provider raw error를 evidence에 남기지 않는다.

## 3. Merge units

| PR | Branch | Base | Demo outcome |
|---|---|---|---|
| 01 | `codex/docs/tenant-chat-active-contract` | `dev` | active contract/schema/fixture/handoff와 실행 명세 확정 |
| 02 | `feat/tenant-chat-auth-shell` | PR 01 | invite/login/tenant selection/access+refresh/session revoke, Chat shell, legacy delivery alignment |
| 03 | `codex/feat/tenant-chat-runtime` | PR 02 | tenant RuntimeConfig/Snapshot/publish, quota/cache/provider policy |
| 04 | `codex/feat/tenant-chat-gateway` | PR 03 | private Gateway, workload JWT, rate, quota/budget ledger, provider/fallback |
| 05 | `codex/feat/tenant-chat-api` | PR 04 | Chat API, EncryptedChatStore, conversation/SSE/history/retention |
| 06 | `codex/feat/tenant-chat-admin` | PR 05 | admin policy/BYOK/Dashboard/detail/content diagnostic |
| 07 | `codex/feat/tenant-chat-web` | PR 06 | employee Chat Web/BFF, normal/economy/blocked UX, a11y |
| 08 | `codex/feat/tenant-chat-demo` | PR 07 | Compose/self-host seed, E2E/browser/load/demo polishing |

PR 02는 실제 browser/session 계약 공백을 같은 PR의 첫 독립 contract commit에서 닫고 auth shell까지 vertical slice로 제공한다. PR 03~08은 stacked draft로 개발할 수 있다. 선행 contract/schema를 소비하는 부분은 선행 PR 기준으로 검증한다. merge 전에 base를 승인된 최신 기준으로 바꾸고 diff를 다시 확인한다.

## 4. Demo-critical scope

### Auth

- email/password와 Google login
- invite acceptance와 atomic User/Membership/Employee binding
- active tenant 선택
- 5분 access JWT, 30일 rotating refresh, device/session revoke
- admin은 User+tenant_admin membership으로 사용하며 dummy Employee를 만들지 않음

### Runtime/Gateway

- tenant-only immutable RuntimeSnapshot
- workload JWT private admission/completion/cancel
- request rate와 active stream cap
- exact cache
- quota/budget `normal|warning|economy|blocked`
- primary/fallback all-billable-attempt settlement
- provider-confirmed usage ledger/outbox

### Chat product

- conversation create/list/rename/delete
- bounded SSE stream
- EncryptedChatStore history/title
- final assistant only persistence
- profile usage/policy state
- quota hard-stop 시 관리자 문의 안내

### Admin/demo

- policy/provider/quota edit and publish
- Dashboard `surface=tenant_chat`
- safe Request Detail
- Full Content Logging default off, demo opt-in
- single tenant-admin step-up/purpose/audit diagnostic
- idempotent seed and one-command smoke

## 5. Follow-up backlog

아래는 interface와 policy discriminator를 닫지 않지만 demo-critical merge를 막지 않는다.

- Semantic Cache backend API, Gateway adapter, Admin UI와 live evaluation. 현재 published strategy는 `off|exact`만 허용
- OAuth-only add-password
- employee quota increase request/approval workflow
- diagnostic four-eyes option
- legal hold
- native/mobile/desktop edge와 enterprise SSO
- KMS/HSM adapter
- multi-node HA, autoscaling, advanced enterprise client administration

## 6. Acceptance by PR

| PR | Required gate |
|---|---|
| 01 | JSON parse/schema-fixture pairing, conflict matrix, forbidden-data scan |
| 02 | invite race/replay, tenant selection, revoke-next-request, CSRF/session negative tests |
| 03 | parallel publish/rollback, exact snapshot pin, invalid economy route publish deny |
| 04 | JWT replay/body binding, admission no-content-on-deny, quota race, fallback all-attempt settlement |
| 05 | crypto tamper/rotation, IDOR, final-only persistence, retention/delete/cache epoch |
| 06 | tenant-admin authorization, provider SSRF, diagnostic step-up/purpose/audit, Dashboard aggregate |
| 07 | auth/chat/quota UI state matrix, keyboard/a11y/mobile, no token/content browser artifact |
| 08 | clean+upgrade Compose, real-stack E2E, provider mock/live separation, k6/race/legacy regression |

## 7. Deployment order

1. migration/DB roles
2. Control Plane readers/writers
3. Gateway private verifier/readers, traffic off
4. Chat API/EncryptedChatStore
5. projector/Dashboard reader
6. Chat Web
7. demo seed/snapshot
8. tenant feature flag
9. E2E/load/legacy regression

## 8. Stop conditions

- existing Application/public `/v1` behavior changes without compatibility contract
- private Gateway listener is externally reachable
- quota/budget race exceeds a hard stop or duplicate settles
- raw content/credential/provider error appears in DB log/metric/artifact outside approved encrypted store
- migration requires destructive down/drop or old reader cannot read newly written data
- exact snapshot/body/admission binding cannot be proven

그 외의 구현 세부 defect는 범위를 좁혀 수정하고 vertical slice 진행을 계속한다.
