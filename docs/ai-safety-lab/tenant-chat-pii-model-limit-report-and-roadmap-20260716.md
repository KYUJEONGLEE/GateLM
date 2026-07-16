# Tenant Chat PII 모델 한계 분석 및 발전 계획 — 2026-07-16

## 1. 문서 상태

| 항목 | 내용 |
|---|---|
| 문서 성격 | 특정 브랜치와 실행 환경에서 확인한 개발 근거 및 후속 작업 계획 |
| 검증 대상 브랜치 | `feat/tenant-chat-pii-mask-once` |
| 검증 대상 코드 | `ab4cede784b0e3131a0e3f25640b63ffd0f6f001` |
| 검증일 | 2026-07-16 KST |
| 대상 경로 | Tenant Chat 저장 전 sanitization과 AI Service ONNX PII 탐지 |
| 데이터 범위 | 합성 문장과 aggregate 결과만 사용 |
| 원문 저장 | 없음 |
| 현재 결정 | 통합 동작은 확인됐지만 production-grade PII/DLP 품질 근거는 없음. 오늘 배포 환경 연결과 안전한 원복 경로까지 완료해야 함 |

이 문서는 active Tenant Chat 계약을 변경하지 않는다. 현재 구현과 모델의 한계를 기록하는 evidence 문서이며, 아래 통과 기준 중 운영 기준값은 제품·보안 책임자의 별도 승인 정책으로 확정해야 한다.

## 2. 결론 요약

1. Gateway 규칙, AI Service 규칙, ONNX 모델, Tenant Chat 저장 전 마스킹 연결은 동작한다.
2. 규칙 단독 대비 OpenAI 모델 추가 효과는 1,000건 합성 평가에서 통과율 `78.0% -> 78.5%`로 작았다.
3. 같은 비교에서 false negative 사례는 6건 줄었지만 false positive 사례는 24건 늘었다.
4. KoELECTRA를 추가한 축소 평가에서는 전화번호와 주민등록번호의 true positive가 OpenAI 단독 대비 증가하지 않았다.
5. KoELECTRA ONNX 어댑터가 BIO 토큰을 하나의 span으로 합치지 않아 이메일 1개를 2~16개 탐지로 계산하는 결함이 확인됐다.
6. 이름과 조직명은 두 모델이 탐지하지 않는다. 현재 결과는 규칙 backstop이다.
7. 모델이 실제 개입한 요청의 지연은 OpenAI 단독 p50 약 195ms, 두 모델 p50 약 309ms로 관찰됐다.
8. 두 모델의 첫 로드, 메모리, 순차 평가 처리량은 현재 개발 PC 기준으로 무겁다.
9. 따라서 지금 필요한 첫 작업은 재학습이 아니라 어댑터 정확성 수정과 모델별 기여도 분리 평가다.
10. 모델 사용 결정을 유지하더라도 두 모델을 즉시 동일한 enforce 권한으로 운영해서는 안 된다.

## 3. 현재 완성된 흐름

```text
Tenant Chat의 새 사용자 메시지
-> Gateway 필수 로컬 규칙 검사
-> 로컬 규칙으로 block이면 즉시 차단
-> 그 외 결과를 AI Service에 일시 전달
-> AI Service의 빠른 규칙 검사
-> 규칙으로 덮이지 않은 ML 후보 구간만 모델 검사
-> OpenAI ONNX 결과와 KoELECTRA ONNX 결과 정규화
-> 규칙 결과와 모델 결과 병합
-> allow/redact/block 적용
-> passed/redacted 내용만 암호화 저장
-> 이후 요청은 검증된 sanitized history를 재검사하지 않고 새 사용자 메시지만 검사
-> sanitized history와 새 sanitized 메시지만 Provider에 전달
```

이 흐름의 장점은 규칙으로 충분한 요청은 모델을 건너뛰고, 이전 대화 원문을 매번 모델에 다시 전달하지 않는다는 점이다. 다만 현재 모델 결과 정규화와 품질 근거가 충분하지 않으므로 연결이 동작한다는 사실과 탐지가 정확하다는 주장은 분리해야 한다.

## 4. 평가 범위와 해석 주의사항

### 4.1 실행한 평가

