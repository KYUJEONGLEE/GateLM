# Have-To Decisions - 재혁님

> Control Plane & Runtime Policy 관점에서 팀 결정이 필요한 항목만 모은 working draft입니다.
> 공식 계약이 아니며, 합의 전에는 API, DB, Event, Metrics, security-sensitive field를 확정하지 않습니다.

## 빠른 결정 요약

| No | 결정할 것 | 추천안 | 영향 범위 | 우선순위 | 상태 |
| -- | -- | -- | -- | -- | -- |
| 1 | RuntimeConfig와 RuntimeSnapshot 경계 | v1.x는 thin snapshot, v2.0.0에서 lifecycle 정리 | Gateway, Web, Observability | P0 | 토론 중 |
| 2 | 조직/팀/budget scope 표현 | core identity 확정은 보류하고 scope 요구사항부터 합의 | 전체 | P0 | 미결정 |
| 3 | publish/reload 실패 동작 | invalid publish는 차단, 기존 안전 상태 유지 | Gateway, Control Plane | P0 | 추천안 있음 |
| 4 | 민감 원문 저장 여부 | 기본 비저장, 필요 시 별도 opt-in 논의 | Security, DB, Demo | P0 | 추천안 있음 |
| 5 | 실제 Provider 정책 범위 | v1.x에서 1종 thin slice, Mock fallback 유지 | Gateway, Control Plane | P1 | 토론 중 |
| 6 | event/log/metric evidence 수준 | 데모 설명 단위부터 정하고 필드는 나중에 확정 | Observability, Web | P1 | 미결정 |
| 7 | 데모 입력 방식 | preset 중심, 제한 자유 입력은 리허설 후 판단 | Web, Safety, Gateway | P1 | 추천안 있음 |

## 1. Runtime policy publish 단위

### 왜 결정해야 하나?

Control Plane이 만든 정책을 Gateway가 어떻게 읽고, 언제 갱신하고, 실패 시 어떻게 유지할지 정해야 v2.0.0 main path가 흔들리지 않습니다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| Static snapshot | 파일 또는 fixture export를 Gateway가 소비 | 빠르게 병렬 검증 가능 | live 정책 반영 증거가 약함 |
| Thin live publish | 최소 publish/reload 흐름만 연결 | v2 메시지와 잘 맞음 | 최소 계약 합의 필요 |
| Full lifecycle | 운영 수준의 lifecycle 구현 | 제품성 강함 | v2.0.0 범위 초과 위험 |

### 추천안

v1.x에서는 정적 snapshot export와 얇은 publish/reload smoke를 먼저 만듭니다. v2.0.0에서는 lifecycle을 정리하되 세부 필드명과 저장 구조는 공식 계약 문서로 넘깁니다.

### 결정 전까지 안전한 기본값

정적 snapshot export와 sanitized fixture를 기준으로 병렬 개발합니다.

### 영향을 받는 역할

Control Plane, Gateway, Web, Observability

## 2. 민감 정보와 raw content

### 왜 결정해야 하나?

보안 신뢰도, 데모 안정성, DB 부담, 팀 역할 경계에 모두 영향을 줍니다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| 기본 비저장 | 원문을 저장하지 않음 | 안전하고 설명 쉬움 | 디버깅 정보가 줄어듦 |
| 제한 opt-in | 조건부로 저장 | 운영 분석 가능 | 접근 제어와 보존 정책 필요 |
| 기본 저장 | 항상 저장 | 분석 쉬움 | 보안 리스크 큼 |

### 추천안

기본값은 저장하지 않는 방향으로 둡니다. 필요하더라도 별도 opt-in, 접근 제어, 보관 기간, 암호화 조건을 합의하기 전에는 예시 데이터도 문서에 넣지 않습니다.

### 결정 전까지 안전한 기본값

문서, fixture, demo에는 raw prompt, raw response, secret 원문을 넣지 않습니다.

### 영향을 받는 역할

전체 역할

## 3. publish/reload failure mode

### 왜 결정해야 하나?

정책 시스템은 성공 경로보다 실패 경로가 더 중요합니다. 잘못된 설정이 Gateway에 반영되면 데모와 제품 신뢰도가 동시에 깨집니다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| fail closed | 실패 시 요청 차단 또는 publish 차단 | 안전함 | 데모 흐름이 멈출 수 있음 |
| last known safe | 마지막 안전 상태 유지 | 데모와 운영 안정성 균형 | 상태 설명 필요 |
| fail open | 실패해도 진행 | 가용성 높음 | 정책 신뢰도 낮음 |

### 추천안

검증 실패 시 publish를 막고, Gateway는 마지막으로 안전하다고 판단된 상태를 유지하는 방향을 우선 검토합니다. 정확한 상태 표현과 이벤트 구조는 아직 확정하지 않습니다.

### 결정 전까지 안전한 기본값

invalid publish는 차단하고, live 경로가 불안정하면 static fixture로 설명합니다.

### 영향을 받는 역할

Control Plane, Gateway, Observability, Web

## 4. 데모 evidence 수준

### 왜 결정해야 하나?

Control Plane은 화면만 있으면 설득력이 약합니다. 정책 변경이 실제 요청 결과나 집계 화면에 반영되는 evidence가 필요합니다.

### 선택지

| 선택지 | 설명 | 장점 | 단점 |
| -- | -- | -- | -- |
| fixture only | 정적 증거만 표시 | 안정적 | 제품성이 약함 |
| live + fallback | live 우선, fixture 대체 | 안정성과 설득력 균형 | parity 관리 필요 |
| live only | 실제 요청만 표시 | 설득력 강함 | 발표 리스크 큼 |

### 추천안

민감 원문 없이도 설명 가능한 preset 요청, sanitized fixture, 정책 변경 전후 비교를 준비합니다. live path가 불안정할 경우 fallback evidence로 같은 이야기를 유지합니다.

### 결정 전까지 안전한 기본값

live + fallback을 함께 준비합니다.

### 영향을 받는 역할

전체 역할
