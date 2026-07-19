# Gateway 1대 → 2대 확장 실험 결과

이 문서는 `gateway-scaleout-technical-challenge-plan.md`에 정의한 실험의 실행 기록이다. 성공한 결과만 남기지 않고, 측정 전 하네스 실패와 분산 전환 후 관측되는 정확성 문제도 원인과 원본 증거 식별자를 함께 보존한다.

## 공통 조건

- 애플리케이션 SHA: `3be2a8d7e0da63219a8a05d07b9b10797ee42a4e`
- 성능 제어·하네스 SHA: `828fd73163fddaaaee8cae3ae91ce9d7a095e473`
- Gateway 인증 캐시: 활성화, TTL 5초, 최대 4096개
- Provider: 격리된 Mock 전용 Application, 실제 Provider route 0개
- Mock 지연 프로파일: `control_100ms`
- 부하 경로: 전용 Load Generator → HTTPS Edge/Caddy → Gateway → Data/Redis/AI/Mock
- 요청: 매 실행마다 고유한 Request ID를 사용하는 cache-miss 비스트리밍 요청
- VU 계산: 사전 할당 `목표 RPS × 2`, 최대 `목표 RPS × 4`
- 각 예비 탐색 구간 지속시간: 30초

이 결과는 실제 외부 Provider가 포함된 E2E 용량이 아니다. 100ms Mock으로 Provider 대기시간을 통제한 상태에서 Gateway 수만 바꾸는 상대 비교다.

## 운영 동형 환경 구성 결과

운영 애플리케이션 SHA `3be2a8d7…`의 서비스 구성과 설정을 격리된 성능 VPC에 옮기고, 부하 발생기만 측정 대상 호스트에서 분리했다. 운영 DB 원본과 운영 트래픽·DNS는 변경하지 않았다.

| 역할 | Private IP | 인스턴스 | 실행 서비스 |
|---|---:|---|---|
| Load Generator | `10.77.1.10` | `c7i.large` | k6와 증거 수집기만 실행 |
| Edge | `10.77.1.50` | `c7i.large` | Web, Chat Web, Caddy |
| Gateway 1 | `10.77.1.20` | `c7i.xlarge` | Gateway Core |
| Gateway 2 | `10.77.1.21` | `c7i.xlarge` | Gateway Core, 2대 비교 시에만 upstream 포함 |
| Data | `10.77.1.30` | `m7i.large` | PostgreSQL, Redis, Control Plane, Chat API, RAG Worker |
| AI | `10.77.1.40` | `c7i.large` | AI Service, 100ms Mock Provider |

최종 2대 상태에서 두 Gateway는 같은 image ID `sha256:455936e3…d64d`, Gateway binary SHA-256 `6c18b1e0…5dc4`, E5 bundle SHA-256 `b0ca5bcd…4081`, RootFS SHA-256 `55fa7d07…4411`을 사용했다. 공개 포트는 각각 자신의 Private IP에만 `8080/8081`로 bind됐고 두 컨테이너 모두 healthy였다.

운영과의 비동등 조건도 남아 있다. 성능 VPC는 운영처럼 Public/Private subnet을 나누지 않고 하나의 subnet에서 Security Group으로 경로를 제한한다. 실제 Provider·SMTP는 차단했고 합성 Mock Application만 사용했다. 따라서 이 결과는 **운영 애플리케이션 경로를 맞춘 Gateway 1대/2대 상대 비교**이지, 실제 Provider 포함 운영 E2E 용량이나 고가용성 보장은 아니다.

## Gateway 1대 기준선

### 10 RPS / 30초

판정: **통과**

| 항목 | 결과 |
|---|---:|
| 목표 / 실제 완료 RPS | 10 / 10 |
| 완료 요청 | 300 |
| Dropped iterations | 0 |
| HTTP 오류율 | 0% |
| 실패한 k6 check | 0 / 1,500 |
| HTTP p95 | 116.129ms |
| HTTP p99 | 179.328ms |
| HTTP max | 204.936ms |
| Gateway 1 / Gateway 2 / 알 수 없음 응답 | 300 / 0 / 0 |
| 고유 Request Log | 300 / 300 |
| 성공·HTTP 200·logging written 로그 | 300 / 300 / 300 |
| DB 기록 latency p95 | 113.000ms |
| Mock Provider 호출 | 301회 |
| 비동기 로그 queue/drop/persist 오류 | 모두 0 |

Mock 호출 301회는 k6 사전 점검 1회와 실제 부하 300회의 합이다. 따라서 이 실행의 서로 다른 300개 Request ID에 대해서는 추가 호출이 관측되지 않았다. 이 값만으로 같은 멱등성 키의 동시 요청이나 Gateway 간 exactly-once를 증명하지는 않는다.

5초 간격 8개 `docker stats` 표본의 주요 자원 값은 다음과 같다. 평균에는 부하 직전·직후의 유휴 표본이 포함된다. Docker CPU 100%는 대략 논리 CPU 한 개 사용량이므로 인스턴스 전체 CPU 백분율로 읽으면 안 된다.

| 역할 / 컨테이너 | CPU 평균 | CPU 최대 | 메모리 최대 |
|---|---:|---:|---:|
| Gateway 1 / gateway-core | 57.44% | 90.71% | 997.6MiB |
| Data / PostgreSQL | 47.05% | 88.85% | 79.8MiB |
| Data / Redis | 0.86% | 2.42% | 5.4MiB |
| Edge / Caddy | 0.52% | 1.46% | 15.3MiB |
| AI / Mock latency shaper | 2.25% | 13.79% | 17.7MiB |
| AI / Mock upstream | 1.61% | 9.91% | 16.2MiB |
| AI / AI Service | 3.56% | 23.15% | 54.7MiB |

원본 증거:

- run ID: `run_20260719T103813Z_484259_665`
- Load Generator bundle: `/home/ubuntu/GateLM-prod-clone-control-bbd82e6b9/reports/perf/loadgen/20260719T103813Z-run_20260719T103813Z_484259_665`
- k6 SSM command: `286c8a74-8efa-4872-80bb-d038f9a3983f`
- 자원 표본 SSM command: `69f0d74b-2089-42f4-84c5-7da5fffc8bb3`
- DB 대조 SSM command: `1846c2dc-3b7e-4ddd-838f-693a413111e9`
- Mock 호출 대조 SSM command: `8630da20-8fcb-48c1-94cb-936c4e4f1e9f`

### 20 RPS / 30초

판정: **통과**

