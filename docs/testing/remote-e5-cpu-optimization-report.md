# 원격 E5 CPU 최적화 실험 보고서

기준일: 2026-07-19

최종 판정: **서버를 추가하지 않고 worker 경합을 줄여 원격 E5 성공률과 tail latency를 크게 개선했지만, 150 RPS 승격 기준은 통과하지 못했다.**

## 1. 배경과 문제

이전 두-Gateway 원격 E5 실험에서는 Gateway CPU를 크게 줄이는 데 성공했지만, 단일 2 vCPU AI Server가 새로운 병목이 됐다. 150 RPS에서 remote E5 `ready`는 31.04%뿐이었고 68.44%가 100ms timeout 후 Rule 기반으로 fallback됐다. HTTP 요청 9,001건은 모두 성공했지만 이는 모델 추론 성공이 아니라 fallback을 포함한 결과였다.

이번 실험은 EC2를 추가하지 않고 같은 AI Server 내부에서 다음을 검증했다.

1. 동적 micro-batch로 item당 CPU를 줄일 수 있는가.
2. 동시에 실행하는 ONNX worker 수를 제한하면 thread 경합을 줄일 수 있는가.
3. 한 호스트에서 process를 2개로 나눠 별도 ONNX Session을 사용하면 2 vCPU를 더 활용할 수 있는가.

이전 기준선의 상세 조건과 결과는 [`remote-e5-two-gateway-performance-report.md`](remote-e5-two-gateway-performance-report.md)에 있다.

## 2. 구현한 실험 장치

실험 브랜치에 다음을 추가했다.

- bounded queue와 dedicated worker를 사용하는 `RoutingDifficultyBatcher`
- batch 1·2·4·8의 판정 일치율, score 변화, 처리량, CPU/item을 비교하는 aggregate-only benchmark
- batch size, batch wait, worker 수를 각각 제어하는 환경변수
- 종료 시 batch 수, item 수, queue wait, inference 시간을 원문 없이 남기는 집계 로그
- batch 0ms 즉시 dispatch를 허용하는 설정 검증과 회귀 테스트

관련 커밋은 다음과 같다.

| 커밋 | 내용 |
|---|---|
| `6ef4a856e` | batch 실행 경로, bounded queue, parity benchmark 추가 |
| `5e98479bb` | 요청 수용 한도와 실제 ONNX worker 수 분리 |
| `5282bfab9` | `BATCH_MAX_WAIT_MS=0` 환경변수 기동 오류 수정 |

실험 AI image는 `sha256:9bd3634940bd77a02c2b0b9c1ff37b915b60412e981222a2dc531a8102776008`이며, branch HEAD `5282bfab96c856c5fcfa91fc092fe622d1dc1592`에서 빌드했다. 이 변경은 feature branch에만 있고 `dev`나 `main`에는 병합하지 않았다.

## 3. 공통 환경

| 항목 | 조건 |
|---|---|
| Gateway | `c7i.xlarge` 2대, 각 4 vCPU |
| AI Server | `c7i.large` 1대, 2 vCPU |
| Load Generator | 별도 `c7i.large` |
| Provider | 격리 Mock Provider, 고정 100ms |
| E2E 부하 | 150 RPS, 60초, cache-miss, 고유 Request ID |
| 인증 캐시 | ON, TTL 5초, 최대 4,096개 |
| Gateway 분배 | Caddy round-robin 50:50 |
| Gateway remote timeout | 100ms |
| ONNX intra/inter-op thread | 1 / 1 |
| E5 model SHA-256 | `a374ca7b87cdafc3c2a4b8b3c7db4a6500803ced02c750351d5fa80f60e94a94` |
| 성능 하네스 SHA | `828fd73163fddaaaee8cae3ae91ce9d7a095e473` |

운영 DNS, 운영 트래픽, 실제 Provider는 사용하거나 변경하지 않았다.

## 4. 시도 1: 동적 micro-batch

승인된 redacted holdout 100건과 현재 Go가 생성한 42차원 rule vector를 결합했다. 각 batch size를 3회 실행하고 batch 1 결과를 parity 기준으로 사용했다.

Dataset SHA-256은 `278be4bcf7764ed760b8f5e67858bf1587ad53a41d0bec71652f0b73b2ca8bc8`, vector export SHA-256은 `810cfb174564ab2e35a3139565c941d351764dbe7f13959b3a9e31363f2b74c8`이다.

