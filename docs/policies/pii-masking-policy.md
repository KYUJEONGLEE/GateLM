# GateLM 민감정보 마스킹 정책

> P0 범위 안내: 이 문서는 장기 민감정보 정책 확장 기준을 포함한다. 현재 P0 감지 유형과 action은 `docs/p0/p0-contract.md`와 `docs/p0/implementation-cut.md`를 우선한다. P0 `sensitive_data_blocked`는 HTTP 403으로 고정한다. 이 문서의 422 예시는 P1/P2 정책 검증 또는 custom detector validation 문맥으로만 본다. 단, raw prompt/response/secret 저장 금지와 Provider 호출 전 마스킹/차단 원칙은 P0에서도 낮추지 않는다.

## 문서 목적

이 문서는 GateLM에서 이메일, 전화번호, API Key, 주민등록번호 등 민감정보를 감지하고, 외부 LLM Provider 요청 전 또는 로그 저장 전 어떤 방식으로 마스킹/차단할지 정의하는 기준 문서다.

이 문서는 아래 작업의 기준이다.

- Gateway 민감정보 감지 stage 구현
- Provider 호출 전 redaction/block decision 구현
- 로그 저장 전 redacted payload 생성
- `llm_masking_events` event payload 작성
- Request Log / Detail Drawer masking metadata 표시
- Dashboard masking 지표 계산
- Runtime Policy의 security policy schema 작성
- AI 코딩 도구가 raw prompt, raw response, secret sample을 저장하지 못하게 하는 기준

GateLM은 단순 Chat UI가 아니라 **확장 가능한 LLM Gateway 플랫폼**이다. 민감정보 정책도 MVP 감지 규칙 몇 개만 하드코딩하는 방식이 아니라, detector, action, policy version, tenant override, audit, dashboard가 늘어나도 기존 Gateway pipeline과 로그 schema를 깨지 않도록 설계한다.

---

# 0. 최상위 원칙

## 0.1 확장 가능성은 기본값이다

민감정보 감지와 마스킹은 아래 전제를 따른다.

- detector type은 enum으로 닫지 않는다.
- 새 detector는 Gateway pipeline 전체를 수정하지 않고 detector registry에 추가한다.
- policy action은 tenant, project, application, user, api key, app token 단위로 확장 가능해야 한다.
- provider, model, routing strategy에 따라 별도 보안 정책을 적용할 수 있어야 한다.
- detector rule은 코드에 흩뿌리지 않고 versioned policy/rule로 관리한다.
- 감지 결과는 `requestId` 기준으로 로그, dashboard, detail drawer에서 추적 가능해야 한다.
- raw sensitive value는 저장하지 않고, 필요하면 HMAC 기반 sample hash만 저장한다.

좋은 방향:

```text
Gateway masking stage
-> DetectorRegistry 실행
-> PolicyEvaluator가 action 결정
-> RedactionEngine이 provider prompt 생성
-> MaskingEventPublisher가 redacted metadata 발행
```

나쁜 방향:

```text
if prompt.contains("@") { ... }
if tenantId == "demo" { ... }
if provider == "openai" { ... }
```

Provider별 차이는 Provider Adapter 또는 Provider Capability에 둔다. 민감정보 탐지 자체는 Provider에 종속되지 않는다.

## 0.2 Provider 호출 전 마스킹이 기본이다

외부 LLM Provider로 요청을 보내기 전에 민감정보를 먼저 탐지하고 action을 결정한다.

```text
Request Context Assembly
-> PII / Secret Detection
-> Redaction or Block
-> Model Routing
-> Cache Key 생성
-> Provider Request 변환
-> Provider 호출
```

Provider 호출 후 로그 저장 단계에서만 마스킹하면 이미 외부 Provider로 민감정보가 전달된 뒤다. GateLM의 기본 보안 가치는 **Provider 호출 전 차단/마스킹**이다.

## 0.3 저장 전 마스킹은 항상 수행한다

Provider 호출 여부와 관계없이, 저장소로 가는 payload는 항상 redacted 기준이다.

저장 가능:

- `redactedPrompt`
- `responseSummary`
- `promptHash`
- `responseHash`
- `maskingAction`
- `maskingDetectedTypes`
- `maskingDetectedCount`
- `maskingRuleId`
- `securityPolicyVersionId`
- `sampleHash`
- token/cost/latency/cache/routing metadata

저장 금지:

- raw prompt
- raw response
- raw API Key
- raw Provider credential
- raw Authorization header
- raw App Token
- raw Cookie
- raw 주민등록번호
- raw 전화번호
- raw 이메일 sample
- 외부 Provider raw error body 전체
- 테스트 snapshot 안의 실제 secret

원문 저장이 필요한 고객사는 별도 tenant policy로 명시적으로 허용해야 하며, 암호화, 접근 제어, retention, audit log가 먼저 있어야 한다. MVP 기본값은 원문 저장 금지다.

## 0.4 차단은 실패가 아니라 정책 적용 결과다

민감정보 정책으로 차단된 요청은 시스템 장애가 아니다.

- Gateway response status: `blocked`
- HTTP status: P0 `sensitive_data_blocked`는 `403`. P1/P2 정책 검증이나 custom detector validation은 `400` 또는 `422`를 사용할 수 있음
- Provider 호출: 수행하지 않음
- 비용: actual provider cost `0`
- Dashboard error rate: 기본 실패율에서 제외
- Dashboard block rate: 별도 집계
- Log: 반드시 남김

## 0.5 탐지 sample은 hash만 저장한다

탐지된 값의 원문을 저장하지 않는다.

