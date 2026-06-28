# GateLM 확장 계획안 - hyeok

## 1. 방향성

GateLM은 B2B LLM Gateway로 확정한다.

핵심 가치는 "기업의 모든 LLM 요청을 허용된 경로로 통과시켜 보안, 비용, 사용량, 장애 대응을 중앙에서 통제하는 것"이다.

GateLM은 ChatGPT 같은 최종 사용자용 챗봇이 아니라, 고객사의 서비스나 내부 도구가 LLM을 호출할 때 반드시 거치는 운영 레이어다.

## 2. 한 줄 정의

GateLM은 기업의 LLM API 호출을 하나의 Gateway로 통합해 민감정보 보호, 비용 통제, 모델 라우팅, 로그 분석을 제공하는 B2B LLMOps 플랫폼이다.

## 3. 기준선

나머지 P0 구현은 기존 one-day 문서를 기준으로 한다.

기준 문서:

- `docs/p0/one-day-parallel-completion-plan.md`
- `docs/p0/one-day/merge-1-independent-start.md`
- `docs/p0/one-day/merge-2-core-completion.md`
- `docs/p0/one-day/merge-3-e2e-integration.md`
- `docs/p0/one-day/merge-4-demo-freeze.md`

P0에서 기대하는 기본 흐름:

1. 관리자가 Tenant, Project, Application을 만든다.
2. Gateway API Key와 App Token을 발급한다.
3. 고객사 앱 또는 테스트 클라이언트가 Gateway로 LLM 요청을 보낸다.
4. Gateway가 인증, 마스킹, 차단, Exact Cache, Simple Routing을 처리한다.
5. Mock Provider 응답을 받고 로그를 저장한다.
6. Web Console에서 로그 상세와 대시보드 요약을 확인한다.

## 4. 확장 기능 우선순위

| 기능 | 기업 가치 | 데모 임팩트 | 구현 난이도 | 추천 단계 |
| --- | --- | --- | --- | --- |
| 실제 LLM Provider 연결 | 실제 서비스처럼 보이게 함 | 높음 | 중간 | P1 |
| 실시간 응답 | 사용자 체감 성능 강조 | 높음 | 중간~높음 | P1 |
| Rate Limit | 비용 폭주 방지 | 높음 | 중간 | P1 |
| Budget Hard Block | 예산 초과 차단 | 높음 | 중간 | P1 |
| 시계열 차트 | 관리자 설득력 강화 | 높음 | 중간 | P1 |
| Text-only Chat UI | 실시간 참여형 데모 | 높음 | 낮음~중간 | P1 |
| Runtime Policy Editor | 운영자가 정책 수정 가능 | 높음 | 중간~높음 | P1.5 |
| Custom Regex Rule | 고객사별 민감정보 정책 | 높음 | 중간 | P1.5 |
| Semantic Cache | 비용 절감 고도화 | 중간 | 높음 | P2 |
| Redpanda / ClickHouse 연동 | 대규모 로그 처리 | 중간 | 높음 | P2 |
| 사용자 초대 / 권한 관리 | B2B 운영 필수 | 중간 | 중간 | P2 |
| Self-hosted / Hybrid 설치 | 기업 보안 우려 해소 | 높음 | 높음 | P2 |
| 대용량 로그 분석 | 엔터프라이즈 설득력 | 중간 | 높음 | P2 |

## 5. 내가 추천하는 구현 순서

### 5.1 P0: Gateway Vertical Slice 완성

목표는 "Gateway로 요청이 들어오고, 정책 처리 후 Provider 응답과 로그가 남는 흐름"을 끝까지 완성하는 것이다.

필수 기능:

- Control Plane 기본 생성 API
- Gateway API Key / App Token 인증
- Mock Provider 호출
- Exact Cache
- 개인정보 마스킹
- 위험 정보 차단
- Simple Routing
- 요청 로그 저장
- 요청 상세 조회
- 대시보드 요약

P0의 목적은 발표용 화면 완성이 아니라, GateLM의 기본 동작 경로를 증명하는 것이다.