| 항목 | 결과 |
|---|---:|
| 목표 / 실제 완료 RPS | 20 / 약 20.03 |
| 완료 요청 | 601 |
| Dropped iterations | 0 |
| HTTP 오류율 | 0% |
| 실패한 k6 check | 0 / 3,005 |
| HTTP p95 | 114.839ms |
| HTTP p99 | 140.104ms |
| HTTP max | 204.082ms |
| Gateway 1 / Gateway 2 / 알 수 없음 응답 | 601 / 0 / 0 |
| 고유 Request Log | 601 / 601 |
| 성공·HTTP 200·logging written 로그 | 601 / 601 / 601 |
| DB 기록 latency p95 | 112.000ms |
| Mock Provider 호출 | 602회 |
| 비동기 로그 queue/drop/persist 오류 | 모두 0 |

Mock 호출 수는 사전 점검 1회와 부하 601회의 합과 일치한다. 10 RPS보다 p95·p99가 낮아진 값은 짧은 30초 탐색 실행의 분산과 워밍업 영향을 포함하므로, RPS 증가가 지연을 개선했다는 뜻으로 해석하지 않는다.

| 역할 / 컨테이너 | CPU 평균 | CPU 최대 | 메모리 최대 |
|---|---:|---:|---:|
| Gateway 1 / gateway-core | 112.09% | 180.66% | 1,006.0MiB |
| Data / PostgreSQL | 57.05% | 108.36% | 80.3MiB |
| Data / Redis | 1.05% | 2.04% | 5.6MiB |
| Edge / Caddy | 2.28% | 6.66% | 18.1MiB |
| AI / Mock latency shaper | 1.50% | 3.37% | 18.1MiB |
| AI / Mock upstream | 1.82% | 10.57% | 16.4MiB |
| AI / AI Service | 0.17% | 0.18% | 47.2MiB |

원본 증거:

- run ID: `run_20260719T104353Z_487164_27155`
- Load Generator bundle: `/home/ubuntu/GateLM-prod-clone-control-bbd82e6b9/reports/perf/loadgen/20260719T104353Z-run_20260719T104353Z_487164_27155`
- k6 SSM command: `0538452e-c8af-430e-b3bd-b9e692d17bee`
- 자원 표본 SSM command: `b5ee5e10-8cd3-48c1-941e-212eac43885a`
- DB 대조 SSM command: `eeb19099-29cd-491c-822d-94fb530a9d13`
- Mock 호출 대조 SSM command: `a8437ad4-5758-471b-8679-cb146d8b76e5`

### 30 RPS / 30초

판정: **통과**

| 항목 | 결과 |
|---|---:|
| 목표 / 실제 완료 RPS | 30 / 약 30.03 |
| 완료 요청 | 901 |
| Dropped iterations | 0 |
| HTTP 오류율 | 0% |
| 실패한 k6 check | 0 / 4,505 |
| HTTP p95 | 113.980ms |
| HTTP p99 | 144.863ms |
| HTTP max | 194.511ms |
| Gateway 1 / Gateway 2 / 알 수 없음 응답 | 901 / 0 / 0 |
| 고유 Request Log | 901 / 901 |
| 성공·HTTP 200·logging written 로그 | 901 / 901 / 901 |
| DB 기록 latency p95 | 111.000ms |
| Mock Provider 호출 | 902회 |
| 비동기 로그 queue/drop/persist 오류 | 모두 0 |

| 역할 / 컨테이너 | CPU 평균 | CPU 최대 | 메모리 최대 |
|---|---:|---:|---:|
| Gateway 1 / gateway-core | 165.98% | 271.63% | 1,018.0MiB |
| Data / PostgreSQL | 86.67% | 107.02% | 90.2MiB |
| Data / Redis | 0.95% | 1.29% | 6.2MiB |
| Edge / Caddy | 1.45% | 4.25% | 19.6MiB |
| AI / Mock latency shaper | 1.90% | 6.56% | 26.9MiB |
| AI / Mock upstream | 2.20% | 12.44% | 16.7MiB |
| AI / AI Service | 0.17% | 0.18% | 47.0MiB |

원본 증거:

- run ID: `run_20260719T104624Z_488645_14900`
- Load Generator bundle: `/home/ubuntu/GateLM-prod-clone-control-bbd82e6b9/reports/perf/loadgen/20260719T104624Z-run_20260719T104624Z_488645_14900`
- k6 SSM command: `3ab90bf0-6105-4796-a402-d2abe38880d9`
- 자원 표본 SSM command: `7da30aaf-c117-43d6-82b3-2519bc5a3b17`
- DB 대조 SSM command: `ab22308a-7a04-47d7-a142-a797ac15deac`
- Mock 호출 대조 SSM command: `0780794f-c1ed-47ee-b3fe-530fd57cc2fa`

### 40 RPS / 30초

판정: **통과**

| 항목 | 결과 |
|---|---:|
| 목표 / 실제 완료 RPS | 40 / 약 40.03 |
| 완료 요청 | 1,201 |
| Dropped iterations | 0 |
| HTTP 오류율 | 0% |
| 실패한 k6 check | 0 / 6,005 |
| HTTP p95 | 113.382ms |
| HTTP p99 | 136.086ms |
| HTTP max | 195.833ms |
| Gateway 1 / Gateway 2 / 알 수 없음 응답 | 1,201 / 0 / 0 |
| 고유 Request Log | 1,201 / 1,201 |
| 성공·HTTP 200·logging written 로그 | 1,201 / 1,201 / 1,201 |
| DB 기록 latency p95 | 110.000ms |
| Mock Provider 호출 | 1,202회 |
| 비동기 로그 queue/drop/persist 오류 | 모두 0 |

| 역할 / 컨테이너 | CPU 평균 | CPU 최대 | 메모리 최대 |
|---|---:|---:|---:|
| Gateway 1 / gateway-core | 202.45% | 327.71% | 1,018.0MiB |
| Data / PostgreSQL | 101.81% | 109.24% | 97.6MiB |
| Data / Redis | 1.23% | 3.18% | 6.6MiB |
| Edge / Caddy | 2.32% | 4.95% | 21.9MiB |
| AI / Mock latency shaper | 2.12% | 7.20% | 20.7MiB |
| AI / Mock upstream | 3.30% | 11.02% | 16.7MiB |
| AI / AI Service | 3.64% | 22.55% | 47.3MiB |

원본 증거:

- run ID: `run_20260719T104836Z_489956_25384`
- Load Generator bundle: `/home/ubuntu/GateLM-prod-clone-control-bbd82e6b9/reports/perf/loadgen/20260719T104836Z-run_20260719T104836Z_489956_25384`
- k6 SSM command: `0b296708-2021-43fc-b3fa-80f412ca2ee7`
- 자원 표본 SSM command: `ecd571b3-4698-4358-bb2d-798fc0562707`
- DB 대조 SSM command: `05ce15b9-2493-47d2-bfb0-0041f30bf8ed`
- Mock 호출 대조 SSM command: `be37aac6-be2c-40eb-a1ac-f733a75c665e`

### 50 RPS / 30초

판정: **통과**

