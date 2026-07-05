# GateLM AI Coding Rules

> v1.0.0 범위 안내: 이 문서는 AI 작업 규칙과 장기 안전 기준을 포함한다. 현재 구현 범위는 `docs/archive/v1.0.0/contracts.md`와 `docs/archive/v1.0.0/implementation-plan.md`를 우선한다. 이 문서의 `P0`, `MVP`, `1차 구현`, `P1/P2` 표현이 v1.0.0 문서와 충돌하면 v1.0.0 문서를 우선한다.

## 문서 목적

이 문서는 Cursor, Codex, ChatGPT 같은 AI 코딩 도구가 GateLM 코드를 작성하거나 수정할 때 반드시 따라야 하는 작업 규칙이다.

GateLM은 단순 Chat UI가 아니라 **확장 가능한 LLM Gateway 플랫폼**이다. AI는 빠른 구현을 이유로 기존 구조를 무너뜨리거나, 임의의 API/DB/Event/폴더를 만들거나, 보안·정책·로그 기준을 우회하면 안 된다.

이 문서는 코드 스타일 문서가 아니다. 코드 스타일은 `coding-convention.md`를 따른다. 이 문서는 **AI가 어떤 순서와 제한 안에서 작업해야 하는지**를 정의한다.

---

# 0. 최상위 원칙

## 0.1 확장 가능성은 항상 기본값이다

모든 AI 작업은 아래 전제를 따른다.

- MVP 구현이라도 나중에 Provider, Model, Policy, Tenant, Project, Application, Analytics, SDK, 배포 방식이 늘어날 수 있게 만든다.
- Provider와 Model은 DB enum, TypeScript union, Go const 목록으로 닫아버리지 않는다.
- 정책 적용 대상은 `tenant`, `project`, `user`, `application`, `api_key`, `app_token`, 향후 `group`, `department`까지 확장될 수 있어야 한다.
- Gateway pipeline은 stage를 추가할 수 있게 유지한다.
- 새 요구사항을 임시 분기문으로 처리하지 않는다.
- 기능이 커질 가능성이 있으면 interface, adapter, strategy, registry, schema 기반 구조를 우선 검토한다.

금지 예시:

```ts
if (provider === 'openai') {
  // 모든 provider 로직을 여기에 몰아넣음
}
```

허용 예시:

```ts
const adapter = providerRegistry.get(provider);
return adapter.createChatCompletion(request);
```

## 0.2 문서와 계약이 코드보다 먼저다

AI는 다음 변경을 할 때 먼저 관련 문서를 확인하고, 필요한 경우 문서를 먼저 수정해야 한다.

| 변경 유형 | 먼저 확인할 문서 |
|---|---|
| 새 API 추가/수정 | `api-spec.md` |
| DB schema 변경 | `db-schema.md` |
| 폴더/모듈 위치 변경 | `folder-structure.md` |
| 코드 스타일/응답/예외 처리 | `coding-convention.md` |
| Gateway 흐름 변경 | `architecture.md`, `gateway-flow.md` |
| 민감정보 탐지/마스킹/차단 변경 | `pii-masking-policy.md`, `gateway-flow.md`, `llm-log-schema.md` |
| 로그/대시보드 masking field 변경 | `llm-log-schema.md`, `dashboard-metrics.md` |
| 기능 범위 판단 | `project-overview.md`, `master-spec.md` |
| Event payload 변경 | `packages/contracts/events`, `llm-log-schema.md`, 필요 시 `event-schema.md` |
| Policy schema 변경 | `packages/contracts/policies`, 필요 시 `policy-spec.md`, `pii-masking-policy.md` |

문서에 없는 API, Event, DB 구조를 임의로 만들지 않는다.

## 0.3 기존 구조를 바꾸지 않는다

AI는 사용자가 명시적으로 요청하지 않는 한 아래 작업을 하지 않는다.

- 폴더 구조 재배치
- 모듈 이름 변경
- 공통 계층 신설
- 기존 API path 변경
- 기존 DB table/column 이름 변경
- 기존 response format 변경
- 기존 인증/인가 흐름 변경
- Gateway pipeline 순서 변경
- Provider 호출 경로 변경

구조 변경이 필요하다고 판단되면 먼저 이유, 영향 범위, 대안을 설명한다. 바로 코드를 수정하지 않는다.

## 0.4 민감정보 작업은 별도 리뷰 대상이다

AI가 PII detector, masking action, raw prompt 저장, Provider request payload, Authorization header 처리, API Key/Provider Key handling을 수정하는 경우 반드시 `pii-masking-policy.md`를 먼저 확인한다.

아래 변경은 즉시 구현하지 않고 계획과 위험을 먼저 설명한다.

- raw prompt/raw response 저장
- Provider 호출 전 masking 생략
- API Key/JWT/private key block 완화
- 주민등록번호 부분 마스킹 허용
- masking event sample 저장
- Authorization header logging

