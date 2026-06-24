# GateLM P0/P1/P2 Scope

## 문서 목적

이 문서는 GateLM 구현 범위를 P0, P1, P2, 제외 기능으로 나누어 팀원이 같은 기준으로 판단하도록 한다.

현재 P0는 3~5일 안에 데모 필수 흐름을 완성하는 최소 구현이다. 기능을 많이 여는 것보다 Gateway vertical slice가 끊기지 않는 것이 우선이다.

---

## 1. 범위 라벨 기준

| 라벨 | 의미 |
|---|---|
| P0 | 3~5일 안에 반드시 구현해야 하는 데모 필수 최소 범위 |
| P1 | P0 완료 후 제품성을 높이기 위한 확장 범위 |
| P2 | 장기 확장 범위. 이번 P0/P1 구현에서는 제외 |
| 제외 | 이번 MVP에서 명시적으로 하지 않는 기능 |

P0에서 `중간`과 `낮음` 우선순위 항목은 seed, mock, 단순 API, 축소 UI로 대체할 수 있다.

---

## 2. P0 — 데모 필수 기능

| 대분류 | 기능 | 설명 | 우선순위 |
|---|---|---|---|
| Gateway | OpenAI-compatible 요청 전달 | 요청을 GateLM이 받아 Mock Provider 또는 Provider Adapter로 전달하고 응답을 반환한다. | 높음 |
| Gateway | 사용 가능한 모델 목록 조회 | 프로젝트에서 사용할 수 있는 모델 목록을 제공한다. P0는 mock catalog면 충분하다. | 낮음 |
| 인증/접근제어 | API Key 발급 | Gateway 호출에 필요한 API Key를 발급한다. 원문 Key는 생성 시 1회만 보여준다. | 높음 |
| 인증/접근제어 | API Key 인증 | 승인된 API Key가 있는 요청만 Gateway를 사용할 수 있게 한다. | 높음 |
| 인증/접근제어 | App Token 발급 | Application 단위 접근 제어를 위한 App Token을 발급한다. 원문 Token은 생성 시 1회만 보여준다. | 중간 |
| 인증/접근제어 | App Token 검증 | 등록된 Application에서 온 요청인지 Gateway에서 검증한다. | 중간 |
| 프로젝트 관리 | Tenant / Project / Application 생성 | LLM 사용량과 로그를 Tenant, Project, Application 단위로 식별하고 관리한다. P0는 seed 또는 최소 생성 API를 허용한다. | 낮음 |
| Mock Provider | 테스트용 Provider 호출 | 실제 LLM Provider 없이도 Gateway 요청 흐름을 끝까지 검증할 수 있게 한다. | 높음 |
| 모델 선택 | Simple Routing | `auto`로 요청이 들어오면 GateLM이 저비용 모델 또는 기본 모델을 선택한다. | 높음 |
| 비용 절감 | Exact Cache | 동일 요청이 반복되면 이전 응답을 재사용해 Provider 호출을 생략한다. | 높음 |
| 보안 | 개인정보 마스킹 | 이메일, 전화번호 같은 개인정보를 Provider 호출 전에 마스킹으로 치환한다. | 높음 |
| 보안 | 위험 정보 차단 | API Key, JWT, 주민등록번호 같은 위험 정보가 포함된 요청은 Provider 호출 전에 차단한다. | 높음 |
| 사용량/로그 | 요청 로그 저장 | Gateway를 거친 LLM 요청 기록을 requestId 기준으로 저장한다. | 높음 |
| 사용량/로그 | 토큰/비용/응답 시간 기록 | 요청별 prompt token, completion token, 예상 비용, latency를 저장한다. P0에서는 mock usage 기반으로 단순화한다. | 중간 |
| 사용량/로그 | 요청 상세 조회 | 개별 요청의 모델, 비용, 토큰, 응답 시간, 캐시, 라우팅, 마스킹 결과를 확인한다. | 높음 |
| 대시보드 | 사용 현황 요약 | 전체 요청 수, 성공 요청 수, 차단 요청 수, 캐시 적중 정보를 중심으로 보여준다. P0에서는 축소 카드로 충분하다. | 중간 |
| 데모/연동 | 고객사 앱 연동 데모 | 기존 LLM endpoint를 GateLM Gateway로 바꾸면 인증, 캐시, 라우팅, 마스킹, 로깅이 적용되는 흐름을 보여준다. | 높음 |

---

## 3. P1 — P0 완료 후 확장 기능