권장:

```text
sampleHash = HMAC-SHA256(tenant_salt, normalized_sensitive_value)
```

주의:

- 단순 SHA-256만 사용하지 않는다. 이메일, 전화번호처럼 후보 공간이 작은 값은 사전 대입 위험이 있다.
- `tenant_salt` 또는 HMAC key는 KMS/Secrets Manager로 관리한다.
- sampleHash는 같은 tenant 안에서 중복 패턴 분석용으로만 사용한다.
- sampleHash를 UI에 노출하지 않는다. 운영자 권한의 detail view에서도 기본 비노출이다.

---

# 1. 문서 우선순위

민감정보 감지/마스킹 구현은 아래 순서를 따른다.

```text
docs/p0/p0-contract.md
-> docs/p0/implementation-cut.md
-> docs/p0/p0-log-event-payload.md
-> docs/architecture/gateway-flow.md
-> docs/policies/pii-masking-policy.md
-> docs/architecture/llm-log-schema.md
-> docs/p0/p0-db-migration-plan.md
-> docs/architecture/api-spec.md
-> docs/architecture/dashboard-metrics.md
-> docs/policies/coding-convention.md
-> docs/policies/ai-coding-rules.md
-> 실제 구현
```

충돌 시 기준:

1. P0 범위와 action/status는 `docs/p0/p0-contract.md`를 따른다.
2. P0 구현 컷라인은 `docs/p0/implementation-cut.md`를 따른다.
3. P0 로그 필드는 `docs/p0/p0-log-event-payload.md`를 따른다.
4. Gateway stage 순서는 `docs/architecture/gateway-flow.md`를 따른다.
5. 민감정보 detector, action, masking 세부 기준은 이 문서를 따른다.
6. P0 저장 테이블과 column type은 `docs/p0/p0-db-migration-plan.md`를 따른다.
7. 장기 API/DB/Dashboard 설계는 각 architecture 문서를 참고하되 P0 문서와 충돌하면 P1/P2 후보로 본다.

문서에 없는 detector type, action value, log field, API field, DB column을 임의로 추가하지 않는다.

---

# 2. MVP 범위

## 2.1 MVP에서 반드시 지원하는 감지 유형

| Detector Type | 설명 | 기본 severity | Provider 요청 전 기본 action | 저장 전 기본 action |
|---|---|---:|---|---|
| `email` | 이메일 주소 | `medium` | `redact` | `redact` |
| `phone_number` | 한국 휴대폰/전화번호, 국제 전화번호 일부 | `medium` | `redact` | `redact` |
| `resident_registration_number` | 주민등록번호 형태 | `critical` | `block` | `redact` |
| `api_key` | Provider API Key, Access Token, Secret Key | `critical` | `block` | `redact` |
| `authorization_header` | Bearer token, Basic credential 등 | `critical` | `block` | `redact` |
| `jwt` | JSON Web Token 형태 | `high` | `block` | `redact` |
| `private_key` | PEM/OpenSSH private key block | `critical` | `block` | `redact` |
| `account_id` | 고객 계정번호, 내부 계정 ID 패턴 | `medium` | `redact` | `redact` |
| `employee_id` | 사번/임직원 ID 패턴 | `medium` | `redact` | `redact` |
| `internal_keyword` | 사내 기밀 키워드 rule match | `high` | `redact` 또는 `block` | `redact` |

## 2.2 MVP에서 제외하는 것

아래는 1차 범위에서 제외한다.

- OCR 기반 이미지 민감정보 탐지
- 파일 업로드 문서 내 민감정보 탐지
- RAG 문서 저장소 전체 스캔
- 고급 NLP 기반 기밀정보 분류 모델
- DLP 제품 수준의 완전한 개인정보 분류
- 국가별 모든 신분증 번호 검증
- Provider 응답의 완전한 개인정보 재식별 방지
- 브라우저 확장 기반 공식 ChatGPT/Gemini/Claude 웹사이트 감시

단, 구조는 detector를 추가할 수 있게 둔다.

---

# 3. Action 용어 기준

## 3.1 Policy Action

Policy evaluator가 결정하는 action은 아래 값을 사용한다.

| Action | 의미 | Provider 호출 여부 | 사용 예 |
|---|---|---:|---|
| `allow` | 탐지됐지만 정책상 통과 | Y | 테스트 tenant, low-risk 내부 ID |
| `redact` | 민감값을 placeholder로 치환하고 진행 | Y | 이메일, 전화번호 |
| `block` | 요청을 차단하고 Provider 호출하지 않음 | N | 주민등록번호, private key, strict policy의 credential |
| `hash_only` | 원문은 제거하고 hash metadata만 남김 | N 또는 Y | 고급 분석/중복 탐지용 확장 action |

MVP Gateway는 `allow`, `redact`, `block`을 구현한다. `hash_only`는 policy schema와 event 확장 가능성만 둔다.

## 3.2 API / Log Outcome

Request Log와 Dashboard에서 표시하는 최종 outcome은 아래 값을 사용한다.

| Field | Allowed Values | 설명 |
|---|---|---|
| `maskingAction` | `none`, `redacted`, `blocked` | 요청 1건의 최종 masking outcome |
| `maskingDetectedTypes` | array[string] | 탐지된 detector type 목록 |
| `maskingDetectedCount` | integer | 전체 탐지 건수 |
| `maskingRequiredReview` | boolean | 보안 리뷰 필요 여부. 확장 필드 |

Mapping:

| Policy Action | Log Outcome |
|---|---|
| no detection | `none` |
| `allow` | `none` 또는 `redacted` 아님. masking event에는 `allow` 기록 |
| `redact` | `redacted` |
| `block` | `blocked` |