## 0.5 한 번에 너무 큰 변경을 하지 않는다

AI는 하나의 작업에서 하나의 목적만 처리한다.

좋은 작업 단위:

```text
- Project 생성 API 구현
- App Token 발급 Service 구현
- Request Log Detail 조회 API 구현
- Gateway exact cache stage 추가
```

나쁜 작업 단위:

```text
- 인증, 프로젝트, 정책, 대시보드, Gateway, Worker를 한 번에 구현
- 전체 폴더 구조 재정리
- API 명세와 DB schema와 UI를 동시에 대규모 변경
```

큰 기능은 반드시 작은 패치로 나눈다.

---

# 1. AI 작업 시작 전 규칙

## 1.1 코드 작성 전 반드시 계획을 제시한다

AI는 코드를 작성하거나 파일을 수정하기 전에 먼저 계획을 제시해야 한다.

계획에는 아래 항목을 포함한다.

```text
1. 작업 목표
2. 수정할 파일 목록
3. 새로 만들 파일 목록
4. 참조할 문서
5. DB/API/Event/Policy 변경 여부
6. 보안 영향 여부
7. 테스트 계획
8. 확장성 고려사항
```

계획 없이 바로 코드를 작성하지 않는다.

## 1.2 계획 템플릿

AI는 작업 전 아래 형식을 사용한다.

```text
작업 계획

목표:
- ...

수정 예정 파일:
- ...

새로 생성할 파일:
- ...

참조 문서:
- `project-overview.md`
- `architecture.md`
- `gateway-flow.md`
- `pii-masking-policy.md` 보안/마스킹 관련 작업 시
- `llm-log-schema.md` 로그/이벤트 관련 작업 시
- `db-schema.md`
- `api-spec.md`
- `folder-structure.md`
- `coding-convention.md`

계약 변경 여부:
- API: 없음 / 있음
- DB: 없음 / 있음
- Event: 없음 / 있음
- Policy: 없음 / 있음

보안 영향:
- 없음 / 있음

확장성 고려:
- ...

테스트:
- ...
```

## 1.3 불확실하면 먼저 확인한다

아래 상황에서는 코드를 만들지 말고 먼저 확인한다.

- 요구사항이 문서와 충돌한다.
- 어느 모듈에 넣어야 할지 확실하지 않다.
- API path가 문서에 없다.
- DB table이나 column이 문서에 없다.
- 인증/인가 범위가 불명확하다.
- 원문 Prompt/Response 저장 여부가 불명확하다.
- 민감정보 detector/action/storage 기준이 불명확하다.
- Provider Key, API Key, App Token 처리 방식이 불명확하다.
- 보안 정책 우회가 필요해 보인다.

단, 사용자가 명시적으로 “일단 합리적으로 진행”을 요청한 경우에는 가장 보수적인 방향으로 진행하고, 가정한 내용을 결과에 명시한다.

---

# 2. 파일 수정 규칙

## 2.1 기존 파일을 먼저 찾는다

AI는 새 파일을 만들기 전에 반드시 기존 위치를 찾는다.

우선순위:

```text
1. folder-structure.md에서 위치 확인
2. 기존 유사 기능 파일 검색
3. 같은 domain module 내부 확인
4. contracts/docs 반영 여부 확인
5. 새 파일 생성
```

## 2.2 임의 폴더 생성 금지

아래 폴더명은 만들지 않는다.

```text
src/controllers
src/services
src/repositories
src/helpers
src/utils
src/common2
src/shared2
src/temp
src/tmp
src/misc
src/new
backend
server
client
api-new
v2-temp
```

예외가 필요하면 먼저 `folder-structure.md`를 수정해야 한다.

## 2.3 공통 코드 남용 금지

공통 코드는 정말 여러 도메인에서 재사용될 때만 `common`, `shared`, `packages/shared`에 둔다.

금지:

```text
모든 helper를 common에 몰아넣기
도메인 규칙을 shared util로 빼기
Controller에서 쓰기 편하다는 이유로 global util 만들기
```

허용:

```text
Project 전용 검증 로직 -> project module 내부
API Key hashing 로직 -> key/security 관련 module 내부
Provider 변환 로직 -> provider adapter 내부
순수 날짜 formatting -> shared util 가능
```

## 2.4 생성 코드 직접 수정 금지

아래 위치의 생성 코드는 직접 수정하지 않는다.

```text
apps/web/src/generated/
apps/control-plane-api/src/generated/
apps/worker/src/generated/
apps/gateway-core/internal/generated/
apps/ai-service/app/generated/
```

계약 변경이 필요하면 `packages/contracts`를 먼저 수정하고 생성 과정을 다시 수행한다.

---

# 3. 패키지 설치 규칙

## 3.1 불필요한 패키지 설치 금지

AI는 새 패키지를 설치하기 전에 반드시 아래를 확인한다.

