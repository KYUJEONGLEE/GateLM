# GateLM Team Workplan v0.1

## 문서 목적

이 문서는 5명의 교육생이 2~3주 동안 GateLM을 바이브코딩으로 구현할 때의 역할, 일정, 협업 규칙을 정의한다. 목표는 기능을 많이 여는 것이 아니라 Gateway vertical slice를 안정적으로 완성하는 것이다.

---

## 1. 팀 운영 원칙

```text
1. Gateway vertical slice가 항상 1순위다.
2. 화면은 Gateway가 end-to-end로 돈 뒤 붙인다.
3. 작업은 2~4시간 단위로 자른다.
4. AI에게 전체 프로젝트 구현을 맡기지 않는다.
5. 문서에 없는 API/DB/Event는 만들지 않는다.
6. raw prompt/raw response/secret 원문 저장 변경은 보안 리뷰 대상이다.
7. 매일 마지막에는 통합 시나리오를 한 번 실행한다.
```

실행 기준 문서:

```text
범위 판단: docs/p0/p0-contract.md
테스트 판단: docs/p0/p0-test-matrix.md
리뷰/CI 판단: docs/p0/p0-review-and-ci-gate.md
데모 완료 판단: docs/p0/demo-acceptance.md
```

---

## 2. 5명 역할 분배

| 사람 | 1차 책임 | 2차 책임 | 완료 기준 |
|---|---|---|---|
| A | Control Plane API / PostgreSQL | seed, auth, project/application/key/token | Admin이 project와 key/token을 만들 수 있음 |
| B | Gateway Core | OpenAI-compatible endpoint, provider adapter | curl 요청이 mock provider까지 왕복 |
| C | Gateway Policy/Security/Cache | masking, exact cache, simple routing | redaction/block/cache/routing이 로그에 남음 |
| D | Worker/Analytics/Log API | invocation log, dashboard API, detail API | Request Log/Detail/Dashboard 조회 가능 |
| E | Web Console/Demo App | onboarding UI, dashboard UI, request detail | 발표 시나리오를 브라우저에서 실행 가능 |

B와 C는 Gateway를 같이 보지만 파일 경계를 나눈다.

```text
B: handler, pipeline skeleton, provider adapter, response shape
C: masking stage, cache stage, routing stage, policy/config stage
```

---

## 3. 2주 기본 일정

### Day 1 — Repository Skeleton

```text
A: control-plane-api skeleton, Prisma/NestJS bootstrap
B: gateway-core skeleton, healthz/readyz
C: masking/cache/routing package skeleton
D: worker/log schema skeleton, analytics storage 결정
E: web skeleton, login/onboarding layout
팀 공통: implementation-cut, demo-acceptance, local-dev 확인
```

완료 기준:

```text
docker compose up -d postgres redis mock-provider
control-plane healthz
gateway healthz
web local page
```

### Day 2 — Control Plane P0 Data

```text
A: users/tenants/projects/applications/api_keys/app_tokens/provider_connections schema + seed
B: Gateway config load 방식 결정
C: active config shape 초안
D: p0 invocation log table/DTO 초안
E: onboarding form skeleton
```

완료 기준:

```text
seed admin 로그인
Tenant/Project/Application/API Key/App Token seed 조회
```

### Day 3 — Gateway First Response

```text
A: API Key/App Token 발급 API
B: /v1/chat/completions + mock provider adapter
C: RequestContext와 stage interface 정리
D: invocation.finished event/log DTO
E: customer app demo curl 화면 또는 simple form
```

완료 기준:

```text
curl -> Gateway -> mock provider -> OpenAI-compatible response
```

### Day 4 — Auth + Context

```text
A: API Key/App Token hash 검증용 read model/API
B: Gateway authenticate/identify/appauth stage
C: fail-closed error handling
D: blocked/auth failed log 저장
E: Web에서 발급된 key/token 복사 UI
```

완료 기준:

```text
유효 key/token 요청 성공
잘못된 key/token 요청 Provider 호출 전 차단
```

### Day 5 — Masking / Cache / Routing

```text
A: security/routing/cache config seed
B: Gateway response headers/metadata
C: email/phone redact, credential/JWT/RRN block, exact cache, model=auto routing
D: masking/cache/routing fields 저장
E: Request Log UI skeleton
```

완료 기준:

```text
redaction/block/cache hit/routing이 curl과 log에서 확인됨
```

### Day 6 — Log / Detail

```text
A: request log query 권한 scope
B: event publish 실패 handling
C: stage별 metadata 정리
D: Request Log API + Detail API
E: Detail Drawer UI
```

완료 기준:

```text
Request Log 목록과 Detail Drawer에서 Gateway 결과 확인
```

### Day 7 — Dashboard

```text
A: dashboard API tenant/project filter
B: gateway log event 누락 field 보강
C: cache saving 계산 보강
D: Dashboard Overview API
E: Dashboard cards UI
```

완료 기준:

```text
total/success/blocked/tokens/cost/latency/cache 지표 표시
```

### Day 8 — 통합 안정화

```text
A: API validation/error code 정리
B: Gateway integration test
C: masking/cache/routing unit test
D: log/dashboard query test
E: UI flow polish
```

완료 기준:

```text
demo-acceptance 체크리스트 80% 이상 통과
```

### Day 9 — P1 하나만 선택

가능한 P1 중 하나만 선택한다.

```text
- Rate Limit
- Budget hard block
- Streaming
- Real OpenAI adapter
- Redpanda/ClickHouse 실제화
```

기준: 데모 안정성을 해치면 하지 않는다.

### Day 10 — 발표 리허설

