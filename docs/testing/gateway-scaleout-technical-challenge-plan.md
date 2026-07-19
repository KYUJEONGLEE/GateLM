# 운영 동등 환경 기반 Gateway 1대 → 2대 확장 실험 기록

## 1. 실험 목적

현재 운영 중인 4개 역할 분산 환경과 같은 애플리케이션·설정·의존성 경로를 격리된 성능 환경에 재현한 뒤, Gateway만 1대에서 2대로 늘렸을 때 다음을 비교한다.

- 처리량, 지연시간, 오류율이 실제로 개선되는가
- 공유 Redis 기반 Rate Limit이 두 Gateway에서 일관되게 적용되는가
- 같은 논리 요청이 두 Gateway로 분산될 때 Provider 중복 호출과 중복 비용이 발생하는가
- 응답, Assistant 메시지, Request Log, 비용 정산이 한 번만 기록되는가
- 진행 중인 SSE 요청에 재연결하거나 다른 Gateway가 이어받을 수 있는가

이 실험의 우선순위는 문제를 즉시 고치는 것이 아니라, 분산 전환 전후의 재현 조건과 원본 증거를 남기는 것이다. 실험 중 발견되는 동시성·멱등성·Rate Limit·중복 호출 문제는 별도 개선 실험 전까지 그대로 보존한다.

## 2. 주장 경계

이 문서에서 다음 표현을 구분한다.

- **확인됨**: 코드, AWS 런타임, DB 또는 원본 부하 결과로 확인한 사실
- **관측됨**: 지정된 실험에서 실제로 발생하고 원본 로그가 보존된 결과
- **가설**: 분산 구조상 발생 가능하지만 아직 재현하지 않은 문제
- **한계**: 현재 실험만으로 보장할 수 없는 범위

가설을 장애나 결함으로 단정하지 않는다. 특히 Provider 호출이 시작된 뒤 응답을 받지 못한 모호한 실패에서는 Provider가 상태 조회나 자체 멱등성을 제공하지 않으면 Gateway만으로 exactly-once 실행을 증명할 수 없다.

## 3. 2026-07-19 사전 확인 스냅샷

### 운영 환경

| 역할 | Private IP | 인스턴스 | 확인된 상태 |
|---|---:|---|---|
| Edge | `10.78.1.10` | `c7i.large` | Web, Chat Web, Caddy |
| Gateway | `10.78.2.20` | `c7i.xlarge` | Gateway 1대 |
| Data | `10.78.2.30` | `m7i.large` | PostgreSQL, Redis, Control Plane, Chat API, RAG Worker |
| AI | `10.78.2.40` | `c7i.large` | AI Service, Mock Provider |

- 애플리케이션 배포 SHA: `3be2a8d7e0da63219a8a05d07b9b10797ee42a4e`
- 복제 DB 기준 SHA: `9936521039a6ace9d3ed32508c1fc92e89da61e2`
- API Key 인증 캐시: 활성화, TTL 5초, 최대 4096개
- Rate Limit: Redis, Token Bucket, 운영 확인값 60 requests / 60 seconds
- Difficulty 추론: Gateway 로컬 E5 활성화, timeout 100ms
- 현재 운영 배포본의 AI Safety sidecar: 비활성화

애플리케이션 SHA와 DB 복제 기준 SHA가 다른 것은 오류가 아니다. 운영 애플리케이션 배포는 매번 DB를 다시 덤프·복원하지 않으므로 두 기준을 독립적으로 기록한다.

### 변경 전 성능 환경

| 역할 | Private IP | 인스턴스 | 확인된 상태 |
|---|---:|---|---|
| Load Generator 겸 Edge | `10.77.1.10` | `c7i.large` | Web, Chat Web, Caddy와 부하 발생기 공유 |
| Gateway 1 | `10.77.1.20` | `c7i.xlarge` | 별도 실험 이미지 `perf-local-e5-control` |
| Data | `10.77.1.30` | `m7i.large` | PostgreSQL, Redis, Control Plane, Chat API |
| AI / Mock | `10.77.1.40` | `c7i.xlarge` | AI Service, 100ms Mock Provider |

변경 전 상태는 운영 동등 기준선으로 사용할 수 없다. Gateway 이미지가 운영 배포본과 다르고, RAG Worker가 없으며, Load Generator와 Edge가 CPU·네트워크를 공유하기 때문이다.

## 4. 목표 성능 토폴로지

### Gateway 1대 기준선

```text
Load Generator 10.77.1.10
  -> HTTPS Edge/Caddy 10.77.1.50
       -> Gateway 1 10.77.1.20
            -> Data 10.77.1.30
            -> AI + Mock 10.77.1.40
```

### Gateway 2대 비교군

```text
Load Generator 10.77.1.10
  -> HTTPS Edge/Caddy 10.77.1.50
       -> round-robin Gateway 1 10.77.1.20
       -> round-robin Gateway 2 10.77.1.21
            -> shared Data 10.77.1.30
            -> shared AI + Mock 10.77.1.40
```

