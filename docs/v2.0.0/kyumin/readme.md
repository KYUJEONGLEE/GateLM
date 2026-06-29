# GateLM v2.0.0 Contract Prep - Kyumin

## 1. 내 역할의 v2 main path

김규민 역할은 Product Experience & Demo 관점에서 v2.0.0이 "조직 기반 LLMOps Gateway MVP"로 보이게 만드는 것이다.

- Web Console에서 Admin, Developer, Employee surface를 분리해서 보여준다.
- Employee Chat은 별도 예외 경로가 아니라 Application boundary 안의 고객사 앱으로 표현한다.
- Request Log / Detail / Dashboard가 같은 requestId, applicationId, budget scope, RuntimeSnapshot provenance를 일관되게 보여주게 한다.
- Dashboard는 "실시간처럼 보이는 숫자"가 아니라 freshness와 query budget을 가진 운영 화면으로 만든다.
- Demo는 자유 입력 중심이 아니라 preset scenario runner 중심으로 반복 가능한 evidence를 만든다.
- Streaming thin slice가 붙더라도 UI는 final status와 domain outcome을 우선 표시하고 token별 상세 timeline은 v2.0.0 core에 넣지 않는다.

## 2. 내가 다른 역할에게 받아야 하는 계약

### 재혁님 / Control Plane

- Application catalog read model 후보
  - applicationId
  - projectId
  - displayName
  - status
  - allowed employee entry 여부
- RuntimeSnapshot provenance read model 후보
  - runtimeSnapshotId
  - runtimeSnapshotVersion
  - contentHash 또는 configHash 계열
  - publishedAt
  - publishedBy
  - runtimeState
- budget scope resolution 결과
  - budgetScopeType 후보: application, project, team
  - budgetScopeId
  - displayName
  - resolvedBy 후보: RuntimeSnapshot, Control Plane rule
- publish/reload 상태
  - validation failed
  - publish failed
  - reload failed
  - last known safe used
  - stale snapshot used

### 지섭 / Gateway

- Customer/Employee Chat이 호출할 Gateway-facing contract
  - Browser direct인지 Web BFF/server-side인지 결정 필요
  - 어떤 방식이든 raw App Token은 브라우저에 노출하지 않아야 한다.
- response metadata
  - requestId
  - terminalStatus 후보
  - domain outcome 후보
  - selectedProvider
  - selectedModel
  - routingReason
  - cache outcome
  - fallback outcome
  - streaming final state
- Request Detail에 필요한 sanitized provider/error metadata
  - raw provider error body는 금지

### 윤지 / Safety

- UI 노출 가능한 safety summary 수준
  - Employee에게 보일 문구
  - Developer에게 보일 detector category summary
  - Admin에게 보일 policy provenance
- redactedPromptPreview 허용 범위
- detector type label의 UI 표시명 후보
- response-side safety는 v2.0.0 core가 아니라는 명확한 문구

### 규정 / Observability

- Dashboard API/read model 후보
  - aggregate grain
  - freshness metadata
  - query budget metadata
  - stale 여부
  - requestId drilldown 가능 여부
- Request Log list/detail read model
  - terminalStatus와 domain outcome group을 추론하지 않고 그대로 보여줄 수 있어야 한다.
- Dashboard query 실패 또는 budget 초과 시 UI가 표시할 상태
  - too broad
  - stale
  - partial
  - unavailable

## 3. 내가 다른 역할에게 제공해야 하는 계약

- Employee Chat UX boundary
  - Employee UI는 응답, requestId, 간단한 상태만 보여준다.
  - Admin/Developer UI는 routing, cache, safety, provider, latency, cost, policy provenance를 보여준다.
- Web Console navigation/read model 요구
  - Dashboard
  - Management
  - Analytics
  - Settings
  - Employee Chat 또는 Demo App surface는 Application으로 귀속된다.
