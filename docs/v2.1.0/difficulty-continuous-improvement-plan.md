# GateLM Difficulty Model Data And Continuous Improvement Plan

| Field | Value |
|---|---|
| Status | Versioned operational planning proposal; not an active API/DB/Event/Metrics contract |
| Applies to | General Gateway difficulty classifier offline data, evaluation, retraining, and promotion lifecycle |
| Active runtime contract | [`../routing/contracts.md`](../routing/contracts.md) |
| Data and label contracts | [`difficulty-evaluation-dataset-contract.md`](difficulty-evaluation-dataset-contract.md), [`difficulty-label-guide.md`](difficulty-label-guide.md) |
| Last verified | 2026-07-20 |

## 1. 결론과 현재 한계

현재 난이도 모델 근거는 **운영 고객 데이터가 아니라 합성 데이터 기반의 offline 검증**이다.

- 500건 tooling smoke는 `trainingEligible=false`인 테스트 데이터다.
- 사람과 dataset owner가 승인한 500건, 2,000건, model-path 5,000건은 학습 입력 자격을 갖지만 출처는 여전히 `synthetic_fixture`, 동의 유형은 `synthetic`이다.
- model-path 5,000건으로 만든 42D B1은 3,000건 weight fit과 1,000건 calibration만 사용한 non-authoritative shadow baseline이다. Promotion holdout은 열지 않았고 production 분포에 대한 성능 근거가 아니다.
- Independent OOD Dataset 2의 5,000건은 현재 `pending`, `reviewerCount=0`, `trainingEligible=false`인 합성 review candidate다. Human approval 전에는 학습·모델 선택·성능 주장에 사용할 수 없다.

따라서 현재 결과는 파이프라인 재현성, label 계약, split 격리와 초기 후보 비교를 보여 주지만 실제 사용자 분포에서 계속 좋아진다는 증거는 아니다. 이 간극은 아래의 반복 가능한 데이터·학습 운영 루프로 닫는다.

여기서 지속 학습은 요청마다 production model의 weight를 자동 변경하는 online learning을 뜻하지 않는다. GateLM은 승인된 데이터 snapshot마다 offline에서 후보를 재학습하고, 동결된 평가와 shadow/canary gate를 통과한 immutable artifact만 사람이 승격하는 **gated batch learning**을 사용한다.

## 2. 반복 개선 루프

```text
안전한 후보 확보
-> 동의·출처·redaction 검증
-> 독립 라벨링과 adjudication
-> family/time 기준 dataset 동결
-> offline 재학습·calibration
-> 기존 모델과 blind 비교
-> request shadow와 제한적 canary
-> 승인 또는 즉시 rollback
-> drift·오류 분석 후 다음 후보 확보
```

달력 주기는 검토를 시작하는 신호일 뿐 자동 재학습이나 자동 배포 명령이 아니다. 초기 운영안은 매주 candidate queue와 label 품질을 점검하고, 매월 데이터 readiness와 drift를 검토하는 것이다. 실제 재학습은 새 approved family가 versioned minimum-family policy를 충족하고 개선 가설이 있을 때만 실행한다.

## 3. 백데이터 확보 전략

데이터는 위험도가 낮은 출처부터 단계적으로 넓힌다.

| 단계 | 확보 데이터 | 용도 | 현재 상태 |
|---|---|---|---|
| A. 합성·수동 seed | 현재 taxonomy의 반례, 긴 simple, 짧은 complex, 다국어, negation, payload contamination | 파이프라인과 취약 slice 보강 | 사용 중 |
| B. 사내 opt-in pilot | 직원이 학습 용도로 별도 제출하고 검토한 안전한 예시 | 합성 문체 편향 확인 | 미구현; 별도 동의·보안 절차 필요 |
| C. 고객 opt-in sample | tenant가 개선 목적을 명시적으로 허용한 요청에서 masking 경계 뒤 생성한 redacted sample | 실제 분포와 drift 확인 | 미구현; 계약·정책 승인 전 수집 금지 |
| D. 오류 중심 보강 | 구조화된 feedback, rule↔shadow disagreement와 slice aggregate로 식별한 취약 구간을 사람이 재현한 sample | hard case와 회귀 방지 | 일부 aggregate shadow만 존재; sample export는 미구현 |