| 평가 | 입력 | 구성 | 결과 산출 여부 |
|---|---:|---|---|
| 규칙 기준선 | 1,000건 | 규칙 + no-op ML | 완료 |
| OpenAI 모델 비교 | 1,000건 | 규칙 + OpenAI ONNX | 완료 |
| 두 모델 축소 비교 | 30건 | 규칙 + OpenAI ONNX + KoELECTRA ONNX | 완료, adapter 2개 로드 확인 |
| 두 모델 전체 비교 | 1,000건 | 규칙 + 두 ONNX 모델 | 900초 내 미완료, 보고서 미생성 |
| 전체 그룹 지연 벤치마크 | 50건 | 안전·영문 PII·한글 PII·혼합 사례 | 완료 |
| AI Service 회귀 | 242개 | unit/API/artifact 테스트 | 통과, 3개 skip |
| Gateway 회귀 | 전체 Go package | `go test ./...` | 통과 |
| Tenant Chat Web 회귀 | 20개 | Node test | 통과 |

Chat API는 커밋 전 104개 테스트와 typecheck가 통과했다. 최종 재실행은 로컬 `node_modules`의 `jest-cli` 내부 링크 누락으로 테스트가 시작되기 전에 중단됐으며, 이 문서 작성 시점에 소스 회귀 실패로 판정하지 않았다.

### 4.2 숫자를 운영 정확도로 해석하면 안 되는 이유

- 1,000건 corpus는 합성 데이터다.
- 이전 threshold 조정에서 같은 corpus를 참고했으므로 untouched holdout이 아니다.
- 주요 pass rate는 outcome, detector type, detected count가 모두 맞는지를 보는 case-level exact match다.
- 실제 개인정보 문자열의 시작과 끝을 평가하는 span-level 모델 정확도가 아니다.
- 규칙과 모델을 합친 결과이므로 모델 단독 정확도로 사용할 수 없다.
- 실제 고객 원문이나 고객 로그를 수집해 평가하지 않았다.
- 이 결과는 개발 방향을 정하는 screening evidence이며 production promotion evidence가 아니다.

로컬 상세 산출물은 원문 없이 아래 Git-ignored 경로에 생성했다.

```text
.tmp/pii-model-limit-20260716/rules-only/
.tmp/pii-model-limit-20260716/hybrid/
.tmp/pii-model-limit-20260716/hybrid-two-models-targeted/
.tmp/pii-model-limit-20260716/latency-two-models-all-groups/
```

## 5. 정확도 결과

### 5.1 규칙 단독과 OpenAI 모델 추가 비교

| 지표 | 규칙 단독 | 규칙 + OpenAI | 변화 |
|---|---:|---:|---:|
| 전체 통과 | 780/1,000 | 785/1,000 | +5건 |
| 통과율 | 78.0% | 78.5% | +0.5%p |
| false positive 사례 | 38 | 62 | +24건, 악화 |
| false negative 사례 | 180 | 174 | -6건, 개선 |
| outcome mismatch | 168 | 148 | -20건 |
| detected type mismatch | 125 | 120 | -5건 |
| error | 0 | 0 | 변화 없음 |

OpenAI 모델은 일부 누락을 줄였지만 전체 false positive를 더 크게 늘렸다. 현재 결과만 보면 사용자가 받는 불필요한 마스킹 증가를 감수할 만큼의 순효과가 입증되지 않았다.

### 5.2 주요 유형별 변화

| 유형 | 규칙 단독 | 규칙 + OpenAI | 판단 |
|---|---|---|---|
| 이메일 | precision 1.0, recall 1.0 | 동일 | 이 corpus에서는 규칙만으로 이미 탐지 |
| 전화번호 | recall 0.7692 | recall 0.9231 | 6개 누락 중 4개 개선 |
| 주민등록번호 | recall 0.7143 | 동일 | OpenAI 모델의 accepted label 범위 밖 |
| 비공개 URL | precision 1.0, recall 0.1852 | precision 0.5676, recall 0.7778 | recall은 개선됐지만 false positive 16건 발생 |
| secret | recall 0.5161 | recall 0.7419 | 누락 7건 개선 |
| 이름 | precision 0.4839, recall 0.3409 | 동일 | 규칙 backstop 결과 |
| 조직명 | precision 1.0, recall 0.2917 | 동일 | 규칙 backstop 결과 |
| IP 주소 | recall 0.9091 | recall 0.2273 | 모델 비지원 유형인데 결과가 퇴행해 병합·정책 상호작용 감사 필요 |