- Request Detail 표시 구조 후보
  - Identity
  - Application
  - Budget scope
  - RuntimeSnapshot provenance
  - Terminal status
  - Domain outcomes
  - Usage/cost/latency
  - Safety/cache/routing/provider/fallback
- Dashboard 화면별 freshness 기대치
  - Demo Dashboard: 짧은 polling 또는 수동 refresh
  - Operation Overview: manual refresh 기본, 필요한 곳만 30~60초 polling
  - Analytics/Drilldown: manual refresh, 시간 범위 제한, query budget 표시
- Demo scenario runner 요구
  - safe
  - exact cache hit
  - redaction
  - block
  - rate limit
  - provider timeout
  - provider error + mock fallback
  - streaming thin slice

## 4. 내가 막히는 dependency

- Employee Chat의 Gateway 호출 방식이 정해지지 않으면 App Token 보관 위치와 UI/BFF 책임을 확정할 수 없다.
- RuntimeSnapshot provenance 최소 세트가 없으면 Request Detail의 정책 적용 근거 화면을 만들 수 없다.
- budgetScopeType/budgetScopeId의 resolver owner가 없으면 Dashboard와 Request Detail에서 비용 귀속을 설명할 수 없다.
- terminalStatus/domain outcome 계약이 없으면 Dashboard status 집계와 Request Detail 단계 표시가 흔들린다.
- Dashboard freshness/query budget read model이 없으면 운영 화면에서 stale/partial/unavailable 상태를 정확히 표현할 수 없다.
- 실제 Provider + Mock fallback outcome 구분이 없으면 Demo에서 "성공했지만 fallback으로 성공"을 설명할 수 없다.

## 5. 내가 늦어지면 막히는 다른 역할

- 규정님은 Dashboard/Request Detail UI 요구가 늦으면 read model 우선순위와 aggregation grain을 확정하기 어렵다.
- 지섭은 Demo App/Employee Chat의 호출 방식이 늦으면 Gateway response metadata와 BFF 경계를 조정하기 어렵다.
- 재혁님은 RuntimeSnapshot publish 상태를 UI에서 어떻게 보여줄지 늦으면 Admin publish/reload 상태 모델의 UX 기준이 약해진다.
- 윤지는 Safety 노출 수준이 늦으면 detector/provenance를 어느 audience까지 공개할지 확정하기 어렵다.

## 6. 계약 확정 전에도 병렬로 할 수 있는 shadow/evidence 작업

- Fixture 기반 Employee Chat mock surface
  - Provider 직접 호출 없이 Gateway client interface만 둔다.
  - raw prompt/raw response 저장 없이 redacted preview 후보만 표시한다.
- Dashboard freshness UI prototype
  - lastIngestedAt, lastAggregatedAt, source, isStale 후보를 fixture로 표시한다.
- Request Detail domain outcome prototype
  - terminalStatus와 domain outcome을 분리해서 보여주는 UI skeleton.
- Demo scenario runner prototype
  - preset 기반 실행 순서, presenter controls, emergency stop 위치를 UI로 검증한다.
- Query budget UX evidence
  - too broad, partial, stale, unavailable 상태의 빈 화면/안내 상태를 만든다.

## 7. P0로 먼저 확정해야 하는 항목

프론트 관점의 P0는 아래 순서다.

1. Employee Chat의 Gateway 호출 방식
   - browser direct
   - Web BFF/server-side
   - raw App Token을 브라우저에 둘 수 없으므로 BFF/server-side를 우선 추천한다.
2. Employee Chat을 Application 중 하나로 보는지 여부
   - 추천: Application boundary 안에 둔다.
   - 내부 직원 요청도 Request Log, Detail, Dashboard에 포함한다.
3. Dashboard freshness/query budget 최소 read model
   - lastIngestedAt
   - lastAggregatedAt
   - source
   - isStale
   - queryBudgetState 후보