### intra-op thread 1 결과

| Batch | 처리량 item/s | CPU ms/item | Batch p95 | Label flip | complex → simple | Accuracy / F1 |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 173.249 | 5.771 | 8.021ms | 0 | 0 | 0.96 / 0.959184 |
| 2 | 176.859 | 5.726 | 16.179ms | 2 | 1 | 0.94 / 0.938776 |
| 4 | 168.811 | 5.980 | 33.707ms | 4 | 3 | 0.94 / 0.937500 |
| 8 | 147.758 | 6.681 | 76.654ms | 3 | 2 | 0.95 / 0.948454 |

Batch 2는 처리량이 2.08% 늘었지만 판정 2건이 바뀌었고, 고난도 요청 1건이 단순 요청으로 바뀌었다. Batch 4와 8은 품질이 바뀌면서 처리량까지 batch 1보다 낮아졌다.

intra-op thread 2에서도 batch 2는 판정 2건이 바뀌었다. Batch 1 처리량은 187.513 item/s로 8.23% 늘었지만 CPU는 5.771ms/item에서 10.634ms/item으로 84.26% 증가했다. 2 vCPU 포화 환경에서 지속 가능한 개선으로 보기 어렵다.

### 판정

동적 micro-batch는 폐기한다. 현재 QInt8 ONNX artifact는 batch shape에 따라 score와 최종 label이 달라지므로 authoritative 요청에 사용할 수 없다. 실험 기본값은 batch 1, wait 0ms로 유지한다.

## 5. 시도 2: worker 수 직접 비교

AI API에 직접 150 RPS를 30초 동안 균일하게 보내 worker 1·2·4·16을 비교했다. 짧은 고정 synthetic instruction을 사용했으며 각 실행은 4,500~4,501건을 완료했다.

| Worker | 완료 / 실패 / drop | HTTP 평균 | p95 | p99 | AI CPU 평균 |
|---:|---:|---:|---:|---:|---:|
| 1 | 4,500 / 0 / 0 | 5.100ms | 6.026ms | 15.147ms | 62.062% |
| 2 | 4,500 / 0 / 0 | 5.747ms | 6.058ms | 29.276ms | 62.027% |
| 4 | 4,501 / 0 / 0 | 4.964ms | 6.025ms | 9.583ms | 61.554% |
| 16 | 4,501 / 0 / 0 | 5.101ms | 6.101ms | 12.359ms | 62.311% |

직접 테스트에서는 모든 설정이 통과했고 worker 4의 p99가 가장 낮았다. 하지만 VU가 대부분 1이었던 균일한 짧은 요청이므로 실제 Gateway 경로의 burst와 queue 효과를 재현하지 못했다. 이 결과만으로 worker 4를 채택하지 않고 E2E를 별도로 수행했다.

## 6. 두-Gateway E2E 비교

### 전체 결과

| 항목 | 기존 원격 기준선 | Batch 1 / Worker 4 | Batch 1 / Worker 8 | Process 2 × Worker 1 |
|---|---:|---:|---:|---:|
| 완료 요청 | 9,001 | 9,000 | 9,001 | 9,001 |
| HTTP 오류 / drop | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| HTTP p95 | 214.991ms | **206.336ms** | 207.797ms | 208.008ms |
| HTTP p99 | 303.414ms | **242.758ms** | 243.325ms | 257.087ms |
| HTTP max | 627.871ms | 383.759ms | **353.680ms** | 460.878ms |
| DB latency p95 | 212ms | **204ms** | 205ms | 205ms |
| DB latency p99 | 300ms | **240ms** | **240ms** | 253ms |
| Routing 평균 | 84.217ms | **44.384ms** | 77.354ms | 79.775ms |
| Provider wait 평균 | 105.033ms | 102.415ms | **102.406ms** | 103.255ms |
| AI CPU 평균 | 182.24% | **102.02%** | 103.74% | 100.95% |
| AI 메모리 최대 | 821.9MiB | 787.1MiB | 795.6MiB | **1,588.2MiB** |

Worker 4는 기존 기준선 대비 routing 평균을 47.30%, HTTP p99를 19.99%, AI CPU 평균을 44.02% 줄였다. 두 Gateway CPU 평균도 기존 16.51% / 16.65%에서 11.83% / 11.60%로 낮아졌다.

