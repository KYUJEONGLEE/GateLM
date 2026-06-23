# GateLM Post-MVP Scope v0.1

## 문서 목적

이 문서는 P0 구현에서 제외하거나 P1/P2로 내려야 하는 기능을 명확히 정리한다. 구현 중 기능 욕심이 생길 때 이 문서를 기준으로 멈춘다.

---

## 1. Scope Gate

새 기능을 시작하기 전에 아래 질문에 답한다.

```text
1. P0 acceptance checklist를 더 빨리 통과하게 만드는가?
2. Gateway vertical slice를 깨지 않는가?
3. raw prompt/raw response/secret 처리 기준을 복잡하게 만들지 않는가?
4. 1명이 하루 안에 통합까지 끝낼 수 있는가?
5. 데모 실패 위험보다 제품 가치가 큰가?
```

하나라도 `아니오`면 P1/P2로 미룬다.

---

## 2. P1 후보

P1은 P0 완료 후 시간이 남을 때만 진행한다.

| 기능 | P1로 둔 이유 | 시작 조건 | 완료 기준 |
|---|---|---|---|
| SSE Streaming | OpenAI-compatible 완성도 향상 | non-stream 안정화 | stream=true 응답과 final event 기록 |
| Redpanda 실제 연동 | 응답/분석 경로 분리 실연 | log direct writer 안정화 | event consume 후 log 저장 |
| ClickHouse 실제 집계 | dashboard 성능/구조 실연 | request log API 완료 | overview query가 ClickHouse에서 조회 |
| Project Rate Limit | 사용량 통제 가치 | Redis 연결 안정화 | RPM 초과 시 Provider 전 차단 |
| Budget hard block | 비용 통제 가치 | costMicroUsd 계산 완료 | 월 예산 초과 시 Provider 전 차단 |
| Provider connection test | admin UX 향상 | mock/real adapter 안정화 | test API가 healthy/unhealthy 반환 |
| Chat UI Reply-to Context | 제품 사용성 향상 | Gateway context 구조 안정화 | parent message 1단계만 포함 |
| Dashboard charts | 발표 시각화 | overview cards 완료 | requests/cost/time chart 1~2개 |

---

## 3. P2 후보

P2는 문서와 interface만 남기고 이번 교육 프로젝트에서 구현하지 않는다.

| 기능 | P2로 내리는 이유 | P0 대체안 |
|---|---|---|
| Semantic Cache 실제 embedding | vector store, threshold, false positive, 보안 기준 필요 | Exact Cache만 구현 |
| AI Service routing score | simple routing으로 데모 충분 | prompt length 기반 routing |
| CEL Policy editor/evaluator | 정책 엔진만으로도 별도 프로젝트급 | JSON config 기반 policy |
| Policy rollback UI | version/binding UI 복잡 | seed policy 또는 단순 update |
| AWS Secrets Manager + KMS 실연 | 로컬 개발 복잡도 증가 | SecretStore interface + local resolver |
| S3 Object Storage | payload retention/암호화/권한 필요 | redacted preview/ref만 저장 |
| Terraform/AWS 배포 | 발표 가치 대비 비용 큼 | Docker Compose local demo |
| Custom regex detector UI | ReDoS validation, 보안 리뷰 필요 | built-in detector만 구현 |
| Advanced Dashboard | ClickHouse MV/rollup 설계 필요 | overview cards + request logs |
| Multi-provider fallback | adapter/attempt 비용 처리 복잡 | provider 1개 + mock |

---

## 4. 개별 기능 상세

### 4.1 Semantic Cache

P0에서는 구현하지 않는다.

이유:

```text
- embedding provider 또는 model 선택 필요
- vector store 또는 similarity index 필요
- threshold false positive가 보안/정확성 이슈를 만든다
- redacted prompt 기준 embedding을 강제해야 한다
- tenant/project 격리와 policy version cache key가 필요하다
```

P0 처리:

```text
- Gateway pipeline에 semantic_cache_lookup stage 이름만 남길 수 있다.
- 기본값은 disabled.
- disabled 상태에서는 즉시 miss를 반환한다.
- AI Service/vector DB를 임의로 추가하지 않는다.
```

P2 시작 조건:

```text
[ ] redacted embedding policy 확정
[ ] vector store schema 확정
[ ] similarity threshold 실험 기준 확정
[ ] tenant/project isolation test 확보
[ ] false positive 대응 정책 확정
```