주의:

- `llm_masking_events.action`은 `allow`, `redact`, `block`을 사용한다.
- P0 canonical source인 `p0_llm_invocation_logs.masking_action`과 API의 `maskingAction`은 `none`, `redacted`, `blocked`를 사용한다. 장기 ClickHouse mirror에서는 `llm_invocations.masking_action`도 같은 값을 사용한다.
- 기존 코드에서 `mask` 또는 `block`만 사용하고 있다면 migration 전에 이 문서를 기준으로 정리한다.

---

# 4. Redaction Placeholder 기준

## 4.1 Placeholder 형식

Redaction placeholder는 대문자 snake case를 사용한다.

```text
[EMAIL_REDACTED]
[PHONE_NUMBER_REDACTED]
[RESIDENT_REGISTRATION_NUMBER_REDACTED]
[API_KEY_REDACTED]
[AUTHORIZATION_HEADER_REDACTED]
[JWT_REDACTED]
[ACCOUNT_ID_REDACTED]
[EMPLOYEE_ID_REDACTED]
[INTERNAL_KEYWORD_REDACTED]
[SECRET_REDACTED]
```

## 4.2 Placeholder에 원문 일부를 남기지 않는다

금지:

```text
u***@company.com
010-****-1234
sk-...abcd
900101-1******
```

허용:

```text
[EMAIL_REDACTED]
[PHONE_NUMBER_REDACTED]
[API_KEY_REDACTED]
```

이유:

- 일부 마스킹은 작은 조직/문맥에서 재식별 가능성이 높다.
- API Key prefix/suffix는 credential rotation이나 brute-force hint가 될 수 있다.
- Dashboard/Log 검색에서 부분 원문이 장기 보관될 수 있다.

## 4.3 위치 보존

문맥을 유지해야 하므로, redaction은 문장 구조를 최대한 유지한다.

예시:

```text
입력: 담당자 이메일은 user@example.invalid 입니다.
출력: 담당자 이메일은 [EMAIL_REDACTED] 입니다.
```

복수 탐지 시 같은 placeholder를 반복한다.

```text
[EMAIL_REDACTED] 와 [EMAIL_REDACTED] 에게 연락해줘.
```

MVP에서는 같은 요청 안의 첫 번째 이메일/두 번째 이메일을 구분하는 `[EMAIL_1_REDACTED]` 형태를 사용하지 않는다. 필요하면 추후 policy option으로 추가한다.

---

# 5. Detector 상세 정책

## 5.1 공통 detector 인터페이스

모든 detector는 같은 logical interface를 따른다.

```ts
interface SensitiveDataDetector {
  type: string;
  version: string;
  detect(input: DetectionInput): DetectionResult[];
}

interface DetectionResult {
  type: string;
  startOffset: number;
  endOffset: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  normalizedHash: string;
  ruleId?: string;
  metadata?: Record<string, unknown>;
}
```

구현 언어가 Go여도 logical field는 동일해야 한다.

## 5.2 이메일 감지

Detector type: `email`

기본 목적:

- 개인 이메일, 회사 이메일이 외부 LLM Provider로 그대로 전달되는 것을 방지한다.
- Request Log와 Dashboard에 raw email이 저장되는 것을 방지한다.

기본 action:

| 위치 | 기본 action |
|---|---|
| Provider 요청 전 | `redact` |
| 로그/분석 저장 전 | `redact` |
| masking event | `action = redact`, `severity = medium` |

기본 감지 규칙:

```regex
(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b
```

검증 기준:

- TLD가 2자 이상이어야 한다.
- 공백, 괄호, 따옴표 경계 안에서도 탐지해야 한다.
- Markdown 링크 안의 이메일도 탐지해야 한다.
- `user@example.invalid` 같은 테스트 도메인은 테스트 fixture로만 사용한다.
- allowlist domain이 있어도 raw email 저장은 금지한다.

False positive 완화:

- 코드 블록 안의 package coordinate나 log label이 email처럼 보일 수 있다.
- MVP에서는 코드 블록 예외를 두지 않는다. 보안 우선으로 redaction한다.
- 추후 `policy.allowCodeBlockEmail = true` 같은 tenant option을 추가할 수 있다.

Redaction:

```text
[EMAIL_REDACTED]
```

## 5.3 전화번호 감지

Detector type: `phone_number`

기본 목적:

- 휴대폰 번호, 사무실 번호, 국제 전화번호가 외부 Provider와 로그에 그대로 남는 것을 방지한다.

기본 action:

| 위치 | 기본 action |
|---|---|
| Provider 요청 전 | `redact` |
| 로그/분석 저장 전 | `redact` |
| masking event | `action = redact`, `severity = medium` |

MVP 감지 범위:

- 한국 휴대폰 번호: `010`, `011`, `016`, `017`, `018`, `019`
- 한국 지역번호 일부: `02`, `031` 등 2~3자리 지역번호
- 국제번호 prefix: `+82` 중심
- separator: `-`, space, `.`, 없음

예시 regex 방향:

```regex
(?x)
\b(
  (\+82[-.\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}
  |
  (\+82[-.\s]?)?0?\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}
)\b
```

검증 기준:

- 숫자만 10~11자리인 경우도 탐지한다.
- 일반 주문번호/계좌번호와 혼동될 수 있으므로 confidence를 낮출 수 있다.
- 전화번호 detector가 account_id detector와 충돌하면 더 높은 confidence detector를 우선한다.

Redaction:

```text
[PHONE_NUMBER_REDACTED]
```