### Remote E5 상태

각 Gateway 재기동 후 측정한 counter에는 k6 부하와 소수의 사전 점검 요청이 함께 포함된다. 따라서 분모는 각각 9,002~9,004건이며 k6 완료 건수와 정확히 같지 않다.

| 상태 | 기존 원격 기준선 | Worker 4 | Worker 8 | Process 2 × Worker 1 |
|---|---:|---:|---:|---:|
| `ready` | 31.04% | **87.29%** | 44.55% | 48.25% |
| `timeout` | 68.44% | **10.31%** | 54.51% | 18.59% |
| `busy` | 0.37% | 2.25% | **0.58%** | 9.76% |
| `inference_failed` | 0.16% | **0.14%** | 0.37% | 23.40% |

Worker 4의 `ready` 평균 응답시간은 37.720ms였다. 반면 worker 8은 AI CPU가 거의 같아도 `ready` 평균이 48.406ms로 늘고 timeout이 54.51%로 악화됐다. worker 수를 늘린 것이 처리 용량 증가가 아니라 ONNX Session 경합 증가로 이어진 결과다.

Process 2 구성은 각 process가 별도 ONNX Session과 worker 1개를 가지게 했지만 효과가 없었다. 메모리는 약 두 배가 됐고, 종료 집계에서 process별 평균 queue wait가 59.878ms / 60.082ms, 평균 inference가 14.016ms / 14.404ms였다. AI CPU 평균은 여전히 약 1 vCPU 수준이었으며 `ready`는 48.25%에 그쳤다. 이 구성도 폐기한다.

## 7. 왜 HTTP는 모두 성공했는가

네 E2E 실행 모두 HTTP 실패가 0이지만 E5 성공률은 다르다. Gateway가 remote timeout, busy, inference failure에서 Rule 기반 난이도 판정으로 fail-open하기 때문이다.

Worker 4에서도 12.71%가 remote E5 결과를 사용하지 못했다. 이 요청들은 약 100ms의 remote deadline을 소비한 뒤 Mock Provider 100ms를 기다리므로 HTTP p95가 약 206ms에 남는다. 따라서 다음 두 문장은 구분해야 한다.

- 확인된 사실: 150 RPS의 최종 Gateway 요청은 fallback을 포함해 모두 성공했다.
- 확인되지 않은 주장: 원격 E5가 150 RPS를 손실 없이 처리했다.

## 8. 최종 결론과 현재 한계

서버를 늘리지 않는 내부 개선안 중에서는 **single process + batch 1 + worker 4 + ONNX intra/inter-op 1**이 가장 낫다. 이 구성은 기존보다 CPU 경합과 tail latency를 줄였고 remote E5 `ready`를 31.04%에서 87.29%로 높였다.

그러나 다음 이유로 production 승격이나 150 RPS 용량 보장을 선언하지 않는다.

- remote E5 실패·fallback이 12.71% 남았다.
- local E5 기준 HTTP p95 115.331ms보다 worker 4의 206.336ms가 여전히 78.91% 느리다.
- 60초 단일 실행이며 실제 Provider, PII 동시 부하, 장시간 soak를 포함하지 않았다.
- 직접 API 테스트와 E2E 결과가 크게 달라 실제 Gateway burst와 queue 효과를 별도로 모델링해야 한다.
- process 2개는 CPU를 더 쓰지 못하고 메모리와 오류만 늘렸다.
- 현재 변경은 experimental feature branch이며 active API·Metrics contract가 아니다.

다음 내부 개선은 요청 원문을 남기지 않는 tokenizer / ONNX / head 단계별 latency metric을 먼저 추가하고, 공유 ONNX Session의 동시 실행 특성과 Gateway 두 대에서 들어오는 burst 분포를 계측하는 것이다. 단순히 worker, timeout, queue 크기를 늘리는 방식은 이번 데이터상 해결책이 아니다.

## 9. 환경 복구

모든 실험 후 성능환경을 다음 상태로 복구했다.

