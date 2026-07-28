# GateLM v1.0.0 Release Target Refactoring Baseline

| Field | Value |
|---|---|
| Status | Planning baseline; not an active contract |
| Contract lifecycle | N/A |
| Document role | Refactoring planning baseline |
| Applies to | target `v1.0.0` 준비를 위한 리팩토링 순서와 검증 경계 |
| Implementation baseline | `origin/dev @ e54d35b94d0409cf4b6ceba8036735f1ee7afe6e` |
| Main cross-check | `origin/main @ 7e6eff7d2bfb315998028c4382ca671065eace49` |
| Verified at | 2026-07-27 |
| Release meaning | `Unreleased` planning이며 공식 `v1.0.0` 선언이 아님 |
| Contract effect | API/DB/Event/Metrics/Security 의미 변경 없음 |

이 문서는 리팩토링 착수 순서와 release gate를 정리한다. 새 API, DB column, event field, metric label, security-sensitive field를 승인하지 않으며, 기존 active contract를 대체하지 않는다.

## 1. 기준선 결정

현재 개발 통합 기준은 [`../source-of-truth.md`](../source-of-truth.md)에 따라 `origin/dev`다.

| Ref | Commit | 해석 |
|---|---|---|
| `origin/dev` | `e54d35b94d0409cf4b6ceba8036735f1ee7afe6e` | current 구현 조사와 DOC-01 작업 기준 |
| `origin/main` | `7e6eff7d2bfb315998028c4382ca671065eace49` | 배포·승격 참조. 검사 시 `origin/dev`보다 7개 commit 앞섬 |

2026-07-27 검사에서 `origin/dev`는 `origin/main`의 조상이었고 `origin/dev`만의 commit은 없었다. 두 tree의 차이는 저장소 루트 `README.md`였다. 따라서 기존 main 감사 결과는 historical evidence로 유지하되, 그 테스트 결과를 현재 dev 결과로 옮겨 적지 않는다.

실제 RC를 만들 때는 별도의 exact candidate SHA를 선택하고 같은 SHA에서 release gate 전체를 다시 실행한다. 이 문서의 baseline SHA는 공식 release SHA가 아니다.

원격에는 `v1.0.0-rc.1` tag/release가 없다. 이번 감사 환경에서만 관찰된 local-only `v1.0.0-rc.1`은 historical `cd41a682...` commit을 가리키므로 공유 release evidence가 아니며 push하지 않는다. 새 RC 번호와 tag는 release owner가 clean remote 상태와 exact candidate SHA를 확인한 뒤 결정한다.

## 2. DOC-01 범위

이번 문서 작업은 다음만 수행한다.

- current implementation snapshot을 최신 `origin/dev`로 재기준화
- 현재 상태를 `Unreleased`, 리팩토링 완료 목표를 `v1.0.0`으로 통일
- 기존 release-like v1/v2 폴더를 pre-v1 workstream으로 재분류
- 중립 문서 검증 명령 `verify:docs`를 canonical alias로 추가하고 기존 `verify:v2-docs`는 호환 alias로 유지
- documentation gap의 깨진 문자와 중복 ID 복원
- 코드로 해결된 gap을 근거와 함께 Resolved로 이동
- active Tenant Chat 계약에는 있으나 UI/API 구현이 없는 항목을 Open으로 등록
- 기존 기본 챗봇 종료와 public Gateway 호환성 보존 경계를 분리
- gap ID 중복과 mojibake가 다시 들어오지 않도록 문서 검증 보강

이번 작업에서 제품 코드, runtime 설정, schema, fixture와 배포 구성을 바꾸지 않는다.

## 3. 확인된 RC 결정 필요 항목

아래는 release owner가 우선순위를 승인하기 전까지 RC blocker 후보로 취급한다.

| Gap | 결정 범위 | 선행 owner |
|---|---|---|
| `DOC-001`, `DOC-002` | exact release SHA, branch와 package/image/docs 정렬 | Release |
| `DOC-004` | former v2.0 baseline의 API/DB/Event/Metrics/Security 상속 범위 | Architecture, Contract |
| `DOC-006`, `DOC-007` | fresh-host evidence와 기능별 maturity | Delivery, Product |
| `DOC-011`, `DOC-012` | Tenant Chat actor/FK tenant isolation | API, DB, Security |
| `DOC-023`, `DOC-025` | mask-once rollout과 PII production evidence | Tenant Chat, Security |
| `DOC-026` | employee notice acknowledgement 계약 이행 여부 | Product, API, DB, Security |
| `DOC-027` | Admin Content Diagnostic과 forbidden-data policy 충돌 해결 | Product, API, DB, Security |
| `DOC-028` | 기본 챗봇 종료 범위, 데이터 보존과 호환 기간 | Product, Architecture, Data |
| `DOC-029`, `DOC-030` | self-host production/local-demo 계약과 전체 secret posture | Delivery, Security |
| `DOC-031` | employee usage canonical ledger와 장애 parity | Billing, Gateway, Data |

