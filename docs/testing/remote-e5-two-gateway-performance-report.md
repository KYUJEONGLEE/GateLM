# Gateway 2대 원격 E5 분리 A/B 성능 실험

기준일: 2026-07-19

판정: **구조 분리는 성공했지만, 단일 2 vCPU AI Server는 150 RPS에서 원격 E5 요청을 감당하지 못했다.**

## 1. 실험 목적

Gateway 내부에서 E5 난이도 분류를 실행하면 라우팅 로직이 Gateway CPU와 메모리를 크게 사용한다. Gateway를 두 대로 늘려도 각 프로세스가 모델을 각각 적재하고 추론하므로, Gateway 확장 비용과 모델 추론 비용이 결합된다.

이번 실험은 다음 두 구성을 같은 부하에서 비교했다.

1. **로컬 E5:** Gateway 1·2가 각각 E5를 적재하고 추론
2. **원격 E5:** 두 Gateway는 HTTP로 단일 AI Server의 E5 추론 API를 호출

이 단계에서는 AI Server의 worker 수, timeout, 동시성 제한을 결과에 맞춰 튜닝하지 않았다. 병목과 fallback을 그대로 관측해 다음 기술적 챌린지의 기준선으로 남기는 것이 목적이다.

## 2. 공통 조건

| 항목 | 조건 |
|---|---|
| Gateway | `c7i.xlarge` 2대, 각 4 vCPU |
| AI Server | `c7i.large` 1대, 2 vCPU |
| Load Generator | Gateway와 분리된 `c7i.large` |
| 부하 | 150 RPS, 60초, 완료 목표 9,001건 |
| 요청 | cache-miss, 비스트리밍, 실행마다 고유 Request ID |
| Provider | 격리 Mock Provider, 응답 대기 100ms 고정 |
| 인증 캐시 | ON, TTL 5초, 최대 4,096개 |
| 분배 | Caddy round-robin, 두 Gateway 50:50 확인 |
| 실험 코드 HEAD | `2866860220fdbc70ade1dc902f1a469ad34dd8ac` |
| 성능 하네스 SHA | `828fd73163fddaaaee8cae3ae91ce9d7a095e473` |
| 로컬 E5 Gateway image | `sha256:9e09cd2c…609d` |
| 원격 E5 Gateway image | `sha256:8cc3cb45…adfd` |
| 원격 E5 AI image | `sha256:a6d46d1f…b24d` |
| E5 ONNX 파일 SHA-256 | `a374ca7b87cdafc3c2a4b8b3c7db4a6500803ced02c750351d5fa80f60e94a94` |

원격 E5 조건은 Gateway timeout 100ms, Gateway별 최대 동시 호출 64개, AI Server 최대 동시 추론 16개, ONNX intra/inter-op thread 각 1개로 고정했다. 실제 Provider와 운영 DNS·운영 트래픽은 사용하거나 변경하지 않았다.

## 3. A/B 결과

| 항목 | 로컬 E5 | 원격 E5 | 변화 |
|---|---:|---:|---:|
| 완료 요청 | 9,001 | 9,001 | 동일 |
| dropped iteration | 0 | 0 | 동일 |
| HTTP 오류 / 실패 check | 0 / 0 | 0 / 0 | 동일 |
| Gateway 1 / 2 응답 | 4,500 / 4,501 | 4,500 / 4,501 | 동일 |
| HTTP p95 | 115.331ms | 214.991ms | **86.41% 증가** |
| HTTP p99 | 159.227ms | 303.414ms | **90.55% 증가** |
| HTTP max | 224.179ms | 627.871ms | 180.08% 증가 |
| DB 기록 latency p95 | 112ms | 212ms | 89.29% 증가 |
| DB 기록 latency p99 | 155ms | 300ms | 93.55% 증가 |
| 라우팅 판단 평균 | 7.153ms | 84.217ms | **11.77배 증가** |
| Provider 대기 평균 | 101.855ms | 105.033ms | 3.12% 증가 |
| 최종 simple 판정 | 9,001 | 9,001 | 동일 |