| 대분류 | 기능 | 설명 | 우선순위 |
|---|---|---|---|
| Streaming | 실시간 응답 | `stream=true` 요청을 SSE 방식으로 중계한다. | 중간 |
| Provider 연동 | 실제 LLM Provider 연결 | OpenAI-compatible 실제 Provider Adapter를 1개 이상 연결한다. | 높음 |
| 정책 | Rate Limit | Project 단위 RPM 제한을 적용하고 초과 시 Provider 호출 전에 차단한다. | 최우선 |
| 정책 | Budget Hard Block | 월 예산을 초과하면 Provider 호출 전에 차단한다. | 최우선 후보 |
| 분석 인프라 | Redpanda / ClickHouse 연동 | Gateway 로그를 비동기 이벤트로 처리하고 분석 DB에 저장한다. | 중간 |
| 대시보드 | 시계열 차트 | 요청 수, 비용, 응답 시간 추이를 차트로 보여준다. | 높음 |
| Chat UI | Text-only Chat UI | 고객사가 별도 UI가 없을 때 사용할 수 있는 간단한 텍스트 채팅 UI를 제공한다. | 중간 |
| Context | Reply-to Context | 특정 이전 응답에 답장할 때 parent message 1단계 context를 포함한다. | 후순위 |

---

## 4. P2 — 장기 확장 기능

| 대분류 | 기능 | 설명 | 우선순위 |
|---|---|---|---|
| 고급 캐시 | Semantic Cache | 완전히 같은 요청이 아니어도 유사 요청이면 캐시를 활용한다. | 최우선 |
| 정책 관리 | Runtime Policy Editor | 보안, 라우팅, 예산 정책을 UI에서 작성하고 버전 관리한다. | 중간 |
| 보안 정책 | Custom Regex Rule | 고객사가 직접 민감정보 탐지 규칙을 등록한다. | 중간 |
| 조직 관리 | 사용자 초대 / 권한 관리 | 팀원을 초대하고 Tenant 또는 Project 단위 권한을 부여한다. | 낮음 |
| 배포/설치 | Self-hosted / Hybrid 설치 | 기업 내부 서버에서 직접 운영할 수 있는 설치 방식을 제공한다. | 낮음 |
| 분석 인프라 | 대용량 로그 분석 | 대량 요청 로그를 ClickHouse 기반으로 장기 분석한다. | 높음 |

---

## 5. 이번 MVP에서 제외하는 기능

```text
- 파일 업로드
- 이미지 입력
- OCR
- RAG 기반 문서 검색
- 복잡한 AgentOps Trace
- Kubernetes 배포
- Envoy 프록시
- Redis Cluster
- 완전한 정책 엔진
```

---

## 6. P0 최종 데모 시나리오

```text
1. Admin 또는 seed 데이터로 GateLM 데모 환경에 진입한다.
2. Project/Application/API Key/App Token 정보를 준비한다.
3. 개발자가 고객사 앱의 LLM endpoint를 GateLM Gateway로 변경한다.
4. 고객사 앱 또는 curl에서 /v1/chat/completions 요청을 보낸다.
5. Gateway가 API Key와 App Token을 검증하고 context를 식별한다.
6. safe 요청은 mock Provider로 전달되고 usage/cost/latency가 기록된다.
7. 동일 요청 2회차는 Exact Cache hit로 처리된다.
8. model=auto 요청은 mock-fast 또는 기본 모델로 simple routing된다.
9. 이메일/전화번호 포함 요청은 redacted prompt로 Provider에 전달된다.
10. credential-like/JWT/RRN 포함 요청은 Provider 호출 전에 차단된다.
11. Request Detail에서 routing/cache/masking/token/cost/latency를 확인한다.
12. Dashboard에서 total/success/blocked/cache 중심 요약을 확인한다.
```

---

## 7. 방향성 원칙

```text
- GateLM은 단순 Chat UI 서비스가 아니라 LLM Gateway 서비스다.
- 모든 승인된 LLM 요청은 GateLM Gateway를 통과해야 한다.
- 3~5일 P0에서는 mock provider와 축소 UI를 적극 허용한다.
- 비용 절감과 보안 통제가 핵심 가치다.
- Provider 호출 전 마스킹/차단이 기본이다.
- 원문 Prompt/Response는 기본적으로 영속 저장하지 않는다.
- 정책은 장기적으로 Runtime Policy로 관리하지만 P0는 JSON config로 단순화한다.
- 문서에 없는 API, Event, DB 구조를 임의로 만들지 않는다.
```
