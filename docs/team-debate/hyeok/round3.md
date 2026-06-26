# Round 3 최종 의견 - hyeok

## 0. 결론 먼저

GateLM v1.0.0은 "많은 기능을 모아둔 LLM 도구"가 아니라, **기업의 모든 LLM API 요청이 반드시 지나가는 B2B LLM Gateway**로 정의하는 것이 가장 좋다.

Round 1에서는 v1.0.0 범위를 공격적으로 넓혀 기업용 서비스처럼 보이게 하는 데 집중했다.  
Round 2에서는 그 범위를 다시 정리해, 메인 제품 흐름과 v2 확장 기능을 분리했다.

내 최종 의견은 다음이다.

> GateLM v1.0.0은 고객사 업무 앱의 LLM 요청이 Gateway를 통과하면서 인증, 정책, 보안, 비용 절감, 라우팅, 로그, 대시보드, 지표까지 연결되는 end-to-end 운영 흐름을 완성하는 버전이어야 한다.

즉, 핵심은 "기능 개수"가 아니라 **기업이 LLM 사용 경로를 중앙에서 통제하고 추적할 수 있는가**다.

---

## 1. Round 1과 Round 2의 차이

## 1.1 Round 1의 장점

Round 1의 장점은 범위를 작게 잡지 않았다는 점이다.

처음 P0는 너무 단순한 Gateway, Mock Provider, 로그 조회 수준으로 보일 위험이 있었다.  
그래서 Round 1에서는 다음 기능들까지 넓게 포함하려 했다.

- 실제 Provider 연결
- Streaming
- Rate Limit
- Budget Hard Block
- Runtime Policy
- Custom Regex Rule
- Semantic Cache Lite
- 시계열 Dashboard
- Text-only Chat UI
- Redpanda / ClickHouse 확장 가능성

이 방향은 코치 피드백 중 "너무 단순해 보인다", "기업용 환경 설명이 부족하다", "대규모 트래픽을 고려해야 한다"는 지점에 대응하기 좋다.

다만 Round 1의 약점은 v1.0.0에 너무 많은 기능이 섞여 있어, 실제 구현과 발표에서 초점이 흐려질 수 있다는 점이다.

## 1.2 Round 2의 장점

Round 2의 장점은 기능을 다시 제품 흐름 중심으로 정리했다는 점이다.

Round 2에서는 다음 기준이 생겼다.

- v1은 제품이 실제로 동작하는 기본 Gateway 흐름
- v2는 병목 측정 이후 확장하는 고급 운영 구조
- Rate Limit은 v1에 넣되 PostgreSQL 기반 Fixed Window로 시작
- Redis, Redpanda, ClickHouse, Semantic Cache는 v2 확장 또는 PoC로 분리
- Observability는 단순 대시보드가 아니라 metrics와 k6 baseline까지 포함
- Control Plane 설정이 Gateway 런타임에 실제 반영되어야 함

이 방향은 발표와 구현 모두 안정적이다.

다만 Round 2를 너무 보수적으로 해석하면 다시 "기술적 난이도가 낮아 보인다"는 문제가 생길 수 있다.

---

## 2. 최종 방향

Round 1의 공격적인 범위와 Round 2의 정리된 기준을 합치면, 최종 방향은 다음이 가장 적절하다.

## 2.1 v1.0.0은 확장 P0지만, 메인 흐름은 하나로 고정한다

v1.0.0은 단순 MVP처럼 작아서는 안 된다.  
하지만 모든 고급 기능을 완성하려고 해도 안 된다.

따라서 v1.0.0은 **확장 P0**로 잡되, 발표와 구현의 중심은 아래 하나의 흐름으로 고정한다.

1. 기업 관리자가 GateLM에 접속한다.
2. Tenant, Project, Application을 생성한다.
3. Provider 설정과 사용 가능한 모델을 등록한다.
4. Gateway API Key와 App Token을 발급한다.
5. 고객사 업무 앱이 OpenAI-compatible API 형태로 GateLM에 요청한다.
6. Gateway가 API Key와 App Token을 검증한다.
7. Gateway가 Application 단위 Rate Limit을 검사한다.
8. Gateway가 위험 정보는 차단하고 개인정보는 마스킹한다.
9. Gateway가 Exact Cache를 조회한다.
10. `model=auto` 요청이면 Simple Routing으로 모델을 선택한다.
11. Provider를 호출하거나 캐시 응답을 반환한다.
12. Request Log, Request Detail, Dashboard, Metrics에서 처리 결과를 확인한다.
13. k6 baseline으로 최소 부하 테스트 결과를 제시한다.