IP 주소 퇴행의 원인을 모델 자체로 단정할 수는 없다. OpenAI 모델이 직접 IP label을 제공하지 않으므로 규칙 신호 제거, overlap 처리, contextual action 적용 순서를 케이스 단위로 추적해야 한다.

### 5.3 두 모델 축소 비교

30건은 이메일 8건, 전화번호 8건, 주민등록번호 8건과 일부 중복·대조 사례로 구성한 탐색용 subset이다. 전체 품질을 대표하지 않는다.

| 구성 | exact pass | false positive 사례 | false negative 사례 |
|---|---:|---:|---:|
| 규칙 단독 | 11/30 | 7 | 15 |
| 규칙 + OpenAI | 12/30 | 7 | 14 |
| 규칙 + OpenAI + KoELECTRA | 8/30 | 7 | 13 |

| 유형 | 규칙 TP | OpenAI 포함 TP | 두 모델 TP |
|---|---:|---:|---:|
| 이메일 | 8/8 | 8/8 | 8/8 |
| 전화번호 | 5/8 | 6/8 | 6/8 |
| 주민등록번호 | 3/8 | 3/8 | 3/8 |

KoELECTRA 추가 후 supported type의 true positive는 늘지 않았다. false negative 사례가 1건 줄어든 것은 이메일 결과가 실제 enforcement로 바뀐 영향이지만, 같은 이메일 하나를 여러 token detection으로 반환해 exact count는 실패했다.

### 5.4 KoELECTRA span 집계 결함

OpenAI 단독에서 탐지 개수가 1이었던 이메일 5건이 두 모델 실행에서는 다음처럼 증가했다.

| 사례 | 기대 개수 | OpenAI 단독 | 두 모델 |
|---|---:|---:|---:|
| 이메일 사례 1 | 1 | 1 | 4 |
| 이메일 사례 2 | 1 | 1 | 15 |
| 이메일 사례 3 | 1 | 1 | 16 |
| 이메일 사례 4 | 1 | 1 | 10 |
| 이메일 사례 5 | 1 | 1 | 2 |

이 중 OpenAI 단독에서 통과했던 4건이 KoELECTRA 추가 후 detected count mismatch로 실패했다. 현재 direct ONNX KoELECTRA classifier는 token별 BIO label을 그대로 detection으로 내보내며, OpenAI classifier에 존재하는 연속 span 병합 과정이 없다.

이 문제는 KoELECTRA checkpoint의 본질적 정확도 한계가 아니라 우선 수정해야 할 GateLM 어댑터 결함이다. 이 결함을 고치기 전에는 KoELECTRA 모델 품질을 최종 판정할 수 없다.

## 6. 지연시간과 메모리 결과

### 6.1 모델 개입 요청

평가 보고서에는 케이스별 model invocation flag가 없으므로 `latency > 10ms`인 케이스를 모델 개입 요청으로 추정했다. 따라서 아래 값은 탐색용이다.

| 구성 | 추정 모델 개입 케이스 | p50 | p95 | 최대 |
|---|---:|---:|---:|---:|
| 규칙 + OpenAI, 1,000건 평가 | 344 | 195ms | 301ms | 866ms |
| 규칙 + 두 모델, 30건 subset | 10 | 309ms | 414ms | 414ms |

두 번째 모델 추가는 이 subset에서 p50을 약 114ms 증가시켰지만 supported type true positive는 늘리지 못했다.

### 6.2 50건 전체 그룹 벤치마크

| 지표 | 결과 |
|---|---:|
| 전체 p50 | 0ms |
| 전체 p95 | 356ms |
| 영문 PII 그룹 최대 | 3,686ms |
| 혼합 경계 그룹 p95 | 356ms |
| timeout | 0/50, request timeout 5,000ms 기준 |
| Python benchmark process peak RSS | 1,465.31MiB |

전체 p50이 0ms인 이유는 모델이 빠르기 때문이 아니라 안전 문장과 규칙 충분 문장이 과반을 차지해 모델을 호출하지 않았기 때문이다. 모델 지연 목표는 반드시 model invocation이 관측된 전용 corpus로 별도 측정해야 한다.