### 5.2 P1: B2B 데모 설득력 강화

P1은 발표에서 "이게 진짜 기업용 Gateway구나"를 보여주는 단계다.

우선순위:

1. 실제 LLM Provider 연결
2. 실시간 응답
3. Rate Limit
4. Budget Hard Block
5. 시계열 차트
6. Text-only Chat UI

이 단계까지 되면 고객사 앱에서 실제 LLM 응답을 받고, 사용량과 비용이 대시보드에서 시간에 따라 갱신되는 모습을 보여줄 수 있다.

### 5.3 P1.5: 정책 관리 고도화

P1.5는 운영자가 직접 정책을 다루는 단계다.

우선순위:

1. Runtime Policy Editor
2. Custom Regex Rule

정책 예시:

- Marketing Team은 `gpt-4o-mini`와 `mock-fast`만 사용 가능
- Data Team은 월 예산 100달러 초과 시 차단
- 이메일, 전화번호, 주민등록번호 패턴은 항상 마스킹
- `internal-only`, `confidential` 키워드 포함 시 차단

이 기능은 GateLM이 단순 프록시가 아니라 "운영 정책 플랫폼"이라는 점을 보여준다.

### 5.4 P2: 엔터프라이즈 확장

P2는 발표에서 다 구현하지 못해도, 아키텍처와 확장 계획으로 보여줄 가치가 있다.

우선순위:

1. Redpanda / ClickHouse 연동
2. Semantic Cache
3. 사용자 초대 / 권한 관리
4. Self-hosted / Hybrid 설치
5. 대용량 로그 분석

P2의 핵심 메시지는 "트래픽이 늘어나도 분석 경로를 분리하고, 기업 보안 요구에 맞춰 배포 방식을 선택할 수 있다"이다.

## 6. Semantic Cache에 대한 판단

Semantic Cache는 비용 절감 측면에서 매력적이지만, P1의 핵심 데모로 두기에는 위험하다.

이유:

- 비슷한 문장이라도 답이 달라야 하는 경우가 많다.
- 날짜, 사용자, 프로젝트, 권한, 최신성에 따라 캐시 재사용 가능 여부가 달라진다.
- 잘못된 캐시 hit는 비용 절감보다 더 큰 신뢰도 문제를 만든다.

추천 방향:

- P0/P1에서는 Exact Cache 중심으로 안정성을 먼저 증명한다.
- Semantic Cache는 P2에서 "조건부 캐시"로 설계한다.
- 캐시 key에는 tenant, project, model, policy version, normalized prompt, freshness class를 포함한다.
- 날씨, 주가, 날짜, 개인화 요청, 권한 의존 요청은 semantic cache bypass 대상으로 둔다.

## 7. 대규모 트래픽 처리 전략

GateLM의 강점으로 대규모 트래픽 처리를 어필하려면, 단순히 "빠르다"가 아니라 "응답 경로와 분석 경로를 분리했다"를 보여줘야 한다.

기본 전략:

- 응답 경로: 인증, 마스킹, 캐시, 라우팅, Provider 호출만 빠르게 처리
- 분석 경로: 로그 저장, 비용 분석, 대시보드 집계는 비동기 처리

확장 구조:

- Gateway는 요청을 처리하고 log event를 발행한다.
- Redpanda는 이벤트를 안정적으로 버퍼링한다.
- Worker는 이벤트를 소비해 ClickHouse에 적재한다.
- ClickHouse는 대량 로그와 시계열 분석을 빠르게 처리한다.
- Web Dashboard는 집계된 데이터를 조회한다.

P0에서는 Postgres 기반 로그로 충분하다.

P2에서 Redpanda / ClickHouse를 붙이며 "대규모 로그 분석 구조로 확장 가능"을 보여준다.

## 8. 데모 시나리오 제안

데모는 기능 나열이 아니라 "기업 관리자가 GateLM을 왜 써야 하는지"를 보여주는 흐름이어야 한다.