4. Demo 입력 방식
   - 추천: preset scenario runner 중심
   - 제한 자유 입력은 sandbox mode 후보로만 둔다.
5. Request Detail의 RuntimeSnapshot provenance 최소 세트
   - full snapshot 복사 금지
   - id/version/hash/state 계열 provenance만 표시

## 8. 아직 공식 API/DB/Event/Metrics/Schema 필드로 확정하면 안 되는 후보 용어

아래는 UI/read model 후보로만 사용해야 한다.

- `queryBudgetState`
- `freshnessState`
- `isStale`
- `lastAggregatedAt`
- `lastIngestedAt`
- `runtimeState`
- `lastKnownSafeUsed`
- `staleSnapshotUsed`
- `domainOutcome`
- `safetyOutcome`
- `cacheOutcome`
- `providerOutcome`
- `fallbackOutcome`
- `streamingOutcome`
- `demoScenarioId`
- `scenarioRunner`
- `sandboxMode`
- `employeeChatApplication`
- `budgetScopeDisplayName`

이 용어들은 화면 논의를 위한 후보이며, 공식 API/DB/Event/Metrics/Schema 필드는 `docs/v2.0.0/contracts.md`에서만 확정해야 한다.

## 9. 첫 구현 PR로 쪼갤 수 있는 단위

### PR 1. Employee Chat Boundary Skeleton

- Employee Chat을 Application boundary 안의 surface로 표현한다.
- Gateway client interface만 만들고 Provider 직접 호출은 금지한다.
- BFF/server-side 호출 방식이 확정되기 전에는 fixture/mock client로 둔다.

### PR 2. RuntimeSnapshot Provenance in Request Detail

- Request Detail에 RuntimeSnapshot provenance 영역을 추가한다.
- 우선 fixture/read model 후보로 id/version/hash/state만 표시한다.
- full snapshot 내용은 보여주지 않는다.

### PR 3. Dashboard Freshness And Query Budget UI

- Dashboard 상단에 freshness 상태를 표시한다.
- query budget 초과/partial/stale/unavailable 상태를 UI로 분리한다.
- 실제 aggregate API가 없어도 fixture로 검증한다.

### PR 4. Demo Scenario Runner

- preset 기반 presenter control을 만든다.
- safe/cache/redaction/block/rate limit/provider timeout/fallback/streaming thin slice를 순서대로 실행할 수 있게 한다.
- 청중 자유 입력은 v2.0.0 core demo에서 제외한다.

### PR 5. Domain Outcome Detail Skeleton

- terminalStatus와 domain outcome group을 Request Detail에서 분리 표시한다.
- Gateway/Observability 계약이 확정되면 실제 read model로 교체한다.

## 프론트 최종 입장

- Employee Chat은 Application 중 하나로 봐야 한다.
- raw App Token을 브라우저에 두지 않는 BFF/server-side 호출 방식을 우선 추천한다.
- Dashboard는 숫자보다 freshness/query budget을 숨기지 않는 것이 중요하다.
- Demo는 preset scenario runner 중심이어야 한다.
- 자유 입력은 v2.0.0 core demo가 아니라 제한된 sandbox 후보로만 둔다.
- UI는 후보 용어를 쓸 수 있지만, 공식 필드처럼 문서화하면 안 된다.

## 다른 역할 문서 반영

### 지섭 / Gateway 문서 반영

- Gateway 쪽에서도 Employee Chat 호출 경계를 blocking dependency로 보고 있으므로, 프론트는 browser direct보다 Web BFF/server-side 방식을 우선안으로 더 명확히 밀어야 한다.
- Actual Provider path와 Mock fallback path는 UI에서 반드시 구분되어야 한다.
  - 사용자 관점 최종 성공 여부
  - primary provider outcome
  - fallback outcome
  - selectedProvider/selectedModel
  - degraded path 여부