```text
1. 이미 설치된 패키지로 가능한가?
2. 표준 라이브러리로 가능한가?
3. 기존 유틸이나 내부 패키지가 있는가?
4. 패키지가 유지보수되고 있는가?
5. 보안 이슈가 없는가?
6. bundle size 또는 runtime overhead가 적절한가?
7. 라이선스 문제가 없는가?
```

## 3.2 패키지 추가 전 설명 필수

패키지를 추가해야 한다면 먼저 아래를 설명한다.

```text
패키지명:
사용 위치:
필요한 이유:
대체안:
보안/라이선스 고려:
운영 영향:
```

사용자 승인 없이 dependency를 추가하지 않는다.

## 3.3 금지되는 설치 패턴

```bash
npm install some-random-package
pnpm add lodash moment axios uuid class-transformer-extra
pip install random-llm-helper
```

위처럼 이유 없이 편의 패키지를 추가하지 않는다.

특히 아래 작업은 기존 선택지를 우선 사용한다.

| 목적 | 우선 선택 |
|---|---|
| 날짜 처리 | 기존 date util 또는 표준 API |
| HTTP client | 프로젝트 기존 client |
| validation | 기존 validation 방식 |
| ID 생성 | 기존 ID 정책 |
| logging | 기존 logger |
| config | 기존 config module |
| Provider 호출 | Gateway provider adapter |

---

# 4. DB 변경 규칙

## 4.1 DB schema 변경 전 설명 필수

AI는 DB schema를 바꾸기 전에 먼저 설명해야 한다.

필수 설명 항목:

```text
1. 변경 이유
2. 변경 대상 table
3. 추가/수정/삭제할 column
4. 관계 변경 여부
5. index 변경 여부
6. migration 방식
7. 기존 데이터 영향
8. backfill 필요 여부
9. rollback 가능 여부
10. 성능 영향
11. 보안 영향
```

## 4.2 db-schema.md 먼저 수정

DB 변경은 아래 순서를 따른다.

```text
1. db-schema.md 수정
2. ORM schema 수정
3. migration 생성
4. repository/service 수정
5. 테스트 수정
```

`db-schema.md`에 없는 table이나 column을 코드에서 먼저 만들지 않는다.

## 4.3 destructive migration 금지

아래 작업은 사용자 승인 없이 금지한다.

- table 삭제
- column 삭제
- column type 축소
- nullable -> not null 변경
- unique constraint 추가
- 기존 index 삭제
- 데이터 대량 update/delete
- migration history 수정
- production data reset

필요하면 safe migration으로 나눈다.

```text
1. nullable column 추가
2. backfill
3. 코드에서 새 column 사용
4. 검증 후 not null 적용
5. 오래된 column 제거는 별도 작업
```

## 4.4 created_at / updated_at 기준 유지

모든 주요 table은 아래 기준을 따른다.

- `created_at`: 생성 시점. 생성 후 수정하지 않는다.
- `updated_at`: row의 의미 있는 변경 시점. 수정 시 자동 갱신한다.
- soft delete table은 `deleted_at`을 사용한다.
- audit/event/ledger 계열 table은 immutable을 기본으로 하며 `updated_at`을 두지 않을 수 있다.

## 4.5 확장 가능한 schema 설계

금지:

```sql
provider ENUM ('openai', 'anthropic')
model ENUM ('gpt-4o', 'claude-3')
```

권장:

```sql
provider TEXT NOT NULL
model TEXT NOT NULL
provider_model_id TEXT NULL
metadata JSONB NOT NULL DEFAULT '{}'
```

정책 대상은 아래처럼 확장 가능하게 설계한다.

```sql
target_type TEXT NOT NULL
target_id UUID NOT NULL
```

---

# 5. API 변경 규칙

## 5.1 api-spec.md 먼저 수정

API 추가/수정은 아래 순서를 따른다.

```text
1. api-spec.md 수정
2. OpenAPI contract 수정
3. DTO 수정
4. Controller 구현
5. Service 구현
6. 테스트 수정
7. 프론트 API client 수정
```

문서에 없는 endpoint를 구현하지 않는다.

## 5.2 API 응답 형식 유지

Control Plane API는 공통 응답 형식을 따른다.

성공:

```json
{
  "data": {},
  "meta": {}
}
```

실패:

```json
{
  "error": {
    "code": "STRING_CODE",
    "message": "Human readable message",
    "requestId": "req_xxx",
    "details": {}
  }
}
```

Gateway OpenAI-compatible API는 OpenAI 호환성을 우선한다. GateLM 전용 메타데이터는 response header 또는 `gate_lm` 확장 필드로 처리한다.

## 5.3 인증 필요 여부 명시

새 API를 만들 때는 반드시 아래를 명시한다.

```text
인증 필요 여부:
인증 방식:
필요 role:
tenant scope:
project scope:
```