| 항목 | 결과 |
|---|---:|
| 목표 / 실제 완료 RPS | 50 / 약 50.03 |
| 완료 요청 | 1,501 |
| Dropped iterations | 0 |
| HTTP 오류율 | 0% |
| 실패한 k6 check | 0 / 7,505 |
| HTTP p95 | 113.205ms |
| HTTP p99 | 156.462ms |
| HTTP max | 210.993ms |
| Gateway 1 / Gateway 2 / 알 수 없음 응답 | 1,501 / 0 / 0 |
| 고유 Request Log | 1,501 / 1,501 |
| 성공·HTTP 200·logging written 로그 | 1,501 / 1,501 / 1,501 |
| DB 기록 latency p95 | 110.000ms |
| Mock Provider 호출 | 1,502회 |
| 비동기 로그 queue/drop/persist 오류 | 모두 0 |

| 역할 / 컨테이너 | CPU 평균 | CPU 최대 | 메모리 최대 |
|---|---:|---:|---:|
| Gateway 1 / gateway-core | 210.42% | 341.79% | 996.8MiB |
| Data / PostgreSQL | 107.92% | 126.85% | 119.4MiB |
| Data / Redis | 1.39% | 2.52% | 7.5MiB |
| Edge / Caddy | 2.45% | 7.33% | 23.2MiB |
| AI / Mock latency shaper | 2.94% | 12.86% | 21.0MiB |
| AI / Mock upstream | 1.82% | 7.92% | 30.8MiB |
| AI / AI Service | 0.17% | 0.18% | 47.2MiB |

Gateway 최대 CPU는 4 vCPU 상한에 가까워졌지만 요청 실패나 지연 급증은 관측되지 않았다. 따라서 50 RPS를 단일 Gateway의 한계라고 단정하지 않고, 60 RPS 이상에서 최초 한계 신호를 추가 탐색한다.

원본 증거:

- run ID: `run_20260719T105128Z_491592_5813`
- Load Generator bundle: `/home/ubuntu/GateLM-prod-clone-control-bbd82e6b9/reports/perf/loadgen/20260719T105128Z-run_20260719T105128Z_491592_5813`
- k6 SSM command: `b9bc4fd5-5766-47cd-8061-85c010348319`
- 자원 표본 SSM command: `0070250f-4b20-438f-bb1c-62f2176eeb14`
- DB 대조 SSM command: `ed673eb3-3a54-4aae-b896-131c30c6cf55`
- Mock 호출 대조 SSM command: `cda09654-7ae4-4d83-ba46-b5ecaa474cb3`

### 60 RPS / 30초

판정: **통과**

| 항목 | 결과 |
|---|---:|
| 목표 / 실제 완료 RPS | 60 / 60 |
| 완료 요청 | 1,800 |
| Dropped iterations | 0 |
| HTTP 오류율 | 0% |
| 실패한 k6 check | 0 / 9,000 |
| HTTP p95 | 114.167ms |
| HTTP p99 | 158.864ms |
| HTTP max | 216.760ms |
| Gateway 1 / Gateway 2 / 알 수 없음 응답 | 1,800 / 0 / 0 |
| 고유 Request Log | 1,800 / 1,800 |
| 성공·HTTP 200·logging written 로그 | 1,800 / 1,800 / 1,800 |
| DB 기록 latency p95 | 111.000ms |
| Mock Provider 호출 | 1,801회 |
| 비동기 로그 queue/drop/persist 오류 | 모두 0 |

| 역할 / 컨테이너 | CPU 평균 | CPU 최대 | 메모리 최대 |
|---|---:|---:|---:|
| Gateway 1 / gateway-core | 215.22% | 349.77% | 1,002.0MiB |
| Data / PostgreSQL | 103.36% | 106.96% | 158.5MiB |
| Data / Redis | 1.38% | 2.95% | 8.1MiB |
| Edge / Caddy | 3.13% | 9.21% | 25.6MiB |
| AI / Mock latency shaper | 1.61% | 3.12% | 21.0MiB |
| AI / Mock upstream | 0.88% | 3.01% | 17.1MiB |
| AI / AI Service | 5.22% | 26.25% | 47.2MiB |

원본 증거:

- run ID: `run_20260719T105432Z_493348_31551`
- Load Generator bundle: `/home/ubuntu/GateLM-prod-clone-control-bbd82e6b9/reports/perf/loadgen/20260719T105432Z-run_20260719T105432Z_493348_31551`
- k6 SSM command: `20059550-dcaa-4aff-a581-8a5efa1815eb`
- 자원 표본 SSM command: `d7fe59d0-ebd1-4aec-8936-5a235f7e4e01`
- DB 대조 SSM command: `4f5eefca-cf13-4685-8968-3905aa97efaf`
- Mock 호출 대조 SSM command: `efd7bac2-7209-442a-a114-e9cd3885bf15`

### 70 RPS / 30초

판정: **통과**

| 항목 | 결과 |
|---|---:|
| 목표 / 실제 완료 RPS | 70 / 70 |
| 완료 요청 | 2,100 |
| Dropped iterations | 0 |
| HTTP 오류율 | 0% |
| 실패한 k6 check | 0 / 10,500 |
| HTTP p95 | 114.457ms |
| HTTP p99 | 158.204ms |
| HTTP max | 218.815ms |
| Gateway 1 / Gateway 2 / 알 수 없음 응답 | 2,100 / 0 / 0 |
| 고유 Request Log | 2,100 / 2,100 |
| 성공·HTTP 200·logging written 로그 | 2,100 / 2,100 / 2,100 |
| DB 기록 latency p95 | 111.000ms |
| Mock Provider 호출 | 2,101회 |
| 비동기 로그 queue/drop/persist 오류 | 모두 0 |

| 역할 / 컨테이너 | CPU 평균 | CPU 최대 | 메모리 최대 |
|---|---:|---:|---:|
| Gateway 1 / gateway-core | 217.87% | 352.61% | 999.9MiB |
| Data / PostgreSQL | 103.38% | 110.79% | 223.6MiB |
| Data / Redis | 1.42% | 3.70% | 9.1MiB |
| Edge / Caddy | 3.27% | 4.88% | 27.4MiB |
| AI / Mock latency shaper | 2.99% | 13.65% | 21.3MiB |
| AI / Mock upstream | 1.93% | 9.70% | 17.2MiB |
| AI / AI Service | 2.97% | 22.55% | 47.2MiB |

원본 증거:

- run ID: `run_20260719T105714Z_494897_20847`
- Load Generator bundle: `/home/ubuntu/GateLM-prod-clone-control-bbd82e6b9/reports/perf/loadgen/20260719T105714Z-run_20260719T105714Z_494897_20847`
- k6 SSM command: `ae8104c7-1bb1-4d28-bf88-6dea0ab21a3e`
- 자원 표본 SSM command: `2cd9a826-fdd2-4e80-a4ad-41d4ec567813`
- DB 대조 SSM command: `8e11df49-abb1-4615-b651-b61f867d5201`
- Mock 호출 대조 SSM command: `312532d0-a928-4392-a148-c111d58a40e9`