### Scene 1. 기업 관리자가 프로젝트를 만든다

관리자는 GateLM Console에서 프로젝트와 애플리케이션을 등록하고 Gateway API Key와 App Token을 발급한다.

메시지:

- 개발팀이 OpenAI, Anthropic, Gemini 키를 각자 들고 있지 않아도 된다.
- 회사는 중앙에서 어떤 팀이 어떤 모델을 쓰는지 통제할 수 있다.

### Scene 2. 고객사 앱이 Gateway로 LLM 요청을 보낸다

고객사 앱 또는 Text-only Chat UI에서 Gateway로 요청을 보낸다.

메시지:

- 직원은 기존 도구를 쓰는 것처럼 요청한다.
- 실제 호출은 GateLM Gateway를 거쳐 Provider로 전달된다.

### Scene 3. 민감정보 마스킹을 보여준다

참여자가 이름, 이메일, 전화번호가 포함된 문장을 입력한다.

Gateway는 Provider 호출 전에 민감정보를 마스킹한다.

관리자는 로그 상세에서 원문이 아니라 redacted preview만 확인한다.

메시지:

- 회사 데이터가 외부 LLM으로 그대로 나가는 것을 막는다.
- 로그에도 원문을 저장하지 않는다.

### Scene 4. 모델 라우팅을 보여준다

짧고 단순한 요청은 저비용 모델로 보내고, 긴 분석 요청은 고성능 모델로 보낸다.

로그 상세에는 routed model과 routing reason이 표시된다.

메시지:

- 모든 요청을 비싼 모델로 보내지 않는다.
- 비용 절감이 자동화된다.

### Scene 5. Cache와 비용 절감을 보여준다

같은 요청을 다시 보내면 Exact Cache hit가 발생한다.

Provider 호출 없이 응답하고, 비용과 latency가 줄어든다.

메시지:

- 반복 요청은 비용을 만들지 않는다.
- Gateway가 Provider 호출을 줄인다.

### Scene 6. Rate Limit / Budget Block을 보여준다

짧은 시간에 많은 요청을 보내거나 예산 한도에 근접한 프로젝트를 만든다.

Gateway가 요청을 제한하거나 차단한다.

메시지:

- 비용 폭주를 사후 분석하는 것이 아니라 사전에 막는다.

### Scene 7. 대시보드에서 전체 상황을 확인한다

관리자는 시계열 차트와 로그를 통해 비용, 토큰, 요청 수, 캐시 hit, 마스킹 이벤트, 차단 이벤트를 확인한다.

메시지:

- 누가, 어떤 프로젝트에서, 어떤 모델을, 얼마나 썼는지 볼 수 있다.
- GateLM은 기업의 LLM 운영 가시성을 제공한다.

## 9. 실시간 참여형 데모 아이디어

발표가 딱딱해지는 것을 막기 위해 Text-only Chat UI를 "참여형 입력 도구"로 활용한다.

방식:

1. 발표자가 QR 또는 로컬 URL을 공유한다.
2. 참석자가 짧은 프롬프트를 입력한다.
3. 모든 요청은 GateLM Gateway를 통과한다.
4. 대시보드에서 요청 수, 마스킹 이벤트, 라우팅 결과가 갱신된다.

주의:

- 이 UI는 GateLM의 핵심 제품이 아니라 데모용 고객사 앱 역할이다.
- 발표에서 "GateLM은 Chat UI 서비스가 아니라 Gateway이며, 이 화면은 고객사 앱을 흉내낸 데모 클라이언트"라고 먼저 말해야 한다.

## 10. 역할 분담 제안

| 역할 | P0 이후 추천 담당 |
| --- | --- |
| A | Control Plane, Provider credential 등록, Policy API, Budget 설정 API |
| B | 실제 Provider Adapter, Streaming proxy, Provider response normalization |
| C | Rate Limit, Budget Hard Block, Routing policy, 인증 context |
| D | PII masking, Custom Regex Rule, Exact/Semantic Cache 안전 정책 |
| E | Web Console, 시계열 차트, Text-only Chat UI, 데모 플로우 |