이 흐름이 완성되면 GateLM은 더 이상 "프록시 서버 하나"가 아니라, 기업용 LLM 운영 Gateway로 보인다.

## 2.2 v1.0.0의 메시지는 비용 절감보다 통제와 추적이다

초기에는 비용 절감이 가장 큰 메시지처럼 보였다.  
하지만 기업용 관점에서는 비용 절감보다 더 앞에 와야 하는 가치가 있다.

최종 메시지는 다음 순서가 좋다.

1. 허용된 경로로만 LLM을 호출하게 한다.
2. 어떤 팀, 앱, 사용자가 LLM을 얼마나 쓰는지 추적한다.
3. 외부 Provider로 나가는 민감정보를 줄인다.
4. Rate Limit과 Budget 정책으로 과도한 사용을 막는다.
5. Cache와 Routing으로 비용을 줄인다.

즉, 비용 절감은 핵심 가치이지만 단독 주인공은 아니다.  
GateLM의 더 큰 가치는 **통제 가능한 LLM 사용 경로를 기업에 제공하는 것**이다.

---

## 3. v1.0.0 필수 범위

## 3.1 반드시 구현해야 하는 것

| 영역 | 필수 구현 |
| --- | --- |
| Control Plane | Tenant, Project, Application 생성 |
| Key 관리 | Gateway API Key, App Token 발급 |
| Gateway 인증 | API Key + App Token 검증 |
| Runtime Config | Control Plane 설정이 Gateway 요청 처리에 반영 |
| API | OpenAI-compatible `/v1/chat/completions`, `/v1/models` |
| Provider | Mock Provider 기본 유지 |
| 실제 Provider | 가능하면 1개 연결, 실패 시 Mock fallback |
| 보안 | PII 마스킹, 위험 정보 차단 |
| 비용 절감 | Exact Cache |
| 라우팅 | `model=auto` Simple Routing |
| 사용 통제 | PostgreSQL-backed Fixed Window Rate Limit |
| 로그 | Request Log, Request Detail |
| 대시보드 | 요청 수, 비용, 토큰, latency, cache, masking, routing 요약 |
| 지표 | JSON structured log, metrics endpoint |
| 성능 증거 | k6 baseline |
| 데모 | 고객사 업무 앱이 GateLM을 통해 LLM 요청하는 시나리오 |

## 3.2 v1.0.0에 넣으면 좋은 것

아래 기능은 v1.0.0에 넣으면 발표가 강해진다.  
다만 메인 흐름을 깨면서까지 무리할 필요는 없다.

- 실제 Provider 1개 연결
- Budget Hard Block
- 시계열 차트
- Text-only Customer Demo App
- Custom Regex Rule 최소 등록
- Runtime Policy 최소 조회/적용

## 3.3 v1.0.0에서 욕심내면 위험한 것

아래 기능은 좋아 보이지만, v1.0.0 메인 흐름에 넣으면 오히려 위험하다.

- Semantic Cache
- Redis 기반 Rate Limit
- Redpanda 이벤트 파이프라인
- ClickHouse 대용량 로그 분석
- Streaming
- Runtime Policy Editor 고도화
- 사용자 초대/권한 관리 고도화
- Self-hosted/Hybrid 자동 설치

이 기능들은 버리는 것이 아니라 v2로 보내야 한다.  
v1에서 metrics와 k6로 병목을 측정하고, 그 결과를 근거로 v2 확장을 설명하면 된다.

---

## 4. 기술적 챌린지 정리

v1.0.0에서 기술적 난이도를 보여주려면 "우리가 어려운 기술을 많이 썼다"가 아니라, Gateway 운영에서 실제로 어려운 지점을 보여줘야 한다.

## 4.1 Gateway 런타임 설정 반영

관리자 화면에서 만든 Project, Application, API Key, Provider 설정이 Gateway 요청 처리에 반영되어야 한다.

이게 안 되면 Control Plane은 단순 설정 화면이고, Gateway와 분리된 장식이 된다.

## 4.2 API Key + App Token 이중 인증

Gateway API Key는 프로젝트 또는 조직의 Gateway 접근 권한을 나타낸다.  
App Token은 실제 고객사 애플리케이션 단위 접근을 나타낸다.

둘이 다른 Tenant, Project, Application을 가리키면 `scope_mismatch`로 차단해야 한다.

이 구조가 있어야 "기업이 앱 단위로 LLM 사용을 통제한다"는 메시지가 살아난다.

## 4.3 Rate Limit

v1에서는 PostgreSQL-backed Fixed Window로 충분하다.