### 100 RPS / 30초 경계 탐색

판정: **예비 탐색 통과**

| 항목 | 결과 |
|---|---:|
| 목표 / 실제 완료 RPS | 100 / 100 |
| 완료 요청 | 3,000 |
| Dropped iterations | 0 |
| HTTP 오류율 | 0% |
| 실패한 k6 check | 0 / 15,000 |
| HTTP p95 | 116.010ms |
| HTTP p99 | 154.873ms |
| HTTP max | 229.369ms |
| Gateway 1 / Gateway 2 / 알 수 없음 응답 | 3,000 / 0 / 0 |
| 고유 Request Log | 3,000 / 3,000 |
| 성공·HTTP 200·logging written 로그 | 3,000 / 3,000 / 3,000 |
| DB 기록 latency p95 | 113.000ms |
| Mock Provider 호출 | 3,001회 |
| 비동기 로그 queue/drop/persist 오류 | 모두 0 |

| 역할 / 컨테이너 | CPU 평균 | CPU 최대 | 메모리 최대 |
|---|---:|---:|---:|
| Gateway 1 / gateway-core | 228.78% | 370.95% | 1,014.0MiB |
| Data / PostgreSQL | 95.00% | 110.10% | 202.8MiB |
| Data / Redis | 1.63% | 2.35% | 10.4MiB |
| Edge / Caddy | 5.03% | 13.26% | 32.6MiB |
| AI / Mock latency shaper | 4.18% | 10.04% | 25.1MiB |
| AI / Mock upstream | 1.26% | 2.14% | 17.2MiB |
| AI / AI Service | 0.17% | 0.18% | 47.2MiB |

Gateway 최대 CPU는 4 vCPU 상한의 약 92.7%에 해당한다. 다만 30초 실행이므로 100 RPS를 지속 가능 용량이나 운영 SLO로 주장하지 않는다.

원본 증거:

- run ID: `run_20260719T110008Z_496526_1130`
- Load Generator bundle: `/home/ubuntu/GateLM-prod-clone-control-bbd82e6b9/reports/perf/loadgen/20260719T110008Z-run_20260719T110008Z_496526_1130`
- k6 SSM command: `3b089664-3d69-4891-8fa6-dc64a614cf79`
- 자원 표본 SSM command: `e669cadb-761b-44cd-83bd-64bac9e90eac`
- DB 대조 SSM command: `68a53bdb-47b1-4551-9a34-f032e6ee4e76`
- Mock 호출 대조 SSM command: `35f46af3-f6f7-44e2-8f67-e8ebf29b65ea`

### 150 RPS / 30초 경계 탐색

판정: **요청은 통과, Gateway CPU 포화·지연 상승 관측**

| 항목 | 결과 |
|---|---:|
| 목표 / 실제 완료 RPS | 150 / 약 150.03 |
| 완료 요청 | 4,501 |
| Dropped iterations | 0 |
| HTTP 오류율 | 0% |
| 실패한 k6 check | 0 / 22,505 |
| HTTP p95 | 137.834ms |
| HTTP p99 | 162.600ms |
| HTTP max | 234.575ms |
| Gateway 1 / Gateway 2 / 알 수 없음 응답 | 4,501 / 0 / 0 |
| 고유 Request Log | 4,501 / 4,501 |
| 성공·HTTP 200·logging written 로그 | 4,501 / 4,501 / 4,501 |
| DB 기록 latency p95 | 135.000ms |
| Mock Provider 호출 | 4,502회 |
| 비동기 로그 queue/drop/persist 오류 | 모두 0 |

| 역할 / 컨테이너 | CPU 평균 | CPU 최대 | 메모리 최대 |
|---|---:|---:|---:|
| Gateway 1 / gateway-core | 247.43% | 399.35% | 1,007.0MiB |
| Data / PostgreSQL | 107.19% | 118.00% | 242.4MiB |
| Data / Redis | 2.54% | 7.17% | 12.3MiB |
| Edge / Caddy | 5.11% | 10.30% | 41.5MiB |
| AI / Mock latency shaper | 3.44% | 6.98% | 26.4MiB |
| AI / Mock upstream | 2.30% | 9.61% | 17.3MiB |
| AI / AI Service | 3.70% | 22.50% | 47.3MiB |

Gateway 최대 CPU 399.35%는 4 vCPU를 사실상 모두 사용한 표본이다. 요청 오류는 없었지만 p95는 100 RPS의 116.010ms보다 약 18.8% 증가했다. 따라서 150 RPS는 단일 Gateway의 실패점이 아니라 **CPU 포화와 지연 상승이 시작된 2대 비교 기준점**으로 사용한다.

원본 증거:

- run ID: `run_20260719T110316Z_498302_30663`
- Load Generator bundle: `/home/ubuntu/GateLM-prod-clone-control-bbd82e6b9/reports/perf/loadgen/20260719T110316Z-run_20260719T110316Z_498302_30663`
- k6 SSM command: `f94a3a7f-cabf-4b49-8e9f-ddd90c83b5ad`
- 자원 표본 SSM command: `d1628159-bf49-4294-9ce6-f5b36ba7f2fa`
- DB 대조 SSM command: `023d093b-5fa6-48e5-b036-ced75481703c`
- Mock 호출 대조 SSM command: `3a492787-e699-4ca0-9e4b-c5dbf1863e37`

### 1대 예비 탐색 요약

| 목표 RPS | 완료 요청 | 오류 / dropped | p95 | p99 | Gateway CPU 최대 | 판정 |
|---:|---:|---:|---:|---:|---:|---|
| 10 | 300 | 0 / 0 | 116.129ms | 179.328ms | 90.71% | 통과 |
| 20 | 601 | 0 / 0 | 114.839ms | 140.104ms | 180.66% | 통과 |
| 30 | 901 | 0 / 0 | 113.980ms | 144.863ms | 271.63% | 통과 |
| 40 | 1,201 | 0 / 0 | 113.382ms | 136.086ms | 327.71% | 통과 |
| 50 | 1,501 | 0 / 0 | 113.205ms | 156.462ms | 341.79% | 통과 |
| 60 | 1,800 | 0 / 0 | 114.167ms | 158.864ms | 349.77% | 통과 |
| 70 | 2,100 | 0 / 0 | 114.457ms | 158.204ms | 352.61% | 통과 |
| 100 | 3,000 | 0 / 0 | 116.010ms | 154.873ms | 370.95% | 예비 탐색 통과 |
| 150 | 4,501 | 0 / 0 | 137.834ms | 162.600ms | 399.35% | CPU 포화·지연 상승 |