인증/인가가 불명확한 API는 구현하지 않는다.

## 5.4 API path 임의 변경 금지

아래 작업은 금지한다.

- 기존 endpoint 이름 바꾸기
- REST resource 단수/복수 혼용
- query parameter 의미 변경
- response field 이름 변경
- error code 임의 변경
- pagination 형식 변경

변경이 필요하면 backward compatibility를 고려한다.

---

# 6. 보안 관련 코드 규칙

## 6.1 보안 코드는 반드시 리뷰 필요

아래 코드는 AI가 단독으로 최종 확정하지 않는다. 반드시 사용자 또는 팀 리뷰가 필요하다.

- 인증
- 인가
- API Key 발급/검증/폐기
- App Token 발급/검증/폐기
- Provider Key 저장/조회/회전
- Secrets Manager 연동
- KMS 암호화/복호화
- 민감정보 탐지/마스킹
- Prompt/Response 저장 정책
- Audit Log
- Rate Limit / Quota 차단
- Runtime Policy 평가
- Webhook signature 검증
- Tenant isolation
- Admin 권한 변경

AI는 구현 초안을 만들 수 있지만, 결과에 반드시 `보안 리뷰 필요`를 표시한다.

## 6.2 Secret 원문 노출 금지

절대 로그, 응답, 테스트 스냅샷, seed data, 문서 예시에 실제 secret을 넣지 않는다. 민감정보 탐지와 마스킹 세부 기준은 `pii-masking-policy.md`를 따른다.

금지:

```text
sk-live-...
OPENAI_API_KEY=실제값
provider_api_key 원문 반환
console.log(apiKey)
logger.info({ token })
```

허용:

```text
sk_test_redacted
****abcd
providerKeyRef
secretId
keyHash
```

## 6.3 원문 Prompt/Response 저장 최소화

세부 민감정보 기준은 `pii-masking-policy.md`를 따른다.

기본 정책:

- raw prompt 저장 금지
- raw response 저장 금지
- 로그에는 redacted prompt만 저장
- response는 summary 또는 metadata 중심 저장
- cache key는 redacted prompt 기반 hash 또는 embedding 사용
- 원문 저장은 고객사가 명시적으로 허용한 경우에만 별도 암호화와 retention 적용
- 이메일, 전화번호, API Key, 주민등록번호 일부를 placeholder에 남기지 않음

## 6.4 Tenant isolation 우선

모든 query와 command는 tenant scope를 포함해야 한다.

금지:

```ts
repository.findById(projectId)
```

권장:

```ts
repository.findByTenantIdAndProjectId(tenantId, projectId)
```

Project, API Key, App Token, Policy, Budget, Request Log 조회는 tenant/project scope를 반드시 검증한다.

## 6.5 Provider 직접 호출 금지

Provider SDK/API 호출은 Gateway provider adapter에서만 수행한다.

금지:

```text
apps/web에서 OpenAI SDK import
apps/control-plane-api에서 Anthropic 직접 호출
임의 script에서 Provider Key를 읽어 직접 호출
```

허용:

```text
apps/gateway-core/internal/providers/* adapter
```

---

# 7. Gateway 구현 규칙

## 7.1 Gateway pipeline 순서 유지

Gateway 요청 흐름은 기본적으로 아래 순서를 따른다.

```text
1. Request ID 생성
2. API Key 인증
3. Tenant / Project / User / Application 식별
4. App Token 검증
5. Rate Limit 검사는 v1.0.0 필수. `applicationId` 기준 PostgreSQL-backed fixed window를 적용
6. Runtime Policy 검사는 v1.0.0 ActiveRuntimeConfig 기반 최소 정책을 적용
7. 민감정보 탐지 / 마스킹
8. Model Routing
9. selectedProvider/selectedModel을 포함한 Exact Cache key 생성
10. Exact Cache 조회
11. Semantic Cache 조회는 v2 후보. v1.0.0에서는 disabled
12. Provider Adapter 호출
13. 응답 반환
14. 비동기 이벤트 발행
```

순서 변경이 필요하면 `architecture.md`와 `gateway-flow.md`를 먼저 수정하고 이유를 설명한다. 민감정보 stage 변경은 `pii-masking-policy.md`도 함께 확인한다.

## 7.2 응답 경로와 분석 경로 분리

Gateway는 사용자 응답을 위해 필요한 작업만 동기 처리한다.

동기 처리:

- 인증
- 식별
- 정책 검사
- 제한 검사
- 마스킹
- 캐시 조회
- 라우팅
- Provider 호출
- 응답 반환

비동기 처리:

- 상세 usage logging
- ClickHouse 저장
- dashboard 집계
- alert 계산
- S3 payload 저장
- audit/event 후처리

Gateway가 응답 경로에서 무거운 분석 query를 수행하지 않는다.

## 7.3 Stage 추가 규칙

새 Gateway stage를 추가할 때는 아래를 확인한다.

