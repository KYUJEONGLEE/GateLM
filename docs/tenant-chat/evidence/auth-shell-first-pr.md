# Tenant Chat Auth Shell 첫 PR 검증 증거

검증일: 2026-07-13 (Asia/Seoul)

기준 브랜치: `feat/tenant-chat-auth-shell`

착수 base: `origin/dev@b7d1a740b04b522c1c8f1c17f37ab037da7644ee`

최종 dev sync: `origin/dev@be9adde7`

이 문서는 직원 초대에서 GateLM Chat shell 진입까지의 첫 vertical slice를 검증한 결과다. 실제 secret, cookie, token, 비밀번호, provider 원문 오류는 기록하지 않는다.

## 1. 계약과 상태 소유권

- 브라우저는 same-origin `chat-web` BFF만 호출한다. BFF는 exact Origin과 double-submit CSRF를 검증한다.
- `chat-api`는 Chat session과 refresh family만 소유하며, Control Plane identity table을 직접 읽지 않는다.
- User, Employee, TenantMembership, Tenant identity와 entitlement는 Control Plane private API가 소유한다.
- PostgreSQL이 session/refresh/revoke authority다. Redis는 session authority가 아니다.
- access JWT는 5분, opaque refresh는 30일이며 PostgreSQL에는 SHA-256 tagged hash만 저장한다.
- invitation token은 진입 즉시 15분 intent cookie로 교환되고 clean URL로 303 redirect된다.
- 신규 계정만 invitation password를 만들 수 있다. 기존 계정은 정상 password 또는 Google 인증 뒤 bind하며 기존 credential을 변경하지 않는다.
- browser, Chat Web→Chat API, Chat API→Control Plane은 서로 다른 service credential 경계다.

API route와 cookie/session schema의 상세 계약은 `docs/tenant-chat/openapi/chat-auth.openapi.json`, `contracts.md`, `execution-contract.md`를 따른다.

## 2. 실제 통합 검증

격리된 production-like Compose project `gatelm-chat-smoke`에서 빈 PostgreSQL에 당시 24개 migration을 순서대로 적용했다. 합성 tenant/employee만 사용해 다음 흐름을 검증했다.

1. token query가 있는 초대 URL 진입
2. 즉시 `/invitations/accept` clean URL로 303 redirect
3. tenant와 신규 계정 상태 확인
4. password 초대 수락과 Employee/User/Membership atomic binding
5. GateLM Chat shell 진입
6. logout 후 기존 계정 password 로그인
7. refresh rotation과 교체 관계 저장
8. logout revoke와 sessionVersion 증가

DB readback은 초대 수락 뒤 Employee `accepted`, Membership `active`, invitation hash 제거, User binding을 확인했다. refresh 후에는 token row `3`, consumed `1`, replacement-linked `1`, tagged hash `3`이었고 원문 token은 저장되지 않았다. logout 후 합성 사용자의 session은 `2/2` revoke, 최대 sessionVersion `2`, device identifier `2/2` hash 저장이었다.

작업 중 `dev`에 Tenant Chat runtime/usage migration이 먼저 병합된 뒤 최신 base를 다시 동기화했다. 이미 auth migration과 합성 session row가 있는 DB에 pending runtime migration을 적용하는 upgrade smoke와, 빈 DB에 runtime→auth 순서로 25개 migration을 적용하는 clean smoke가 모두 통과했다.

보안 네거티브 케이스:

- public `/signup`: `404`
- Origin/CSRF 없는 auth mutation: `403`
- invitation 원문 token: redirect 후 URL, DOM, localStorage에서 부재
- Chat API: Compose 내부 `3003/tcp`만 노출하고 host port 없음
- legacy `application`: production-like Compose 서비스 목록에서 부재

## 3. 부하 스모크

실행 스크립트: `scripts/dev/tenant-chat-auth-shell-load-smoke.mjs`

| 구간 | 요청 | 오류 | p95 | p99 |
| --- | ---: | ---: | ---: | ---: |
| 사전 인증 bootstrap | 500 login | 0 | 272.72ms | 321.52ms |
| session steady | 50 RPS × 10분 = 30,000 | 0 | 51.75ms | 128.92ms |
| session burst | 100 RPS × 1분 = 6,000 | 0 | 70.37ms | 104.06ms |
| login | 10 RPS × 1분 = 600 | 0 | 115.40ms | 158.00ms |
| session 합계 | 36,000 | 0% | 56.30ms | - |

기준은 session p95 ≤500ms, login p95 ≤1.5s, error <1%이며 모두 통과했다.

