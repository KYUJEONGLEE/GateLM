# GateLM Demo Acceptance Criteria v0.1

## 문서 목적

이 문서는 GateLM P0 데모가 “완성”으로 인정되는 기준을 정의한다. 팀원마다 완성 기준이 달라지면 3~5일 프로젝트는 쉽게 흩어진다. 이 문서의 체크리스트를 통과하지 못하면 기능이 많아도 P0 완료가 아니다.

---

## 1. 데모 합격 기준 요약

P0 데모는 아래 7개 장면이 끊기지 않고 이어져야 한다.

```text
1. Admin 온보딩
2. Key/Token 발급
3. Gateway safe request 성공
4. Exact Cache hit
5. Simple Routing
6. Sensitive data redaction/block
7. Dashboard + Request Detail 확인
```

---

## 2. 필수 시나리오 체크리스트

### 2.1 Admin 온보딩

```text
[ ] seed admin 또는 signup/login으로 Web Console 진입
[ ] Tenant 생성 또는 seed tenant 확인
[ ] Project 생성 또는 seed project 확인
[ ] Application 생성 또는 seed application 확인
[ ] Provider Connection 등록 또는 mock provider 선택/seed 확인
[ ] API Key 발급
[ ] App Token 발급 또는 seed token 확인
[ ] 발급된 원문 key/token은 생성 응답에서만 1회 표시
[ ] 목록/상세 화면에서는 key/token 원문이 다시 표시되지 않음
```

### 2.2 Gateway safe request

```text
[ ] 고객사 앱 demo 또는 curl로 /v1/chat/completions 호출
[ ] Authorization: Bearer <gateway_api_key> 사용
[ ] X-GateLM-App-Token 사용
[ ] Gateway가 requestId를 생성
[ ] mock Provider adapter가 응답 반환
[ ] 응답에 OpenAI-compatible fields가 존재
[ ] X-GateLM-Request-Id header가 존재
[ ] Request Log에 status=success 또는 cache_hit로 기록
```

### 2.3 Exact Cache

```text
[ ] 동일한 safe request 1회차는 cacheStatus=miss
[ ] 동일한 safe request 2회차는 cacheStatus=hit
[ ] 2회차는 Provider/mock 호출 count가 증가하지 않음
[ ] cache key에는 tenantId, projectId, selectedModel 또는 routing policy hash가 포함됨
[ ] cache value에 raw prompt가 저장되지 않음
[ ] Dashboard에 cache hit count 또는 cache hit rate가 반영됨
```

### 2.4 Simple Routing

```text
[ ] request model=auto를 지원
[ ] 짧은 prompt는 low-cost model로 selectedModel 기록
[ ] requestedModel과 selectedModel이 Request Detail에서 구분됨
[ ] routingReason=low_cost 또는 default가 기록됨
[ ] 허용되지 않은 model/provider로 routing하지 않음
```

### 2.5 민감정보 redaction

```text
[ ] email 포함 prompt는 Provider 호출 전 [EMAIL_REDACTED]로 변환
[ ] phone number 포함 prompt는 Provider 호출 전 [PHONE_NUMBER_REDACTED]로 변환
[ ] Request Detail에는 redactedPromptPreview만 표시
[ ] raw email/phone이 log, DB, response, technical log에 노출되지 않음
[ ] maskingAction=redacted가 기록됨
[ ] maskingDetectedTypes에 email 또는 phone_number가 기록됨
```

### 2.6 민감정보 block

```text
[ ] credential-like token, JWT, 주민등록번호 형태는 Provider 호출 전 block
[ ] HTTP response는 OpenAI-compatible error shape 또는 GateLM 표준 error shape
[ ] error message에 탐지 원문이 포함되지 않음
[ ] Provider/mock 호출 count가 증가하지 않음
[ ] Request Log에 status=blocked 기록
[ ] costMicroUsd=0 기록
[ ] maskingAction=blocked 기록
```

### 2.7 Dashboard / Request Detail

```text
[ ] Dashboard Overview에 totalRequests 표시
[ ] successfulRequests 표시
[ ] blockedRequests 표시
[ ] cacheHitRate 또는 cacheHitRequests 표시
[ ] totalTokens, totalCostUsd 또는 totalCostMicroUsd, averageResponseTimeMs는 mock usage 기반 축소 표시 가능
[ ] Request Log 목록에서 requestId 클릭 가능
[ ] Detail Drawer에 provider/model/requestedModel/selectedModel 표시
[ ] Detail Drawer에 token/cost/latency 표시
[ ] Detail Drawer에 cache/routing/masking 정보 표시
[ ] raw prompt/raw response는 표시되지 않음
```

---

## 3. 데모 실패 기준

아래 중 하나라도 발생하면 P0 데모 실패로 본다.

