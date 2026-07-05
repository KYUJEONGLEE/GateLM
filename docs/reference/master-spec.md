# GateLM Master Spec

> v1.0.0 범위 안내: 이 문서는 제품 전체 방향과 장기 후보를 포함한다. 현재 구현 목표와 우선 계약은 `docs/archive/v1.0.0/contracts.md`와 `docs/archive/v1.0.0/implementation-plan.md`를 따른다. 이 문서의 `P0`, `MVP`, `1차 구현`, `P1/P2` 표현이 v1.0.0 문서와 충돌하면 v1.0.0 문서를 우선한다. 과거 P0 기준은 `docs/archive/p0/*`에서 참고한다.

## 1. 프로젝트 한 줄 설명

**GateLM**은 고객사의 승인된 LLM 사용 경로를 하나의 Gateway로 통합해 **비용 절감, 사용량 통제, 민감정보 보호, 운영 가시성**을 제공하는 B2B GateLM 플랫폼이다.

## 2. 프로젝트 목표

기업과 개발팀은 여러 LLM Provider를 사용하면서 비용, 보안, 장애, 정책 관리, 사용량 추적 문제를 직접 해결해야 한다.

GateLM은 애플리케이션, 사내 Chat UI, 개발 도구와 LLM Provider 사이에 Gateway를 두고, 기업에서 승인한 LLM 요청을 중앙에서 제어한다.

핵심 목표는 다음과 같다.

- 여러 Provider 호출을 하나의 API로 통합한다.
- 반복 요청과 부적절한 모델 사용을 줄여 토큰 비용을 절감한다.
- 조직, 프로젝트, 사용자 단위로 사용량과 예산을 통제한다.
- Provider 호출 전에 민감정보를 탐지하고 마스킹한다.
- 요청, 응답, 비용, 토큰, 지연시간, 캐시, 라우팅 결과를 추적한다.
- 관리자가 Web Console에서 정책과 사용 현황을 확인하고 운영할 수 있게 한다.
- 기업 Admin 가입, 사용자 초대, 프로젝트 생성, App Token 발급까지 포함한 B2B 도입 흐름을 제공한다.

## 3. 서비스 사용자

| 사용자 | 역할 |
|---|---|
| Tenant Admin | 고객사 전체 관리자. Tenant 생성, 사용자 초대, 전사 정책과 Provider Key 관리 |
| Project Admin | 프로젝트/팀 단위 사용량, 예산, 모델 제한, 정책 관리 |
| Developer | 기존 사내 앱, IDE, CLI, API Client를 GateLM Gateway에 연동 |
| Employee | GateLM Chat UI 또는 고객사 기존 서비스에서 LLM 사용 |
| 고객사 개발/운영자 | Gateway 연동, 로그 상세, 장애 원인, 라우팅 결과 확인 |
| 우리 서비스 관리자 | Tenant 관리, 시스템 운영, 장애 대응 |

## 4. 서비스 방식

GateLM은 단순 Chat UI 서비스가 아니다.

핵심은 기업의 승인된 LLM 사용 경로를 Gateway로 통합하는 것이다.

Chat UI는 고객사가 자체 LLM UI를 가지고 있지 않을 때 제공하는 옵션 중 하나다.

### 4.1 SaaS 기반 기업 도입 흐름

기본 제공 방식은 B2B SaaS다.

```text
GateLM 소개 페이지
-> 기업 Admin 가입
-> Tenant 생성
-> 사용자 초대
-> Project 생성
-> Provider Key 등록
-> API Key / App Token 발급
-> 정책 설정
-> Gateway 연동
```

관리자는 Web Console에서 회사, 프로젝트, 사용자, 애플리케이션 단위 정책을 설정한다.

### 4.2 Gateway API 연동

고객사의 기존 서비스는 OpenAI, Anthropic, Gemini 등을 직접 호출하지 않고 GateLM Gateway API를 호출한다.

이 방식이 GateLM의 핵심 사용 방식이다.

```text
Customer App
-> GateLM Gateway
-> Provider Routing
-> OpenAI / Anthropic / Gemini / Local Model
```

Gateway는 OpenAI-compatible API를 제공하여 기존 OpenAI API 호출 구조를 최대한 적게 바꾸도록 한다.

### 4.3 사내 Chat UI 제공

고객사가 별도 LLM UI를 가지고 있지 않은 경우, 우리가 텍스트 기반 Chat UI를 제공한다.