```text
1. stage가 응답 경로에 필요한가?
2. latency 영향은 얼마인가?
3. 실패 시 fail-open인가 fail-closed인가?
4. event payload에 기록해야 하는가?
5. dashboard에 노출해야 하는가?
6. policy로 제어 가능한가?
7. 테스트 fixture가 있는가?
```

## 7.4 Streaming 처리 주의

SSE Streaming 코드는 아래를 지킨다.

- full response를 메모리에 무조건 누적하지 않는다.
- client disconnect를 감지한다.
- provider stream error를 표준 error event로 변환한다.
- usage 계산이 provider별로 다를 수 있음을 고려한다.
- streaming 중에도 request_id, tenant_id, project_id를 유지한다.
- 로그 저장은 비동기 이벤트로 처리한다.

---

# 8. Runtime Policy 규칙

## 8.1 정책 하드코딩 금지

금지:

```ts
if (tenantId === 'acme' && model === 'gpt-4') {
  throw new ForbiddenException();
}
```

권장:

```ts
const decision = await policyEvaluator.evaluate(context, policySet);
if (decision.action === 'deny') {
  throw new PolicyDeniedException(decision.reason);
}
```

## 8.2 정책 변경은 version 기반

정책은 수정 가능한 mutable object로 다루지 않는다.

기본 흐름:

```text
1. draft 생성
2. validation
3. version 생성
4. publish
5. binding 교체
6. audit log 기록
```

Rollback도 기존 row 수정이 아니라 이전 version binding으로 처리한다.

## 8.3 정책 대상 확장성 유지

정책은 특정 대상만 가정하지 않는다.

권장 구조:

```json
{
  "target": {
    "type": "project",
    "id": "project_123"
  },
  "policyType": "budget",
  "version": 3
}
```

`projectPolicy`, `userPolicy`, `appTokenPolicy`처럼 대상별로 중복 API와 table을 만들지 않는다.

---

# 9. Logging / Observability 규칙

## 9.1 구조화 로그 사용

로그는 문자열 조합이 아니라 구조화된 필드로 남긴다.

권장 필드:

```text
request_id
tenant_id
project_id
user_id
application_id
api_key_id
app_token_id
provider
model
cache_status
routing_reason
masking_action
latency_ms
error_code
```

금지 필드:

```text
raw_prompt
raw_response
provider_api_key
api_key_plaintext
app_token_plaintext
authorization_header
cookie
```

## 9.2 로그 목적 구분

| 로그 유형 | 저장 위치 | 목적 |
|---|---|---|
| application log | stdout / log collector | 장애 진단 |
| usage event | Redpanda -> ClickHouse | 사용량/비용 분석 |
| audit log | PostgreSQL | 관리자 행위 추적 |
| payload object | S3-compatible storage | 명시 허용된 payload 보관 |

서로 다른 목적의 로그를 하나의 table에 몰아넣지 않는다.

## 9.3 이벤트 발행 실패 처리

비동기 이벤트 발행 실패는 명확히 처리한다.

- 사용자 요청 성공 후 이벤트 발행 실패가 발생할 수 있다.
- 이벤트 유실이 비용/감사 문제로 이어지는 경우 retry/outbox를 검토한다.
- 이벤트 실패를 무시하지 않는다.
- 이벤트 payload에 secret을 넣지 않는다.

---

# 10. 테스트 규칙

## 10.1 변경에는 테스트가 따라야 한다

AI가 기능 코드를 수정하면 관련 테스트도 수정하거나 추가한다.

| 변경 유형 | 필요한 테스트 |
|---|---|
| Controller | request/response/e2e test |
| Service | unit test |
| Repository | integration 또는 query test |
| Gateway stage | pipeline/stage test |
| Provider adapter | adapter contract test |
| Policy evaluator | allow/deny/edge case test |
| Masking | pattern/redaction test |
| Rate Limit | limit exceeded/allowed test |
| Quota/Budget | threshold/blocking test |
| Worker | event consumer test |
| Frontend | component/hook test, 필요 시 e2e |

## 10.2 테스트에서 secret 사용 금지

테스트 fixture에도 실제 secret처럼 보이는 값을 넣지 않는다.

권장:

```text
test_provider_key_redacted
api_key_hash_test
app_token_plaintext_for_test_only
```

단, plaintext token test value는 실제 형식과 혼동되지 않게 한다.

## 10.3 Snapshot 남용 금지

아래 데이터가 snapshot에 들어가지 않게 한다.

- raw prompt
- raw response
- secret
- authorization header
- cookie
- provider error raw body에 포함된 민감정보

---

# 11. Frontend 작업 규칙

## 11.1 Page는 얇게 유지한다

Next.js route page는 routing과 layout 연결만 담당한다.

비즈니스 UI는 아래에 둔다.

```text
apps/web/src/features/<domain>/
```

