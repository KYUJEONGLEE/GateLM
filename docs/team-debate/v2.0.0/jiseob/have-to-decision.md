# Have-To Decisions - 이지섭 / Gateway Data Plane & Governance

> 공식 계약이 아니라 팀 결정이 필요한 항목을 모으는 working draft입니다.
> 이 문서에서는 API, DB, Event, Metrics, security-sensitive field를 확정하지 않습니다.
> 합의된 내용만 이후 공식 v2.0.0 계약 문서로 승격합니다.

## 빠른 결정 요약

| No | 결정할 것 | 현재 추천안 | 영향 범위 | 우선순위 | 상태 |
| -- | -- | -- | -- | -- | -- |
| 1 | RuntimeSnapshot 소비 경계 | v1.x에서는 thin slice로 소비 | Gateway, Control Plane, Observability | P0 | 토론 중 |
| 2 | Provider 범위 | Provider 1종 + 모델 2개 이상 + Mock fallback | Gateway, Web, Demo | P0 | 추천안 있음 |
| 3 | Streaming 범위 | v1.x thin slice, v2에서 확장 | Gateway, Web, Observability | P1 | 토론 중 |
| 4 | Evidence 생산 단위 | redacted summary 중심 | Gateway, Observability, Demo | P0 | 추천안 있음 |
| 5 | raw prompt/response 저장 | 기본 금지, opt-in 별도 논의 | Security, DB, Web, Demo | P0 | 추천안 있음 |
| 6 | team/budget scope 관계 | `teamId` core 승격 보류, budget scope로 검토 | 전체 역할 | P0 | 토론 중 |
| 7 | 성능 플랫폼 도입 순서 | PostgreSQL/k6/query profile 먼저 | Gateway, Observability | P1 | 추천안 있음 |

## 1. RuntimeSnapshot 소비 경계

### 왜 결정해야 하나?

Gateway는 요청 처리 시점에 어떤 정책을 기준으로 routing, safety, cache, provider call을 판단해야 합니다. 이 경계가 불명확하면 Control Plane과 Gateway가 서로 다른 가정을 하게 됩니다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| Static fixture | 파일 또는 fixture 기반 snapshot 소비 | 빠르게 병렬 개발 가능 | live 정책 반영 장면이 약함 |
| RuntimeSnapshot thin slice | publish된 snapshot 일부를 Gateway가 소비 | v2 목표와 잘 맞음 | 최소 계약 합의 필요 |
| Full live config | 운영 수준의 live config reload | 제품성 강함 | v2.0.0 범위를 넘을 위험 |

### 추천안

v1.x에서는 static fixture와 RuntimeSnapshot thin slice를 함께 사용하고, v2.0.0에서는 정책 변경이 다음 요청 결과에 반영된다는 수준까지만 목표로 둡니다.

### 결정 전까지 안전한 기본값

Gateway는 snapshot fixture를 소비할 수 있게 준비하되, 필드명과 저장 구조는 확정하지 않습니다.

### 영향을 받는 역할

Control Plane, Gateway, Observability, Web

## 2. Provider Adapter 범위

### 왜 결정해야 하나?

Mock Provider만으로는 v2.0.0의 제품 설득력이 약합니다. 하지만 실제 Provider 범위를 넓히면 secret, 비용, 장애 처리 부담이 커집니다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| Mock only | Mock Provider 유지 | 안정적 | 제품성 약함 |
| Provider 1종 + Mock | 실제 Provider와 fallback 병행 | 현실적 | 실패 처리 필요 |
| Multi-provider | 여러 Provider 동시 지원 | 제품성 강함 | 범위 큼 |

### 추천안

v1.x에서 실제 Provider 1종과 모델 2개 이상을 검증하고, Mock fallback은 계속 유지합니다.

### 결정 전까지 안전한 기본값

Provider credential은 문서와 데모에 직접 노출하지 않습니다. raw secret 예시는 사용하지 않습니다.

### 영향을 받는 역할

Gateway, Control Plane, Web, Observability

## 3. Streaming 범위

### 왜 결정해야 하나?

Streaming은 LLM Gateway의 체감 품질에 중요하지만, provider별 차이를 모두 정규화하려 하면 범위가 커집니다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| Non-stream 유지 | 기존 경로 안정화 | 안전함 | LLM 제품감 약함 |
| Thin slice | 한 경로만 얇게 지원 | 데모 가능 | 일반화 부족 |
| Full normalization | Provider별 stream 차이 흡수 | 제품성 강함 | 범위 큼 |

### 추천안

v1.x에서는 한 Provider 또는 Mock 기반 thin slice로 시작하고, v2.0.0에서는 demo 가능한 수준의 안정성과 evidence를 확보합니다.

### 결정 전까지 안전한 기본값

stream chunk schema, event name, metrics name은 이 문서에서 확정하지 않습니다.

### 영향을 받는 역할

Gateway, Web, Observability

## 4. Evidence 생산 단위

### 왜 결정해야 하나?

Gateway evidence는 Web demo, Observability dashboard, Safety 평가가 함께 소비합니다. 너무 자세하면 보안 위험이 있고, 너무 적으면 검증력이 떨어집니다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| Minimal summary | 결과 요약만 제공 | 안전함 | 분석 약함 |
| Redacted summary | 요약과 sanitized evidence 제공 | 균형 좋음 | 기준 필요 |
| Raw detail | 원문 포함 상세 제공 | 분석 쉬움 | 보안 리스크 큼 |

### 추천안

redacted summary 중심으로 요청 결과, routing 결과, cache 결과, safety 결과, provider 결과, latency 계열 정보를 남기는 방향을 검토합니다.

### 결정 전까지 안전한 기본값

raw prompt, raw response, secret, credential, provider key는 evidence에 포함하지 않습니다.

### 영향을 받는 역할

전체 역할

## 5. Team / Budget Scope 관계

### 왜 결정해야 하나?

v2.0.0은 조직과 팀 단위 governance를 강조하지만, `teamId`를 core identity로 성급히 넣으면 기존 tenant/project/application 경계가 흔들릴 수 있습니다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| teamId core 승격 | Gateway core identity로 사용 | 팀 관제 직관적 | 기존 계약 흔들림 |
| budget scope | budget/routing 판단 범위로 표현 | 유연함 | 용어 합의 필요 |
| metadata 처리 | 일단 부가 정보로 유지 | 영향 작음 | 제품 메시지 약함 |

### 추천안

`tenantId`는 조직 경계로 유지하고, team 단위 예산/라우팅은 budget scope 계열로 표현하는 방향을 우선 검토합니다.

### 결정 전까지 안전한 기본값

`teamId`를 Gateway core identity로 확정하지 않습니다.

### 영향을 받는 역할

전체 역할