## 5.4 API Key / Secret 감지

Detector type: `api_key`

기본 목적:

- OpenAI, Anthropic, Gemini, AWS, GitHub, Slack, 기타 Provider credential이 외부 LLM Provider로 전달되거나 로그에 저장되는 것을 방지한다.

기본 action:

| 위치 | 기본 action |
|---|---|
| Provider 요청 전 | `block` |
| 로그/분석 저장 전 | `redact` |
| masking event | `action = block`, `severity = critical` |

API Key는 단순 개인정보보다 위험도가 높다. GateLM 기본 운영 정책에서는 secret-like credential이 탐지되면 Provider 호출 전에 차단한다. 데모 또는 일부 tenant에서 `redact`로 완화할 수 있지만, 완화 정책은 Tenant Admin 권한, audit log, policy version 기록이 필요하다.

MVP 감지 범위:

| Secret Family | Pattern Direction |
|---|---|
| OpenAI-like key | `sk-` 계열 긴 token |
| Anthropic-like key | `sk-ant-` 계열 token |
| Google API key-like | `AIza` prefix 계열 |
| AWS access key id | `AKIA` / `ASIA` prefix 계열 |
| GitHub token-like | `ghp_`, `github_pat_` 계열 |
| Slack token-like | `xoxb-`, `xoxp-`, `xoxa-`, `xoxr-` 계열 |
| Generic bearer token | `Authorization: Bearer <long-token>` |
| Generic secret assignment | `api_key=`, `secret=`, `token=` 다음 긴 값 |

예시 regex 방향:

```regex
(?i)\b(api[_-]?key|secret|token|access[_-]?key|client[_-]?secret)\s*[:=]\s*['\"]?[A-Za-z0-9_\-\.]{20,}
```

```regex
\b(AKIA|ASIA)[A-Z0-9]{16}\b
```

```regex
\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\b
```

주의:

- 실제 secret 예시는 문서, 테스트, snapshot, seed에 넣지 않는다.
- 테스트에는 synthetic token generator를 사용한다.
- prefix가 실제 Provider와 같아도 값은 명확히 invalid한 테스트 전용 값이어야 한다.
- secret detector는 false positive보다 false negative를 더 위험하게 본다.

Redaction:

```text
[API_KEY_REDACTED]
[SECRET_REDACTED]
```

Critical rule이 `block`으로 승격된 경우 response 예시:

```json
{
  "error": {
    "code": "sensitive_data_blocked",
    "message": "Request blocked because it contains a credential-like secret.",
    "details": {
      "detectedTypes": ["api_key"],
      "requestId": "request_01J..."
    }
  }
}
```

## 5.5 Authorization Header 감지

Detector type: `authorization_header`

기본 action:

| 위치 | 기본 action |
|---|---|
| Provider 요청 전 | `block` |
| 로그/분석 저장 전 | `redact` |
| masking event | `action = block`, `severity = critical` |

감지 대상:

```text
Authorization: Bearer ...
Authorization: Basic ...
Proxy-Authorization: ...
Cookie: session=...
Set-Cookie: ...
```

Redaction:

```text
[AUTHORIZATION_HEADER_REDACTED]
```

주의:

- Gateway technical log에서도 HTTP headers 전체를 그대로 남기지 않는다.
- debug log에 request headers를 dump하지 않는다.
- API Key 인증 실패 시 입력된 key 원문을 error message에 넣지 않는다.

## 5.6 JWT 감지

Detector type: `jwt`

기본 action:

| 위치 | 기본 action |
|---|---|
| Provider 요청 전 | `block` |
| 로그/분석 저장 전 | `redact` |
| masking event | `action = block`, `severity = high` |

감지 방향:

```regex
\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\b
```

검증 기준:

- JWT header/payload가 base64url JSON처럼 보이면 confidence를 높인다.
- 만료된 JWT여도 저장하거나 Provider에 전달하지 않는다.

Redaction:

```text
[JWT_REDACTED]
```

## 5.7 주민등록번호 감지

Detector type: `resident_registration_number`

기본 목적:

- 주민등록번호 형태의 고위험 개인정보가 외부 LLM Provider로 전달되거나 로그에 저장되는 것을 방지한다.

기본 action:

| 위치 | 기본 action |
|---|---|
| Provider 요청 전 | `block` |
| 로그/분석 저장 전 | `redact` |
| masking event | `action = block`, `severity = critical` |

MVP 감지 방향:

```regex
\b\d{6}[-\s]?[1-8]\d{6}\b
```

검증 기준:

- 생년월일로 가능한지 기본 검증한다.
- 뒷자리 첫 숫자 범위는 `1-8`을 우선 본다.
- checksum 검증은 false negative를 만들 수 있으므로 MVP에서는 보조 confidence로만 사용한다.
- separator가 없는 13자리 숫자는 주문번호/계좌번호와 충돌할 수 있으므로 context keyword와 함께 confidence를 계산한다.

Context keyword 예시:

```text
주민번호, 주민등록번호, rrn, national id, registration number
```

Redaction:

```text
[RESIDENT_REGISTRATION_NUMBER_REDACTED]
```

Block 기준:

- 명확한 주민등록번호 형태는 기본 `block`이다.
- 고객사가 `redact`로 낮추려면 tenant security policy에 명시해야 한다.
- 낮추더라도 raw value 저장은 여전히 금지다.

## 5.8 계정 ID / 사번 감지

Detector types:

```text
account_id
employee_id
```

기본 action:

| 위치 | 기본 action |
|---|---|
| Provider 요청 전 | `redact` |
| 로그/분석 저장 전 | `redact` |
| masking event | `action = redact`, `severity = medium` |