고정 조건:

- 애플리케이션은 두 단계 모두 정확히 같은 `3be2a8d7…` 소스와 이미지 설정 사용
- PostgreSQL·Redis·Control Plane·AI·100ms Mock은 두 단계에서 동일
- 인증 캐시 활성화 및 TTL 5초 유지
- 실제 Provider와 SMTP 호출 차단
- Gateway 수 이외의 설정은 변경하지 않음
- Load Generator는 측정 대상 4개 역할의 CPU와 분리

## 5. 운영과 동일하다고 주장할 수 없는 차이

성능 환경은 서비스 경로와 애플리케이션 설정을 운영과 맞추지만, 네트워크 배치는 완전히 동일하지 않다.

- 운영은 Public Edge subnet과 Private backend subnet을 분리한다.
- 성능 환경은 기존 데이터 볼륨을 보존하기 위해 하나의 Public subnet을 유지한다.
- Security Group으로 허용 통신을 제한하지만 subnet·NAT·route 수준의 동일성은 없다.
- Provider는 실제 외부 모델이 아니라 고정 100ms Mock이다.
- 운영 사용자 데이터가 아닌 격리된 synthetic API Key와 Application을 부하에 사용한다.

따라서 결과는 **운영과 같은 Gateway 내부 경로를 사용한 상대 비교**로 사용하며, 실제 Provider 포함 E2E 용량이나 전체 운영 가용성 수치로 확대 해석하지 않는다.

## 6. 실험 단계

### A. 배포 동등성 확인

각 호스트에서 다음 원본을 저장한다.

- Git SHA, Docker image tag/digest, Compose config hash
- 인스턴스 유형과 vCPU·메모리
- 인증 캐시, Rate Limit, E5, AI Safety 관련 비밀 제외 환경값
- 컨테이너 health check와 시작 시각
- PostgreSQL migration 상태, RuntimeSnapshot 식별값
- Redis 연결과 DB 연결
- 실제 Provider credential이 부하 경로에 사용되지 않는다는 검증

### B. Gateway 1대 기준선

낮은 RPS부터 단계적으로 올린다. 각 단계는 같은 지속시간·VU 계산·요청 payload를 사용한다.

예비 탐색 구간: `10 → 20 → 30 → 40 → 50 RPS`

실패 지점이 확인되면 그 전후를 더 촘촘하게 측정하고, 지속 가능한 최고 구간에서 별도 soak test를 수행한다. 각 실행은 다음을 기록한다.

- 요청 수, 완료 수, dropped iterations
- HTTP 오류율과 status 분포
- 평균, p50, p95, p99, max latency
- Gateway CPU·메모리·goroutine
- Data/Redis/AI CPU·메모리
- 비동기 Request Log queue depth와 drop/persist error
- Mock Provider 호출 수
- Gateway 1 응답 수

### C. Gateway 2대 확장

Gateway 2에 Gateway 1과 동일한 이미지·환경·secret을 배포하고 Caddy만 round-robin upstream 2개로 변경한다. B와 같은 RPS·지속시간·VU·payload를 그대로 반복한다.

추가 기록:

- Gateway 1·2 각각의 응답 수와 분배 비율
- Gateway 1·2 각각의 CPU·메모리·goroutine
- 두 Gateway 메트릭 counter의 합
- 공유 PostgreSQL·Redis·AI의 자원 증가량
- 1대 대비 2대 처리량 증가율과 p95·p99 변화

## 7. 해결하지 않고 관측할 기술적 챌린지

### 7.1 API Key 인증 캐시와 cross-replica singleflight

**확인됨:** 인증 캐시와 singleflight는 Gateway 프로세스 내부 상태다.

**가설:** 같은 API Key의 캐시가 동시에 만료되고 요청이 두 Gateway로 나뉘면, 각 프로세스가 한 번씩 Control Plane 인증 조회를 수행할 수 있다. 단일 프로세스 singleflight가 두 프로세스 사이의 중복 조회까지 합치지는 못한다.

수집할 증거:

- 캐시 warm/cold를 분리한 Control Plane 인증 조회 횟수
- 같은 키로 동시 요청했을 때 Gateway별 cache hit/miss
- TTL 경계에서 Control Plane 호출 총합

이 단계에서는 분산 lock이나 공유 인증 캐시를 추가하지 않는다.

### 7.2 공유 Redis Rate Limit 일관성

**확인됨:** 두 Gateway는 같은 Redis를 사용하도록 구성한다.

**검증 질문:** 제한이 `N`인 동일 주체의 요청을 두 Gateway에 동시에 보내도 전체 허용 수가 `N`을 넘지 않는가.

수집할 증거:

- Gateway별 허용·거절 수와 전체 합
- Redis key, TTL, token 변화의 비밀 제외 스냅샷
- 제한된 요청이 Mock Provider까지 전달됐는지 여부
- 동시 요청과 시간창 경계에서의 결과