```text
Employee
-> GateLM Chat UI
-> GateLM Gateway
-> LLM Provider
```

Chat UI는 필수 사용 경로가 아니라 제공 옵션이다.

P1 Chat UI 후보에서는 **텍스트 기반 채팅만 지원**한다.

문서 업로드, 이미지 입력, 파일 분석, OCR, RAG는 1차 범위에서 제외한다.

### 4.4 개발 도구 / API Client 연동

OpenAI-compatible base URL 설정을 지원하는 IDE, CLI, 내부 도구는 GateLM Gateway로 연결할 수 있다.

```text
Developer Tool / CLI / Internal API Client
-> GateLM Gateway
-> LLM Provider
```

단, 공식 ChatGPT, Gemini, Claude 웹사이트처럼 endpoint를 바꿀 수 없는 외부 웹 UI는 GateLM Gateway를 직접 통과시키기 어렵다.

이 경우 회사 정책으로 직접 사용을 제한하고, 승인된 Chat UI 또는 Gateway 연동 경로를 제공해야 한다.

### 4.5 배포 방식

1차 기준은 SaaS다.

다만 보안 민감 기업을 고려해 향후 배포 방식은 아래 3가지로 확장 가능성을 둔다.

| 방식 | 설명 |
|---|---|
| SaaS | GateLM이 클라우드에서 Control Plane과 Gateway를 운영 |
| Self-hosted | 고객사 인프라에 GateLM Gateway와 주요 컴포넌트를 배포 |
| Hybrid | Control Plane은 SaaS, Gateway/Data Plane은 고객사 인프라에 배포 |

1차 구현과 발표에서는 **SaaS를 기본 방식**으로 설명하되, 보안 요구가 강한 기업에는 Hybrid/Self-hosted 확장 가능성을 언급한다.

## 5. 전체 아키텍처

```text
Customer App / Developer Tool / GateLM Chat UI
-> AWS ALB + ACM
-> Go Gateway Core
   -> API Key 인증
   -> Tenant / Project 식별
   -> App Token 검증
   -> Rate Limit / Quota 검사
   -> Runtime Policy 검사
   -> 민감정보 탐지 / 마스킹
   -> Model Routing
   -> Exact Cache 조회
   -> Semantic Cache 조회
   -> LLM Provider 호출
   -> 응답 반환
   -> 비동기 이벤트 발행

Control Plane
-> NestJS API
-> PostgreSQL
-> Redis
-> AWS Secrets Manager + KMS
   -> Tenant 관리
   -> 사용자 초대
   -> Project 관리
   -> API Key / App Token 발급
   -> Provider Key 관리
   -> 정책 관리

Async Processing
-> Redpanda
-> Worker
-> ClickHouse
-> PostgreSQL
-> S3-compatible Object Storage

Dashboard
-> Next.js
-> Control Plane API
-> Analytics API
```

핵심 원칙은 **응답 경로와 분석 경로를 분리**하는 것이다.

- 응답 경로: 사용자 응답에 필요한 작업만 빠르게 처리한다.
- 분석 경로: 로그 저장, 비용 분석, 대시보드 집계는 비동기로 처리한다.

## 6. 기술 스택

| 영역 | 권장 선택 | 이유 |
|---|---|---|
| Edge | AWS ALB + AWS ACM | TLS, HTTP 연결 관리, 기본 transport resilience |
| Gateway Core | Go | network proxy, SSE, 높은 동시성, 운영 단순성 |
| AI | Python(FastAPI) | Embedding, Model Provider Routing |
| Control Plane | NestJS(TypeScript) | 관리자 API, 인증/인가, 정책·키·테넌트 관리, Web Console과의 TypeScript 생태계 일관성 |
| Web | TypeScript + React/Next.js(ECharts) + shadcn/ui | 관리 콘솔과 dashboard |
| API Contract | OpenAPI + JSON Schema | 외부 API와 정책 schema 명세 |
| Runtime Policy | CEL + PostgreSQL + Redis | 사전 compile 가능한 안전한 expression |
| Control DB | PostgreSQL | tenant/config/key/policy/audit/budget ledger |
| Rate Limit / Exact Cache | Single Redis | atomic counter와 짧은 상태, 빠른 lookup |
| Event Bus | Redpanda | 비동기 metering, alert, analytics 분리 |
| Analytics | ClickHouse | 대량 invocation/attempt 분석 |
| Payload Storage | S3-compatible object storage | 암호화, lifecycle, retention |
| Secrets | AWS Secrets Manager + AWS KMS | Provider credential 격리 및 회전 |
| Observability | 언어 자체 로깅 + JSON 구조화 | 시스템 metric과 제품 traffic 분석 분리 |
| Deployment | Docker Compose + EC2 | Data Plane 수평 확장과 독립 배포 |
| Delivery | Terraform + Github Actions CI/CD | 선언적 인프라와 정책화된 배포 |