목표는 완벽한 분산 Rate Limit이 아니다.  
목표는 Gateway가 요청을 받았을 때 사용 가능 여부를 판단하고, 초과 시 429로 차단하는 흐름을 보여주는 것이다.

v2에서는 k6 결과를 근거로 Redis 기반 Rate Limit로 확장한다.

## 4.4 마스킹과 차단

마스킹은 개인정보처럼 Provider로 보내도 되지만 가려야 하는 정보를 처리한다.  
차단은 API Key, JWT, 주민등록번호처럼 Provider로 보내면 위험한 정보를 막는다.

중요한 것은 원문을 로그에 그대로 남기지 않는 것이다.  
로그에는 redacted preview와 탐지 결과만 남겨야 한다.

## 4.5 Exact Cache

Exact Cache는 v1에서 비용 절감 효과를 가장 직관적으로 보여준다.

같은 요청이 다시 들어왔을 때 Provider를 호출하지 않고 이전 응답을 반환한다.  
이때 로그에는 cache hit, saved tokens, saved cost, 낮은 latency가 표시되어야 한다.

## 4.6 Simple Routing

v1의 라우팅은 복잡한 AI 모델 판단이 아니어도 된다.

예를 들어 다음 기준으로 충분하다.

- 짧고 단순한 요청은 저비용 모델
- 긴 요청이나 복잡한 요청은 고성능 모델
- `model=auto`일 때만 자동 라우팅
- 라우팅 사유를 로그에 기록

핵심은 "왜 이 모델로 갔는지"를 운영자가 이해할 수 있게 남기는 것이다.

## 4.7 Metrics와 k6

대규모 트래픽 처리를 말하려면 실제로 측정해야 한다.

v1에서는 최소한 다음을 남겨야 한다.

- request count
- success/error count
- latency
- provider latency
- cache hit count
- masking/block count
- rate limit decision count
- log write duration

k6 baseline은 "현재 구조의 한계가 어디인지"를 보여주는 자료다.  
이 결과가 있어야 v2에서 Redis, Redpanda, ClickHouse가 왜 필요한지 설명할 수 있다.

---

## 5. 최종 역할 분리

## A. Control Plane & Runtime Config

역할:

- Tenant / Project / Application 생성
- Provider / Model 설정
- Gateway API Key / App Token 발급
- active runtime config 제공
- Gateway가 설정을 실제로 읽는 smoke test 제공

완료 기준:

- 관리자가 만든 설정으로 Gateway 요청이 처리된다.
- 발급된 key/token으로 실제 Gateway 인증이 가능하다.

## B. Gateway Runtime & Provider

역할:

- OpenAI-compatible 요청 처리
- Provider adapter 구조
- Mock Provider 유지
- 실제 Provider 1개 연결 후보
- timeout, error format, requestId, provider latency 처리

완료 기준:

- 고객사 앱이 GateLM으로 요청을 보내고 응답을 받는다.
- 실패 응답도 일관된 형식으로 반환된다.

## C. Governance

역할:

- API Key 인증
- App Token 검증
- scope mismatch 차단
- PostgreSQL-backed Fixed Window Rate Limit
- 401 / 403 / 429 응답 계약 유지

완료 기준:

- 잘못된 key/token은 차단된다.
- 다른 Application의 token 조합은 차단된다.
- Rate Limit 초과 시 429가 반환된다.

## D. Safety & Cost

역할:

- PII 마스킹
- 위험 정보 차단
- Exact Cache
- Simple Routing
- token/cost 계산
- cache hit 시 Provider 호출 생략 검증

완료 기준:

- 민감정보는 redacted 상태로 로그에 남는다.
- 위험 정보는 Provider 호출 전에 차단된다.
- 같은 요청 2회차는 cache hit가 된다.
- `model=auto` 요청은 라우팅 결과와 사유가 기록된다.

## E. Observability & Demo

역할:

- Request Log
- Request Detail
- Dashboard Summary
- metrics endpoint
- JSON structured log 확인
- k6 baseline
- 고객사 업무 앱 데모

완료 기준:

- 요청 하나가 requestId 기준으로 추적된다.
- Dashboard에서 전체 사용량과 운영 상태를 확인할 수 있다.
- k6 baseline 결과를 발표 자료에 넣을 수 있다.

---

## 6. 머지 전략

이전 P0에서 가장 큰 문제는 A가 만든 문서를 기다리거나, 각자 계약을 다르게 해석해서 머지 충돌이 생긴 점이다.

이번에는 다음 방식이 좋다.

## 6.1 Day 0 계약 freeze

구현 전에 아래 계약만 작게 고정한다.