```text
[ ] Web Console 또는 curl이 Gateway가 아니라 Provider를 직접 호출함
[ ] raw Provider Key가 Web Console, API response, log에 노출됨
[ ] raw prompt가 Request Log API에서 반환됨
[ ] email/API key가 Provider 호출 전 그대로 전달됨
[ ] 차단 요청이 Provider를 호출함
[ ] 동일 요청 2회차가 cache hit로 보이지 않음
[ ] Dashboard 숫자와 Request Log 건수가 명백히 불일치함
[ ] Tenant/Project scope 없이 request log가 조회됨
[ ] 팀원이 임의 API/DB/Event를 문서 없이 추가함
```

---

## 4. 데모 데이터 세트

P0 데모는 seed 데이터로 시작한다.

| 리소스 | 값 예시 | 비고 |
|---|---|---|
| Tenant | Example Corp | seed tenant |
| Project | Support Bot | LLM workload |
| Application | Support Web App | customer app |
| Provider | mock | deterministic provider |
| Low-cost model | mock-fast | routing 대상 |
| Default model | mock-balanced | 일반 요청 |
| Expensive model | mock-smart | P1/P2 후보 |

Secret처럼 보이는 실제 값을 seed에 넣지 않는다. 테스트용 key/token은 명확히 invalid한 placeholder로 생성한다.

---

## 5. curl 검증 스크립트 기준

### 5.1 Safe request

```bash
curl -sS http://localhost:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer glm_api_test_redacted' \
  -H 'X-GateLM-App-Token: glm_app_token_test_redacted' \
  -d '{
    "model": "auto",
    "messages": [
      {"role": "user", "content": "Write a short refund response."}
    ],
    "temperature": 0.2,
    "max_tokens": 128,
    "stream": false
  }'
```

기대 결과:

```text
HTTP 200
X-GateLM-Request-Id 존재
X-GateLM-Cache-Status: miss 또는 hit
response.model 또는 gate_lm.selectedModel 존재
```

### 5.2 Redaction request

```bash
curl -sS http://localhost:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer glm_api_test_redacted' \
  -H 'X-GateLM-App-Token: glm_app_token_test_redacted' \
  -d '{
    "model": "auto",
    "messages": [
      {"role": "user", "content": "Send a polite reply to user@example.invalid."}
    ],
    "stream": false
  }'
```

기대 결과:

```text
HTTP 200
maskingAction=redacted
Provider/mock 입력에는 [EMAIL_REDACTED]만 존재
Request Detail에 raw email 없음
```

### 5.3 Block request

```bash
curl -sS http://localhost:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer glm_api_test_redacted' \
  -H 'X-GateLM-App-Token: glm_app_token_test_redacted' \
  -d '{
    "model": "auto",
    "messages": [
      {"role": "user", "content": "This message contains a credential-like placeholder: api_key=test_secret_token_redacted_for_demo_only"}
    ],
    "stream": false
  }'
```

기대 결과:

```text
HTTP 403
error.code=sensitive_data_blocked
Provider/mock 호출 없음
Request Log status=blocked
costMicroUsd=0
```

---

## 6. Request Detail 필수 필드

Detail Drawer는 최소 아래 필드를 보여야 한다.

```text
requestId
status
httpStatus
provider
model
requestedModel
selectedModel
promptTokens
completionTokens
totalTokens
costMicroUsd
latencyMs
cacheStatus
cacheType
routingReason
maskingAction
maskingDetectedTypes
maskingDetectedCount
redactedPromptPreview
errorCode
errorMessage
createdAt
```

금지 필드:

```text
rawPrompt
rawResponse
providerApiKey
apiKeyPlaintext
appTokenPlaintext
authorizationHeader
cookie
rawProviderErrorBody
```

---

## 7. 발표 시나리오

최종 발표는 아래 순서로 진행한다.

```text
1. 문제 정의: LLM 사용 경로가 흩어지면 비용/보안/가시성이 깨진다.
2. GateLM 소개: 모든 승인된 LLM 요청을 Gateway로 통과시킨다.
3. Admin 온보딩: Tenant/Project/Provider/Key/Token 발급.
4. 고객사 앱 호출: base URL을 GateLM Gateway로 변경.
5. 첫 요청: Provider 호출, token/cost/latency log 생성.
6. 같은 요청 반복: Exact Cache hit, 비용 절감 표시.
7. model=auto: low-cost routing 결과 표시.
8. email 포함 요청: redaction 후 Provider 전달.
9. credential-like 요청: Provider 호출 전 block.
10. Dashboard/Detail: 운영자가 비용, 캐시, 라우팅, 마스킹을 추적.
```

---

## 8. 데모 전 최종 점검

```text
[ ] 로컬 초기화 스크립트 1개로 seed가 재현됨
[ ] mock provider latency/error/call count를 확인할 수 있음
[ ] 발표용 브라우저 계정과 curl command가 준비됨
[ ] 네트워크 없이도 mock provider로 데모 가능
[ ] 실제 Provider key가 필요하면 별도 환경변수로만 주입
[ ] raw secret이 repo, README, screen recording에 노출되지 않음
[ ] 장애 대비 녹화본 또는 스크린샷 백업이 있음
```