## Gateway 2대 비교군

1대 전체 탐색에서 150 RPS까지 요청 실패는 없었으므로, 2대 비교는 저부하 `10`, 중간 `50`, 단일 Gateway 포화 직전 `100`, 포화 표본 `150 RPS`를 같은 30초 조건으로 반복했다. 이 비교는 2대의 최대 처리량을 찾는 실험이 아니라, 같은 부하에서 분배·지연·CPU headroom이 달라지는지 확인하는 실험이다.

### 10 RPS / 30초

판정: **통과, 두 Gateway 균등 분배 확인**

| 항목 | 결과 |
|---|---:|
| 목표 / 실제 완료 RPS | 10 / 약 10.03 |
| 완료 요청 | 301 |
| Dropped iterations | 0 |
| HTTP 오류율 | 0% |
| 실패한 k6 check | 0 / 1,505 |
| HTTP p95 / p99 / max | 117.639 / 186.331 / 209.299ms |
| Gateway 1 / Gateway 2 / 알 수 없음 응답 | 150 / 151 / 0 |
| 고유·성공·HTTP 200·logging written 로그 | 301 / 301 / 301 / 301 |
| DB 기록 latency p95 | 113.000ms |
| Mock Provider 호출 | 302회 |
| 비동기 로그 queue/drop/persist 오류 | 모두 0 |

| 역할 / 컨테이너 | CPU 평균 | CPU 최대 | 메모리 최대 |
|---|---:|---:|---:|
| Gateway 1 / gateway-core | 28.25% | 51.41% | 1,017.0MiB |
| Gateway 2 / gateway-core | 28.45% | 50.93% | 993.3MiB |
| Data / PostgreSQL | 92.23% | 106.16% | 229.4MiB |
| Data / Redis | 0.95% | 2.75% | 5.6MiB |
| Edge / Caddy | 1.11% | 6.19% | 15.0MiB |
| AI / Mock latency shaper | 1.70% | 9.65% | 26.4MiB |
| AI / Mock upstream | 2.71% | 10.28% | 17.4MiB |
| AI / AI Service | 0.17% | 0.18% | 47.1MiB |

Mock 호출 302회는 사전 점검 1회와 실제 부하 301회의 합이다.

원본 증거:

- run ID: `run_20260719T112754Z_511177_21552`
- Load Generator bundle: `/home/ubuntu/GateLM-prod-clone-control-bbd82e6b9/reports/perf/loadgen/20260719T112754Z-run_20260719T112754Z_511177_21552`
- k6 SSM command: `94a2da02-869a-43f5-8d04-fc25073a71d1`
- 자원 표본 SSM command: `f49fdc11-d221-4c6c-a423-eebd4c5b1b8b`
- DB 대조 SSM command: `ecba99d1-b63d-4c42-912a-590d0a12f5d2`
- Mock 호출 대조 SSM command: `047df899-f396-4b38-be12-62be50d2d53a`

### 50 RPS / 30초

판정: **통과, 두 Gateway 균등 분배 확인**

| 항목 | 결과 |
|---|---:|
| 목표 / 실제 완료 RPS | 50 / 약 50.03 |
| 완료 요청 | 1,501 |
| Dropped iterations | 0 |
| HTTP 오류율 | 0% |
| 실패한 k6 check | 0 / 7,505 |
| HTTP p95 / p99 / max | 114.182 / 144.026 / 207.314ms |
| Gateway 1 / Gateway 2 / 알 수 없음 응답 | 750 / 751 / 0 |
| 고유·성공·HTTP 200·logging written 로그 | 1,501 / 1,501 / 1,501 / 1,501 |
| DB 기록 latency p95 | 111.000ms |
| Mock Provider 호출 | 1,502회 |
| 비동기 로그 queue/drop/persist 오류 | 모두 0 |

| 역할 / 컨테이너 | CPU 평균 | CPU 최대 | 메모리 최대 |
|---|---:|---:|---:|
| Gateway 1 / gateway-core | 137.63% | 224.44% | 1,032.2MiB |
| Gateway 2 / gateway-core | 136.14% | 221.05% | 1,010.0MiB |
| Data / PostgreSQL | 94.68% | 108.11% | 229.5MiB |
| Data / Redis | 1.40% | 3.62% | 6.3MiB |
| Edge / Caddy | 3.00% | 6.25% | 23.8MiB |
| AI / Mock latency shaper | 2.49% | 12.35% | 26.5MiB |
| AI / Mock upstream | 0.63% | 1.08% | 17.4MiB |
| AI / AI Service | 1.81% | 13.28% | 56.9MiB |

원본 증거:

- run ID: `run_20260719T113221Z_513663_21209`
- Load Generator bundle: `/home/ubuntu/GateLM-prod-clone-control-bbd82e6b9/reports/perf/loadgen/20260719T113221Z-run_20260719T113221Z_513663_21209`
- k6 SSM command: `f13f62e2-4747-470f-a8fb-ff758b7b3bdb`
- 자원 표본 SSM command: `91cf0154-da0a-4cee-8b31-be999eee9132`
- DB 대조 SSM command: `512bd0da-8197-4a1b-90a3-809d956d914f`
- Mock 호출 대조 SSM command: `64100db7-00d8-44de-a71f-070de637b3a9`

### 100 RPS / 30초

판정: **통과, 두 Gateway 균등 분배 확인**

| 항목 | 결과 |
|---|---:|
| 목표 / 실제 완료 RPS | 100 / 100 |
| 완료 요청 | 3,000 |
| Dropped iterations | 0 |
| HTTP 오류율 | 0% |
| 실패한 k6 check | 0 / 15,000 |
| HTTP p95 / p99 / max | 113.184 / 155.704 / 225.690ms |
| Gateway 1 / Gateway 2 / 알 수 없음 응답 | 1,500 / 1,500 / 0 |
| 고유·성공·HTTP 200·logging written 로그 | 3,000 / 3,000 / 3,000 / 3,000 |
| DB 기록 latency p95 | 110.000ms |
| Mock Provider 호출 | 3,001회 |
| 비동기 로그 queue/drop/persist 오류 | 모두 0 |

| 역할 / 컨테이너 | CPU 평균 | CPU 최대 | 메모리 최대 |
|---|---:|---:|---:|
| Gateway 1 / gateway-core | 210.02% | 338.47% | 1,028.1MiB |
| Gateway 2 / gateway-core | 207.47% | 336.86% | 990.2MiB |
| Data / PostgreSQL | 106.97% | 112.01% | 248.3MiB |
| Data / Redis | 1.90% | 4.16% | 8.1MiB |
| Edge / Caddy | 4.86% | 12.19% | 32.6MiB |
| AI / Mock latency shaper | 2.28% | 4.61% | 27.6MiB |
| AI / Mock upstream | 1.20% | 1.98% | 17.4MiB |
| AI / AI Service | 3.08% | 23.54% | 47.1MiB |