이 표는 owner 승인을 대신하지 않는다. 각 계약 민감 변경은 별도 proposal/contract PR에서 승인받는다.

## 4. 기본 챗봇 종료 경계

사용 중단 대상은 legacy browser chat product와 그 전용 conversation surface다.

제거 후보:

- `apps/application` legacy browser UI와 전용 BFF
- legacy conversation create/update/delete UI와 API
- Tenant Chat으로 대체된 customer-demo 진입점
- 사용 종료가 확인된 legacy conversation table과 관련 데이터 보존 경로

이 목록은 확인되지 않은 legacy retention worker가 존재하거나 제거 대상이라는 뜻이 아니다. `LEG-00`에서 실제 `Conversation`·`ChatMessage` schema, API consumer와 보존 요구를 먼저 확인한다.

이번 리팩토링에서도 보존하는 호환성:

- public OpenAI-compatible `/v1` Gateway data plane
- Project/Application credential, RuntimeConfig/RuntimeSnapshot과 budget enforcement
- Project/Application Request Log, Analytics와 관리 기능
- 외부 client가 사용하는 App Token/API Key 호환 경로

`apps/application`을 삭제하는 것과 Project/Application 제품·public `/v1`을 삭제하는 것은 같은 작업이 아니다. 실제 종료는 다음 단계로 나눈다.

1. `LEG-00`: route, consumer, 데이터, 운영 사용량과 계약 영향 inventory
2. `LEG-01`: `.env` 기반 legacy bootstrap side effect 제거, 신규 UI 진입 숨김과 production 기본 비활성
3. `LEG-02`: conversation write 차단, read-only/redirect 또는 `410` 기간과 관찰
4. `LEG-03`: UI/BFF/backend module 제거
5. `LEG-04`: 승인된 retention에 따른 데이터 forward migration 또는 삭제

각 단계는 rollback, telemetry와 사용자 데이터 보존 기준을 갖는다. DOC-01에서는 기존 동작을 비활성화하거나 삭제하지 않는다.

## 5. Backend 실데이터 기능은 있으나 frontend consumer가 없는 기능

아래 항목은 `origin/dev` 코드에서 backend route와 service가 확인되지만 `apps/web`과 다른 frontend 앱에서 route consumer를 찾지 못했다. 일부는 placeholder 화면만 존재한다. 이것이 곧 UI를 만들어야 한다는 뜻은 아니다. 각 항목은 제품 노출, 운영자 전용 유지 또는 API 종료 중 하나를 owner가 결정한 뒤 구현한다.