컨테이너 메모리 관찰값:

| 서비스 | 시작 | 50 RPS 중간 | 종료 idle |
| --- | ---: | ---: | ---: |
| Chat Web | 58.45MiB | 168.00MiB | 65.08MiB |
| Chat API | 54.19MiB | 98.29MiB | 91.93MiB |
| Control Plane | 156.80MiB | 164.60MiB | 167.50MiB |
| PostgreSQL | 85.87MiB | 84.54MiB | 100.70MiB |

부하 구간의 서비스 로그에는 pool exhaustion, timeout, fatal, unhandled exception 패턴이 없었다. PostgreSQL 로그의 수동 진단 SQL syntax error 1건은 제품 요청과 무관한 검증 harness 오류였고 수정 후 readback을 완료했다.

## 4. 자동 검증

- `corepack pnpm run verify:v2-final`: 통과
  - 문서/secret-shaped value/whitespace 검증
  - Control Plane typecheck와 21 suites / 229 tests 통과, DB integration 2 suites / 4 tests 환경 조건으로 skip
  - Dashboard typecheck
  - Gateway `go test ./...`
- Chat API: typecheck, build, 3 suites / 9 tests 통과
- Chat Web: typecheck와 production build 통과
- shared BFF: typecheck, 4 security tests 통과
- shared UI: typecheck 통과
- Dashboard: production build, 45 unit tests 통과
- Docker: Control Plane, Chat API, Chat Web, Dashboard, legacy Application Linux image build 통과
- Compose: `config --quiet`, clean migration, health/readiness, private Chat API, Chat host routing 통과
- OpenAPI/JSON schema-fixture pairing과 `verify:v2-docs` 통과

Dashboard unit 검증 중 순수 색상 helper가 Next UI 컴포넌트 전체를 import해 Windows ESM에서 실패하는 기존 결합을 발견했다. helper를 순수 모듈로 분리한 뒤 최신 dev 포함 45개 테스트가 통과했다.

최신 `dev` 동기화 뒤 Gateway의 embedded runtime schema test가 Windows checkout의 CRLF/LF 차이를 계약 drift로 오인하는 문제를 발견했다. 의미 없는 line-ending 차이만 정규화하고 실제 schema byte drift 검사는 유지한 뒤 `go test ./...` 전체가 통과했다.

## 5. 브라우저와 UI QA

- desktop 1440×900, mobile 390×844에서 login, invitation, shell을 확인했다.
- 한국어 본문은 최소 16px, 보조 텍스트는 14px, 주요 조작 영역은 최소 44px다.
- 한국어 줄바꿈은 `word-break: keep-all`을 사용하며 작은 화면에서도 제목과 버튼 문구가 잘리지 않는다.
- keyboard focus-visible, landmark/heading/label, mobile navigation drawer와 닫기 동작을 확인했다.
- composer는 provider 연결 전 disabled 상태이며 “관리자의 모델 연결이 필요합니다”만 표시한다.
- 기존 Dashboard 직원 관리 레이아웃은 유지하고 `Chat 초대`, `Chat 초대 재발송` 의미만 확장했다.

## 6. Migration과 rollback

Migration은 authz version column, `tenant_chat_sessions`, `tenant_chat_refresh_tokens`, 관련 index/trigger를 additive하게 추가한다. Membership unique constraint는 duplicate preflight가 실패하면 migration 전체를 중단하며 기존 row를 임의 정리하지 않는다.

Rollback은 Chat Web/API와 신규 writer를 먼저 중지하고 Caddy/Dashboard CTA를 이전 배포로 되돌린다. 이미 기록된 session row와 authz version은 보존한다. destructive down migration이나 credential 복구는 수행하지 않는다.

## 7. 후속 작업

- conversation CRUD/SSE와 encrypted history
- Gateway workload JWT와 tenant RuntimeSnapshot 기반은 병합됐으며, active contract에 맞춘 ownership/검증 경계 정렬이 남아 있다.
- private completion endpoint와 provider/fallback 연결, terminal outbox, pending-unconfirmed, admission→Dashboard E2E
- Terraform/ECS 및 실제 배포 topology
- Semantic Cache
- legacy customer-demo/Application 파일 물리 삭제

자동 검증과 merge blocker 확인 뒤 이 PR을 먼저 병합한다. 사용자는 병합 commit SHA를 기준으로 desktop/mobile/auth UX를 확인하고, 그동안 후속 Gateway 계약 정렬과 integration 작업을 병렬로 진행한다.