원본 증거:

- run ID: `run_20260719T113452Z_515147_10487`
- Load Generator bundle: `/home/ubuntu/GateLM-prod-clone-control-bbd82e6b9/reports/perf/loadgen/20260719T113452Z-run_20260719T113452Z_515147_10487`
- k6 SSM command: `b46c9001-a9a5-4dca-92c6-44b714503e6f`
- 자원 표본 SSM command: `fbbb78d3-481a-4fa4-9022-28dffd406505`
- DB 대조 SSM command: `e60e63c0-6991-4978-9771-a72c0d5c97a5`
- Mock 호출 대조 SSM command: `d0b51df4-434e-4dc9-938c-e5a5d241629a`

### 150 RPS / 30초

판정: **통과, 단일 Gateway 포화 구간에서 p95 개선**

| 항목 | 결과 |
|---|---:|
| 목표 / 실제 완료 RPS | 150 / 약 150.03 |
| 완료 요청 | 4,501 |
| Dropped iterations | 0 |
| HTTP 오류율 | 0% |
| 실패한 k6 check | 0 / 22,505 |
| HTTP p95 / p99 / max | 115.404 / 156.145 / 235.645ms |
| Gateway 1 / Gateway 2 / 알 수 없음 응답 | 2,251 / 2,250 / 0 |
| 고유·성공·HTTP 200·logging written 로그 | 4,501 / 4,501 / 4,501 / 4,501 |
| DB 기록 latency p95 | 112.000ms |
| Mock Provider 호출 | 4,502회 |
| 비동기 로그 queue/drop/persist 오류 | 모두 0 |

| 역할 / 컨테이너 | CPU 평균 | CPU 최대 | 메모리 최대 |
|---|---:|---:|---:|
| Gateway 1 / gateway-core | 220.65% | 357.02% | 1,011.0MiB |
| Gateway 2 / gateway-core | 220.01% | 355.88% | 995.2MiB |
| Data / PostgreSQL | 107.95% | 116.23% | 274.6MiB |
| Data / Redis | 2.77% | 6.50% | 10.9MiB |
| Edge / Caddy | 4.80% | 8.85% | 42.2MiB |
| AI / Mock latency shaper | 4.24% | 9.53% | 28.0MiB |
| AI / Mock upstream | 2.95% | 12.01% | 18.7MiB |
| AI / AI Service | 0.17% | 0.19% | 47.2MiB |

단일 Gateway의 최대 CPU는 399.35%였지만 2대에서는 각각 357.02%, 355.88%였다. 같은 150 RPS에서 p95는 137.834ms에서 115.404ms로 22.430ms, 약 16.3% 낮아졌다. 그러나 목표 부하 자체를 150 RPS보다 높이지 않았으므로 최대 처리량이 2배가 됐다고 주장할 수는 없다.

원본 증거:

- run ID: `run_20260719T113726Z_516643_28462`
- Load Generator bundle: `/home/ubuntu/GateLM-prod-clone-control-bbd82e6b9/reports/perf/loadgen/20260719T113726Z-run_20260719T113726Z_516643_28462`
- k6 SSM command: `998e5162-2778-4c23-a445-1211f99d9a56`
- 자원 표본 SSM command: `1accc980-8d56-4f2a-a937-51552c36d190`
- DB 대조 SSM command: `3e06e1a1-887b-4657-ad63-d6a4eda6ec54`
- Mock 호출 대조 SSM command: `f109e003-7c91-4d70-9a83-7931711e3772`

### 1대와 2대 직접 비교

| 목표 RPS | 1대 p95 | 2대 p95 | p95 변화 | 1대 Gateway CPU 최대 | 2대 Gateway CPU 최대 | 2대 응답 분배 |
|---:|---:|---:|---:|---:|---:|---:|
| 10 | 116.129ms | 117.639ms | +1.30% | 90.71% | 51.41% / 50.93% | 150 / 151 |
| 50 | 113.205ms | 114.182ms | +0.86% | 341.79% | 224.44% / 221.05% | 750 / 751 |
| 100 | 116.010ms | 113.184ms | -2.44% | 370.95% | 338.47% / 336.86% | 1,500 / 1,500 |
| 150 | 137.834ms | 115.404ms | -16.27% | 399.35% | 357.02% / 355.88% | 2,251 / 2,250 |

10·50 RPS에서는 1ms 안팎의 p95 차이로 사실상 비슷했다. 단일 Gateway CPU가 포화된 150 RPS에서는 2대로 분산했을 때 p95와 replica별 CPU headroom이 개선됐다. 네 비교 모두 오류·dropped iteration은 0이었다. 다만 모든 실행이 30초이므로 지속 가능 용량, 운영 SLO, 장애 시 가용성을 증명하지 않는다.

## 측정 준비 중 실패 기록

다음 실패는 Gateway 처리량 결과가 아니다. 두 실행 모두 실제 부하 요청 전에 중단됐으며, 측정 하네스의 재현성을 높이기 위해 수정했다.

| 단계 | 증상 | 원인 | 조치 | SSM command |
|---|---|---|---|---|
| 10 RPS 1차 시도 | Git SHA 수집 전 중단 | SSM은 root, 체크아웃은 ubuntu 소유여서 Git `dubious ownership` 발생 | 전역 설정 대신 정확한 체크아웃 경로에만 명령 단위 `safe.directory` 적용 | `e787f687-8d3e-49d1-a0ee-1d1062cc8ca4` |
| 10 RPS 2차 시도 | k6 스크립트 초기화 중 중단 | 고정 k6 런타임에 브라우저 전역 `URL` 객체가 없음 | 기존 URL 허용 검증은 유지하고 런타임 독립적인 hostname parser 사용 | `af47b087-ad40-4ece-9dbd-ec29e08e5286` |
| Gateway 2 최초 기동 | `10.77.1.20` bind 충돌로 시작 실패 | 공통 overlay를 읽은 뒤 replica별 bind 값을 다시 적용하지 않음 | host role 검증 뒤 Gateway 2 bind를 `.21`로 덮어쓰도록 하네스 수정 | 하네스 SHA `828fd731…` |
| Gateway 2 독립 build | Gateway 1과 RootFS가 달라 비교 중단 | 같은 소스라도 독립 build 결과가 bit-identical 이미지임을 보장하지 않음 | Gateway 1의 검증된 이미지를 암호화 전송하고 image ID까지 일치시킨 뒤 측정 | 최종 pair attestation `dfed51ba-3bac-4c7c-8201-9ec345d0e702` |
| Tenant Chat 1차 직접 probe | Data 호스트에서 Gateway `8081` timeout | 운영과 같은 SG는 Data → Gateway private listener를 허용하지 않으며 실제 Chat API 경로는 Data → Edge `8081` | 제품 SG를 열지 않고 probe를 실제 Edge 경로로 변경 | `55e7e2fe-be41-4cc5-bcc8-da99f4f43c2e` |
| 동일 replica 대조군 1차 | 재연결 전에 admission 재호출이 거절됨 | 한 request의 admission은 한 번만 소비해야 하는데 하네스가 두 번 호출 | 인증 없는 `/healthz` 404를 spacer로 사용해 Caddy round-robin만 전진 | `b610d5bd-7b45-4f67-8d33-8194680a8bc0` |
| Rate Limit 결과 수집 | 요청 전송 뒤 로컬 poll만 실패 | PowerShell 예약 변수 `$PID`와 수집 변수명이 충돌 | 이미 실행된 SSM command를 조회해 재요청 없이 결과 회수 | 실제 probe `6891301e-74d4-4df2-b47a-3c6de4f0efe4` |