이 detector는 고객사별 패턴이 다르므로 Runtime Policy rule로 설정한다.

예시 rule shape:

```json
{
  "type": "employee_id",
  "name": "Company employee id",
  "pattern": "\\bEMP-[0-9]{6}\\b",
  "severity": "medium",
  "defaultAction": "redact"
}
```

주의:

- 고객사별 custom regex는 ReDoS 위험이 없도록 validation한다.
- regex timeout을 둔다.
- catastrophic backtracking이 가능한 pattern은 publish를 거부한다.

## 5.9 사내 기밀 키워드 감지

Detector type: `internal_keyword`

기본 action:

| 위치 | 기본 action |
|---|---|
| Provider 요청 전 | `redact` 또는 `block` |
| 로그/분석 저장 전 | `redact` |
| masking event | policy에 따라 `redact` 또는 `block` |

사용 예:

- 프로젝트 코드명
- 미공개 제품명
- 내부 시스템명
- 고객사 비밀 등급 태그
- 계약명

Rule 예시:

```json
{
  "type": "internal_keyword",
  "name": "Confidential project codename",
  "matchType": "keyword",
  "keywords": ["PROJECT_CODE_NAME"],
  "caseSensitive": false,
  "severity": "high",
  "defaultAction": "block"
}
```

주의:

- 실제 사내 기밀 키워드는 문서 예시에 넣지 않는다.
- Web Console에서 keyword 등록 시 audit log를 남긴다.
- keyword rule 변경은 policy version을 새로 만든다.

---

# 6. Detector 충돌과 우선순위

여러 detector가 같은 범위를 탐지할 수 있다.

우선순위:

```text
api_key / authorization_header / jwt
-> resident_registration_number
-> internal_keyword
-> phone_number
-> email
-> account_id / employee_id
-> unknown
```

결정 기준:

- 겹치는 범위는 severity가 높은 detector를 우선한다.
- 같은 severity면 confidence가 높은 detector를 우선한다.
- 같은 값에 대해 여러 detector가 의미 있게 매칭되면 masking event는 여러 개 남길 수 있으나, redaction은 한 번만 수행한다.
- 최종 request-level action은 가장 강한 action을 따른다.

Action 강도:

```text
block > redact > allow
```

예시:

```text
입력에 email과 api_key가 함께 있음
-> email detector: redact
-> api_key detector: block
-> 최종 maskingAction: blocked
-> Provider 호출 없음
-> masking events: email/redact, api_key/block
```

```text
입력에 email과 private_key가 함께 있음
-> email detector: redact
-> private_key detector: block
-> 최종 maskingAction: blocked
-> Provider 호출 없음
-> masking events: email/redact, private_key/block
```

---

# 7. Gateway 처리 흐름

## 7.1 기본 처리 순서

```text
1. Gateway가 요청을 수신한다.
2. requestId / traceId를 생성한다.
3. API Key 인증, Tenant/Project/Application/User 식별을 수행한다.
4. App Token을 검증한다.
5. Rate Limit / Quota / Budget pre-check를 수행한다.
6. Runtime Policy snapshot을 로드한다.
7. Chat UI의 Reply-to Context가 있으면 context를 조립한다.
8. 민감정보 detector registry를 실행한다.
9. Security Policy Evaluator가 action을 결정한다.
10. action = block이면 Provider 호출 전 차단 응답을 반환한다.
11. action = redact이면 redacted prompt를 생성한다.
12. redacted prompt 기준으로 cache key를 생성한다.
13. Exact Cache / Semantic Cache를 조회한다.
14. Model Routing을 수행한다.
15. Provider request로 변환한다.
16. 외부 LLM Provider를 호출한다.
17. Provider response를 정규화한다.
18. 필요 시 response summary를 생성한다.
19. 사용자에게 응답을 반환한다.
20. masking/log/usage event를 비동기로 발행한다.
21. Worker가 ClickHouse/PostgreSQL/S3에 저장한다.
```

## 7.2 Block 흐름

```text
Client
-> Gateway
-> PII detection
-> action = block
-> Provider 호출 없음
-> Error response 반환
-> masking event 발행
-> invocation log status = blocked 저장
```

Block 응답은 민감값을 포함하지 않는다.

```json
{
  "error": {
    "code": "sensitive_data_blocked",
    "message": "Request blocked by GateLM security policy.",
    "details": {
      "requestId": "request_01J...",
      "detectedTypes": ["resident_registration_number"],
      "action": "blocked"
    }
  }
}
```

## 7.3 Redact 흐름

```text
Client
-> Gateway
-> PII detection
-> action = redact
-> redacted prompt 생성
-> cache key 생성
-> cache or Provider
-> response 반환
-> masking event 발행
-> invocation log maskingAction = redacted
```

Provider에는 redacted prompt만 전달한다.

```text
원문: user@example.invalid 에게 연락하는 답변을 써줘.
Provider 전달: [EMAIL_REDACTED] 에게 연락하는 답변을 써줘.
```

## 7.4 Allow 흐름

`allow`는 detector가 값을 찾았지만 policy상 차단/마스킹하지 않는 경우다.

사용 조건:

- 낮은 severity의 내부 식별자
- 테스트 tenant
- 특정 project policy에서 허용한 synthetic data

제한:

- `api_key`, `authorization_header`, `resident_registration_number`는 MVP 기본 정책에서 `allow` 불가다.
- allow가 적용되어도 raw payload 저장 금지는 유지한다.
- allow event는 감사 목적으로 남긴다.