## 7. 도입하지 않는 선택지

현재 프로젝트에서는 아래 기술을 1차 구현 범위에서 제외한다.

| 제외 항목 | 제외 이유 |
|---|---|
| Envoy | Gateway Core를 직접 구현하므로 프록시 계층을 추가하지 않음 |
| gRPC | 서비스 수가 많지 않고 REST/JSON으로 충분함 |
| OPA | 정책 서버를 별도로 운영하기에는 복잡도가 큼 |
| Redis Cluster | 초기 규모에서는 Single Redis로 충분하며 운영 복잡도 감소 |
| Vault | AWS Secrets Manager + KMS로 대체 |
| Kubernetes | Docker Compose + EC2로 배포 복잡도 감소 |
| 별도 Internal Contract 계층 | 내부 호출은 REST API + JSON 기반으로 단순화 |

## 8. 주요 기능

### 8.1 통합 LLM Gateway

GateLM Gateway는 여러 LLM Provider로 향하는 요청을 하나의 진입점으로 통합한다.

애플리케이션은 OpenAI, Anthropic 등 개별 Provider API를 직접 호출하지 않고, Gateway의 OpenAI 호환 단일 API만 호출한다.

Gateway는 Provider별 요청·응답 포맷 변환, API Key 중앙 관리, Streaming 응답 중계, 요청 메타데이터 수집을 담당한다.

#### 세부 기능

- OpenAI 호환 단일 API 제공
- OpenAI, Anthropic 등 Provider별 요청·응답 포맷 변환
- Provider 호출 Proxy
- SSE Streaming 응답 중계
- Request Metadata 수집
- API Key 중앙 관리
- App Token 기반 애플리케이션 접근 제어

#### 사용자 가치

- 여러 LLM Provider를 애플리케이션 수정 없이 교체하거나 추가할 수 있다.
- 개발팀은 Provider별 API 차이를 직접 관리하지 않아도 된다.
- 기존 사내 서비스는 Provider API 대신 GateLM Gateway를 호출해 비용과 보안 정책을 적용받을 수 있다.

### 8.2 비용 최적화

반복 요청은 Cache로 처리하고, 요청의 난이도와 비용에 따라 적절한 모델로 라우팅하여 불필요한 Provider 호출과 고가 모델 사용을 줄인다.

초기에는 동일 요청에 대한 Exact Cache를 중심으로 구현하고, 이후 유사 프롬프트까지 처리하는 Semantic Cache로 확장한다.

#### 세부 기능

- 동일 요청에 대한 Exact Cache
- 유사 프롬프트 기반 Semantic Cache
- 비용·난이도 기반 Model Routing
- 저비용 모델 우선 사용
- 고가 모델 사용 최소화
- Cache Hit/Miss 기록
- Provider 호출 감소

#### 사용자 가치

- 불필요한 API 호출을 줄여 토큰 비용을 절감한다.
- 단순 요청에 고가 모델을 사용하는 낭비를 줄인다.
- 반복 요청의 응답 속도를 개선할 수 있다.

### 8.3 조직별 사용량 통제

관리자는 회사, 부서, 프로젝트, 사용자, 애플리케이션 단위로 API Key와 사용 정책을 관리할 수 있다.

각 조직 단위에 대해 허용 Provider/Model, RPM, TPM, 동시 요청 수, 월 예산을 설정하여 비용이 발생하기 전에 초과 사용을 차단한다.

#### 세부 기능

- Tenant 생성 및 관리
- 기업 Admin 가입
- 사용자 초대 및 Tenant membership 관리
- 사용자별 역할 관리
- Project 생성 및 관리
- 프로젝트/팀/사용자별 API Key 발급
- 애플리케이션 접근용 App Token 발급
- Token expire 설정
- API Key 회전 및 폐기
- Key별 Permission Scope 설정
- 허용 Provider/Model 목록 관리
- RPM, TPM, 동시 요청 수 제한
- 월 예산 및 Quota 설정
- 예산 초과 또는 임계치 도달 시 차단/경고