## 11. 최종적으로 보여줄 기술적 챌린지

발표에서 강조할 기술적 포인트는 다음으로 잡는 것이 좋다.

1. Gateway latency를 늘리지 않으면서 인증, 마스킹, 캐시, 라우팅을 처리한다.
2. 응답 경로와 분석 경로를 분리해 대규모 트래픽에서도 응답 속도를 유지한다.
3. 기업 보안을 위해 원문 prompt, response, key를 저장하지 않는다.
4. 모델 라우팅과 캐시로 비용을 줄인다.
5. Rate Limit과 Budget Hard Block으로 비용 폭주를 사전에 막는다.
6. ClickHouse 기반 시계열 분석으로 많은 요청 로그를 빠르게 조회한다.
7. Self-hosted / Hybrid 배포로 기업의 데이터 통제 요구를 수용한다.

## 12. 내 추천 결론

내 추천은 다음이다.

P0는 지금 one-day 문서 기준으로 Gateway vertical slice를 완성한다.

P1은 실제 Provider 연결, 실시간 응답, Rate Limit, Budget Hard Block, 시계열 차트, Text-only Chat UI를 우선 구현한다.

P2는 Redpanda / ClickHouse, Semantic Cache, 권한 관리, Self-hosted / Hybrid, 대용량 로그 분석으로 확장한다.

발표에서는 "비용 절감"만 전면에 두기보다, "기업의 LLM 사용 경로를 허용된 Gateway로 통제하고, 그 위에서 보안/비용/분석을 제공한다"를 핵심 메시지로 잡아야 한다.

## 13. v1.0.0 구현 범위 재정의

v1.0.0은 단순 P0 데모가 아니라, GateLM이 B2B LLM Gateway로서 설득력을 갖는 첫 번째 완성 버전으로 잡는다.

구현 속도보다 머지 충돌과 통합 검증이 더 큰 병목이라면, 기능 범위는 더 공격적으로 잡는 것이 맞다.

v1.0.0의 목표는 "Gateway가 동작한다"가 아니라 "기업이 GateLM을 도입해야 하는 이유가 기능으로 보인다"이다.

v1.0.0에서 반드시 구현해야 하는 범위는 다음이다.

| 영역 | v1.0.0 구현 범위 | 데모에서 보여줄 내용 |
| --- | --- | --- |
| Control Plane | Tenant, Project, Application 생성 | 관리자가 고객사/프로젝트/앱을 등록한다 |
| Provider Key 관리 | 프로젝트별 Provider Key 등록 | 고객사가 사용할 OpenAI 등 Provider credential을 중앙 등록한다 |
| Key 발급 | Gateway API Key, App Token 발급 | 고객사 앱이 Gateway를 호출할 credential을 받는다 |
| Gateway 인증 | API Key와 App Token 검증 | 허용된 앱만 Gateway를 사용할 수 있다 |
| 실제 Provider 호출 | 최소 1개 실제 LLM Provider 연결 | Gateway가 실제 LLM Provider를 대신 호출한다 |
| Streaming Proxy | SSE 기반 실시간 응답 중계 | 사용자가 답변을 실시간으로 받는다 |
| 마스킹 | 이메일, 전화번호 등 기본 개인정보 마스킹 | 민감정보가 Provider로 그대로 나가지 않는다 |
| 위험 정보 차단 | API Key, JWT, 주민등록번호 등 차단 | 위험 요청은 Provider 호출 전에 막힌다 |
| Exact Cache | 동일 요청 캐시 | 반복 요청은 Provider 호출 없이 응답한다 |
| Semantic Cache Lite | 제한 조건이 있는 유사 요청 캐시 | 안전한 범위의 유사 질문만 캐시 hit 처리한다 |
| Simple Routing | `auto` 요청에 대한 단순 모델 선택 | 요청 성격에 따라 모델이 선택된다 |
| Rate Limit | 프로젝트/API Key 단위 RPM 제한 | 짧은 시간의 과도한 요청을 막는다 |
| Budget Hard Block | 프로젝트 월 예산 초과 차단 | 비용 폭주를 사전에 막는다 |
| Runtime Policy | 라우팅/예산/보안 정책 조회와 수정 | 운영자가 배포 없이 정책을 바꾼다 |
| Custom Regex Rule | 프로젝트별 민감정보 패턴 추가 | 고객사별 내부 식별자나 금칙어를 탐지한다 |
| 로그 저장 | 요청별 metadata, token, cost, latency 저장 | 누가 어떤 요청을 얼마나 썼는지 남는다 |
| 로그 상세 | routing/cache/masking/token/cost/latency 조회 | 요청 한 건의 처리 결과를 추적한다 |
| 시계열 Dashboard | 요청 수, 비용, 토큰, latency, cache, masking 추이 | 관리자가 사용량 변화를 시간 단위로 본다 |
| Text-only Chat UI | 고객사 앱을 흉내낸 데모 클라이언트 | 실시간 참여형 데모로 Gateway 통과를 보여준다 |
| 설치/실행 패키지 | Docker Compose 기반 실행 | 기업 내부 서버에 올릴 수 있는 형태를 보여준다 |