Provider 대기는 거의 같았지만 라우팅 판단이 평균 약 77ms 늘었고, HTTP p95는 약 100ms 늘었다. 따라서 지연 증가의 주원인은 Mock Provider가 아니라 원격 E5 호출 및 timeout 경로다.

### 자원 이동

부하 구간의 `docker stats` 표본만 집계했다. Docker CPU 100%는 논리 CPU 한 개 사용량이다.

| 역할 | 로컬 E5 CPU 평균 / 최대 | 원격 E5 CPU 평균 / 최대 | 메모리 최대 변화 |
|---|---:|---:|---:|
| Gateway 1 | 351.40% / 358.21% | 16.51% / 23.56% | 992MiB → 82.1MiB |
| Gateway 2 | 349.57% / 354.60% | 16.65% / 24.08% | 981.1MiB → 82.6MiB |
| 원격 E5 AI | 해당 없음 | 182.24% / 186.75% | 821.9MiB |

원격 분리 후 Gateway CPU는 각각 약 95.3% 감소했고 모델 메모리도 Gateway에서 제거됐다. 반면 원격 E5 컨테이너는 2 vCPU의 약 91.1%를 평균적으로 사용했다. 즉 연산이 사라진 것이 아니라 **Gateway에서 단일 AI Server로 병목이 이동했다.**

## 4. HTTP 성공과 E5 성공을 구분해야 하는 이유

원격 추론 메트릭은 부하 9,001건과 k6 사전 점검 1건을 합친 9,002건을 기록했다.

| 원격 E5 상태 | 건수 | 비율 |
|---|---:|---:|
| `ready` | 2,794 | 31.04% |
| `timeout` | 6,161 | **68.44%** |
| `busy` | 33 | 0.37% |
| `inference_failed` | 14 | 0.16% |
| 합계 | 9,002 | 100% |

- `ready` 응답 평균은 약 47.30ms였다.
- `timeout` 응답 평균은 약 100.61ms로 설정한 100ms deadline과 일치했다.
- 원격 추론이 준비되지 않으면 Gateway는 기존 Rule 기반 판정으로 fallback했다.

따라서 `HTTP 9,001건 성공`, `최종 simple 9,001건`은 원격 E5가 모두 성공했다는 뜻이 아니다. 대부분의 사용자 요청은 Provider까지 정상 처리됐지만, 원격 E5는 약 68.4%에서 timeout됐고 Rule fallback 덕분에 최종 HTTP 요청이 성공했다.

이 구분 없이 완료 요청만 보면 원격 분리가 성공한 것처럼 보이는 것이 이번 실험에서 확인한 가장 중요한 해석상의 함정이다.

## 5. 요청 수 교차 검증

| 증거 | 결과 |
|---|---:|
| k6 완료 요청 | 9,001 |
| DB 고유 Request ID | 9,001 |
| DB success / HTTP 200 / logging written | 9,001 / 9,001 / 9,001 |
| Mock Provider 호출 | 9,002 |

Mock 호출 9,002회는 k6 사전 점검 1회와 실제 부하 9,001회의 합이다. 이번 고유 Request ID 정상 부하에서는 Provider 추가 호출이나 Request Log 중복이 관찰되지 않았다.

단, 이 실험은 같은 멱등성 키 동시 요청, 진행 중 SSE 재연결, Gateway 강제 종료를 실행하지 않았다. 따라서 분산 환경의 exactly-once, 중복 과금 방지, Assistant 메시지 단일 저장을 증명하지 않는다.

## 6. 측정 중 발견한 실패와 교란 요인

성공한 결과만 남기지 않고 준비 과정의 실패도 기록한다.