| Surface | Backend evidence | Frontend 확인 결과 | 다음 결정 |
|---|---|---|---|
| Budget audit history | [`budget-operations.controller.ts`](../../../apps/control-plane-api/src/modules/budget-operations/budget-operations.controller.ts#L19-L24) | 실데이터 consumer가 없고 [`gateway-admin-console.tsx`](../../../apps/web/src/features/gateway-admin/components/gateway-admin-console.tsx#L126-L130)의 Audit logs는 wiring 없는 placeholder | 예산 운영 이력 UI 추가 또는 admin API 전용 유지 |
| Notification event history | [`budget-operations.controller.ts`](../../../apps/control-plane-api/src/modules/budget-operations/budget-operations.controller.ts#L27-L32) | 조회 consumer가 없고 [`gateway-admin-console.tsx`](../../../apps/web/src/features/gateway-admin/components/gateway-admin-console.tsx#L119-L124)의 Alerts는 delivery 미연결 placeholder | 알림 이력 UI 추가, 운영 도구 전용 유지 또는 route 종료 |
| Project-scoped Provider CRUD/discovery | [`provider-connections.controller.ts`](../../../apps/control-plane-api/src/modules/provider-connections/provider-connections.controller.ts#L36-L148), [`provider-connections-client.ts`](../../../apps/web/src/lib/control-plane/provider-connections-client.ts#L140-L380) | backend에는 project scope 등록·조회·삭제·탐색이 있으나 현재 web client는 tenant/application scope만 사용 | project scope 노출 필요성 확인 후 UI 추가 또는 호환 API로 명시 |

## 6. 계약에는 있으나 아직 구현되지 않은 제품 surface

### 6.1 Employee notice acknowledgement

RuntimeSnapshot과 execution binding에는 `employeeNoticeVersion`이 전달되지만, 직원별 acknowledgement state/API/UI와 admission 비교는 확인되지 않았다. active 계약의 `CHAT_POLICY_ACK_REQUIRED`를 실제로 구현할지 계약에서 후속 범위로 조정할지 먼저 결정한다. 상세는 `DOC-026`이다.

### 6.2 Admin Content Diagnostic

active Tenant Chat 계약은 step-up, allowlisted purpose, one-time decrypt grant와 append-only audit를 가진 단건 diagnostic을 MVP로 둔다. 그러나 프로젝트 forbidden-data policy는 raw prompt/response의 API response와 UI 평문 노출을 금지한다. 현재 app code에도 해당 route, grant/audit 저장과 UI가 없다. 기능 제외 또는 명시적인 security exception을 먼저 결정하고, 구현을 선택하면 Full Content Logging retention까지 포함한 계약 PR과 구현 PR을 분리한다. 상세는 `DOC-027`이다.

## 7. 작업 순서

1. `DOC-01`: current baseline, target `v1.0.0`, pre-v1 registry와 gap register를 고정한다.
2. `PVR-00`: release 이름이 붙은 fixture/evidence 경로의 실행 의존성을 분리하고, 기능별 계약 승격·archive 이동 계획을 승인한다.
3. `SEC-00`: self-host production/local-demo topology, ingress/egress, Mock 허용 범위를 먼저 계약화한다.
4. `SEC-01`/`SEC-02`: network와 모든 인증·암호화·HMAC·DB secret의 production fail-fast를 구현한다.
5. `BILL-00`/`LEDGER-00`: employee usage canonical source, replay/rebuild와 장애 parity를 먼저 계약화하고, `BILL-01`/`LEDGER-01`에서 구현·검증한다.
6. `AUTH-00`에서 signup, login, verification, password reset, invitation acceptance의 abuse guard 계약을 승인하고, `AUTH-01`에서 구현·검증한다.
7. false-success와 production fixture fallback을 제거한다.
8. Tenant Chat acknowledgement와 Content Diagnostic은 contract와 implementation PR을 분리해 승인 순서대로 진행한다.
9. `LEG-00` inventory 후 기본 챗봇 종료를 단계적으로 진행한다.
10. readiness, migration manifest, alert/restore evidence를 보완한다.
11. exact RC SHA에서 전체 release gate를 실행한다.

contract-sensitive PR은 승인된 contract/schema/fixture가 먼저다. behavior-preserving module 분해는 관련 characterization test를 먼저 고정한다.

## 8. v1.0.0 릴리스 선언 조건

다음 조건을 모두 충족하기 전에는 `v1.0.0`, GA 또는 production-ready라고 선언하지 않는다.

- exact RC SHA와 release branch가 승인됨
- RC blocker로 승인된 Open decision이 모두 해결되거나 명시적으로 제외됨
- legacy Application Chat 종료 경계와 public `/v1` 보존 범위가 승인됨
- clean install, build, typecheck, unit/integration/browser E2E와 fresh migration 통과
- fresh-host, upgrade/rollback, backup/restore와 dependency failure evidence 확보
- security scan과 실제 staging Provider/RAG 검증 통과
- tag, package, image와 docs version 정렬
- 결과 문서에 source commit, 환경, 명령, 실패·제외 범위가 함께 기록됨

DOC-01의 문서 검증 통과는 위 release gate 전체 통과를 뜻하지 않는다.

## 9. 변경 규칙

- 이 proposal을 active contract처럼 인용하지 않는다.
- 기존 main 감사 결과와 새 dev 검증 결과를 섞지 않는다.
- 코드가 있다는 이유만으로 release 완료 또는 GA를 선언하지 않는다.
- legacy chat 제거를 public `/v1` 또는 Project/Application core 제거로 확대하지 않는다.
- 원문, secret, credential, 내부 storage 위치와 로컬 사용자 경로를 evidence에 기록하지 않는다.