## 11.2 API 호출은 중앙 client 사용

금지:

```ts
fetch('/api/projects') // component 내부에서 직접 호출 남발
```

권장:

```ts
projectApi.listProjects(params)
```

## 11.3 UI에서 보안 결정하지 않기

프론트엔드는 버튼 노출과 사용자 경험을 제어할 수 있지만, 실제 권한 판단은 서버에서 한다.

금지:

```ts
if (user.role === 'admin') {
  // 서버 검증 없이 민감 작업 실행
}
```

권장:

```text
서버 API에서 role과 tenant scope 검증
프론트는 가능한 action 표시만 담당
```

## 11.4 Dashboard query 주의

Dashboard는 대량 로그를 직접 가져오지 않는다.

- 집계 API를 사용한다.
- pagination을 적용한다.
- Request Log는 필터와 cursor 기반 조회를 사용한다.
- Detail Drawer는 단건 detail API를 사용한다.

---

# 12. Backend 작업 규칙

## 12.1 Controller는 얇게 유지한다

Controller 책임:

- route binding
- auth guard 연결
- DTO validation
- service 호출
- response mapping

Controller에 비즈니스 규칙을 넣지 않는다.

## 12.2 Service는 use case 중심으로 작성한다

Service 책임:

- use case orchestration
- transaction boundary
- domain validation
- repository 호출
- event/audit 기록 요청

Service가 외부 Provider SDK를 직접 호출하지 않는다.

## 12.3 Repository는 DB 접근만 담당한다

Repository 책임:

- query 작성
- persistence model mapping
- transaction 참여

Repository에 인증, 정책, 비용 계산, masking 규칙을 넣지 않는다.

## 12.4 DTO 없이 any 사용 금지

금지:

```ts
createProject(body: any)
```

권장:

```ts
createProject(dto: CreateProjectRequestDto)
```

외부 입력은 항상 DTO와 validation을 거친다.

---

# 13. Worker 작업 규칙

## 13.1 Event schema 우선

Worker가 소비하는 event는 먼저 contract에 정의한다.

```text
packages/contracts/events/
```

Event field를 worker 내부에서 임의로 가정하지 않는다.

## 13.2 Idempotency 고려

Worker는 같은 event가 두 번 들어와도 안전해야 한다.

권장:

```text
event_id 기반 중복 처리
request_id + attempt_id unique key
ledger entry immutable 처리
```

## 13.3 분석 저장소와 Control DB 분리

고볼륨 invocation/event는 ClickHouse에 저장한다.

PostgreSQL에는 아래처럼 Control Plane에 필요한 데이터만 둔다.

- tenant config
- project config
- policy metadata
- budget ledger
- audit log
- user/account data

Request log 원천 데이터를 PostgreSQL에 무제한 저장하지 않는다.

---

# 14. AI 답변 형식 규칙

## 14.1 코드 작성 전 답변 형식

코드 작성 전에는 아래 형식을 사용한다.

```text
작업 계획을 먼저 정리합니다.

목표:
...

수정 파일:
...

생성 파일:
...

계약 변경:
...

보안 영향:
...

테스트:
...
```

## 14.2 코드 작성 후 답변 형식

코드 작성 후에는 아래 형식을 사용한다.

```text
완료 내용:
- ...

수정 파일:
- ...

테스트:
- 실행함: ...
- 실행하지 못함: ...

주의 사항:
- ...

리뷰 필요:
- 없음 / 보안 리뷰 필요 / DB 리뷰 필요 / API 리뷰 필요
```

## 14.3 실패 시 숨기지 않는다

AI는 실패한 작업을 숨기지 않는다.

반드시 아래를 말한다.

- 무엇을 하려 했는지
- 어디까지 완료했는지
- 어떤 오류가 났는지
- 어떤 파일은 수정되었는지
- 사용자가 확인해야 할 점

---

# 15. 금지 작업 목록

AI는 사용자 명시 요청 없이 아래 작업을 하지 않는다.

## 15.1 Git 작업 금지

```bash
git reset --hard
git clean -fd
git rebase
git push
git commit
git checkout .
```

Git 작업은 사용자가 명시적으로 요청한 경우에만 수행한다.

## 15.2 위험한 Shell 명령 금지

```bash
rm -rf
sudo
chmod -R 777
chown -R
docker system prune
DROP DATABASE
TRUNCATE
DELETE FROM without WHERE
```

필요한 경우 먼저 이유와 영향 범위를 설명한다.

## 15.3 환경 파일 수정 금지

아래 파일은 사용자 승인 없이 수정하지 않는다.

```text
.env
.env.local
.env.production
.env.staging
secrets.json
credentials.json
```

대신 `.env.example`에 필요한 key만 추가한다.

## 15.4 범위 밖 기능 구현 금지

MVP 제외 범위는 구현하지 않는다.