---

# 8. Cache와 Masking 관계

## 8.1 Cache Key는 redacted prompt 기준

Cache key는 raw prompt로 만들지 않는다.

권장 구성:

```text
cacheKeyMaterial = tenantId
                 + projectId
                 + selectedPolicyVersionId
                 + selectedProvider
                 + selectedModel
                 + normalizedRedactedPrompt
                 + parentMessageHash
                 + toolConfigHash
```

저장:

```text
cacheKeyHash = HMAC-SHA256(cache_key_secret, cacheKeyMaterial)
```

주의:

- raw prompt를 Redis key에 넣지 않는다.
- raw prompt hash를 그대로 외부에 노출하지 않는다.
- policy version을 cache key에 포함해야 마스킹 정책 변경 후 오래된 cache가 잘못 재사용되지 않는다.

## 8.2 Semantic Cache도 redacted 기준

Semantic Cache embedding은 redacted prompt 기준으로 만든다.

```text
raw prompt
-> redaction
-> redacted prompt
-> embedding
-> semantic cache lookup
```

민감정보가 들어간 raw prompt를 embedding provider나 vector store에 보내지 않는다.

## 8.3 Block 요청은 cache lookup하지 않는다

`block`으로 결정된 요청은 cache lookup을 하지 않는다.

이유:

- 민감정보가 포함된 요청이라는 사실 자체로 정책 차단이 필요하다.
- 이전에 비슷한 safe response가 있더라도, 보안 정책을 우회하면 안 된다.

---

# 9. 로그 저장 정책

## 9.1 Request-level log

P0에서는 `p0_llm_invocation_logs`와 Request Log API에 아래 masking field를 포함한다. 장기 ClickHouse mirror에서는 `llm_invocations`에도 같은 의미로 저장한다.

| Field | Type | 설명 |
|---|---:|---|
| `maskingAction` | string | `none`, `redacted`, `blocked` |
| `maskingDetectedTypes` | array[string] | 탐지된 detector type 목록 |
| `maskingDetectedCount` | integer | 탐지 총 건수 |
| `securityPolicyVersionId` | string or null | 적용된 security policy version |
| `redactedPromptRef` | string or null | redacted prompt object storage reference |
| `redactedPromptPreview` | string or null | UI용 짧은 preview. raw value 금지 |

## 9.2 Masking event log

민감정보 탐지/마스킹/차단 결과는 별도 event로 남긴다.

```json
{
  "eventType": "masking.detected",
  "requestId": "request_01J...",
  "tenantId": "tenant_01J...",
  "projectId": "project_01J...",
  "userId": "user_01J...",
  "ruleId": "rule_01J...",
  "detectorType": "email",
  "action": "redact",
  "detectedCount": 1,
  "severity": "medium",
  "sampleHash": "hmac-sha256:...",
  "createdAt": "2026-06-22T06:00:00.000Z",
  "metadata": {
    "detectorVersion": "email-detector-v1",
    "policyVersionId": "policy_ver_01J..."
  }
}
```

`sampleHash`는 원문이 아니다. HMAC 결과만 저장한다.

## 9.3 Object Storage 저장

S3-compatible Object Storage에는 redacted payload만 저장한다.

권장 key:

```text
tenants/{tenantId}/projects/{projectId}/requests/{requestId}/redacted-prompt.json
tenants/{tenantId}/projects/{projectId}/requests/{requestId}/response-summary.json
```

저장 객체 예시:

```json
{
  "requestId": "request_01J...",
  "contentType": "redacted_prompt",
  "policyVersionId": "policy_ver_01J...",
  "redactedPrompt": "[EMAIL_REDACTED] 에게 보낼 답변을 작성해줘.",
  "createdAt": "2026-06-22T06:00:00.000Z"
}
```

금지:

- `raw-prompt.json`
- `original-prompt.json`
- `provider-request-raw.json`
- `headers.json` 원문 저장

원문 payload 저장 기능은 MVP에 없다.

---

# 10. API 기준

## 10.1 Gateway response metadata

Gateway response는 필요한 경우 masking metadata를 반환할 수 있다.

```json
{
  "gate_lm": {
    "requestId": "request_01J...",
    "cacheStatus": "miss",
    "routingReason": "low_cost",
    "maskingAction": "redacted",
    "maskingDetectedTypes": ["email"]
  }
}
```

주의:

- raw detected value를 반환하지 않는다.
- detected offset을 반환하지 않는다.
- 일반 Employee에게는 `detectedTypes`를 숨길 수 있다.
- Project Admin 이상에게만 상세 masking metadata를 노출한다.

## 10.2 Request Log Detail API

Request Detail Drawer는 redacted 정보만 보여준다.

```json
{
  "masking": {
    "action": "redacted",
    "detectedTypes": ["email", "phone_number"],
    "detectedCount": 2,
    "policyVersionId": "policy_ver_01J...",
    "redactedPromptPreview": "[EMAIL_REDACTED] 에게 [PHONE_NUMBER_REDACTED] 로 연락..."
  }
}
```

## 10.3 Analytics Masking API

`GET /api/analytics/masking`은 aggregate 중심이다.

허용:

- detector type별 count
- action별 count
- project별 masking count
- severity별 count
- time series

금지:

- raw sample 목록
- raw prompt 목록
- raw response 목록
- sampleHash 기본 노출

---

# 11. Runtime Policy 기준

## 11.1 Security Policy Shape

Security policy는 detector rule과 action rule을 분리한다.