- Gateway Context
- Runtime Config
- Credential 응답 형식
- Rate Limit Decision
- Safety Decision
- Cache/Routing Result
- Invocation Log
- Dashboard Summary
- Error Response

이 계약은 모든 역할이 동시에 참고한다.  
A가 먼저 만들고 뿌리는 방식이 아니라, 팀 공통 계약으로 먼저 확정해야 한다.

## 6.2 Merge 1: 골격과 계약 반영

목표:

- 각 앱이 실행된다.
- 각 역할의 최소 endpoint, interface, mock, stub이 생긴다.
- 실제 구현은 약해도 계약 형태는 맞는다.

완료 기준:

- Docker Compose 또는 로컬 실행 가능
- Control Plane / Gateway / Web 기본 실행
- smoke script에서 최소 health check 통과

## 6.3 Merge 2: 핵심 요청 흐름

목표:

- 발급된 key/token으로 Gateway 요청이 가능하다.
- 인증, Rate Limit, 마스킹, 캐시, 라우팅, Provider 호출이 연결된다.

완료 기준:

- 정상 요청 200
- 잘못된 key 401
- scope mismatch 403
- rate limit 초과 429
- 위험 정보 차단
- cache hit 검증

## 6.4 Merge 3: 로그와 대시보드

목표:

- Gateway를 통과한 요청이 로그와 대시보드에 반영된다.
- 운영자가 requestId 기준으로 요청을 추적할 수 있다.

완료 기준:

- Request Log 목록 조회
- Request Detail 조회
- Dashboard Summary 조회
- masking/cache/routing/rate limit 결과 표시

## 6.5 Merge 4: 데모와 성능 증거

목표:

- 고객사 업무 앱 데모가 동작한다.
- metrics와 k6 baseline으로 운영형 Gateway라는 증거를 만든다.

완료 기준:

- 고객사 앱에서 GateLM 호출 성공
- 호출 후 로그 상세로 이동 가능
- metrics endpoint 확인
- k6 baseline 결과 정리
- 발표 시나리오 완성

---

## 7. 최종 발표 메시지

발표에서는 기능을 나열하면 안 된다.  
아래 메시지를 중심으로 잡는 것이 좋다.

> 기업에서 여러 팀과 애플리케이션이 각자 OpenAI, Anthropic, Gemini API를 직접 쓰기 시작하면, 관리자는 어떤 데이터가 외부로 나가는지, 어떤 팀이 얼마나 쓰는지, 어떤 모델이 왜 선택됐는지 알기 어렵습니다. GateLM은 모든 LLM 요청이 지나가는 Gateway로서 인증, 정책, 보안, 비용 절감, 라우팅, 로그, 대시보드를 중앙에서 제공합니다.

시연도 이 메시지에 맞춰야 한다.

1. 관리자가 프로젝트와 앱을 만들고 key/token을 발급한다.
2. 고객사 업무 앱이 GateLM으로 LLM 요청을 보낸다.
3. GateLM이 요청을 인증하고 정책을 적용한다.
4. 민감정보는 마스킹되고 위험 정보는 차단된다.
5. 반복 요청은 캐시되어 비용이 줄어든다.
6. `model=auto` 요청은 적절한 모델로 라우팅된다.
7. 관리자는 requestId로 로그와 대시보드에서 결과를 확인한다.
8. metrics와 k6 결과로 운영형 Gateway임을 보여준다.

---

## 8. 최종 결론

Round 1의 장점은 범위를 넓혀 GateLM을 기업용 서비스처럼 보이게 만들려는 공격적인 방향이었다.  
Round 2의 장점은 그 범위를 v1 제품 흐름과 v2 확장 흐름으로 정리한 점이었다.

따라서 Round 3 최종안은 다음이다.

1. GateLM은 B2B LLM Gateway다.
2. v1.0.0은 확장 P0로 잡되, 메인 흐름은 하나로 고정한다.
3. v1.0.0의 핵심은 인증, 정책, 보안, 캐시, 라우팅, 로그, 대시보드, metrics가 연결된 end-to-end Gateway 흐름이다.
4. Rate Limit과 k6 baseline은 v1에 포함해 "운영형 Gateway"라는 증거를 만든다.
5. Semantic Cache, Redpanda, ClickHouse, Streaming은 v2 확장으로 두고, v1에서 측정한 병목을 근거로 붙인다.
6. 팀 개발은 Day 0 계약 freeze 후 A~E가 동시에 구현한다.

최종 한 줄:

> GateLM v1.0.0은 기업의 LLM 요청을 하나의 허용된 경로로 통과시켜, 보안과 비용과 사용량을 중앙에서 통제하고 추적하는 운영형 LLM Gateway다.