Redis Lua 또는 현재 원자 연산이 정상이라면 문제가 재현되지 않을 수 있다. 그 결과 역시 그대로 기록한다. 알고리즘이나 key 구조는 이 실험에서 변경하지 않는다.

### 7.3 동일 멱등성 키의 Provider 중복 호출·중복 비용

**가설:** 첫 요청이 Gateway 1에서 실행 중일 때 같은 멱등성 키가 Gateway 2로 들어오면, 프로세스 메모리에 있는 active stream을 Gateway 2가 알지 못할 수 있다.

수집할 증거:

- 동일 키 동시 요청 2개의 실제 upstream Gateway
- Mock Provider call counter
- ProviderAttempt 행 수
- Assistant Message 행 수
- Request Log 행 수
- 비용 ledger 또는 usage settlement 행 수
- 반환된 turn/message ID

판정은 “응답이 같아 보였다”가 아니라 Provider 호출과 영속 행을 함께 대조한다. 중복 호출이 관측돼도 이 단계에서는 분산 lock, 요청 소유권 lease 또는 shared stream을 구현하지 않는다.

### 7.4 SSE 재연결과 Gateway 장애

**확인됨:** 현재 진행 중인 SSE 세션과 replay 연결의 일부는 Gateway 프로세스 메모리에 의존한다.

실험:

1. Gateway 1에 스트리밍 요청을 고정해 Provider 호출을 시작한다.
2. 응답 중 연결을 끊고, 동일 키 재연결을 round-robin Edge로 보낸다.
3. 별도 실행에서 Gateway 1 프로세스를 Provider dispatch 전·후에 각각 종료한다.
4. 재연결 성공 여부, Provider 호출 수, DB 결과를 대조한다.

**한계:** 테스트를 위해 Gateway 종료는 수행할 수 있지만, 발견된 takeover 부재는 고치지 않는다. 실제 Provider가 실행 상태 조회나 멱등성을 제공하지 않는 경우 dispatch 후 모호한 실패에 대해 exactly-once를 보장했다고 주장하지 않는다.

### 7.5 공유 AI 서버 병목

Gateway가 2대로 늘어도 AI Service와 Mock Provider는 1대다. 처리량이 2배가 되지 않는다면 Gateway가 아니라 AI·Data·Redis가 병목인지 자원과 단계별 지연으로 구분한다.

100ms Mock은 네트워크와 Provider 대기시간을 통제하기 위한 기준선이다. 실제 모델 속도를 대표하지 않는다. 이후 별도 실험에서 지연 프로파일을 바꿀 수 있지만, 1대/2대 직접 비교 중에는 100ms를 고정한다.

## 8. 결과 기록 표

### 용량 비교

| Gateway 수 | 목표 RPS | 완료 RPS | 오류율 | dropped | p95 | p99 | G1 응답 | G2 응답 | Mock 호출 | 판정 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 |  |  |  |  |  |  |  | 0 |  | 대기 |
| 2 |  |  |  |  |  |  |  |  |  | 대기 |

### 분산 정확성 비교

| 시나리오 | 기대값 | 관측값 | 원본 증거 | 결과 | 해결 여부 |
|---|---|---|---|---|---|
| 동일 키 동시 요청 | Provider 호출 1회 | 대기 | 대기 | 미측정 | 의도적으로 미해결 |
| 동일 주체 Rate Limit | 전체 허용 수가 제한 이하 | 대기 | 대기 | 미측정 | 의도적으로 미해결 |
| Assistant 저장 | 1행 | 대기 | 대기 | 미측정 | 의도적으로 미해결 |
| 비용 정산 | 1회 | 대기 | 대기 | 미측정 | 의도적으로 미해결 |
| 타 Gateway SSE 재연결 | 명시적 기준과 비교 | 대기 | 대기 | 미측정 | 의도적으로 미해결 |
| Gateway 종료 후 재시도 | 중복 호출·최종 상태 확인 | 대기 | 대기 | 미측정 | 의도적으로 미해결 |

## 9. 발표용 정리 형식

최종 발표에서는 다음 순서로만 정리한다.

1. **문제:** 단일 프로세스 메모리 상태가 Gateway 다중화에서 공유되지 않는다.
2. **기준선:** 운영 동등 설정의 Gateway 1대 성능과 정확성 결과.
3. **확장:** 동일 조건에서 Gateway만 2대로 늘린 결과.
4. **관측된 한계:** 실제로 재현된 중복 호출, Rate Limit 불일치, 재연결 실패만 제시.
5. **영향:** 추가 Provider 비용, 중복 메시지, 사용자 응답, 처리량에 미친 정량 영향.
6. **후속 개선 후보:** shared request ownership, Redis/DB atomic claim, shared replay buffer, provider idempotency 연계. 이 문서의 실험 단계에서는 구현하지 않는다.

깨끗한 성공 결과만 남기지 않는다. 실패한 실행도 환경 SHA, 명령, 로그, DB 조회 결과와 함께 원본 evidence bundle로 보존한다.