```text
- seed reset 후 처음부터 데모
- curl script 검증
- screenshot/backup 준비
- README 실행 순서 검증
- raw secret 노출 여부 점검
```

---

## 4. 3주차가 있을 때

3주차는 새 기능보다 안정화에 쓴다.

```text
Day 11: 실제 Provider adapter 또는 rate limit/budget 중 하나 완성
Day 12: Dashboard chart 또는 streaming 중 하나 완성
Day 13: 테스트/버그 수정/보안 리뷰
Day 14: README, 발표 자료, 데모 영상
Day 15: 최종 통합, fallback demo 준비
```

---

## 5. Daily Sync 방식

매일 15분만 진행한다.

각자 아래만 말한다.

```text
1. 어제 완료한 end-to-end 영향
2. 오늘 GateLM 데모에 붙일 것
3. 막힌 API/DB/Event/보안 이슈
4. 오늘 통합 시나리오에서 깨질 가능성
```

금지:

```text
- 세부 구현 설명 길게 하기
- AI가 생성한 코드를 검토 없이 merge하기
- 문서 변경 없이 계약 변경하기
```

---

## 6. Daily Smoke Owner

매일 마지막에는 한 명을 smoke owner로 지정한다.

| 요일/일차 | 기본 owner | 확인 범위 |
|---|---|---|
| Day 1 | B | healthz/readyz, mock provider 연결 |
| Day 2 | A | seed admin, tenant/project/application/key/token |
| Day 3 | B | safe `/v1/chat/completions` |
| Day 4 | B | API Key/App Token 인증 실패 차단 |
| Day 5 | C | masking/cache/routing |
| Day 6 | D | Request Log/Detail |
| Day 7 | D | Dashboard Overview |
| Day 8 이후 | 당일 변경이 가장 큰 영역 담당자 | 전체 demo flow |

Smoke 실패 시 원칙:

```text
1. 새 기능 구현보다 smoke 복구를 우선한다.
2. 실패 requestId와 깨진 stage를 기록한다.
3. raw prompt/secret 노출 가능성이 있으면 즉시 보안 이슈로 올린다.
4. Dashboard 숫자 불일치는 Request Log canonical source부터 확인한다.
```

---

## 7. Branch / PR 규칙

Branch 이름:

```text
feature/p0-gateway-chat-completions
feature/p0-api-keys
feature/p0-request-logs
fix/masking-block-flow
```

PR 크기 기준:

```text
- 수정 파일 10개 이하 권장
- 목적 1개
- DB/API/Event 변경 여부 명시
- 보안 영향 여부 명시
- 테스트 결과 첨부
```

PR checklist:

```text
[ ] 관련 문서 확인
[ ] p0-contract 범위 안의 변경
[ ] API/DB/Event 변경 여부 표시
[ ] raw prompt/raw response 저장 없음
[ ] secret 원문 노출 없음
[ ] tenant/project scope 확인
[ ] p0-test-matrix 관련 항목 통과 또는 수동 검증 기록
[ ] 보안 리뷰 필요 여부 표시
[ ] rollback 또는 영향 범위 명시
```

---

## 8. Codex / Claude 사용 규칙

### 7.1 역할 분리

| 도구 | 주 사용처 |
|---|---|
| Codex | 작은 코드 패치, 테스트 추가, 리팩터링 |
| Claude | 설계 리뷰, API/DB/Event 검토, 테스트 케이스 작성 |
| ChatGPT | 범위 조정, 문서화, 구현 순서 점검 |

### 7.2 AI 작업 요청 템플릿

```text
목표:
- Gateway exact cache stage 구현

참조 문서:
- docs/p0/implementation-cut.md
- docs/architecture/gateway-flow.md
- docs/policies/pii-masking-policy.md
- docs/p0/p0-log-event-payload.md

수정 가능 파일:
- apps/gateway-core/internal/pipeline/stages/cache/*
- apps/gateway-core/internal/domain/cache/*
- apps/gateway-core/internal/adapters/redis/*

금지:
- raw prompt 저장 금지
- provider adapter 수정 금지
- 새 API 생성 금지
- DB schema 변경 금지

완료 기준:
- cache miss 시 provider 호출
- cache hit 시 provider 호출 없음
- cache key에 tenant/project/security policy hash 포함
- unit test 통과
```

### 7.3 AI 결과 리뷰 기준

```text
[ ] 문서에 없는 파일/폴더를 만들지 않았는가?
[ ] 임의 endpoint를 만들지 않았는가?
[ ] DB schema를 문서 없이 바꾸지 않았는가?
[ ] Provider 직접 호출 위치가 Gateway adapter 밖에 생기지 않았는가?
[ ] raw prompt/raw response/secret 로그가 생기지 않았는가?
[ ] tenant isolation이 빠지지 않았는가?
[ ] 테스트가 실제로 의미 있는가?
```

---

## 9. 통합 우선순위

충돌이 생기면 아래 순서로 결정한다.

```text
1. Gateway가 end-to-end로 도는가?
2. Provider 호출 전 보안 stage가 적용되는가?
3. 로그와 Dashboard에서 운영 가치가 보이는가?
4. UI가 발표 가능할 만큼만 충분한가?
5. P1 기능을 넣어도 데모 안정성이 깨지지 않는가?
```

---

## 10. 팀장 점검 질문

매일 팀장은 아래 질문만 집요하게 본다.

```text
- 오늘도 curl로 /v1/chat/completions가 도는가?
- Provider 직접 호출 코드가 Gateway 밖에 생겼는가?
- raw prompt나 secret이 저장되는가?
- requestId로 Gateway -> Log -> Detail까지 추적되는가?
- 새로운 기능이 P0 acceptance를 더 가깝게 만드는가?
```