v1.0.0에서 "구현 또는 최소 동작 증명"까지 가져가야 하는 확장성 항목은 다음이다.

- Redpanda / ClickHouse 연동은 완전 운영 수준이 아니어도, 로그 이벤트가 비동기 분석 경로로 흘러가는 구조를 보여준다.
- Self-hosted / Hybrid 설치는 완전한 배포 자동화가 아니어도, Docker Compose 기반 설치 가이드와 실행 가능성을 보여준다.
- 대용량 로그 분석은 실제 수백만 건이 아니어도, 샘플 로그 대량 삽입 후 시계열 조회가 빠르게 되는 것을 보여준다.

v1.0.0에서 후순위로 둘 수 있는 것은 다음이다.

- 사용자 초대 / 권한 관리
- 완전한 Self-hosted / Hybrid 배포 자동화
- Semantic Cache의 고정밀 평가 실험
- Redpanda / ClickHouse의 운영 수준 장애 복구
- 다중 실제 Provider 전체 연결

즉 v1.0.0은 P0가 아니라 "P0 + 기업용 설득 기능 + 데모 임팩트 기능"까지 포함한 버전으로 정의한다.

## 14. v1.0.0에서 기대하는 동작 흐름

v1.0.0 데모의 기본 흐름은 다음과 같다.

1. 관리자가 GateLM Console에 접속한다.
2. Tenant를 생성한다.
3. Project를 생성한다.
4. Application을 생성한다.
5. 프로젝트에서 사용할 Provider Key를 등록한다.
6. Gateway API Key와 App Token을 발급한다.
7. 관리자가 프로젝트별 정책을 설정한다.
8. 정책에는 허용 모델, Rate Limit, 월 예산, 마스킹 규칙, Custom Regex Rule이 포함된다.
9. 고객사 앱 역할의 Text-only Chat UI 또는 테스트 클라이언트가 발급받은 credential로 Gateway에 요청한다.
10. Gateway는 API Key와 App Token을 검증한다.
11. Gateway는 프로젝트 정책과 사용량 상태를 확인한다.
12. Rate Limit 또는 Budget Hard Block 조건에 걸리면 Provider 호출 전에 차단한다.
13. Gateway는 prompt에서 민감정보를 탐지하고 마스킹하거나 차단한다.
14. Gateway는 Exact Cache와 제한적 Semantic Cache를 확인한다.
15. Cache miss면 Simple Routing으로 모델을 고른다.
16. Gateway는 실제 LLM Provider 또는 Mock Provider를 호출한다.
17. Streaming 요청이면 SSE 형태로 응답을 중계한다.
18. Gateway는 응답을 클라이언트에 반환한다.
19. Gateway는 요청 결과를 로그 이벤트로 남긴다.
20. 로그는 Postgres에 저장되고, 확장 경로에서는 Redpanda/ClickHouse 분석 경로로도 전달된다.
21. 관리자는 Web Console에서 로그 목록을 확인한다.
22. 관리자는 로그 상세에서 routing, cache, masking, token, cost, latency, policy decision을 확인한다.
23. 관리자는 Dashboard에서 시계열 비용, 요청 수, 토큰 사용량, latency, cache hit, masking 이벤트, budget 사용률을 확인한다.