- 두 Gateway: `gatelm/gateway-core:prod-clone-3be2a8d7e0da`, image `sha256:455936e3e890543a82c0853184c42caca4c0ae727785de7ce4fe530c3261d64d`, healthy
- 인증 캐시: ON, TTL 5초, 최대 4,096개
- local E5: ON, remote E5: OFF
- 실험용 AI container: 정상 종료 후 제거
- 기존 AI Service와 Mock Provider: healthy
- TCP 8002 임시 Security Group ingress / egress: 0개
- 운영 DNS, 운영 트래픽, 실제 Provider: 변경 없음

## 10. 원본 증거 식별자

### Batch와 직접 worker 비교

- batch parity benchmark: `253a9918-f464-476c-b50c-4ecb9698a408`
- worker 1 load / resource: `8917f61f-b2c8-4c4b-8936-d1629d0eb521` / `0252394e-f6e8-4c36-8fc5-157ad68dcdab`
- worker 2 load / resource: `7a40d014-903c-4a10-966c-48f30b40e384` / `d792264b-cada-421a-914f-62207990912d`
- worker 4 load / resource: `e1963f46-30ff-4459-b4df-157e1cab89ae` / `546f1237-4a67-41ef-bbad-b8cb5b8c93f4`
- worker 16 load / resource: `71071af8-8e7a-434a-a6bc-8b47c90227bb` / `9307b4a0-a5af-460c-beff-a4c948786e30`

### Worker 4 E2E

- run ID: `run_20260719T150059Z_612038_8647`
- evidence bundle: `/home/ubuntu/GateLM-prod-clone-control-bbd82e6b9/reports/perf/loadgen/20260719T150059Z-run_20260719T150059Z_612038_8647`
- k6 / resource / metrics / DB: `e5f03ed0-5be0-45ac-b2e4-7f32fa18edf7` / `7e237bd0-3158-4665-871b-85959c2feae5` / `51ea1a0e-5f31-49f0-b7b4-6a21b6f5346c` / `47c2f540-f16d-45d9-b67d-b72b1c90e60e`

### Worker 8 E2E

- run ID: `run_20260719T150711Z_615213_32353`
- evidence bundle: `/home/ubuntu/GateLM-prod-clone-control-bbd82e6b9/reports/perf/loadgen/20260719T150711Z-run_20260719T150711Z_615213_32353`
- k6 / resource / metrics / DB: `9073e3d4-1171-4e22-a3f7-b95621adb432` / `ba53ea04-7006-44b1-98c9-9aeec81da6cf` / `4efbe608-7c8f-40c4-811d-09de33339cb8` / `33178cbb-e85e-4f9b-89a5-3df10c94243a`

### Process 2 E2E와 복구

- run ID: `run_20260719T151928Z_621200_30908`
- evidence bundle: `/home/ubuntu/GateLM-prod-clone-control-bbd82e6b9/reports/perf/loadgen/20260719T151928Z-run_20260719T151928Z_621200_30908`
- k6 / resource / metrics / DB: `55a1ec4b-1190-42cf-92f6-7cefc43f48c6` / `bba64c30-c84c-452e-86db-4136a90aed7c` / `24166787-8344-4aea-bed3-3b1ecac79d48` / `749ff066-d760-4063-94cd-283d0acd4f31`
- Gateway 원복 / AI 종료 / 최종 검증: `3cfccc0f-919e-47bf-9251-c2f313ca1844` / `b649e7a6-46b9-4c78-a739-57d3f2b7ba61` / `62939689-3789-43b1-86ee-985a862dc52a`

## 11. 발표용 요약

Gateway에서 E5를 분리한 뒤 단일 2 vCPU AI Server가 병목이 되어 원격 추론의 68.44%가 timeout됐습니다. 서버를 추가하지 않고 micro-batch를 먼저 검토했지만 batch 2부터 판정이 바뀌어 폐기했습니다. 이후 ONNX worker 수와 process 수를 비교한 결과, worker 4가 AI CPU 평균을 182.24%에서 102.02%로 줄이면서 remote E5 `ready`를 31.04%에서 87.29%로 높이고 routing 평균을 84.217ms에서 44.384ms로 개선했습니다. 그러나 fallback이 12.71% 남아 150 RPS 완전 처리에는 실패했습니다. 즉 thread 수를 늘리는 것이 아니라 경합을 제한하는 것이 효과적이었지만, 현재 2 vCPU 한 대만으로 운영 승격 기준을 충족하지 못한다는 한계까지 수치로 확인했습니다.