#### 사용자 가치

- 조직별 LLM 사용량을 사전에 통제할 수 있다.
- 특정 팀, 사용자, 기능의 과도한 사용으로 인한 비용 폭증을 방지한다.
- 운영자는 비용이 발생한 뒤가 아니라 발생하기 전에 사용량을 제어할 수 있다.
- 고객사는 사람 사용자와 애플리케이션 사용자를 구분해 LLM 접근 권한을 관리할 수 있다.

### 8.4 민감정보 보호

사용자 요청에 포함된 개인정보와 내부 기밀 정보를 Provider 호출 전에 탐지하고 마스킹하거나 요청을 차단한다.

원문 Prompt는 요청 처리 중 메모리에서만 사용하고, 로그와 분석 DB에는 Redacted Prompt와 Metadata만 저장하여 정보 유출 위험을 줄인다.

#### 세부 기능

- 주민등록번호, 전화번호, 이메일 탐지
- 사번, 계정 정보, 내부 식별자 탐지
- 사내 기밀 키워드 탐지
- 민감정보 마스킹 또는 요청 차단
- Redacted Prompt 생성
- 로그에는 마스킹된 Prompt만 저장
- 원문 Prompt 저장 최소화
- Cache Key는 Prompt Hash 또는 Embedding 기반 저장
- 분석 DB에는 Token, Cost, Latency, Model, User ID, Feature ID 등 Metadata 저장

#### 사용자 가치

- 개인정보가 외부 LLM Provider로 그대로 전달되는 위험을 줄인다.
- 내부 문서나 사내 기밀 정보가 외부로 유출될 가능성을 낮춘다.
- 보안 정책을 운영 레벨에서 일관되게 적용할 수 있다.

### 8.5 장애 대응 및 자동 Fallback

특정 Provider나 Model이 느려지거나 실패하는 경우, Gateway가 자동으로 다른 Provider 또는 Model로 전환한다.

Timeout, Retry, Circuit Breaker, Exponential Backoff를 적용하여 장애 Provider에 요청이 계속 몰리는 것을 방지하고 전체 AI 기능의 중단을 막는다.

#### 세부 기능

- Provider Health Check
- Timeout 설정
- 실패 요청 Retry
- Exponential Backoff 기반 재시도
- Circuit Breaker 적용
- 장애 Provider로의 요청 차단
- 대체 Provider/Model 자동 전환
- Fallback Route 기록

#### 사용자 가치

- 특정 LLM Provider 장애가 발생해도 서비스의 AI 기능을 계속 유지할 수 있다.
- 장애 상태의 Provider에 요청이 몰려 전체 시스템이 느려지는 문제를 방지한다.
- 운영자는 장애 발생 시 어떤 경로로 Fallback되었는지 추적할 수 있다.

### 8.6 관측성과 감사 추적

모든 LLM 호출에 대해 요청자, 기능, 모델, 토큰, 비용, 지연시간, 오류, 캐시 적중 여부, Fallback 경로를 기록한다.

이를 통해 장애, 비용 폭증, 성능 저하가 발생했을 때 원인을 빠르게 추적할 수 있다.

#### 세부 기능

- 호출 로그 수집
- 요청자, Tenant, API Key, Feature ID 기록
- 사용 Provider/Model 기록
- Prompt/Completion Token 기록
- 요청별 비용 계산
- Latency 및 TTFT 기록
- 오류 코드 및 실패 원인 기록
- Cache Hit/Miss 기록
- Fallback 경로 기록
- Trace 기반 요청 흐름 조회
- Query Builder 기반 로그 검색

#### 사용자 가치

- 누가, 언제, 어떤 기능에서, 어떤 모델을, 얼마나 썼는지 확인할 수 있다.
- 장애나 비용 폭증의 원인을 빠르게 추적할 수 있다.
- 운영 데이터 기반으로 라우팅, 예산, 캐시 정책을 개선할 수 있다.

### 8.7 운영 대시보드와 알림

운영자는 Web Console에서 LLM 사용량, 비용, 성능, 오류율, 캐시 적중률, Provider 상태를 확인할 수 있다.

예산 초과, 지연시간 증가, 오류율 상승 등 이상 징후가 발생하면 알림을 통해 선제적으로 대응한다.

#### 세부 기능