| 단계 | 증상 | 원인 | 조치 / 결과 해석 |
|---|---|---|---|
| 이미지·모델 전송 | 호스트 간 SSH 연결 실패 | Gateway Security Group의 22번 **egress**가 허용되지 않음 | 정확한 임시 CIDR 규칙으로 전송 후 즉시 제거. 제품 성능 실패가 아니라 하네스 실패 |
| AI 첫 기동 | 모델 `config.json` PermissionError | 비 root 컨테이너 사용자가 전송된 모델 디렉터리를 읽지 못함 | 모델 디렉터리에 read/execute만 부여한 뒤 healthy 확인 |
| Gateway 첫 원격 기동 | overlay 경로 및 미사용 Compose 변수 오류 | 두 호스트의 전송 위치가 달랐고 Compose가 전체 파일을 보간 | host별 검증된 overlay 경로 사용. 실제 요청 전 실패이므로 결과에서 제외 |
| 원격 성능 실행 | PostgreSQL CPU가 부하 전부터 약 100% | 이전 요청 로그를 처리하는 Dashboard rollup 세션이 동시 실행 | relation lock으로 rollup 테이블 작업임을 확인. 원격 실행의 PostgreSQL CPU는 E5 영향으로 귀속하지 않음 |
| 원상 복구 1차 | 복구 전 이미지 확인이 실패 | 하네스가 `prod-clone-` 태그 접두사를 빠뜨림 | 컨테이너 변경 전에 중단됨. 정확한 태그로 재실행해 복구 완료 |

원격 실행 중 PostgreSQL 평균 CPU는 115.55%였지만, 부하 직전 첫 표본부터 99.98%였고 `dashboard_rollup_*`, `employee_usage_rollups` 관계를 갱신하는 별도 세션이 확인됐다. 따라서 DB CPU 증가와 tail latency 전부를 원격 E5 탓으로 설명할 수 없다.

반면 아래 두 증거는 DB rollup과 무관하게 AI 병목을 직접 보여준다.

- 원격 E5 컨테이너 평균 CPU 182.24% / 2 vCPU
- Gateway가 직접 집계한 원격 E5 timeout 6,161건 / 9,002건

## 7. 기술적 챌린지 정리

### 문제

라우팅 품질을 높이기 위해 E5 추론을 Gateway 요청 경로에 넣자, Gateway 두 대가 각각 모델을 적재하고 CPU를 거의 4 vCPU 한계까지 사용했다. Gateway의 네트워크 처리와 모델 추론이 같은 확장 단위를 공유했다.

### 시도

E5 추론을 별도 AI Server의 private API로 분리하고 두 Gateway가 같은 원격 모델 서버를 호출하도록 했다. 서비스 토큰, private Security Group 경로, timeout, 동시성 제한과 상태별 메트릭을 추가해 local/remote A/B를 수행했다.

### 결과

Gateway CPU는 약 95% 감소하고 모델 메모리도 제거됐다. 그러나 단일 2 vCPU AI Server가 새로운 병목이 되어 원격 E5의 68.44%가 100ms 안에 완료되지 못했다. 결과적으로 HTTP p95는 115.331ms에서 214.991ms로 86.41% 증가했다.

### 현재 한계

- Gateway 2대가 되어도 AI Server가 1대이면 E5 처리 용량은 증가하지 않는다.
- 현재 HTTP 성공률은 Rule fallback을 포함하므로 모델 추론 성공률과 다르다.
- AI Server 장애 시 현재 정책은 Rule 기반 fail-open이며, 품질 저하를 별도로 관측·경보하는 운영 기준은 아직 검증하지 않았다.
- E5와 PII 등 다른 AI 기능이 같은 호스트를 사용하면 CPU 경합이 더 커질 수 있다.
- 1회씩 수행한 60초 Mock 비교이므로 지속 가능 용량이나 실제 Provider 포함 운영 SLO가 아니다.
- 모델 분류 정확도와 비용 절감 효과는 이번 성능 실험 범위가 아니다.
- 멱등성, cross-replica SSE attach, Rate Limit 장애, Gateway crash 후 중복 비용 문제는 수정하거나 재검증하지 않았다.