운영 기본값은 항상 **수집 안 함**이다. 서비스 이용 동의를 모델 학습 동의로 해석하지 않는다. 고객 데이터 pilot은 tenant별 명시적 opt-in, 목적·범위·보존기간·철회 및 삭제 절차, 데이터 residency, reviewer 접근 권한을 별도 계약으로 승인한 뒤 시작한다.

운영 요청을 그대로 training DB나 log로 복사하지 않는다. 승인된 pilot에서도 raw prompt는 Gateway의 기존 masking 경계 밖으로 내보내거나 영구 저장하지 않고, 다음 gate를 모두 통과한 `redactedPrompt`만 격리된 offline candidate store에 기록한다.

1. 해당 tenant와 요청이 수집 대상 opt-in 범위인지 확인한다.
2. secret, credential, 개인정보와 조직 고유 식별자를 승인된 `redactionVersion`으로 제거한다.
3. redaction 실패, 민감 도메인 또는 삭제 추적 불가 sample은 폐기한다.
4. prompt 내용을 포함하지 않는 `sampleId`와 provenance만 부여한다.
5. candidate 단계에서는 `in_review` 또는 `pending`으로 유지하고 학습 입력과 분리한다.
6. 철회·삭제 요청은 candidate, approved dataset과 해당 sample을 사용한 artifact provenance까지 추적해 후속 배포에서 제외한다.

3~6번을 구현하려면 consent ledger, 격리 저장소, 삭제 전파와 접근 감사에 대한 Security/DB/API 계약이 먼저 필요하다. 이 문서는 그 필드를 임의로 정의하거나 현재 구현됐다고 주장하지 않는다.

### 3.1 대표성과 편향 제어

많이 들어온 데이터를 그대로 학습하면 대형 tenant, 한국어, 짧은 요청 또는 현재 모델이 이미 잘 맞히는 표본이 과대표집될 수 있다. Candidate selection은 다음 저빈도 bucket별로 수행한다.

- active 5 category × `simple | complex`
- 한국어·영어·mixed language
- 긴 simple·짧은 complex·negation·indirect expression·payload contamination
- rule↔shadow disagreement 방향
- 신규 prompt family와 최근 시간 구간

Tenant, 사용자 또는 동일 prompt family 하나가 batch를 지배하지 못하도록 source cap과 family deduplication을 적용한다. 정확한 cap과 최소 family 수는 dataset owner가 승인한 versioned minimum-family policy에 둔다. Metric label에는 tenant ID, prompt hash, prompt fragment나 error detail을 넣지 않는다.

## 4. 프롬프트 처리와 버전 관리

“프롬프트 관리”는 서로 다른 세 대상을 분리한다.

### 4.1 사용자 요청

- Runtime raw prompt는 요청 처리와 기존 masking에만 사용하며 training fixture, report, structured log, metric, cache key 또는 제품 diagnostics에 저장하지 않는다.
- Offline 학습 후보에는 승인된 `redactedPrompt`만 허용한다.
- Instruction과 인용문·문서 payload를 분리해 payload 안의 명령을 사용자 지시로 학습하지 않는다.
- 완전한 redaction으로 의미가 사라진 sample은 semantic 학습에서 fail closed하고 억지 label을 만들지 않는다.

### 4.2 합성 데이터 생성 프롬프트

합성 generator 또는 외부 모델을 사용한다면 generator prompt, generator model, decoding 설정, code version과 생성 일자를 dataset sidecar manifest에서 immutable provenance로 고정한다. 생성 프롬프트가 달라지면 같은 dataset version을 덮어쓰지 않고 새 candidate version을 만든다. 합성 데이터는 실제 데이터의 수량을 대신하지 않으며, 운영 slice에서 발견한 오류 가설을 재현하고 경계 사례를 늘리는 용도로 사용한다.