### 6.3 시작 비용과 처리량

- 두 모델을 실제 로드한 최신 단일 smoke 관찰에서 startup warmup은 `29,136.56ms`였다.
- 같은 관찰의 RSS 증가는 `657.82MiB`였다.
- OS file cache가 이미 따뜻한 이후 벤치마크에서도 첫 PII 모델 활성 요청은 최대 `3,686ms`였다.
- KoELECTRA graph는 다중 padded batch에서 accepted detection 결과가 달라져 현재 `max_safe_batch_size=1`이다.
- 두 모델을 사용한 1,000건 순차 evaluator는 900초 안에 끝나지 않았다.

startup warmup과 RSS 값은 1회 관찰이며 repeated-cold p50/p95가 아니다. 900초 초과도 production 요청 1개의 지연과 동일하지 않지만, 현재 evaluator 처리량과 개발 반복 속도가 좋지 않다는 근거다.

## 7. 확인된 한계

### 7.1 모델 자체의 한계

- 두 모델 모두 공개 checkpoint를 그대로 사용하며 GateLM fine-tuning이 없다.
- OpenAI 모델 accepted label은 account number, email, phone, postal address, private date, private URL, secret으로 제한된다.
- KoELECTRA accepted label은 email, phone, resident registration number로 제한된다.
- 이름과 조직명 label은 두 모델 모두 현재 integration allowlist에 없다.
- 한국어 대화체, 띄어쓰기 오류, 축약, 완곡 표현, 문맥 의존 표현에 대한 별도 검증 근거가 없다.

### 7.2 GateLM 통합 구현의 한계

- KoELECTRA BIO token을 entity span으로 병합하지 않는다.
- 두 adapter 사이 중복 span과 동일 entity의 최종 detected count 규칙이 충분히 고정되지 않았다.
- 모델 비지원 유형인 IP 주소 결과가 퇴행해 rule/ML overlap 처리 감사를 해야 한다.
- KoELECTRA는 정확도 보존 때문에 내부 batch를 1로 제한한다.
- full evaluator가 완료 전에 종료되면 partial aggregate를 남기지 않아 긴 실행 결과가 모두 사라진다.
- case report에 adapter별 invocation과 contribution이 없어 latency만으로 모델 호출을 추정해야 한다.

### 7.3 평가 근거의 한계

- untouched holdout이 없다.
- span-level 정답이 없다.
- 모델 단독, 규칙 단독, adapter별 조합을 같은 실행 계약으로 자동 비교하는 보고서가 없다.
- false redaction이 사용자 문장 의미를 얼마나 훼손하는지 평가하지 않는다.
- 반복 cold, 동시 요청, sustained throughput, startup failure 자료가 없다.
- 실제 Tenant Chat private 경로의 enforce, Provider 억제, fallback, DB·Redis·로그 비저장 E2E evidence가 없다.

### 7.4 운영 한계

- CPU-only 환경에서 모델 활성 요청 p95가 이미 약 300~400ms다.
- cold load와 process memory가 크므로 Chat API/Gateway process에 모델을 직접 포함하기 어렵다.
- 750ms Gateway timeout은 목표 지연시간이 아니라 장애 시 fallback 경계다.
- 모델을 늘릴수록 정확도 기여보다 latency와 메모리가 먼저 증가할 수 있다.

## 8. 현재 권고 운영 자세

모델 사용 결정을 취소할 필요는 없지만, 현재는 다음처럼 제한해야 한다.

1. 규칙을 최소 guardrail과 빠른 1차 경로로 유지한다.
2. 모델은 규칙이 덮지 못한 후보에만 호출하는 현재 candidate gate를 유지한다.
3. KoELECTRA는 span 병합 수정과 ablation 통과 전까지 enforce 기여를 승인하지 않는다.
4. OpenAI 모델도 현재 합성 결과만으로 전체 tenant의 production 기본값이라고 선언하지 않는다.
5. 이름·조직명은 모델 탐지라고 표시하지 않고 규칙 결과로만 보고한다.
6. sidecar 장애와 timeout은 원문을 저장하지 않고 bounded reason code와 aggregate counter로만 관측한다.
7. 실제 고객 prompt를 모델 개선용 중앙 로그로 수집하지 않는다.