- Overview Dashboard
- Tenant / Project / User 관리 화면
- API Key / App Token 관리 화면
- 부서별/팀별/사용자별 비용 시각화
- Provider/Model별 비용 분석
- 모델별 성능 비교
- TTFT, 응답시간, 오류율 시각화
- Cache Hit Rate 시각화
- Fallback 발생 현황 확인
- 예산 임계치 알림
- 지연시간 이상 알림
- 오류율 이상 알림

#### 사용자 가치

- LLM 운영 상태를 실시간으로 파악할 수 있다.
- 비용, 성능, 장애 문제에 선제적으로 대응할 수 있다.
- 비개발자 운영자도 Web Console에서 사용 현황을 확인할 수 있다.
- 기업 Admin은 가입부터 사용자 초대, 프로젝트 생성, 정책 설정까지 Web Console에서 진행할 수 있다.

### 8.8 정책 관리 및 외부 연동

라우팅, 보안, 예산, Rate Limit, Guardrail 정책을 코드에 하드코딩하지 않고 Runtime Policy로 관리한다.

관리자는 Web Console에서 정책을 설정하고, 검증, 배포, 롤백, 변경 이력 감사를 수행할 수 있다.

또한 SDK, Webhook, OpenTelemetry 연동을 통해 기존 서비스와 쉽게 연결할 수 있다.

#### 세부 기능

- Web Console 기반 정책 설정
- Routing Policy 관리
- Security Policy 관리
- Budget Policy 관리
- Rate Limit Policy 관리
- Guardrail Policy 관리
- CEL 기반 Runtime Policy 적용
- 정책 Validation
- 정책 Version 관리
- 정책 Publish/Rollback
- 정책 변경 Audit Log
- SDK 연동
- Webhook 연동
- OpenTelemetry 연동

#### 사용자 가치

- 개발 배포 없이 운영 정책을 변경할 수 있다.
- 정책 변경 이력을 남겨 감사와 추적이 가능하다.
- 기존 서비스, 모니터링 시스템, 사내 운영 도구와 연동할 수 있다.

### 8.9 LLM 운영 보조 Assistant

GateLM은 단순히 LLM 요청을 중계하는 것에 그치지 않고, 운영 데이터를 기반으로 관리자 의사결정을 보조하는 LLM 기능을 제공할 수 있다.

1차 구현에서는 필수 기능으로 두지 않지만, 서비스 차별화를 위해 우선 후보로 관리한다.

#### 세부 기능

- 주간 비용 증가 원인 요약
- 프로젝트별 사용량 리포트 요약
- 마스킹 이벤트 요약
- 라우팅 정책 개선 제안
- 예산 초과 위험 프로젝트 설명

#### 사용자 가치

- 관리자는 복잡한 로그와 차트를 직접 해석하지 않아도 된다.
- LLM 운영 데이터를 자연어로 이해할 수 있다.
- 정책 변경과 비용 최적화 판단을 더 쉽게 할 수 있다.

## 9. 대화 맥락 처리

Provider는 이전 대화를 자동으로 기억하지 않는다.

따라서 Chat UI 또는 Gateway는 필요한 context를 매 요청마다 Provider에 전달해야 한다.

P1 Context 후보에서는 전체 대화 기록을 매번 보내지 않고, **Reply-to Context** 방식을 우선 적용한다.

```text
사용자가 특정 AI 응답에 답장
-> Chat UI가 parent_message_id 전송
-> Gateway가 부모 질문/응답 조회
-> 현재 질문과 부모 맥락을 Provider에 전달
```

기본 정책은 다음과 같다.

- 직계 부모 질문/응답만 context에 포함한다.
- 부모 응답이 길면 요약 또는 잘라낸 내용을 사용한다.
- context token 사용량을 별도 기록한다.
- cache key에는 현재 질문과 parent message hash를 함께 반영한다.

## 10. 원문 저장 정책

기본 정책은 **원문 Prompt/Response 저장 최소화**다.

원문은 요청 처리 중 메모리에서만 사용하고, 영속 저장소에는 기본적으로 아래 데이터를 저장한다.

- request_id
- tenant_id
- project_id
- user_id
- provider
- model
- token count
- cost
- latency
- cache status
- routing rule
- masking result
- redacted prompt
- response summary

원문 Prompt/Response 저장이 필요한 경우에는 고객사가 명시적으로 허용해야 하며, 별도 암호화와 retention 정책을 적용한다.