이 실패들은 Gateway 처리 결과로 집계하지 않았다. 제품의 분산 동시성·Rate Limit·멱등성·SSE 동작을 고치지 않고, 유효한 비교를 막는 배포·측정 하네스만 수정했다.

## Gateway 2대 분산 정확성 관측

### 검증용 Tenant Chat fixture와 주장 경계

복제된 운영 Tenant Chat RuntimeSnapshot은 실제 Provider를 가리키므로 사용하지 않았다. 격리 성능 DB의 합성 tenant/user와 기존 Mock Provider만 가리키는 `perf_gateway_scaleout_mock_v1` snapshot을 만들고, private admission/completion 경로로 멱등성 동작을 관측했다. 실제 Provider credential은 호출하지 않았다.

이 fixture는 Gateway의 admission, usage reservation, ProviderAttempt, settlement, invocation log를 검증하지만 Chat API의 conversation/turn 생성 전체 흐름은 실행하지 않는다. 실제 조회에서도 세 probe 모두 `tenant_chat_turns=0`, user/assistant message가 각각 0행이었다. 따라서 이 실험으로 **Assistant 메시지 중복 저장이 없다**고 주장하지 않는다.

- fixture bootstrap: `d512ef0c-bae4-49db-b756-44173731ea14`
- snapshot reference: `138a9d00-6111-438b-9c95-abfd205692cf`
- turn/message 개수 대조: `8e942c7b-e83e-467e-ad89-d484521fe4ea`

### 관측 요약

| 시나리오 | 관측값 | 판정 | 해결 여부 |
|---|---|---|---|
| 다른 Gateway에 20ms 뒤 같은 멱등성 요청 | 첫 요청 200, 두 번째 503, Provider 1회 | 진행 중 stream 공유 부재 재현 | 의도적으로 미해결 |
| 같은 Gateway에 20ms 뒤 같은 멱등성 요청 | 첫 요청 200, 두 번째 503, Provider 1회 | session 등록 전 경쟁 구간 재현 | 의도적으로 미해결 |
| 같은 Gateway에 완료 후 같은 요청 | 첫 요청 200, 두 번째 replay 200, Provider 1회 | terminal replay 대조군 통과 | 변경 없음 |
| 두 Gateway 공유 Rate Limit 4에 동시 10개 | 전체 200 4개, 429 6개, Provider 4회 | 전역 일관성 통과, 문제 미재현 | 변경 없음 |
| 동일 요청 ProviderAttempt·비용·Request Log | Attempt 1, 확정 비용 1회, Log 1 | 정상 동시 요청에서 중복 미재현 | 변경 없음 |
| Assistant Message 중복 | turn/message 생성 경로 미실행 | 미측정 | 의도적으로 미해결 |
| Provider dispatch 중 Gateway 강제 종료 | 실행하지 않음 | 미측정 | 의도적으로 미해결 |

### 1. 다른 Gateway의 진행 중 SSE에 연결하지 못함

동일 멱등성 request `43f658c4-433c-40e5-95bc-8bba32f2ce46`으로 다음 순서를 실행했다.

1. admission은 Gateway 2(`10.77.1.21`)가 처리했다.
2. 첫 completion은 Gateway 1(`10.77.1.20`)로 들어가 HTTP 200, delta 1개, final 1개, `succeeded`로 끝났다.
3. 첫 요청 20ms 뒤 같은 completion을 Gateway 2로 보내자 HTTP 503 `CHAT_USAGE_GUARD_UNAVAILABLE`이 반환됐다.

DB와 Mock 대조 결과는 admission 1행, reservation 1행, ProviderAttempt 1행, usage ledger 2개 lifecycle entry, outbox 2개 lifecycle event, invocation log 1행, Mock Provider 1회였다. 확정 비용은 `2 micro USD`가 한 번 반영됐고 attempt count는 1이었다.

즉 **타 Gateway 진행 중 stream 재연결은 실패했지만, 이 정상 동시 요청에서는 Provider 중복 호출·중복 비용·중복 Request Log는 발생하지 않았다.** 현재 공유 DB의 reservation이 두 번째 Provider 실행을 막았지만, 진행 중 세션은 Gateway 1 프로세스 메모리에만 있어 Gateway 2가 attach하지 못한 결과다. 이 동작은 수정하지 않았다.

원본 증거:

- 요청 probe: `e9b7c31e-5ca2-4d00-a0e0-92c0f4eba49b`
- DB 대조: `de8de812-66a6-480c-9205-f0d7ee520564`
- Mock 대조: `09f7c611-f3ca-4157-a80d-6cdce3313f6b`

### 2. 같은 Gateway에도 session 등록 전 경쟁 구간이 있음

request `69f047a5-a543-4ef2-ad57-f6fd5575c95c`의 두 completion을 Caddy round-robin 조정으로 모두 Gateway 1에 보냈다. 두 번째 요청을 20ms 뒤 시작했을 때 첫 요청은 HTTP 200으로 완료됐지만 두 번째 요청은 같은 Gateway에서도 HTTP 503 `CHAT_USAGE_GUARD_UNAVAILABLE`이었다.

ProviderAttempt 1행, reservation 1행, invocation log 1행, Mock 호출 1회만 존재했다. 이는 첫 요청이 Provider stream을 여는 동안 아직 process-local active session 등록이 완료되지 않은 구간에서는 같은 프로세스도 attach하지 못한다는 관측이다. 이 경쟁 구간도 수정하지 않았다.

원본 증거:

- 요청 probe: `fac55ce7-87dd-47ef-bb79-63c23c91bffc`
- DB 대조: `c0b9d47d-c362-4331-abdf-0fce587e2525`
- Mock 대조: `175bbf96-e64e-4d48-bc9d-190619c066cc`

### 3. 완료 후 같은 Gateway replay 대조군