## 9. 발전 원칙

### 9.1 학습보다 먼저 연결 정확성을 고친다

현재 KoELECTRA 품질은 token 병합 결함의 영향을 받는다. 이 상태에서 fine-tuning하면 모델 문제와 adapter 문제를 구분할 수 없다. 순서는 반드시 아래와 같아야 한다.

```text
adapter correctness
-> 모델별 독립 ablation
-> threshold/overlap 정책
-> frozen holdout
-> latency 최적화
-> Tenant Chat E2E
-> 그 후에도 부족할 때 fine-tuning
```

### 9.2 원문 로그 없이 평가 데이터를 만든다

- synthetic template과 승인된 가상 값만 사용한다.
- 한국어 대화체, 오타, 띄어쓰기, 기호 삽입, hard negative를 별도 생성한다.
- 고객사가 원할 경우 고객사 환경 안에서만 별도 governed evaluation을 수행하고 중앙 수집을 기본값으로 두지 않는다.
- threshold 조정용 development set과 한 번만 여는 frozen holdout을 분리한다.
- report에는 aggregate와 case ID만 남기고 raw rendered prompt와 detected value를 남기지 않는다.

## 10. 오늘 하루 집중 구현 계획

가용 시간은 오늘 밤을 포함한 최대 20~24시간이며, 목표 작업량은 약 3인일로 본다. 다만 한 사람이 수행하므로 선행 작업이 끝나야 다음 작업을 할 수 있다. 따라서 기능을 넓히지 않고 **KoELECTRA 결함 수정, 모델 기여도 판정, 핵심 성능·E2E 근거 확보, 기존 배포 서비스 연결과 원복 검증**에만 집중한다.

오늘의 완료 목표는 production 승격이 아니라 아래 세 선택지 중 하나를 근거로 확정하는 것이다.

```text
1. rules-only 유지
2. rules + OpenAI만 유지
3. rules + OpenAI + 수정된 KoELECTRA 유지
```

### 10.1 오늘 반드시 구현할 범위

| 순서 | 경과 시간 | 작업 | 산출물 | 중단 기준 |
|---:|---:|---|---|---|
| 1 | 0~1시간 | 현재 실패 5건을 regression test로 먼저 고정 | KoELECTRA token fragmentation 재현 테스트 | 1시간 안에 재현되지 않으면 기존 report case로 fixture 고정 |
| 2 | 1~5시간 | KoELECTRA BIO/BIOES span 병합과 중복 제거 | 이메일·전화·주민번호 decoder와 unit test | 4시간 안에 안정화되지 않으면 KoELECTRA를 배포 설정에서 제외하고 다음 단계 진행 |
| 3 | 5~8시간 | IP 퇴행 최소 감사와 고정 subset 4-way ablation | rules/OpenAI/KoELECTRA/combined 비교표 | 원인 분석은 1시간, 두 모델 평가는 60분을 넘기지 않음 |
| 4 | 8~10시간 | 유형별 모델 유지·제외 결정과 threshold 1회 조정 | 오늘 배포할 모델 조합 확정 | 반복 threshold 탐색 금지 |
| 5 | 10~12시간 | model-active warm latency와 cold 3회 | p50/p95/max, peak RSS, startup 실패 aggregate | 정확도 결과가 달라지는 최적화는 폐기 |
| 6 | 12~15시간 | 관련 회귀와 배포 후보 이미지 구성 | 동일 candidate tag의 서비스 이미지와 배포 manifest | 코드 실패가 남으면 배포 금지 |
| 7 | 15~17시간 | DB backup, migration 호환성, 모델 번들 전달 경로 확인 | 이전 image tag·env snapshot·backup·bundle secret | rollback 재현이 안 되면 enforce 금지 |
| 8 | 17~19시간 | 배포 서비스에 candidate image와 sidecar를 shadow로 연결 | `pii-model-init`, AI Service ready, Gateway sidecar 연결 | health/readiness 실패 시 이전 tag로 원복 |
| 9 | 19~21시간 | deployed Tenant Chat synthetic E2E 후 enforce 전환 | mask-once, redact, block, fallback, Provider 억제 결과 | 하나라도 실패하면 sidecar disabled 또는 shadow 유지 |
| 10 | 21~23시간 | enforce 상태 aggregate 관측과 rollback drill | timeout/5xx/latency와 즉시 rules-only 원복 증거 | gate 초과 시 즉시 원복 |
| 11 | 23~24시간 | 보고서 갱신과 최종 커밋 정리 | 실제 배포 조합, 결과, 남은 위험 | 새 기능 추가 금지 |