```json
{
  "version": "2026-06-22.v1",
  "mode": "enforce",
  "rules": [
    {
      "id": "rule_email_default",
      "detectorType": "email",
      "enabled": true,
      "severity": "medium",
      "action": "redact"
    },
    {
      "id": "rule_api_key_default",
      "detectorType": "api_key",
      "enabled": true,
      "severity": "critical",
      "action": "block"
    }
  ],
  "customDetectors": [
    {
      "id": "custom_employee_id",
      "detectorType": "employee_id",
      "pattern": "\\bEMP-[0-9]{6}\\b",
      "severity": "medium",
      "action": "redact"
    }
  ]
}
```

## 11.2 Policy Mode

| Mode | 설명 | Provider 호출 |
|---|---|---:|
| `monitor` | 탐지하고 event만 남김. 저장 전 redaction은 유지 | Y |
| `enforce` | policy action 적용 | action에 따름 |
| `strict` | high/critical은 무조건 block | action에 따름 |

MVP 기본값은 `enforce`다.

주의:

- `monitor` mode여도 저장 전 raw value 저장은 금지다.
- `monitor` mode는 Provider 호출 전 redaction을 끄는 모드가 아니다. redaction 대상은 여전히 redaction한다.
- `monitor`는 주로 새 custom detector의 false positive를 관찰하기 위한 모드다.

## 11.3 Policy Target

Security policy는 아래 대상에 binding될 수 있어야 한다.

```text
tenant
project
application
user
api_key
app_token
group       # future
department  # future
```

우선순위:

```text
app_token > api_key > user > application > project > tenant
```

더 구체적인 policy가 상위 policy를 완전히 대체할지, merge할지는 policy schema에 명시한다. MVP 기본은 “상속 후 override”다.

---

# 12. Frontend 표시 기준

## 12.1 Dashboard

Dashboard에는 아래 지표를 표시할 수 있다.

- masking event count
- blocked request count
- redacted request count
- detector type별 count
- project별 count
- severity별 count
- time series

Dashboard에 표시하지 않는 것:

- raw prompt
- raw response
- raw detected value
- sampleHash
- secret prefix/suffix

## 12.2 Request Detail Drawer

Detail Drawer는 masking 결과를 설명하되 민감값을 노출하지 않는다.

표시 예:

```text
Masking Action: redacted
Detected Types: email, phone_number
Detected Count: 2
Security Policy: policy_ver_01J...
```

Block된 요청 표시 예:

```text
Masking Action: blocked
Detected Types: api_key
Reason: Request blocked by security policy before provider call.
Provider Cost: 0
```

## 12.3 권한별 노출

| Role | masking summary | detected types | redacted preview | policy id | sample hash |
|---|---:|---:|---:|---:|---:|
| Employee | Y | N | N | N | N |
| Developer | Y | Y | 제한적 | N | N |
| Project Admin | Y | Y | Y | Y | N |
| Tenant Admin | Y | Y | Y | Y | 권장 N |
| GateLM Operator | Y | Y | 필요한 경우 | Y | 필요한 경우 internal only |

sampleHash는 기본적으로 UI에 노출하지 않는다.

---

# 13. Error Code 기준

민감정보 관련 표준 error code:

| Error Code | HTTP | 설명 |
|---|---:|---|
| `sensitive_data_blocked` | 403 | Security policy로 Provider 호출 전 차단 |
| `SECURITY_POLICY_NOT_FOUND` | 500 또는 503 | active security policy snapshot 없음 |
| `SECURITY_POLICY_INVALID` | 500 | policy compile/validation 실패 |
| `MASKING_ENGINE_ERROR` | 500 또는 503 | detector/redaction engine 장애 |
| `CUSTOM_DETECTOR_INVALID` | 400 | custom detector 등록/수정 validation 실패 |

Fail-closed 기준:

- active security policy가 없거나 손상된 경우 기본 fail-closed다.
- 단, 운영 정책으로 low-risk detector만 fail-open을 허용할 수 있다.
- `api_key`, `authorization_header`, `resident_registration_number` 관련 detector 실패는 fail-closed다.

---

# 14. 테스트 기준

## 14.1 Unit Test

각 detector는 아래 케이스를 가진다.

- 정상 탐지
- separator 변형
- 대소문자 변형
- markdown/code block 내 탐지
- false positive 후보
- unicode/한글 주변 문자
- 여러 값 동시 탐지
- offset 정확도
- redaction 결과

## 14.2 Integration Test

Gateway 통합 테스트는 아래를 확인한다.

- email 포함 요청은 redacted prompt로 Provider adapter에 전달된다.
- phone 포함 요청은 redacted prompt로 Provider adapter에 전달된다.
- api_key 포함 요청은 P0에서 Provider 호출 전 block된다.
- resident_registration_number 포함 요청은 Provider adapter가 호출되지 않는다.
- block 요청도 P0 request log와 masking metadata를 남긴다. 장기 이벤트 경로에서는 invocation/masking event로 발행한다.
- cache key는 raw prompt를 포함하지 않는다.
- Gateway response와 logs에 raw sensitive value가 없다.

## 14.3 Test Fixture 보안

금지:

- 실제 API Key 사용
- 실제 이메일/전화번호/주민번호 사용
- 실제 고객사 키워드 사용
- production log를 복사한 fixture 사용

허용:

- `example.invalid` 도메인
- 명확히 invalid한 synthetic token
- dummy placeholder
- deterministic fake data generator

테스트 fixture 이름 예:

```text
email_basic_redaction.fixture.json
api_key_blocks_before_provider_call.fixture.json
rrn_blocks_request.fixture.json
phone_redacts_before_cache.fixture.json
```

---

# 15. 구현 위치 기준