### 4.3 라벨링·평가 보조 프롬프트

LLM reviewer/judge는 후보 triage와 불일치 설명을 보조할 수 있지만 정답 승인자가 아니다. 보조 prompt와 모델 버전은 review artifact에 고정하고, 최종 `approved`는 독립 human review와 adjudication으로 결정한다. Prompt를 바꿔 얻은 label 개선을 model 개선과 섞어 보고하지 않는다.

현재 Gateway 난이도 runtime은 LLM system prompt를 호출해 분류하는 구조가 아니다. 따라서 runtime prompt engineering과 Logistic Regression 재학습을 같은 변경으로 취급하지 않는다. 향후 prompt-based classifier를 도입하려면 별도의 active contract와 latency·비용·보안 평가가 필요하다.

## 5. 라벨링과 품질 보증

새 운영 유래 candidate는 합성 데이터보다 엄격하게 처리한다.

1. Reviewer에게 tenant, 사용자와 provisional model prediction을 숨긴 blind record를 제공한다.
2. 두 명이 category, difficulty, 네 semantic bucket, instruction/payload 경계와 slice를 독립 판정한다.
3. 불일치는 제3 adjudicator가 해결하고 결정 근거를 민감 정보 없이 기록한다.
4. 낮은 confidence, redaction 의심 또는 taxonomy 밖 sample은 `needs_adjudication`이나 `rejected`로 남긴다.
5. Dataset owner가 minimum-family policy, provenance, consent, redaction과 reviewer coverage를 승인해야만 `trainingEligible=true`가 된다.

AI 검토 수량을 human reviewer 수로 계산하지 않는다. Category 또는 difficulty taxonomy가 바뀌면 기존 label을 자동 변환하지 않고 migration/relabel 후보로 분리한다.

## 6. 재학습과 평가 절차

각 반복은 아래 artifact를 새 version과 content hash로 동결한다.

- 포함 sample과 family 목록, provenance, consent와 redaction policy
- train, calibration, evaluation holdout, promotion holdout 역할
- feature/vectorizer, 학습 코드와 dependency version
- model·calibrator·threshold 후보와 선택 근거
- 합성 generator 및 AI-assisted review prompt provenance
- current production/shadow baseline과 비교 report

Split은 같은 prompt family가 여러 partition에 걸치지 않게 하고, 운영 데이터가 포함되면 최근 시간 구간을 별도의 out-of-time holdout으로 둔다. Train은 weight fit에만, calibration은 calibrator와 threshold 선택에만 쓴다. Evaluation holdout으로 후보를 비교한 뒤 선택을 끝내고, promotion holdout은 최종 승격 판단에 한 번만 연다. 열어 본 holdout은 다음 반복에서 promotion holdout으로 재사용하지 않는다.

후보는 전체 accuracy 하나로 승격하지 않는다. 최소한 다음을 current artifact와 비교한다.

- category × difficulty, language와 required slice별 accuracy
- 위험도가 높은 `complex -> simple` 오류 수와 비율
- calibration error, log loss와 Brier score
- out-of-time/OOD 성능과 family별 worst slice
- inference p50/p95/max, timeout·fallback과 resource budget
- rule↔candidate disagreement 및 기존 회귀 suite

Gate를 하나라도 통과하지 못하면 candidate는 evidence로 보존하되 승격하지 않는다. 모델 구조나 threshold를 여러 번 바꿔 promotion holdout에 맞추지 않는다.

## 7. 점진 배포와 rollback

승격 순서는 다음과 같다.

1. Offline replay에서 current artifact와 blind 비교한다.
2. 승인된 exact tenant/application allowlist에서 non-authoritative request shadow로 실행한다.
3. Prompt나 score를 노출하지 않는 aggregate comparison과 latency만 검토한다.
4. 별도 runtime owner와 Security 승인을 받은 뒤 제한된 canary에서 authority를 부여한다.
5. Error budget과 directional gate를 만족하는 동안에만 범위를 단계적으로 넓힌다.