### 10.2 오늘 평가할 고정 subset

새 300건 holdout을 오늘 만들지 않는다. 기존 1,000건 corpus에서 아래 조건으로 80~120건의 versioned screening subset을 고정한다.

- 이메일, 전화번호, 주민등록번호의 규칙 성공·규칙 누락 사례
- private URL과 secret의 OpenAI 개선·오탐 사례
- 이름·조직명과 IP 주소의 비지원 유형 퇴행 사례
- 한글과 영문을 모두 포함한다.
- PII가 아닌 유사 숫자·URL·이름 형태의 hard negative를 포함한다.
- selection case ID와 corpus checksum만 저장하고 rendered prompt는 보고서에 저장하지 않는다.

이 subset은 오늘 모델 선택을 위한 screening 자료이며 untouched holdout이나 production evidence로 부르지 않는다.

### 10.3 오늘의 KoELECTRA 유지 기준

아래 조건을 모두 만족할 때만 KoELECTRA를 hot path에 남긴다.

1. 현재 이메일 문제 5건의 detected count가 각각 `1`이 된다.
2. OpenAI 단독 통과 사례가 KoELECTRA 추가 때문에 실패하지 않는다.
3. 전화번호 또는 주민등록번호에서 OpenAI 단독보다 추가 true positive가 최소 1건 발생한다.
4. OpenAI 단독 대비 새 false positive와 비지원 유형 퇴행이 발생하지 않는다.
5. model-active warm p95 추가 비용이 50ms 이하다.

하나라도 실패하면 모델 파일을 삭제하지는 않지만, 추가 모델 환경설정에서 제외하거나 shadow 전용 후보로 내린다.

### 10.4 오늘의 OpenAI 모델 유지 기준

OpenAI 모델은 전체 label을 한꺼번에 승인하지 않고 detector type별로 판단한다.

- 전화번호와 secret처럼 false negative를 줄인 유형은 유지 후보로 둔다.
- 이메일처럼 규칙만으로 이미 충분한 유형은 실제 추가 기여가 있는지 확인한다.
- private URL처럼 recall과 false positive가 함께 증가한 유형은 threshold를 1회 조정한다.
- 조정 후에도 hard-negative false positive가 rules-only보다 증가하면 해당 label을 hot path에서 제외한다.
- 모델 비지원 유형의 규칙 결과를 약화시키면 병합 정책을 수정하기 전까지 enforce하지 않는다.

### 10.5 오늘 제안 성능 기준

최종 production threshold가 아니라 오늘 구현의 engineering 기준이다.

- preload 완료 전 `/readyz` 성공 금지
- 첫 사용자 요청에서 model load 금지
- model-active warm p95 `250ms 이하`를 목표로 하되 정확도를 바꾸지 않는다.
- process peak RSS `1GiB 이하`를 우선 목표로 측정한다.
- 750ms는 목표가 아니라 fallback 경계로 유지한다.
- timeout 또는 sidecar 장애 시 local P0 결과보다 안전성이 낮아지면 안 된다.

### 10.6 배포 전 필수 준비물

기존 배포 서비스에 연결하려면 구현 완료 외에 아래 값과 권한이 준비돼 있어야 한다.

1. 배포 서버 또는 배포 파이프라인 접근 권한
2. 현재 운영 image tag와 오늘 사용할 immutable candidate tag
3. 모든 app image를 올릴 container registry 경로
4. 현재 `.env`의 안전한 backup과 이전 tag 기록
5. PostgreSQL backup 실행·복구 권한
6. 모델 번들을 전달할 승인된 HTTPS object URL과 Compose secret 파일
7. synthetic 요청만 사용하는 배포 확인용 tenant/account
8. Gateway·AI Service health/readiness와 sanitized aggregate를 확인할 권한

