# GateLM 프로젝트 개요 — P0/P1/P2 구현 범위 반영본

## 프로젝트 이름

**GateLM**

## 한줄 설명

GateLM은 기업의 승인된 LLM 사용 경로를 하나의 Gateway로 통합해 **비용 절감, 사용량 통제, 민감정보 보호, 운영 가시성**을 제공하는 B2B GateLM 플랫폼이다.

---

## 1. 핵심 문제

기업과 개발팀은 OpenAI, Anthropic, Gemini 등 여러 LLM Provider를 사용하면서 다음 문제를 각자 직접 해결해야 한다.

```text
- Provider별 API 차이와 Key 관리가 분산된다.
- 팀, 프로젝트, 사용자, 애플리케이션 단위의 사용량과 예산 통제가 어렵다.
- 반복 요청이나 단순 요청에도 불필요하게 고가 모델이 호출되어 비용이 증가한다.
- 개인정보, API Key, 사내 기밀 정보가 외부 LLM Provider로 전달될 위험이 있다.
- 장애, 지연, 비용 폭증이 발생했을 때 어떤 요청이 어떤 모델과 정책을 거쳤는지 추적하기 어렵다.
```

GateLM은 고객사 애플리케이션, 사내 Chat UI, 개발 도구와 LLM Provider 사이에 Gateway를 두어 인증, 정책, 캐시, 라우팅, 마스킹, 로깅을 중앙에서 처리한다.

---

## 2. 타깃 사용자

### 2.1 1차 주요 사용자

| 사용자 | 설명 |
|---|---|
| Tenant Admin | 고객사 전체 관리자. Tenant 생성, 사용자 초대, 전사 정책과 Provider Key 관리 |
| Project Admin | 프로젝트 또는 팀 단위 사용량, 예산, 모델 제한, 정책 관리 |
| Developer | 기존 사내 앱, IDE, CLI, API Client를 GateLM Gateway에 연동 |
| 고객사 개발/운영자 | Gateway 연동 상태, 요청 로그, 장애 원인, 라우팅 결과 확인 |

### 2.2 보조 사용자

| 사용자 | 설명 |
|---|---|
| Employee | GateLM Chat UI 또는 고객사 기존 서비스에서 LLM 사용 |
| 서비스 관리자 | Tenant 관리, 시스템 운영, 장애 대응 |

---

## 3. 구현 범위 라벨 기준

| 라벨 | 의미 |
|---|---|
| P0 | 2~3주 안에 반드시 구현해야 하는 데모 필수 범위 |
| P1 | P0 완료 후 시간이 남으면 구현하는 확장 범위 |
| P2 | 문서에는 남기되 이번 교육 프로젝트 구현에서는 제외하는 장기 범위 |
| 제외 | GateLM 방향과 맞지 않거나 MVP에서 명시적으로 하지 않는 기능 |

---

## 4. P0 구현 범위

P0의 핵심은 “기업이 GateLM을 도입하고, 기존 LLM 요청을 Gateway로 통과시키며, 비용·보안·사용량·로그를 통제하는 흐름”을 끝까지 보여주는 것이다.

### 4.1 SaaS 기반 도입 흐름 — P0 축소판

| 기능 | 라벨 | P0 구현 기준 |
|---|---:|---|
| 기업 Admin 로그인 | P0 | seed admin 또는 local login |
| Tenant 생성 | P0 | Web Console 또는 API |
| 사용자 초대 | P1 | P0는 seed member 또는 생략 가능 |
| Project 생성 | P0 | 필수 |
| Application 생성 | P0 | App Token 발급 대상 |
| Provider Key 등록 | P0 | mock provider 또는 local secret resolver |
| API Key 발급 | P0 | 원문 key 1회 반환, hash 저장 |
| App Token 발급 | P0 | 원문 token 1회 반환, hash 저장 |
| 기본 정책 설정 | P0 | JSON config 기반. CEL editor 아님 |

### 4.2 OpenAI 호환 Gateway API

| 기능 | 라벨 | P0 구현 기준 |
|---|---:|---|
| OpenAI-compatible API 제공 | P0 | `/v1/chat/completions`, `/v1/models` |
| API Key 인증 | P0 | Bearer key 검증 |
| App Token 검증 | P0 | `X-GateLM-App-Token` 검증 |
| Tenant/Project/User/Application 식별 | P0 | API Key/App Token metadata 기준 |
| Provider 호출 Proxy | P0 | mock provider 필수, 실제 provider adapter는 P1 선택 |
| Provider별 request/response 변환 | P0 | adapter interface 유지 |
| SSE Streaming 응답 중계 | P1 | non-stream 먼저 완성 |

### 4.3 비용 최적화

| 기능 | 라벨 | P0 구현 기준 |
|---|---:|---|
| 동일 요청 기반 Exact Cache | P0 | Redis 기반, raw prompt 저장 금지 |
| 기본 Semantic Cache | P2 | stage disabled/mock만 가능 |
| 기본 Model Routing | P0 | `model=auto` simple routing |
| 단순 요청의 저비용 모델 라우팅 | P0 | prompt length 기준으로 충분 |
| Cache Hit/Miss 기록 | P0 | Request Log/Dashboard 반영 |
| Cache savings 계산 | P1 | P0는 optional |

### 4.4 사용량 통제

| 기능 | 라벨 | P0 구현 기준 |
|---|---:|---|
| Project 단위 사용량 기록 | P0 | request log + usage fields |
| User/App Token 단위 기록 | P0 | field는 남김, UI filter는 P1 가능 |
| Rate Limit | P1 | RPM fixed window만 시간이 남으면 구현 |
| TPM/동시 요청 수 제한 | P2 | 구조만 유지 |
| 월 예산 또는 Quota 설정 | P1 | P0에서는 seed config 가능 |
| 초과 사용 시 Provider 호출 전 차단 | P1 | budget hard block 선택 구현 |

