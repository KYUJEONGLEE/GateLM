# Hyeok Decisions - GateLM v2.0.0

> 재혁님이 토론 중 확정한 v2.0.0 핵심 결정 초안입니다.
> 이 문서는 `docs/team-debate`의 working draft이며, 최종 합의 전 API, DB, Event, Metrics, security-sensitive field를 공식 확정하지 않습니다.
> 합의된 내용만 이후 `docs/v2.0.0/contracts.md` 또는 `docs/v2.0.0/implementation-plan.md`로 승격합니다.

## 1. Identity와 비용 귀속

### 결정

`tenantId`는 고객사 또는 회사를 의미합니다.

부서 단위 표현은 `teamId`가 아니라 `departmentId`로 고정합니다.

```text
tenantId = 고객사/회사
departmentId = 비용 책임 부서
projectId = 프로젝트
applicationId = 앱
userId = 실제 사용자
apiKeyId = Gateway API Key 식별자
```

### 이유

`team`은 회사마다 의미가 흔들릴 수 있습니다. 어떤 회사에서는 부서보다 작은 단위이고, 어떤 회사에서는 TF 또는 프로젝트 팀을 뜻할 수 있습니다.

반면 `department`는 부서장 승인, API Key 발급, 예산 관리, 비용 책임과 더 잘 맞습니다.

## 2. Budget Scope

### 결정

`budgetScope`는 사용합니다.

다만 자연어 질문 내용을 보고 비용 귀속 대상을 추론하지 않습니다. `budgetScope`는 사용자가 무엇을 물었는지가 아니라, 이번 요청 비용을 어디에 청구할 것인지 나타내는 명시적 실행 맥락입니다.

```text
budgetScopeType = department | project | application
budgetScopeId = departmentId | projectId | applicationId
```

기본값은 부서 기준입니다.

```text
default budgetScopeType = department
default budgetScopeId = departmentId
```

프로젝트 단위 비용 청구가 필요한 요청에서는 명시적으로 project scope를 사용합니다.

```text
budgetScopeType = project
budgetScopeId = projectId
```

### 처리 원칙

요청에 `budgetScope`가 명시되면 Gateway는 해당 scope가 API Key의 허용 범위 안에 있는지 검사합니다.

요청에 `budgetScope`가 없으면 API Key의 기본 budget scope를 사용합니다.

허용되지 않은 budget scope가 들어오면 차단합니다.

## 3. Gateway API Key와 Budget Scope 관계

### 결정

Gateway API Key 발급을 project 생성 시점에만 묶지 않습니다.

API Key는 호출 권한이고, budget scope는 비용 귀속 단위입니다. 둘은 연결되지만 같은 개념은 아닙니다.

```text
API Key = 누가 GateLM을 호출할 수 있는가
budgetScope = 이번 요청 비용을 어디에 청구할 것인가
```

### API Key 후보 구조

```text
apiKeyId
tenantId
ownerType = department | project | application
ownerId
defaultBudgetScopeType
defaultBudgetScopeId
allowedBudgetScopes
```

### 처리 규칙

```text
1. API Key가 유효한지 확인한다.
2. 요청에 budgetScope가 있는지 확인한다.
3. budgetScope가 있으면 allowedBudgetScopes 안에 있는지 확인한다.
4. budgetScope가 없으면 defaultBudgetScope를 사용한다.
5. 허용되지 않은 budgetScope면 차단한다.
```

## 4. Runtime 정책 추적

### 결정

요청 로그에는 해당 응답이 몇 버전의 정책으로 처리됐는지와 runtime 상태를 남깁니다.

```text
policyVersion
runtimeState
```

### runtimeState 후보

```text
active
last_known_safe
publish_failed
reload_failed
stale
```

### 이유

Request Detail에서 "이 요청은 어떤 정책 상태로 처리됐는가?"를 설명할 수 있어야 합니다.

## 5. 정책 배포와 Reload 실패 처리

### 결정