- Gateway가 `not_called`, `not_checked`, `not_used` 계열을 명시하려는 방향은 Request Detail UX에 유리하다. UI는 미실행 stage를 빈 값으로 숨기지 말고 "not run" 계열 상태로 보여주는 것이 맞다.
- 지섭 문서의 첫 구현 순서 중 `Actual Provider adapter -> RuntimeSnapshot live thin slice`는 프론트 PR 순서와 맞물린다. 프론트는 그 전에 fixture 기반 Request Detail/Scenario Runner skeleton을 만들어 대기할 수 있다.

### 재혁 / Control Plane 문서 반영

- Control Plane도 Request Detail에서 필요한 provenance 최소 세트를 우리에게 요구하고 있다. 프론트는 full snapshot 표시가 아니라 "추적 가능한 최소 provenance"를 요구해야 한다.
- active snapshot lookup key가 `tenant/project/application` 기준인지, budget scope까지 포함하는지는 UI에도 중요하다.
  - Request Detail에서 "이 요청에 어떤 snapshot이 적용됐는가"를 설명하려면 lookup 기준을 숨기면 안 된다.
  - 다만 UI는 공식 key 필드명을 먼저 확정하지 않고, "snapshot resolution basis" 수준의 read model 후보로만 다뤄야 한다.
- validation failed, publish failed, reload failed, last known safe는 Admin/Developer 화면에서는 분리해서 보여줘야 한다. Employee UI에는 내부 publish 상태를 노출하지 않는다.

### 윤지 / Safety 문서 반영

- 윤지 문서와 동일하게 request-side safety는 provider/cache/streaming start 전에 끝나야 한다. Demo Scenario Runner도 이 순서를 깨지 않는 preset만 제공해야 한다.
- Employee UI는 detector type이나 redacted preview를 직접 보여주지 않는다. "보안 정책에 따라 수정/차단됨" 수준으로 제한한다.
- Developer/Admin UI는 detector category summary, masking action, detected count, policy provenance 정도만 표시한다.
- Semantic Cache evidence는 core Dashboard cache hit/cost saving과 섞지 않는다. UI에서도 "Semantic Cache Candidate"를 실제 cache hit처럼 보이게 하면 안 된다.

### 규정 / Observability 문서 반영

- 규정 문서와 동일하게 Dashboard는 무제한 ad-hoc analytics가 아니라 정해진 운영 grain과 query budget을 가진 화면이어야 한다.
- 프론트는 Dashboard에서 query budget 초과를 일반 오류처럼 보이면 안 된다.
  - 필터 범위 축소 요청
  - rollup grain 변경 안내
  - stale/partial/unavailable 상태 분리
- Request Detail은 Observability가 저장한 terminal/domain outcome을 추론 없이 표시해야 한다. UI가 status 의미를 새로 계산하면 안 된다.
- Dashboard 화면은 exact cache, safety, fallback, budget scope를 분리해서 보여줘야 한다. Semantic Cache evidence는 별도 evidence 화면이나 실험 섹션으로만 둔다.
- `savedCostMicroUsd`, latency 계열, freshness 계열은 UI에서 필요하지만 공식 필드명 확정 전까지 read model 후보로만 다룬다.
- 정책 결과와 시스템 실패는 Dashboard에서 분리해야 한다. safety block, budget block, rate limit은 제품 실패처럼 보이면 안 되고, provider timeout/internal error와 다른 시각적 그룹으로 보여야 한다.
- latency도 Gateway internal latency와 Provider latency를 구분해서 보여줘야 한다. fallback success나 cache hit에서는 provider latency 해석이 달라지므로 단일 "latency" 숫자만 강조하면 운영자가 오해할 수 있다.
- `last_known_safe`는 snapshot 자체 상태가 아니라 Gateway runtime 상태 후보로 보는 방향에 동의한다. UI는 "사용된 snapshot provenance"와 "Gateway runtime state"를 분리해서 보여주는 편이 안전하다.