각 단계는 immutable artifact version/hash를 가리키며, 문제가 생기면 직전 승인 artifact 또는 rule-based fallback으로 즉시 되돌린다. Runtime이 dataset을 읽거나 스스로 재학습하지 않으며, 배포 중 model file을 덮어쓰지 않는다. 현재 42D B1 shadow는 이 승격 절차를 통과하지 않았으므로 routing authority가 아니다.

## 8. Drift와 다음 학습 주기

지속 개선의 입력은 raw prompt 수집량이 아니라 안전한 aggregate와 승인된 feedback이다.

- category/difficulty 분포 변화
- rule↔shadow comparison 변화
- `unavailable | busy | timeout | inference_failed` 비율과 latency
- 승인된 structured feedback의 사유 bucket
- offline OOD/out-of-time slice 회귀

현재 active contract가 허용하는 제품 관측은 shadow aggregate metric 두 개뿐이다. Structured feedback, drift metric 또는 sample candidate export를 추가하려면 먼저 API/DB/Event/Metrics/Security contract proposal을 만들고 forbidden data와 label cardinality 검증을 통과해야 한다.

Drift 신호가 발생해도 자동 재학습하지 않는다. Data owner가 영향을 받은 slice를 확인하고, 안전한 candidate를 확보한 뒤 같은 label·split·evaluation·promotion 절차를 새 dataset version으로 다시 시작한다.

## 9. 책임과 승인

| 역할 | 책임 |
|---|---|
| Data owner | 수집 범위, minimum-family policy, dataset eligibility와 삭제 반영 승인 |
| Security/Privacy owner | opt-in 문구, redaction, 보존·철회·residency와 reviewer 접근 승인 |
| Model owner | 학습 재현성, 비교 실험, calibration과 artifact provenance 보증 |
| Runtime owner | Shadow/canary 범위, latency/error budget과 rollback 준비 확인 |
| Release approver | Promotion holdout 결과와 모든 선행 승인 확인 후 승격 결정 |

한 사람이 dataset 생성, 최종 label 승인, model 선택과 production 승격을 모두 단독 수행하지 않는다.

## 10. 구현 전 필수 결정

다음 항목은 아직 current 구현 계약으로 확정되지 않았다.

- tenant/customer opt-in과 철회 UX 및 법적 문구
- redaction 실패 판정과 금지 도메인
- candidate/approved dataset별 보존기간과 삭제 SLA
- consent ledger, 격리 offline store와 deletion lineage
- structured feedback taxonomy와 수집 surface
- drift metric 이름·label·alert threshold
- 재학습 minimum-family policy와 promotion safety gate 수치
- canary 범위, 중단 기준과 승인자

이 결정 없이 고객 프롬프트 수집 파이프라인부터 구현하지 않는다. 계약 승인 전까지는 합성·internal manual seed와 안전한 offline evidence만 사용한다.

## 11. 완료의 정의

지속 개선 체계가 준비됐다고 말하려면 다음 evidence가 모두 있어야 한다.

- 고객 데이터가 포함되는 경우 명시적 opt-in, redaction, retention, deletion과 access audit 계약
- 승인된 production-derived dataset manifest와 family/time-disjoint split
- 재현 가능한 training run과 immutable artifact provenance
- Current 대비 blind evaluation, untouched promotion holdout과 OOD/out-of-time 결과
- Shadow/canary 보고서와 rollback drill evidence
- Dataset/model/prompt version별 변경 이력과 책임자 승인

현재 저장소는 이 중 synthetic offline 기반과 일부 shadow 경로만 갖고 있다. 따라서 “지속 학습 체계가 운영 중”이라고 주장하지 않고, 이 문서를 그 체계를 만들기 위한 승인·구현 기준으로 사용한다.