정책 배포 또는 reload가 실패하면 새 정책을 적용하지 않고 이전 정상 버전을 사용합니다.

```text
publish 실패 -> 이전 정상 정책 유지
reload 실패 -> 이전 정상 정책 유지
기본 원칙 -> last known safe 사용
```

### 이유

잘못된 정책 때문에 Gateway runtime이 위험한 상태로 바뀌면 안 됩니다.

## 6. 요청 결과 구조

### 결정

요청의 최종 결과와 기능별 세부 결과를 분리합니다.

```text
terminalStatus
safetyOutcome
cacheOutcome
routingOutcome
providerOutcome
budgetOutcome
streamingOutcome
```

### 예시

```text
terminalStatus = success
safetyOutcome = redacted
cacheOutcome = miss
routingOutcome = selected_primary
providerOutcome = openai_success
budgetOutcome = within_limit
streamingOutcome = completed
```

### 이유

"요청은 성공했지만 cache는 miss였고, safety는 redaction 됐고, provider는 fallback으로 처리됐다"처럼 설명할 수 있어야 합니다.

## 7. Provider와 Mock Fallback 표현

### 결정

실제 Provider 호출과 Mock fallback을 구분합니다.

```text
providerOutcome
fallbackOutcome
providerName
modelName
fallbackReason
```

### 예시

```text
providerOutcome = failed_timeout
fallbackOutcome = mock_success
providerName = openai
modelName = gpt-4o-mini
fallbackReason = provider_timeout
```

### 이유

응답이 성공했더라도 실제 Provider 호출이 성공한 것인지, Mock fallback으로 성공한 것인지 구분해야 합니다.

## 8. Dashboard 집계 기준

### 결정

기본 집계 단위는 1시간입니다.

```text
기본 grain = 1시간 단위
기본 freshness = 수동 새로고침 또는 30초~1분 polling
비용/사용량 화면 = 1시간 단위 집계
데모 화면 = 예외적으로 5초~10초 polling
```

### 화면별 기준

| 화면 | grain | freshness |
| -- | -- | -- |
| Dashboard Overview | 1시간 | 수동 새로고침 또는 30초~1분 |
| Cost / Usage | 1시간 | 수동 새로고침 중심 |
| Request Log | 요청 단위 | 수동 또는 낮은 빈도 polling |
| Demo 화면 | 짧은 단위 | 5초~10초 polling |

### 이유

운영 화면은 DB 부담을 줄이고, 데모 화면만 빠르게 움직이게 합니다.

## 9. Streaming 범위

### 결정

v2.0.0에서 Streaming은 복잡하게 만들지 않습니다.

목표는 사용자의 체감 속도가 빨라지는 것입니다.

```text
응답이 조금씩 오는 느낌 제공
최종 성공/실패 상태만 안정적으로 기록
복잡한 streaming lifecycle 분석은 v2.x로 미룸
```

### 하지 않을 것

- token별 상세 logging을 v2.0.0 필수로 넣지 않습니다.
- response-side safety scan을 v2.0.0 main path로 넣지 않습니다.
- streaming provider별 normalization을 v2.0.0에서 완성하려고 하지 않습니다.

## 10. Raw Prompt / Response 저장

### 결정

원문 저장은 하지 않습니다.

```text
raw prompt 저장 안 함
raw response 저장 안 함
API Key 저장 안 함
Provider Key 저장 안 함
Authorization header 저장 안 함
실제 secret 저장 안 함
```

### 저장 가능한 정보 후보

```text
redacted summary
token count
cost
latency
outcome
policyVersion
runtimeState
providerName
modelName
fallbackReason
```

## 11. v2.0.0 한 줄 결정

GateLM v2.0.0은 고객사와 부서, 프로젝트, 앱, 사용자를 분리해서 기록하고, 비용은 명시적 budget scope에 귀속시키며, 각 요청이 어떤 정책/runtime/provider/fallback/outcome으로 처리됐는지 원문 없이 설명할 수 있는 Gateway로 정리합니다.
