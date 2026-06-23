# GateLM P0 Test Matrix v0.1

## 문서 목적

이 문서는 P0 구현자가 같은 테스트 기준으로 기능 완료를 판단하도록 만든 실행용 테스트 매트릭스다.

P0 테스트는 기능 수보다 Gateway vertical slice가 깨지지 않는지 확인하는 데 집중한다.

---

## 1. 테스트 원칙

```text
1. 모든 테스트는 mock provider만으로 실행 가능해야 한다.
2. 테스트 fixture에 실제 secret이나 실제 개인정보를 넣지 않는다.
3. raw prompt/raw response/API Key/App Token/Provider Key 원문 노출 여부를 확인한다.
4. Dashboard 숫자는 Request Log와 같은 canonical source를 기준으로 검증한다.
5. blocked/cache hit/error 요청도 request log에 남아야 한다.
```

허용 fixture:

```text
example.invalid
glm_api_test_redacted
glm_app_token_test_redacted
test_secret_token_redacted_for_demo_only
```

---

## 2. P0 필수 테스트 매트릭스

| ID | 시나리오 | 기대 HTTP | 기대 log/status | 추가 검증 |
|---|---|---:|---|---|
| P0-T01 | `GET /healthz` | 200 | 없음 | 서비스 실행 확인 |
| P0-T02 | `GET /readyz` | 200 | 없음 | PostgreSQL/Redis 연결 상태 확인 |
| P0-T03 | seed admin login 또는 local login | 200 | audit optional | key/token 원문 재조회 불가 |
| P0-T04 | Tenant/Project/Application 생성 | 2xx | audit optional | tenant/project scope 생성 |
| P0-T05 | API Key 발급 | 2xx | audit optional | 원문 key 1회 반환, hash 저장 |
| P0-T06 | App Token 발급 | 2xx | audit optional | 원문 token 1회 반환, hash 저장 |
| P0-T07 | safe `/v1/chat/completions` | 200 | `success`, `cacheStatus=miss` | mock provider 호출 count 증가 |
| P0-T08 | invalid API Key | 401 | `error` 또는 auth failure log | mock provider 호출 없음 |
| P0-T09 | invalid App Token | 403 | `error` 또는 auth failure log | mock provider 호출 없음 |
| P0-T10 | email 포함 요청 | 200 | `success`, `maskingAction=redacted` | raw email 미노출, provider 입력은 `[EMAIL_REDACTED]` |
| P0-T11 | phone 포함 요청 | 200 | `success`, `maskingAction=redacted` | raw phone 미노출 |
| P0-T12 | credential-like token 포함 요청 | 403 | `blocked`, `errorCode=sensitive_data_blocked` | mock provider 호출 없음, costMicroUsd=0 |
| P0-T13 | JWT 포함 요청 | 403 | `blocked`, `errorCode=sensitive_data_blocked` | mock provider 호출 없음 |
| P0-T14 | 주민등록번호 형태 포함 요청 | 403 | `blocked`, `errorCode=sensitive_data_blocked` | mock provider 호출 없음 |
| P0-T15 | 동일 safe request 2회 호출 | 200 | 1회차 `miss`, 2회차 `cache_hit`/`hit` | 2회차 mock provider 호출 count 증가 없음 |
| P0-T16 | `model=auto` 짧은 prompt | 200 | `routingReason=low_cost`, `selectedModel=mock-fast` | requestedModel/selectedModel 분리 |
| P0-T17 | `stream=true` 요청 | 400 | `error`, `errorCode=streaming_not_supported` | Provider/mock 호출 없음, cacheStatus=bypass |
| P0-T18 | Request Log 목록 | 200 | N/A | project scope 필수, raw prompt 미반환 |
| P0-T19 | Request Detail | 200 | N/A | cache/routing/masking/cost/latency 필드 표시 |
| P0-T20 | Dashboard Overview | 200 | N/A | Request Log 기준 total/success/blocked/cache 수 일치 |

---

## 3. 완료 판정

P0 완료 선언 전 최소 기준:

```text
P0-T01 ~ P0-T20 전부 통과
raw prompt/raw response/secret 미노출 확인
blocked 요청이 Provider/mock을 호출하지 않음
cache hit 요청이 Provider/mock 호출 count를 증가시키지 않음
Dashboard 숫자와 Request Log 숫자가 일치
```

테스트 자동화가 늦어지면 수동 검증 기록을 PR에 남긴다. 단, 보안 관련 테스트는 수동 기록 없이 완료로 보지 않는다.
