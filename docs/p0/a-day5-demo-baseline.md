# GateLM P0 Day5 Demo Baseline

## 1. 문서 목적

이 문서는 Day5 구현을 시작하기 전에 A가 B/C/D/E에게 먼저 공유하는 데모 기준선이다.

Day5의 목표는 새로운 기능을 많이 추가하는 것이 아니라, 이미 만든 Gateway 흐름을 같은 초기 상태에서 재현하고 발표 가능한 데모로 묶는 것이다.

```text
고객사 앱 또는 curl
-> GateLM Gateway
-> 인증 / 보안 / 라우팅 / 캐시
-> Mock Provider 또는 Cache 응답
-> Request Log / Detail / Dashboard 확인
```

Day5에서 A의 책임은 seed reset 절차와 demo credential을 고정해서, 모든 파트가 같은 데이터와 같은 요청으로 구현/검증하게 만드는 것이다.

---

## 2. Day5 시작 전 반드시 읽을 문서

Day5 구현자는 아래 문서만 우선 읽고 시작한다.

| 문서 | 읽는 이유 |
| --- | --- |
| `docs/p0/team-workplan.md` | Day5 역할과 산출물 확인 |
| `docs/p0/demo-acceptance.md` | 최종 데모 합격 기준 확인 |
| `docs/p0/p0-test-matrix.md` | 어떤 케이스를 통과해야 하는지 확인 |
| `docs/p0/p0-contract.md` | API, 상태값, 보안 금지 규칙 확인 |
| `docs/p0/local-dev.md` | 공통 로컬 실행 기준 확인 |
| `docs/p0/day3-shared-contract.md` | 보안, 라우팅, 캐시 공통 계약 확인 |
| `docs/p0/a-day4-log-scope-check.md` | 로그 조회 tenant/project scope 기준 확인 |
| `docs/p0/a-day5-demo-baseline.md` | Day5 데모 초기 상태와 실행 순서 확인 |

새 API, 새 DB 테이블, 새 Event 계약을 만들지 않는다. 필요하면 먼저 문서 변경을 공유한다.

---

## 3. Day5 공통 데모 credential

Day5 데모 요청은 아래 값을 기본값으로 사용한다.

| 항목 | 값 |
| --- | --- |
| Gateway Base URL | `http://localhost:8080` |
| Mock Provider Base URL | `http://localhost:8090` |
| API Key | `glm_api_test_redacted` |
| App Token | `glm_app_token_test_redacted` |
| Tenant ID | `00000000-0000-4000-8000-000000000100` |
| Project ID | `00000000-0000-4000-8000-000000000200` |
| Application ID | `00000000-0000-4000-8000-000000000300` |
| End User ID | `user_demo_001` |
| 기본 요청 모델 | `auto` |

공통 요청 헤더:

```http
Authorization: Bearer glm_api_test_redacted
X-GateLM-App-Token: glm_app_token_test_redacted
X-GateLM-End-User-Id: user_demo_001
X-GateLM-Feature-Id: day5-demo
```

주의:

- API Key/App Token 원문은 데모용 placeholder다.
- 실제 secret, 실제 고객 데이터, 실제 prompt 원문을 문서나 로그에 넣지 않는다.
- Request Log/Detail API는 raw prompt/raw response를 반환하면 안 된다.

---

## 4. 데모 시작 상태 reset 기준

### 4.1 기본 reset

Day5 데모 전 기본 reset은 아래 순서로 한다.

```powershell
docker compose up -d postgres redis mock-provider
```

DB migration과 seed는 아래 파일 순서 기준이다.

```text
db/migrations/001_create_identity_tables.sql
db/migrations/002_create_project_tables.sql
db/migrations/003_create_gateway_credentials.sql
db/migrations/004_create_provider_and_models.sql
db/migrations/005_harden_config_store_constraints.sql
db/migrations/006_create_p0_invocation_logs_fallback.sql
db/seeds/001_seed_p0_demo_data.sql
```

PowerShell에서 수동 적용 예시:

```powershell
Get-Content `
  .\db\migrations\001_create_identity_tables.sql, `
  .\db\migrations\002_create_project_tables.sql, `
  .\db\migrations\003_create_gateway_credentials.sql, `
  .\db\migrations\004_create_provider_and_models.sql, `
  .\db\migrations\005_harden_config_store_constraints.sql, `
  .\db\migrations\006_create_p0_invocation_logs_fallback.sql, `
  .\db\seeds\001_seed_p0_demo_data.sql |
  docker compose exec -T postgres psql -U gatelm -d gatelm -v ON_ERROR_STOP=1
```

Redis exact cache 초기화:

```powershell
docker compose exec -T redis redis-cli FLUSHDB
```

Mock Provider 호출 통계 초기화:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:8090/__mock/reset `
  -Body '{}' `
  -ContentType 'application/json'
```

### 4.2 로그 초기화 기준

기본값은 기존 로그를 삭제하지 않는 soft reset이다.

이유:

- Day4 이후 Request Log/Detail/Dashboard는 로그 누적을 기준으로 동작한다.
- 무조건 로그를 지우면 다른 파트가 만든 검증 데이터가 사라질 수 있다.
- Day5 데모 요청은 `X-GateLM-Feature-Id`를 `day5-*`로 넣어 구분한다.

발표 직전 완전히 깨끗한 데모가 필요할 때만 hard reset을 선택한다.

Hard reset은 팀 합의 후에만 수행한다.

```sql
delete from p0_llm_invocation_logs
where feature_id like 'day5-%';
```

---

## 5. Day5 데모 요청 시나리오

Day5 smoke와 발표 데모는 아래 순서로 맞춘다.