request `518b4c8a-8449-4935-b31d-de78d443893e`는 첫 요청이 끝난 200ms 뒤 같은 Gateway에 다시 보냈다. 첫 요청은 일반 HTTP 200, 두 번째 요청은 `X-GateLM-Idempotency-Replayed: true`인 HTTP 200이었다. 두 번째 응답은 새 delta 없이 final 1개를 replay했고 Provider는 다시 호출되지 않았다.

DB는 admission 1, reservation 1, ProviderAttempt 1, usage ledger 2 lifecycle entry, outbox 2 lifecycle event, invocation log 1행이었고 Mock 호출은 1회였다. 이 대조군은 terminal 결과가 생긴 뒤의 replay가 동작함을 보여준다. 앞선 20ms 실패와 함께 보면 문제 범위는 “멱등성이 전혀 없음”이 아니라 **완료 전 attach/등록 구간**이다.

원본 증거:

- 요청 probe: `e35f64ce-78a7-49af-9f0f-f0b606bda388`
- DB 대조: `55ab7aff-e4be-4897-bff3-29004454a60e`
- Mock 대조: `329d71c4-2382-4693-94d0-17776f0478ba`

### 4. 두 Gateway의 공유 Redis Rate Limit

격리된 합성 Application의 Token Bucket만 `100000/60s`에서 `4/60s`로 임시 변경하고 RuntimeSnapshot hash를 다시 계산했다. 두 Gateway를 재기동하고 Redis의 해당 Application key만 비운 뒤, 같은 Application에 요청 10개를 동시에 보냈다.

| 항목 | 관측값 |
|---|---:|
| 전체 요청 | 10 |
| Caddy 분배 | Gateway 1 5개 / Gateway 2 5개 |
| 전체 허용 / 거절 | HTTP 200 4개 / HTTP 429 6개 |
| Gateway 1 결과 | 429 5개 |
| Gateway 2 결과 | 200 4개 / 429 1개 |
| DB 성공 / rate_limited | 4 / 6 |
| DB 고유 Request Log / logging written | 10 / 10 |
| Mock Provider 호출 | 4회 |
| Redis 잔여 token 표본 | `0.001733…` |

두 Gateway는 요청 자체는 5개씩 받았지만 동시 도착 순서에 따라 허용 4개가 Gateway 2에 먼저 배정됐다. 이는 Caddy 분배 불일치가 아니라 공유 Bucket의 원자적 선점 순서다. 전체 허용 수는 4를 넘지 않았고 429 요청은 Mock Provider에 도달하지 않았다. 따라서 **현재 Redis Lua Token Bucket의 두 Gateway 전역 일관성 문제는 이 실험에서 재현되지 않았다.** 시간창 경계, Redis 장애·failover, hot key는 별도 미측정 범위다.

임시 정책은 즉시 `100000/60s`로 복구했고 RuntimeSnapshot row/body hash 일치, 두 Gateway HTTP 200 Mock smoke, Request Log 각 1행, Edge 인증 경계, 동일 image/binary를 최종 확인했다.

원본 증거:

- 임시 정책 적용: `3ef5d71b-0ca7-40f8-8f10-190f46f692c4`
- 동시 요청: `6891301e-74d4-4df2-b47a-3c6de4f0efe4`
- DB·Redis 대조: `10adf649-2791-4dff-b1d3-e122486e8de9`
- Mock 대조: `627622f3-5449-4279-86ae-f8a84673e978`
- 정책 복구: `ac3afe7f-1023-4321-9630-cabe3f241049`
- 최종 DB·정책 검증: `8ac4e0d1-7cdd-4d86-86a5-a8bbd0372a27`
- 최종 Gateway pair attestation: `dfed51ba-3bac-4c7c-8201-9ec345d0e702`
- 최종 Edge smoke: `1c43800f-3112-4d31-b89a-8d43b5956b42`

## 남겨 둔 기술적 챌린지

이번 단계에서는 아래 항목을 고치지 않았다.

| 항목 | 현재 증거 수준 | 다음 실험에서 답해야 할 질문 |
|---|---|---|
| cross-replica 진행 중 SSE attach | HTTP 503으로 재현 | shared replay buffer나 request ownership 없이 사용자 재연결을 어떻게 보장할 것인가 |
| session 등록 전 경쟁 | 같은 replica에서도 HTTP 503으로 재현 | Provider dispatch와 session publish 사이의 원자적 경계를 어떻게 만들 것인가 |
| Provider exactly-once | 정상 동시 요청에서는 1회, crash 모호성은 미측정 | dispatch 후 Gateway가 죽었을 때 Provider 실행 여부를 어떻게 판별할 것인가 |
| Assistant 메시지 exactly-once | full Chat API persistence 경로 미실행 | 실제 conversation/turn/message 흐름에서 assistant가 한 번만 저장되는가 |
| Gateway 강제 종료 후 재시도 | 미측정 | 비용 reservation, ProviderAttempt, 최종 응답이 어떤 상태로 남는가 |
| cross-replica 인증 캐시 TTL 경계 | 미측정 | process-local singleflight 때문에 Control Plane 조회가 replica 수만큼 증가하는가 |
| Rate Limit 시간창·Redis 장애 | 정상 동시 10건에서는 일관 | window 경계, Redis failover, fail-open/closed 정책에서 전역 제한이 유지되는가 |
| 장시간 용량·장애 가용성 | 30초 비교만 수행 | 10~30분 soak와 한 replica 종료 중 SLO가 유지되는가 |

## 발표용 결론 초안

문제는 Gateway를 두 대로 늘리는 순간 process-local active stream과 singleflight 상태가 공유되지 않는다는 점이었다. 먼저 운영 애플리케이션 경로와 100ms Mock 조건을 맞춘 1대 기준선을 수집했고, 같은 이미지의 Gateway만 한 대 추가해 비교했다. 150 RPS에서 오류 없이 p95가 `137.834ms → 115.404ms`로 약 `16.3%` 낮아지고 부하는 거의 50:50으로 분산됐다.

그러나 진행 중 같은 멱등성 요청은 다른 Gateway에서 HTTP 503이었고, session 등록 전 20ms 경쟁에서는 같은 Gateway에서도 HTTP 503이었다. 공유 DB 덕분에 해당 정상 동시 실험에서 Provider·비용·Request Log 중복은 발생하지 않았고, 공유 Redis Rate Limit도 전체 허용 4건을 지켰다. 따라서 현재 결론은 **처리 headroom은 개선됐지만 진행 중 stream 연속성은 보장되지 않으며, crash-after-dispatch exactly-once와 Assistant 저장은 아직 증명하지 못했다**이다.

이 문서의 30초 Mock 결과만으로 최대 처리량 2배, 운영 고가용성, 실제 Provider 비용 중복 방지를 주장하지 않는다.