- 공식 ChatGPT/Gemini/Claude 웹 사용을 투명하게 Gateway로 강제 우회
- 파일 업로드
- 이미지 입력
- OCR
- RAG 기반 문서 검색
- 복잡한 AgentOps Trace
- 완전한 OPA 정책 서버
- Kubernetes 배포
- Redis Cluster
- gRPC 내부 통신
- Envoy 프록시 계층
- 고급 NLP 기반 기밀정보 탐지

사용자가 요청해도 먼저 MVP 범위 밖임을 알리고 별도 설계 문서가 필요하다고 설명한다.

---

# 16. 리뷰 필요 기준

## 16.1 보안 리뷰 필요

아래 변경은 반드시 보안 리뷰가 필요하다.

- auth guard
- role/permission
- tenant isolation
- API Key hashing
- App Token signing/verification
- Provider Key encryption
- Secrets Manager/KMS
- PII masking
- raw prompt/raw response 저장 여부, detector action, Provider 호출 전 마스킹 기준은 `pii-masking-policy.md`를 따른다.
- `pii-masking-policy.md`의 detector/action/replacement/cache 정책
- prompt/response persistence
- policy evaluator
- webhook signature
- audit log

## 16.2 DB 리뷰 필요

아래 변경은 DB 리뷰가 필요하다.

- migration 추가
- index 추가/삭제
- relation 변경
- unique constraint 변경
- nullable 변경
- soft delete 정책 변경
- ledger/audit table 변경
- ClickHouse table 변경

## 16.3 API 리뷰 필요

아래 변경은 API 리뷰가 필요하다.

- public endpoint 추가
- request/response body 변경
- error code 변경
- pagination 방식 변경
- auth requirement 변경
- OpenAI-compatible Gateway response 변경

## 16.4 Architecture 리뷰 필요

아래 변경은 Architecture 리뷰가 필요하다.

- Gateway pipeline 순서 변경
- 새 service/app 추가
- event bus 변경
- Redis keyspace 변경
- ClickHouse/PostgreSQL 역할 변경
- Provider adapter 구조 변경
- deployment topology 변경

---

# 17. 작업 크기 제한

## 17.1 작은 패치 기준

하나의 AI 작업은 되도록 아래 범위에 머문다.

```text
- 수정 파일 1~5개
- 새 파일 0~3개
- 하나의 domain/use case
- 하나의 API 또는 하나의 UI flow
- 하나의 migration
```

## 17.2 큰 작업 분할 예시

나쁜 요청:

```text
Project 기능 전체 구현해줘.
```

분할:

```text
1. Project DB schema/migration
2. Project DTO/Repository
3. Project Service
4. Project Controller
5. Project API test
6. Project list/create UI
```

나쁜 요청:

```text
Gateway 구현해줘.
```

분할:

```text
1. Gateway request model
2. API Key auth stage
3. Tenant/Project resolution stage
4. Rate limit stage
5. Masking stage
6. Exact cache stage
7. Provider adapter interface
8. OpenAI adapter
9. Event publish stage
```

---

# 18. 변경 전 체크리스트

AI는 파일 수정 전에 아래를 확인한다.

```text
[ ] 요청 범위를 이해했다.
[ ] 관련 문서를 확인했다.
[ ] 기존 파일 위치를 찾았다.
[ ] 새 폴더가 필요하지 않다.
[ ] API 변경 여부를 확인했다.
[ ] DB 변경 여부를 확인했다.
[ ] Event 변경 여부를 확인했다.
[ ] Policy 변경 여부를 확인했다.
[ ] 보안 영향 여부를 확인했다.
[ ] 확장성을 해치지 않는다.
[ ] 테스트 방법을 정했다.
```

---

# 19. 변경 후 체크리스트

AI는 작업 완료 후 아래를 확인한다.

```text
[ ] 문서와 코드가 일치한다.
[ ] 기존 구조를 바꾸지 않았다.
[ ] 불필요한 패키지를 추가하지 않았다.
[ ] raw prompt/response/secrets를 저장하거나 노출하지 않는다.
[ ] tenant/project scope 검증이 있다.
[ ] error response 형식이 일관된다.
[ ] DTO validation이 있다.
[ ] 테스트를 추가/수정했다.
[ ] lint/typecheck/test 실행 여부를 기록했다.
[ ] 리뷰 필요 항목을 명시했다.
```

---

# 20. AI에게 그대로 넣을 짧은 규칙

아래 블록은 Cursor, Codex, ChatGPT에 직접 붙여넣기 위한 축약본이다.