모델 번들 URL은 `.env`, 명령행, 보고서, support log에 적지 않는다. `deploy/selfhost/secrets/pii-model-bundle-url` 같은 Compose secret 파일로만 전달한다.

### 10.7 같은 밤 배포 순서

```text
1. 현재 image tag, env, DB를 backup
2. 오늘 code revision으로 동일 candidate tag의 app image를 build/push
3. 모델 조합에 따라 AI Service primary/additional model env 확정
4. pii-model-init가 bundle과 manifest checksum을 검증
5. AI Service preload 완료와 /readyz 성공 확인
6. Gateway를 sidecar enabled + shadow로 시작
7. synthetic probe로 연결, 지연, error, 원문 비저장 확인
8. deployed Tenant Chat에서 redact/block/Provider 억제 확인
9. 모든 gate 통과 시 GATEWAY_AI_SAFETY_SIDECAR_MODE=enforce로 전환
10. synthetic probe를 다시 실행하고 aggregate를 관측
11. 문제 발생 시 sidecar disabled로 즉시 rules-only 원복
```

Self-host 환경에서 필요한 주요 설정은 다음과 같다. 실제 값과 secret은 문서에 기록하지 않는다.

```text
GATEWAY_AI_SAFETY_SIDECAR_ENABLED=true
GATEWAY_AI_SAFETY_SIDECAR_MODE=shadow -> 검증 후 enforce
GATEWAY_AI_SAFETY_SIDECAR_TIMEOUT_MS=750
AI_SERVICE_INSTALL_ML_DEPS=true
AI_SERVICE_AI_SAFETY_PRELOAD_ENABLED=true
AI_SERVICE_AI_SAFETY_DETECTOR_RUNTIME=onnx
AI_SERVICE_AI_SAFETY_DETECTOR_MODEL_ID=<pinned primary model path>
AI_SERVICE_AI_SAFETY_ADDITIONAL_DETECTOR_MODEL_IDS=<오늘 유지 결정된 경우만 설정>
```

### 10.8 배포 전환 gate

shadow에서 enforce로 넘어가려면 아래 조건을 모두 만족해야 한다.

- `pii-model-init` checksum 검증 성공
- AI Service `/readyz` 성공 후 첫 요청에 model load가 발생하지 않음
- Gateway health/readiness에서 sidecar 연결이 관측됨
- synthetic model-active 요청 20건에서 5xx와 timeout 0건
- synthetic model-active p95 500ms 이하이고 750ms 초과 0건
- 알려진 이메일·전화번호·주민등록번호 결과가 로컬 평가와 동일함
- redact 결과만 encrypted user content와 Provider prompt에 사용됨
- block 요청에서 Provider 호출 0건
- sidecar 장애 probe에서 local P0 fallback 성공
- DB, Redis, structured log, metric label 원문 노출 0건

이 gate는 production-grade 정확도 승격이 아니라 오늘 제한 배포의 최소 안전 조건이다.

### 10.9 즉시 rollback 순서

문제가 생기면 정확도 분석보다 먼저 요청 경로를 안전하게 되돌린다.

```text
1차: GATEWAY_AI_SAFETY_SIDECAR_ENABLED=false로 변경하고 Gateway 재시작
2차: 문제가 모델 결과에만 있으면 shadow로 내려 규칙 결과만 Provider에 적용
3차: code regression이면 GATELM_IMAGE_TAG를 이전 tag로 되돌리고 stack 재시작
4차: migration 문제면 배포 전 DB backup과 공식 restore 절차 사용
```

이번 migration은 기존 message에 기본 provenance를 추가하고 schema v1·v2를 함께 허용하는 additive 형태지만, 이전 image로 rollback 가능한지는 배포 전 smoke로 직접 확인한다. 추측만으로 DB rollback 가능을 선언하지 않는다.

## 11. 오늘 범위에서 제외할 작업

아래 항목은 오늘 시작하지 않는다. 하나라도 섞으면 핵심 결함 수정과 최종 모델 선택이 끝나지 않을 가능성이 높다.

- 새 모델 다운로드 또는 세 번째 모델 연결
- KoELECTRA 또는 OpenAI 모델 fine-tuning
- 300건 이상 새 frozen holdout 제작
- 고객 원문·로그 수집 기능
- 이름·조직명 ML detector 신규 구현
- Admin UI와 정책 편집 화면 확장
- production promotion owner policy 확정
- full concurrency/load test와 장시간 soak test
- KoELECTRA 다중 batch 최적화
- evaluator의 범용 리팩터링