| 순서 | 케이스 | 기대 결과 |
| --- | --- | --- |
| 1 | 안전한 요청 1회차 | `200`, `status=success`, `cacheStatus=miss`, Provider 호출 1회 |
| 2 | 같은 요청 2회차 | `200`, `status=cache_hit`, `cacheStatus=hit`, Provider 호출 증가 없음 |
| 3 | `model=auto` 짧은 요청 | `requestedModel=auto`, `selectedModel=mock-fast`, routing reason 기록 |
| 4 | 이메일/전화번호 포함 요청 | Provider 호출 전 redaction, raw PII 미노출 |
| 5 | API Key/JWT/RRN 유사 문자열 포함 요청 | `403`, `status=blocked`, Provider 호출 없음, 비용 0 |
| 6 | 로그 목록 조회 | 같은 Project scope에서 requestId 확인 가능 |
| 7 | 로그 상세 조회 | routing/cache/masking/cost/latency 확인 가능 |
| 8 | Dashboard 조회 | total/success/blocked/cache count가 로그 기준으로 반영 |

Feature ID 권장값:

```text
day5-safe-demo
day5-cache-demo
day5-routing-demo
day5-redaction-demo
day5-block-demo
```

---

## 6. 데모 요청 예시

### 6.1 안전 요청

```powershell
$headers = @{
  "Content-Type" = "application/json"
  "Authorization" = "Bearer glm_api_test_redacted"
  "X-GateLM-App-Token" = "glm_app_token_test_redacted"
  "X-GateLM-End-User-Id" = "user_demo_001"
  "X-GateLM-Feature-Id" = "day5-safe-demo"
}

$body = @{
  model = "auto"
  messages = @(
    @{
      role = "user"
      content = "이번 주 캠페인 성과를 한 문단으로 요약해줘."
    }
  )
  temperature = 0.2
  max_tokens = 128
  stream = $false
} | ConvertTo-Json -Depth 5

Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:8080/v1/chat/completions `
  -Headers $headers `
  -Body $body
```

### 6.2 마스킹 요청

```text
이번 주 캠페인 성과가 좋은 고객 3명에게 보낼 후속 메시지를 작성해줘.
김민지 / minji.kim@example.test / 010-0000-1234
이준호 / junho.lee@example.test / 010-0000-5678
박서연 / seoyeon.park@example.test / 010-0000-9012
```

기대 결과:

```text
maskingAction=redacted
maskingDetectedTypes에 email, phone_number 포함
Provider input과 Request Detail에는 redacted preview만 존재
raw email/phone 원문 미노출
```

### 6.3 차단 요청

```text
이 요청에는 테스트용 credential marker가 포함되어 있습니다.
api_key=test_secret_token_redacted_for_demo_only
```

기대 결과:

```text
HTTP 403
errorCode=sensitive_data_blocked
status=blocked
cacheStatus=bypass
costMicroUsd=0
Provider 호출 없음
```

---

## 7. DB 확인 쿼리

Seed identity 확인:

```sql
select
  t.slug as tenant_slug,
  p.slug as project_slug,
  a.slug as application_slug,
  ak.key_prefix,
  at.token_prefix
from tenants t
join projects p on p.tenant_id = t.id
join applications a on a.project_id = p.id
left join api_keys ak on ak.application_id = a.id
left join app_tokens at on at.application_id = a.id
where t.id = '00000000-0000-4000-8000-000000000100';
```

Model catalog 확인:

```sql
select provider, model, status
from model_catalog
order by provider, model;
```

Day5 로그 확인:

```sql
select
  feature_id,
  request_id,
  status,
  http_status,
  cache_status,
  masking_action,
  selected_model,
  routing_reason,
  total_tokens,
  cost_micro_usd,
  created_at
from p0_llm_invocation_logs
where feature_id like 'day5-%'
order by created_at desc;
```

---

## 8. 역할별 Day5 구현 기준

| 역할 | Day5 기준 |
| --- | --- |
| A | seed reset 절차와 demo credential 기준을 유지한다. |
| B | safe/cache/provider smoke가 같은 credential로 통과해야 한다. |
| C | auth/context/routing demo case가 같은 tenant/project/application 기준을 써야 한다. |
| D | redaction/block/cache safety가 Provider 호출 전 적용되어야 한다. |
| E | Web Console 또는 demo page에서 log/detail/dashboard 결과를 같은 requestId로 보여줘야 한다. |

구현 순서:

```text
1. A 문서를 먼저 공유한다.
2. B/C/D/E는 이 문서의 credential과 featureId 기준으로 병렬 구현한다.
3. B/C/D는 gateway smoke를 먼저 맞춘다.
4. E는 smoke 결과 requestId를 화면/API에 연결한다.
5. 마지막 통합은 E의 Day5 smoke/demo flow로 검증한다.
```

머지 순서 권장:

```text
A 문서 PR
-> B/C/D 중 smoke에 영향이 작은 PR부터
-> E Web Console / demo flow PR
-> Day5 통합 smoke fix PR
```

---

## 9. Day5 완료 기준

Day5는 아래 조건을 만족하면 완료로 본다.

```text
[ ] 같은 reset 절차로 모든 팀원이 같은 데모 시작 상태를 만들 수 있다.
[ ] 같은 API Key/App Token으로 Gateway 요청을 보낼 수 있다.
[ ] safe request, cache hit, routing, redaction, block을 재현할 수 있다.
[ ] Request Log, Request Detail, Dashboard에서 같은 requestId를 추적할 수 있다.
[ ] raw prompt/raw response/secret 원문이 API 응답, 로그, 화면에 노출되지 않는다.
[ ] 발표자가 숨겨진 로컬 상태를 설명하지 않아도 데모 흐름이 이해된다.
```