### 다음 실험 후보

구현을 바로 고치기 전에 다음 비교로 병목 경계를 수치화해야 한다.

1. 원격 E5를 25 → 50 → 75 → 100 → 150 RPS로 올려 `ready` 99% 이상이 유지되는 단일 AI Server 경계 탐색
2. 같은 조건에서 AI Server 1대와 2대의 처리량·p95·timeout 비율 비교
3. worker 수, ONNX thread 수, 최대 동시 추론 수를 한 변수씩만 바꾸는 실험
4. Rule fallback을 성공으로 숨기지 않도록 HTTP 성공률과 E5 `ready` 비율을 분리한 SLO 정의
5. PII와 E5를 동시에 켠 경우 AI Server 자원 경합 및 fail-open/fail-closed 정책 비교

## 8. 환경 복구 상태

실험 후 성능환경은 다음 상태로 복구했다.

- 두 Gateway: 운영동일 image `sha256:455936e3…d64d`, healthy
- 인증 캐시: ON, TTL 5초, 최대 4,096개
- 로컬 E5: ON, 원격 E5: OFF
- 실험용 `ai-service-routing` 컨테이너: 제거
- 원래 AI Service와 Mock Provider: healthy
- 실험용 TCP 8002 Security Group ingress/egress: 모두 제거
- 운영 DNS·운영 트래픽·실제 Provider: 변경 없음

## 9. 원본 증거 식별자

- 로컬 E5 기준선 run ID: `run_20260719T131840Z_563532_17764`
- 로컬 E5 k6 / 자원 / DB / Mock SSM: `321ecc97-b8ec-448c-8d51-7cc3891c987a` / `0b82f157-20a4-4009-8990-ed55d2a15bd0` / `f6d9d4cf-7150-4858-a381-b4aad4848d38` / `3b35dcfe-8366-4e99-833e-678d5144eeeb`
- 원격 E5 run ID: `run_20260719T132707Z_567748_20684`
- 원격 E5 evidence bundle: `/home/ubuntu/GateLM-prod-clone-control-bbd82e6b9/reports/perf/loadgen/20260719T132707Z-run_20260719T132707Z_567748_20684`
- 원격 E5 k6 / 자원 / DB / Mock SSM: `7c45f3d0-809e-4864-b08b-4adfbf70a0f6` / `4b593f99-00bd-4a04-91e9-8ab58f76f8b4` / `2e34bb93-2d78-42d6-b37e-3ae078ed15c7` / `50f33c75-8e4f-4686-98c2-f3958567c056`
- 원격 추론 메트릭 SSM: `7b346a80-606a-4bc3-837f-c6c5e679f9b4`
- DB rollup relation 확인 SSM: `effd847d-dd3b-4115-9c48-7e3c979fc448`
- Gateway 복구 SSM: `de125159-60b6-4d93-b28c-b71949960e26`
- 전체 컨테이너 복구 확인 SSM: `25f3d3d3-ac29-4ae7-abc8-8651280b67eb`

## 10. 발표용 한 문단

Gateway 내부 E5 추론 때문에 두 Gateway가 각각 CPU를 약 3.5 vCPU씩 사용하던 문제를 해결하기 위해 모델을 별도 AI Server로 분리했습니다. 같은 150 RPS에서 Gateway CPU와 모델 메모리는 약 95% 감소했지만, 단일 2 vCPU AI Server가 새 병목이 되어 원격 추론의 68.44%가 100ms timeout 후 Rule 기반으로 fallback됐고 HTTP p95는 115.331ms에서 214.991ms로 증가했습니다. 즉 분리를 통해 Gateway와 모델의 확장 단위는 분리했지만, Gateway만 늘려서는 전체 처리량이 늘지 않으며 AI Server의 독립적인 용량 산정과 다중화가 필요하다는 점을 실제 데이터로 확인했습니다.