production-grade 승격 근거는 오늘 완성하지 못하지만, 현재 배포 서비스에 제한적으로 연결하고 enforce/rollback을 검증하는 작업은 오늘 필수 범위다. 배포했다는 사실을 production-grade 품질 승인과 동일하게 표현하지 않는다.

## 12. 오늘 이후로 미루는 발전 계획

오늘 결과에서 모델 기여가 입증된 경우에만 다음 작업을 후속으로 남긴다.

### 12.1 품질 근거 보강

- development set과 분리된 최소 300건 frozen synthetic holdout
- 10개 PII 유형, `ko-KR`·`en-US`, span-level 정답
- confidence interval과 false-redaction 영향 평가
- 실제 고객 로그 없이 synthetic·승인 데이터만 사용

### 12.2 운영 근거 보강

- 독립 process repeated-cold 5회 이상
- model-active 동시 요청과 sustained throughput
- production-like Tenant Chat private 경로 E2E evidence
- artifact checksum, model revision, full Git revision binding

### 12.3 필요할 때만 모델 학습

오늘 adapter 수정 후에도 특정 유형의 recall이 부족하고 모델 추가가 규칙 확장보다 유리할 때만 학습한다.

- 한국어 전화번호·주민등록번호 변형은 KoELECTRA 재학습 후보로 둔다.
- 이름·조직명은 현재 label 범위 밖이므로 PER/ORG 모델을 별도로 검토한다.
- 학습, development, frozen holdout을 분리한다.
- 학습 후 ONNX export, QInt8, ablation, latency, memory, E2E를 다시 검증한다.

### 12.4 오늘 바로 수정할 파일

| 우선순위 | 작업 | 주요 대상 |
|---:|---|---|
| P0 | KoELECTRA BIO span aggregation | `apps/ai-service/app/adapters/safety/privacy_filter_adapter.py` |
| P0 | token fragmentation regression test | `apps/ai-service/app/tests/domain/safety/test_privacy_filter_adapter.py` |
| P0 | IP와 overlap 퇴행 test | `apps/ai-service/app/tests/services/test_ai_safety_detector_service.py` |
| P0 | adapter invocation·contribution aggregate | `apps/ai-service/app/services/ai_safety_master_eval_runner.py` |
| P1 | 고정 screening subset과 4-way 실행 | master corpus runner 및 별도 safe fixture |
| P1 | model-active latency corpus | latency benchmark fixture/runner |
| P1 | Tenant Chat 핵심 E2E | Gateway·Chat API·AI Service 통합 test harness |
| P0 | 선택 모델 조합을 지원하는 배포 smoke | `deploy/selfhost/scripts/pii-model-smoke.sh` |
| P0 | candidate image와 즉시 rollback 절차 | `deploy/selfhost/docker-compose.yml`, `.env`, upgrade runbook |

## 13. 최종 판단

현재 결과는 모델 연결을 포기해야 한다는 뜻이 아니다. 다만 공개 checkpoint를 연결한 것만으로 정확도가 확보된 것은 아니며, KoELECTRA는 어댑터 결함 때문에 아직 공정하게 평가되지도 않았다.

가장 빠른 발전 경로는 모델을 더 붙이는 것이 아니라 다음 세 가지다.

1. KoELECTRA span 병합을 고친다.
2. 규칙과 각 모델의 순수 기여도를 같은 holdout에서 분리한다.
3. 기여가 입증된 모델만 Tenant Chat hot path에 남긴다.

이 과정을 통과한 뒤에도 품질이 부족할 때만 fine-tuning을 시작한다. 그렇지 않으면 학습 비용과 운영 지연만 늘고, 실제 마스킹 품질은 개선되지 않을 가능성이 높다.

오늘 작업의 최종 완료 조건은 코드와 테스트가 끝나는 것이 아니다. 선택된 모델 조합이 기존 배포 서비스에 연결되고, synthetic enforce 검증이 통과하며, sidecar를 끄는 rules-only rollback까지 실제로 확인돼야 한다.