## 11. 1차 구현 범위

1차 구현에서 반드시 구현할 범위는 다음과 같다.

- GateLM SaaS 기본 도입 흐름
- 기업 Admin 가입
- Tenant 생성
- 사용자 초대
- Project 생성
- OpenAI 호환 Gateway API
- API Key 인증
- App Token 발급 및 검증
- Tenant / Project / User 식별
- Provider 호출 Proxy
- Text-only Chat UI
- Exact Cache
- 기본 Semantic Cache
- 기본 Model Routing
- Rate Limit / Quota
- 기본 민감정보 마스킹
- Usage Logging
- Token / Cost / Latency 계산
- Event Bus 기반 비동기 로그 처리
- Dashboard Overview
- Request Log / Detail Drawer
- Policy Control UI
- Conversation Reply-to Context
- 기존 고객사 앱이 Gateway API를 호출하는 연동 예시
- 직접 구현 기능과 외부 도구 사용 기능 구분

## 12. 1차 제외 범위

아래 기능은 1차 구현 범위에서 제외한다.

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

## 13. 데모 시나리오

발표 또는 시연에서는 기능 나열이 아니라, 기업이 GateLM을 도입하고 운영하는 흐름을 보여준다.

### 13.1 기업 Admin 온보딩

```text
기업 Admin이 GateLM에 가입
-> Tenant 생성
-> Project 생성
-> Provider Key 등록
-> 예산/모델/보안 정책 설정
```

### 13.2 애플리케이션 연동

```text
관리자가 프로젝트용 App Token 발급
-> 개발자가 기존 사내 앱의 LLM endpoint를 GateLM Gateway로 변경
-> 사내 앱의 LLM 요청이 Gateway를 통과
-> Gateway가 인증, 정책, 캐시, 라우팅, 마스킹을 적용
```

### 13.3 직원 Chat UI 사용

```text
고객사가 자체 AI UI가 없는 경우
-> 직원이 GateLM Chat UI에서 질문
-> Gateway가 정책을 적용
-> Cache 또는 Provider 호출
-> 응답 반환
```

### 13.4 비용 절감

```text
동일한 질문 요청
-> 첫 요청은 Provider 호출
-> 두 번째 요청은 Exact Cache Hit
-> Provider 호출 생략
-> Dashboard에서 절감 비용 확인
```

### 13.5 모델 라우팅

```text
단순 요청 입력
-> 저비용 모델로 라우팅
-> Dashboard에서 routing decision 확인
```

### 13.6 Rate Limit / Quota

```text
프로젝트 예산 또는 요청 한도 초과
-> Gateway에서 Provider 호출 전 차단
-> Dashboard에서 Budget Alert 확인
```

### 13.7 민감정보 마스킹

```text
직원이 API Key 또는 이메일이 포함된 요청 입력
-> Gateway가 민감정보 탐지
-> Provider에는 redacted prompt 전달
-> 관리자가 Dashboard에서 masking event 확인
-> 필요 시 보안 정책 강화
```

### 13.8 로그 추적

```text
Request Log에서 특정 요청 선택
-> 오른쪽 Detail Drawer 열림
-> 비용, 토큰, 캐시, 라우팅, 마스킹 결과 확인
```

### 13.9 LLM 운영 리포트 요약

```text
관리자가 "이번 주 비용 증가 원인을 요약해줘" 요청
-> GateLM이 비용/토큰/모델 사용 데이터를 기반으로 요약
-> 관리자가 정책 변경 또는 예산 조정을 판단
```

## 14. 구현 문서 파생 순서

이 문서는 전체 기준 원본이다.

이후 문서는 아래 순서로 파생한다.

```text
master-spec.md
-> 기능명세.md
-> 정책.md
-> contracts/api.openapi.yaml
-> contracts/events.schema.json
-> contracts/db_schema.md
-> agent_packets/*.md
-> 실제 구현
```

## 15. 핵심 원칙

- 모든 LLM 요청은 Gateway를 통과한다.
- 응답 경로와 분석 경로를 분리한다.
- 비용 절감이 최우선 가치다.
- 보안은 기본적으로 원문 저장 최소화와 마스킹 중심으로 설계한다.
- 정책은 코드가 아니라 Runtime Policy로 관리한다.
- 계약이 먼저이고 구현은 그 다음이다.
- 문서에 없는 API/Event/DB 구조를 임의로 만들지 않는다.