이 흐름이 끊기지 않으면 v1.0.0은 "기업용 LLM Gateway"로 설명할 수 있다.

## 15. v1.0.0 데모 스토리라인

데모는 기능을 하나씩 나열하기보다 "기업 관리자가 왜 GateLM을 써야 하는가"를 보여주는 흐름으로 구성한다.

### Step 1. 기업 관리자가 GateLM에 프로젝트를 등록한다

관리자는 프로젝트와 애플리케이션을 만들고 Gateway API Key와 App Token을 발급한다.

전달 메시지:

- 기업은 각 개발자에게 Provider API Key를 직접 나눠주지 않는다.
- 모든 LLM 호출은 GateLM을 거치게 만들 수 있다.
- 누가 어떤 프로젝트에서 LLM을 쓰는지 중앙에서 식별할 수 있다.

### Step 2. 고객사 앱이 Gateway로 요청을 보낸다

테스트 클라이언트 또는 간단한 고객사 앱 화면에서 Gateway로 요청을 보낸다.

전달 메시지:

- 고객사 앱은 Provider URL 대신 GateLM Gateway URL을 호출한다.
- Gateway는 요청을 받아 정책을 적용한 뒤 Provider로 전달한다.

### Step 3. 민감정보가 포함된 요청을 보낸다

이메일, 전화번호가 포함된 prompt를 보낸다.

Gateway는 개인정보를 마스킹한 뒤 Provider로 전달하고, 로그에도 원문이 아닌 redacted preview만 남긴다.

전달 메시지:

- 기업 데이터가 외부 LLM으로 그대로 나가는 위험을 줄인다.
- 관리자도 로그에서 원문 개인정보를 볼 수 없다.

### Step 4. 동일 요청을 다시 보내 cache hit를 보여준다

같은 요청을 한 번 더 보낸다.

Gateway는 Provider를 다시 호출하지 않고 캐시된 응답을 반환한다.

전달 메시지:

- 반복 요청은 비용을 발생시키지 않는다.
- 비용 절감과 latency 개선을 동시에 보여줄 수 있다.

### Step 5. `model=auto` 요청으로 라우팅을 보여준다

사용자는 모델을 직접 고르지 않고 `auto`로 요청한다.

Gateway는 prompt 길이, 요청 유형, 정책 기준에 따라 모델을 선택하고 routing reason을 로그에 남긴다.

전달 메시지:

- 개발자가 매번 모델을 고르지 않아도 된다.
- 비싼 모델을 무분별하게 쓰지 않도록 Gateway가 조절한다.

### Step 6. Rate Limit과 Budget Hard Block을 보여준다

짧은 시간에 여러 요청을 보내거나 예산 한도에 근접한 프로젝트로 요청을 보낸다.

Gateway는 정책에 따라 요청을 허용하거나 차단한다.

전달 메시지:

- 기업은 비용 폭주를 사후 분석하는 것이 아니라 사전에 막을 수 있다.
- Rate Limit과 Budget은 운영 정책으로 관리된다.

### Step 7. Streaming 응답을 보여준다

긴 답변 요청을 보내고, 응답이 한 번에 오지 않고 실시간으로 흘러오는 모습을 보여준다.

Gateway는 Provider의 streaming 응답을 클라이언트에게 중계하면서 로그에 필요한 메타데이터를 남긴다.

전달 메시지:

- Gateway를 거쳐도 사용자 체감 응답성이 크게 무너지지 않는다.
- 응답 경로와 분석 경로를 분리해야 하는 이유를 보여준다.