### 4.5 민감정보 보호

| 기능 | 라벨 | P0 구현 기준 |
|---|---:|---|
| 이메일 탐지 | P0 | redact |
| 전화번호 탐지 | P0 | redact |
| 주민등록번호 탐지 | P0 | block |
| API Key/credential-like token 탐지 | P0 | block |
| JWT 탐지 | P0 | block |
| Provider에는 redacted prompt 전달 | P0 | raw prompt 전달 금지 |
| 원문 Prompt/Response 저장 최소화 | P0 | 기본 저장 금지 |
| Custom regex rule UI | P2 | ReDoS 검증 필요 |

### 4.6 운영 가시성

| 기능 | 라벨 | P0 구현 기준 |
|---|---:|---|
| Usage Logging | P0 | invocation-level log |
| Token/Cost/Latency 계산 | P0 | mock usage + micro USD |
| Cache/Routing/Masking 결과 기록 | P0 | request detail 필드 |
| Event Bus 기반 비동기 로그 처리 | P1 | P0 shortcut 허용 |
| Dashboard Overview | P0 | cards 중심 |
| Request Log / Detail Drawer | P0 | raw prompt/response 미표시 |
| Policy Control UI | P1 | P0는 단순 설정 화면 또는 seed |

### 4.7 Text-only Chat UI

| 기능 | 라벨 | P0 구현 기준 |
|---|---:|---|
| 텍스트 기반 Chat UI | P1 | P0에서는 customer app demo로 대체 가능 |
| Conversation Reply-to Context | P1 | parent 1단계만 |
| 파일/이미지/OCR/RAG 없는 순수 텍스트 | P0 원칙 | 해당 입력은 거부 |

### 4.8 고객사 앱 연동 예시

| 기능 | 라벨 | P0 구현 기준 |
|---|---:|---|
| 기존 LLM endpoint를 GateLM Gateway로 변경 | P0 | curl 또는 simple demo app |
| 인증/정책/캐시/라우팅/마스킹/로깅 적용 | P0 | 데모 핵심 |

---

## 5. P1 구현 범위

P1은 P0 완료 후 데모 안정성을 해치지 않을 때만 구현한다.

```text
- SSE Streaming
- Redpanda 실제 연동
- ClickHouse 실제 집계
- Project 단위 Rate Limit
- Project monthly Budget hard block
- Provider connection test
- Chat UI Reply-to Context
- Dashboard time-series chart
- 실제 OpenAI-compatible provider adapter 1개
```

---

## 6. P2 구현 범위

P2는 이번 교육 프로젝트에서 구현하지 않는다. 문서와 interface만 남긴다.

```text
- Semantic Cache 실제 embedding/vector store
- AI Service routing score
- CEL 기반 Runtime Policy editor/evaluator
- Policy publish/rollback UI 완성
- S3-compatible Object Storage 실연
- AWS Secrets Manager + KMS 실연
- Terraform/AWS 배포
- Custom regex detector UI
- 고급 dashboard와 materialized view
- Self-hosted/Hybrid 상품화
```

---

## 7. 명시적 제외 기능

아래 기능은 P0/P1/P2와 별개로 이번 MVP에서 하지 않는다.

```text
- 공식 ChatGPT / Gemini / Claude 웹사이트 사용을 투명하게 GateLM Gateway로 강제 우회
- 파일 업로드
- 이미지 입력
- OCR
- RAG 기반 문서 검색
- 파일 분석
- 복잡한 AgentOps Trace
- 완전한 OPA 정책 서버
- Kubernetes 배포
- Redis Cluster
- gRPC 내부 통신
- Envoy 프록시 계층
- 고급 NLP 기반 기밀정보 탐지
```

---

## 8. P0 최종 데모 시나리오

```text
1. Admin이 GateLM에 로그인한다.
2. Tenant와 Project를 생성한다.
3. Application을 만들고 mock Provider Connection을 등록한다.
4. API Key와 App Token을 발급한다.
5. 개발자가 고객사 앱의 LLM endpoint를 GateLM Gateway로 변경한다.
6. 고객사 앱 또는 curl에서 /v1/chat/completions 요청을 보낸다.
7. Gateway가 인증, App Token 검증, context 식별을 수행한다.
8. safe 요청은 mock Provider로 전달되고 usage/cost/latency가 기록된다.
9. 동일 요청 2회차는 Exact Cache hit로 처리된다.
10. model=auto 요청은 mock-fast로 simple routing된다.
11. 이메일 포함 요청은 redacted prompt로 Provider에 전달된다.
12. credential-like/JWT/RRN 포함 요청은 Provider 호출 전에 차단된다.
13. Dashboard에서 total requests, cost, tokens, latency, cache, blocked count를 확인한다.
14. Request Detail Drawer에서 routing/cache/masking 결과를 확인한다.
```

---

## 9. 방향성 원칙

```text
- GateLM은 단순 Chat UI 서비스가 아니라 LLM Gateway 서비스다.
- 모든 승인된 LLM 요청은 GateLM Gateway를 통과해야 한다.
- 응답 경로와 분석 경로를 분리한다.
- 비용 절감과 보안 통제가 핵심 가치다.
- Provider 호출 전 마스킹/차단이 기본이다.
- 원문 Prompt/Response는 기본적으로 영속 저장하지 않는다.
- 정책은 장기적으로 Runtime Policy로 관리하지만 P0는 JSON config로 단순화한다.
- 문서에 없는 API, Event, DB 구조를 임의로 만들지 않는다.
```