```text
너는 GateLM 프로젝트의 AI 코딩 도우미다.

GateLM은 확장 가능한 B2B GateLM 플랫폼이다. 모든 구현은 Provider, Model, Policy, Tenant, Project, Application, Analytics, SDK, 배포 방식이 늘어날 수 있다는 전제로 작성한다.

반드시 지킬 규칙:
1. 코드 작성 전에 먼저 작업 계획을 제시한다.
2. 기존 구조를 바꾸지 않는다.
3. 새 폴더를 임의로 만들지 않는다. folder-structure.md를 따른다.
4. 새 API는 api-spec.md에 먼저 반영한다.
5. DB schema 변경은 db-schema.md에 먼저 설명하고 migration을 만든다.
6. coding-convention.md의 네이밍, DTO, 예외, 응답, import 규칙을 따른다.
7. 불필요한 패키지를 설치하지 않는다. 패키지 추가 전 이유와 대체안을 설명한다.
8. 보안 관련 코드는 반드시 리뷰 필요로 표시한다.
9. API Key, App Token, Provider Key, raw prompt, raw response, Authorization header를 로그나 응답에 노출하지 않는다.
10. Provider/Model을 enum으로 닫지 않는다. adapter/registry/strategy 기반으로 확장 가능하게 만든다.
11. Runtime Policy를 하드코딩하지 않는다.
12. Gateway pipeline 순서를 임의로 바꾸지 않는다.
13. 응답 경로와 분석 경로를 분리한다.
14. 한 번에 너무 큰 변경을 하지 않는다. 큰 기능은 작은 패치로 나눈다.
15. Git reset, destructive migration, rm -rf, env secret 수정은 사용자 명시 요청 없이 하지 않는다.
16. 완료 후 수정 파일, 테스트 결과, 리뷰 필요 여부를 보고한다.

계획 없이 코드 작성 금지. 문서에 없는 API/Event/DB 구조 임의 생성 금지. MVP 제외 범위 구현 금지.
```

---

# 21. AI 작업 판단 기준

AI가 애매한 상황에서 선택해야 할 기본값은 아래와 같다.

| 상황 | 기본 선택 |
|---|---|
| 빠른 구현 vs 확장성 | 확장성 |
| 편의상 하드코딩 vs 정책화 | 정책화 |
| Provider 직접 호출 vs Gateway adapter | Gateway adapter |
| 원문 저장 vs redacted metadata | redacted metadata |
| 동기 분석 vs 비동기 이벤트 | 비동기 이벤트 |
| 새 패키지 설치 vs 기존 코드 활용 | 기존 코드 활용 |
| 구조 변경 vs 기존 구조 유지 | 기존 구조 유지 |
| 큰 변경 vs 작은 패치 | 작은 패치 |
| 모호한 보안 요구 vs 보수적 차단 | 보수적 차단 |
| 문서 생략 vs 문서 우선 | 문서 우선 |

---

# 22. 최종 기준

AI는 GateLM에서 코드를 빠르게 많이 만드는 도구가 아니라, **문서화된 구조 안에서 안전하고 확장 가능한 변경만 수행하는 구현 보조자**로 동작해야 한다.

좋은 AI 작업은 아래 조건을 만족한다.

- 변경 범위가 작고 명확하다.
- 기존 구조를 존중한다.
- 문서와 contract를 먼저 확인한다.
- 보안과 tenant isolation을 기본값으로 둔다.
- Provider와 정책 확장을 막지 않는다.
- 로그와 저장소에 민감정보를 남기지 않는다.
- 테스트와 리뷰 필요 사항을 남긴다.

나쁜 AI 작업은 아래와 같다.

- 코드부터 만든다.
- 폴더를 임의로 만든다.
- 패키지를 즉흥적으로 설치한다.
- DB를 먼저 바꾼다.
- 보안 코드를 리뷰 없이 확정한다.
- Gateway를 우회한다.
- 원문 Prompt/Response를 저장한다.
- 한 번에 대규모 리팩터링을 한다.
- 문서에 없는 API/Event/DB 구조를 만든다.

---

# 18. 민감정보 마스킹 작업 규칙

AI는 민감정보 감지/마스킹 코드를 수정하기 전에 `pii-masking-policy.md`를 먼저 확인해야 한다.

필수 계획 항목:

```text
1. 변경할 detector type
2. 변경할 policy action
3. Provider 호출 전 redaction/block 보장 방식
4. raw prompt/raw response/raw secret 미저장 보장 방식
5. llm-log-schema.md / db-schema.md / api-spec.md 영향
6. 테스트 fixture에 실제 개인정보나 secret이 없는지
7. 보안 리뷰 필요 여부
```

AI는 아래 작업을 즉시 수행하면 안 된다. 먼저 설명하고 리뷰 또는 문서 수정을 요구해야 한다.

- raw prompt를 debug log에 남기는 작업
- Provider request 원문을 저장하는 작업
- API Key detector를 비활성화하는 작업
- 주민등록번호 detector를 allow로 낮추는 작업
- masking stage를 cache 뒤로 옮기는 작업
- block된 요청의 로그를 생략하는 작업
- custom regex validation을 생략하는 작업

민감정보 관련 변경은 작은 단위로 나누고, 보안 리뷰 없이 merge하지 않는다.
