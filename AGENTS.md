# GateLM Agent Guide

GateLM 구현 작업을 시작할 때는 먼저 `docs/README.md`를 읽는다.

`docs/README.md`는 에이전트용 구현 기준 문서이며, 현재 구현 목표, 문서 우선순위, 필수 참고 문서 순서, 작업 판단 기준을 정의한다.

현재 구현 기준은 **v1.0.0 baseline**이다.

코드 변경 전에는 작업 범위에 맞는 세부 문서를 함께 확인한다.

* v1 계획은 `docs/v1.0.0/implementation-plan.md`를 따른다.
* v1 계약은 `docs/v1.0.0/contracts.md`를 따른다.
* API 작업은 `docs/architecture/api-spec.md`를 참고하되, 충돌하면 v1 계약을 우선한다.
* DB 작업은 `docs/architecture/db-schema.md`를 참고하되, 충돌하면 v1 계약을 우선한다.
* Gateway 요청 흐름은 `docs/architecture/gateway-flow.md`를 참고하되, 충돌하면 v1 계약을 우선한다.
* 로그와 이벤트 작업은 `docs/architecture/llm-log-schema.md`를 참고하되, 충돌하면 v1 계약을 우선한다.
* 민감정보 처리는 `docs/policies/pii-masking-policy.md`와 v1 safety 계약을 함께 따른다.
* 코드 스타일과 AI 작업 규칙은 `docs/policies/coding-convention.md`, `docs/policies/ai-coding-rules.md`를 따른다.

이전 P0 문서는 `docs/archive/p0/*`에 보관된 과거 구현 기록이다. 새 v1.0.0 작업의 우선 계약으로 사용하지 않는다.

v1.0.0 구현에서는 B2B LLM Gateway baseline 완성이 최우선이다.

다음 흐름이 깨지면 안 된다.

```text
Admin onboarding
-> Project / Application / Provider / API Key / App Token
-> Customer Demo App Gateway request
-> API Key / App Token authentication
-> Tenant / Project / Application context
-> applicationId PostgreSQL-backed Rate Limit
-> Sensitive data redaction or block
-> Exact Cache
-> Simple Routing
-> Provider call
-> Usage Log
-> Request Log / Detail
-> Dashboard Overview / Metrics
-> k6 baseline
```

모든 코드는 v1.0.0 baseline이라도 확장 가능하게 작성한다.

* Provider와 Model을 enum으로 고정하지 않는다.
* Provider별 로직은 Provider Adapter 안에 둔다.
* Gateway handler에 provider별 조건문을 흩뿌리지 않는다.
* Gateway pipeline은 stage 단위로 추가/교체 가능하게 둔다.
* Sensitive Data Detector는 registry 구조로 추가 가능하게 둔다.
* Cache, Routing, Rate Limit, Secret 조회는 interface를 통해 분리한다.
* 정책 판단은 하드코딩하지 않고 config/policy object를 통해 처리한다.
* 확장성을 이유로 v1.0.0 범위를 넘는 기능을 임의로 구현하지 않는다.

명시적 지시 없이 아래 작업은 하지 않는다.

* 문서에 없는 API 생성
* 문서에 없는 DB table/column 생성
* 문서에 없는 Event field 추가
* raw prompt 저장
* raw response 저장
* Provider Key 평문 저장
* API Key/App Token 평문 저장
* Authorization header 로그 출력
* Web Console에서 Provider 직접 호출
* Control Plane에서 사용자 LLM 요청을 Provider로 proxy
* Worker에서 Provider 요청 재실행
* cache key에 raw prompt 사용
* masking stage를 cache 뒤로 이동
* 실제 secret이나 개인정보를 seed/test/snapshot에 사용

코드 변경 전에는 먼저 작업 계획을 제시한다.

```text
목표:
수정 예정 파일:
새로 생성할 파일:
참조 문서:
API 변경 여부:
DB 변경 여부:
Event 변경 여부:
보안 영향:
테스트 계획:
완료 기준:
```