### 4.2 CEL Runtime Policy

P0에서는 구현하지 않는다.

이유:

```text
- CEL parser/evaluator 통합 필요
- policy validation, versioning, publish, rollback이 필요
- 보안상 fail-open/fail-closed 기준이 복잡하다
- UI editor까지 붙이면 범위가 급증한다
```

P0 처리:

```json
{
  "routing": {
    "mode": "simple",
    "lowCostModel": "mock-fast",
    "defaultModel": "mock-balanced",
    "simplePromptMaxChars": 500
  },
  "security": {
    "email": "redact",
    "phone_number": "redact",
    "resident_registration_number": "block",
    "api_key": "block",
    "jwt": "block"
  },
  "cache": {
    "exactCacheEnabled": true,
    "ttlSeconds": 3600
  }
}
```

P2 시작 조건:

```text
[ ] policy.schema.json 확정
[ ] runtime context schema 확정
[ ] validation API 확정
[ ] publish/rollback audit 확정
[ ] Gateway fail-closed 기준 확정
```

### 4.3 AWS Secrets Manager + KMS

P0에서는 local secret resolver로 대체한다.

P0 interface:

```text
SecretResolver.Resolve(secretRef) -> ProviderCredential
```

구현체:

```text
local-secret://mock-provider/test
local-secret://provider/<id>
```

금지:

```text
- provider key 원문을 PostgreSQL에 저장
- provider key 원문을 log/event/API response에 저장
- Web Console localStorage에 provider key 저장
```

P1/P2에서 실제 AWS 연동을 붙일 때도 interface는 유지한다.

### 4.4 S3-compatible Object Storage

P0에서는 object storage를 필수로 두지 않는다.

P0 처리:

```text
- redactedPromptPreview: DB/ClickHouse/API에 짧게 저장 가능
- responseSummary: 짧은 summary만 저장 가능
- redactedPromptRef/responseSummaryRef: null 가능
```

P2 시작 조건:

```text
[ ] object key 규칙 확정
[ ] encryption 기준 확정
[ ] retention policy 확정
[ ] access audit 기준 확정
[ ] raw payload opt-in 정책 확정
```

### 4.5 Terraform / AWS 배포

P0에서는 하지 않는다.

이유:

```text
- 인프라 디버깅이 교육 프로젝트 시간을 잡아먹는다
- Gateway/Control Plane 자체 구현보다 발표 가치가 낮다
- secret, domain, TLS, IAM 설정이 추가된다
```

P0 대체:

```text
- Docker Compose local demo
- README 실행 순서
- healthz/readyz
```

### 4.6 Streaming

Streaming은 P1이다.

P0 처리:

```text
- request stream=true이면 400 또는 P1_NOT_IMPLEMENTED로 명확히 응답
- non-stream path를 먼저 완성
```

P1 시작 조건:

```text
[ ] non-stream Gateway 안정화
[ ] Provider adapter stream interface 확정
[ ] client disconnect 처리 기준 확정
[ ] stream final event schema 확정
[ ] chunk 원문 저장 금지 확인
```

---

## 5. P0에서 삭제해도 되는 UI/API

P0에서는 아래 화면/API를 만들지 않아도 된다.

```text
- 사용자 초대 이메일 발송
- member role management 전체
- provider key rotation
- policy version list/publish/rollback UI
- model catalog full CRUD
- custom sensitive data rule CRUD
- webhook endpoint 설정
- alert rule 설정
- billing/invoice 화면
- export/download 기능
```

단, DB/API 문서에 장기 구조가 남아 있는 것은 허용한다. 구현하지 않는다는 것이 중요하다.

---

## 6. Post-MVP Backlog 정리 방식

P1/P2 기능은 이 형식으로 backlog에 남긴다.

```text
제목:
- Semantic Cache MVP

라벨:
- P2

선행 조건:
- P0 exact cache 완료
- redacted embedding policy 확정

작업 범위:
- AI Service embedding endpoint
- vector store schema
- similarity threshold config
- cache event 확장

하지 않을 것:
- raw prompt embedding
- tenant 간 shared vector index

Acceptance:
- redacted prompt만 embedding
- tenant/project isolation test 통과
- false positive sample 검증
```