### Step 8. 정책 수정과 Custom Regex Rule을 보여준다

관리자가 프로젝트 정책에서 특정 내부 키워드나 사번 패턴을 Custom Regex Rule로 추가한다.

이후 같은 유형의 요청을 보내면 Gateway가 새 정책을 적용한다.

전달 메시지:

- 고객사마다 다른 내부 보안 규칙을 Gateway에서 운영할 수 있다.
- 배포 없이 정책을 수정하는 운영 경험을 보여준다.

### Step 9. 관리자 대시보드에서 전체 상황을 확인한다

관리자는 Web Console에서 요청 수, 비용, 토큰, latency, cache hit, masking 이벤트, 차단 이벤트, budget 사용률을 확인한다.

시계열 차트로 시간대별 비용 증가, 요청 증가, latency 변화도 확인한다.

전달 메시지:

- 기업은 LLM 사용량을 감으로 관리하지 않는다.
- 사용량, 비용, 보안 이벤트를 운영 데이터로 확인한다.
- GateLM은 단순 프록시가 아니라 LLM 운영 콘솔이다.

## 16. v1.0.0 합격 기준

v1.0.0 데모의 합격 기준은 다음이다.

- 관리자가 프로젝트와 애플리케이션을 만들 수 있다.
- 관리자가 Provider Key를 등록할 수 있다.
- Gateway API Key와 App Token을 발급할 수 있다.
- 발급된 credential로 Gateway 요청이 성공한다.
- 잘못된 credential은 실패한다.
- 최소 1개 실제 LLM Provider 또는 실제 호출과 동일한 adapter 흐름이 동작한다.
- Streaming 응답이 Gateway를 통해 중계된다.
- 개인정보 포함 요청은 마스킹된다.
- 위험 정보 포함 요청은 차단된다.
- 동일 요청 2회차는 cache hit가 된다.
- 안전 조건을 만족하는 유사 요청은 Semantic Cache Lite 후보로 판단되거나 hit된다.
- `model=auto` 요청은 routed model을 남긴다.
- Rate Limit 초과 요청은 차단된다.
- Budget Hard Block 조건의 요청은 차단된다.
- 관리자가 Runtime Policy 또는 프로젝트 정책을 조회/수정할 수 있다.
- 관리자가 Custom Regex Rule을 추가하고 적용 결과를 확인할 수 있다.
- 요청 로그가 저장된다.
- 로그 상세에서 처리 결과를 확인할 수 있다.
- Dashboard에서 사용량 요약과 시계열 차트를 확인할 수 있다.
- 로그 이벤트를 분석 경로로 분리하는 구조가 코드 또는 데모로 확인된다.
- Docker Compose 기반으로 로컬 또는 내부 서버 실행이 가능하다.
- 원문 API Key, App Token, prompt, response가 저장되거나 노출되지 않는다.

## 17. v1.0.0에서 가장 중요한 메시지

v1.0.0에서 가장 중요한 메시지는 "우리는 LLM 앱을 만든 것이 아니라, 기업의 LLM 사용 경로를 통제하는 Gateway를 만들었다"이다.

부가 메시지는 다음이다.

- GateLM을 거치면 누가, 어떤 프로젝트에서, 어떤 모델을, 얼마나 썼는지 추적할 수 있다.
- GateLM을 거치면 민감정보가 외부 LLM으로 그대로 나가는 것을 줄일 수 있다.
- GateLM을 거치면 반복 요청과 모델 선택을 통해 비용을 줄일 수 있다.
- GateLM을 거치면 Rate Limit과 Budget Hard Block으로 비용 폭주를 사전에 막을 수 있다.
- GateLM을 거치면 Streaming을 유지하면서도 로그와 분석을 남길 수 있다.
- GateLM은 Redpanda/ClickHouse 같은 분석 경로로 대용량 로그 처리까지 확장된다.

따라서 v1.0.0은 최소 기능 데모가 아니라, "GateLM을 기업용 LLM Gateway라고 부를 수 있는 첫 완성 버전"으로 정의한다.