## 15.1 Gateway Core

```text
apps/gateway-core/internal/pipeline/stages/masking/
├── stage.go
├── detector_registry.go
├── policy_evaluator.go
├── redaction_engine.go
├── detectors/
│   ├── email.go
│   ├── phone_number.go
│   ├── api_key.go
│   ├── authorization_header.go
│   ├── jwt.go
│   ├── resident_registration_number.go
│   ├── account_id.go
│   ├── employee_id.go
│   └── internal_keyword.go
└── masking_test.go
```

## 15.2 Control Plane API

Security policy 관리 API는 기존 policy module 안에 둔다.

```text
apps/control-plane-api/src/modules/policies/
├── controllers/security-policies.controller.ts
├── dto/security-policy.dto.ts
├── services/security-policy.service.ts
├── repositories/security-policy.repository.ts
└── mappers/security-policy.mapper.ts
```

별도 `pii` top-level module을 만들지 않는다. 민감정보 정책은 Runtime Policy의 한 종류다.

## 15.3 Worker

```text
apps/worker/src/modules/masking-events/
├── consumers/masking-event.consumer.ts
├── writers/masking-event-clickhouse.writer.ts
├── dto/masking-event.dto.ts
└── masking-event.module.ts
```

## 15.4 Web

```text
apps/web/src/features/policies/security/
apps/web/src/features/request-logs/components/masking-summary.tsx
apps/web/src/features/dashboard/components/masking-metrics-card.tsx
```

---

# 16. 금지 사항

아래는 금지한다.

- Provider 호출 후에만 마스킹하는 구현
- raw prompt를 로그에 저장하는 구현
- raw response를 로그에 저장하는 구현
- raw API Key나 App Token을 error message에 넣는 구현
- detector sample을 DB에 원문 저장하는 구현
- Redis key에 raw prompt를 넣는 구현
- cache embedding을 raw prompt로 생성하는 구현
- `maskingAction` 값을 문서 없이 새로 추가하는 구현
- detector type을 TypeScript union이나 DB enum으로 닫는 구현
- tenant별 임시 if문으로 보안 정책을 처리하는 구현
- custom regex를 validation 없이 publish하는 구현
- 테스트에 실제 secret이나 개인정보를 넣는 구현
- Dashboard에 sampleHash나 raw detected value를 표시하는 구현
- masking block을 error rate에 섞어 장애처럼 계산하는 구현
- 보안 관련 코드 변경을 리뷰 없이 merge하는 구현

---

# 17. MVP 구현 체크리스트

Gateway:

```text
[ ] masking stage가 Provider 호출 전에 실행된다.
[ ] detector registry가 확장 가능하다.
[ ] email detector가 있다.
[ ] phone_number detector가 있다.
[ ] api_key detector가 있다.
[ ] authorization_header detector가 있다.
[ ] jwt detector가 있다.
[ ] resident_registration_number detector가 있다.
[ ] action = block이면 Provider adapter가 호출되지 않는다.
[ ] action = redact이면 API Key 원문이 Provider로 전달되지 않는다.
[ ] action = redact이면 redacted prompt만 Provider로 전달된다.
[ ] cache key는 redacted prompt 기준이다.
[ ] raw prompt가 technical log에 남지 않는다.
```

Worker / Log:

```text
[ ] masking event가 Redpanda로 발행된다.
[ ] Worker가 llm_masking_events에 저장한다.
[ ] sampleHash는 HMAC 기반이다.
[ ] raw sample은 저장하지 않는다.
[ ] P0에서는 p0_llm_invocation_logs에 maskingAction, maskingDetectedTypes, maskingDetectedCount가 저장된다.
```

API / Dashboard:

```text
[ ] Request Log API가 masking summary를 반환한다.
[ ] Detail Drawer가 redacted preview만 보여준다.
[ ] Analytics masking API가 aggregate만 반환한다.
[ ] Dashboard가 redacted/blocked request count를 표시할 수 있다.
[ ] block request는 error rate와 분리된다.
```

Policy:

```text
[ ] security policy가 versioned다.
[ ] tenant/project/application/user/app_token 단위 binding을 고려한다.
[ ] custom regex validation이 있다.
[ ] policy 변경 audit log가 남는다.
[ ] high/critical detector fail-closed 기준이 있다.
```

---

# 18. AI 구현자 지침

AI가 민감정보 관련 코드를 작성할 때는 먼저 아래 계획을 제시해야 한다.

```text
1. 어떤 detector/action/policy를 변경하는가
2. Gateway pipeline 중 어느 stage를 수정하는가
3. Provider 호출 전 redaction/block이 보장되는가
4. raw prompt/raw response/raw secret이 저장되지 않는가
5. llm-log-schema.md, db-schema.md, api-spec.md 영향이 있는가
6. 테스트에 실제 개인정보나 secret이 들어가지 않는가
7. 보안 리뷰가 필요한 변경인가
```

AI는 아래 요청을 받으면 바로 구현하지 말고 문서 수정 또는 리뷰 필요성을 설명해야 한다.

- raw prompt를 잠시만 로그에 남기자는 요청
- API Key sample을 테스트에 넣자는 요청
- provider request 전체를 debug log에 남기자는 요청
- masking stage를 cache 뒤로 옮기자는 요청
- block된 요청은 로그를 생략하자는 요청
- detector false positive가 있으니 API Key detector를 끄자는 요청
- custom regex validation을 생략하자는 요청

민감정보 보호 코드는 제품 신뢰의 핵심이다. 빠른 구현보다 안전한 경계와 추적 가능성이 우선이다.
