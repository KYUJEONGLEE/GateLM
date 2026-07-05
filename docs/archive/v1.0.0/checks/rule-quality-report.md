# GateLM v1 규칙 품질 보고서

## 1. 요약

이 보고서는 v1 Gateway의 rule-based safety baseline이 데모와 리뷰 범위에서 충분한 이유를 설명한다.

근거는 PR 2 Safety Eval Runner 출력이다.


| 항목     | 값                                               |
| ------ | ----------------------------------------------- |
| 기본 근거  | `reports/safety-eval/safety-eval-report.json`   |
| 보조 근거  | `reports/safety-eval/safety-eval-report.md`     |
| 보고서 버전 | `safety-eval-report.v1`                         |
| 생성 시각  | `2026-06-27T07:15:03.743582Z`                   |
| 평가 모드  | `detector_output`                               |
| 픽스처    | `v1-safety-eval-detector-output-pass`           |
| 픽스처 버전 | `2026-06-27.v1`                                 |
| 코퍼스    | `docs/archive/v1.0.0/fixtures/safety-eval-corpus.jsonl` |


## 2. 문서 계약 근거

이 보고서는 v1 문서 세트를 근거로 한다.


| 문서                                    | 이 보고서에서 사용하는 근거                                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/archive/v1.0.0/contracts.md`            | v1 safety는 rule-based redaction/block을 사용한다. Safety Lab은 corpus와 evaluation 근거를 담당한다. Gateway는 hot path 실행과 governance metadata를 담당한다. |
| `docs/archive/v1.0.0/implementation-plan.md`  | Python/FastAPI Safety Lab은 선택적 shadow/evaluation path다. v1 smoke는 Python service 의존 없이 통과해야 한다.                                        |
| `docs/architecture/gateway-flow.md`   | 민감정보 탐지와 정책 평가는 routing, cache, provider call보다 먼저 수행된다. Block된 요청은 provider call 전에 멈춘다.                                              |
| `docs/policies/pii-masking-policy.md` | Provider 호출 후에만 redaction하는 방식은 금지된다. Raw sensitive value는 저장하지 않는다. Detector action과 safety checklist가 이 문서에 정의되어 있다.                 |
| `docs/architecture/llm-log-schema.md` | Log와 detail view는 raw prompt, response, credential, detected value가 아니라 redacted/hash/metadata 형태를 저장한다.                               |
| `docs/architecture/api-spec.md`       | Masking metadata는 안전한 summary field로 노출되고, masking analytics는 aggregate 중심으로 제한된다.                                                     |


이 보고서가 주장하는 가장 강한 safety claim은 v1 rule set의 demo-baseline 품질이다. 모든 가능한 민감정보 포맷에 대한 전체 DLP coverage나 production-grade detection을 주장하지 않는다.

## 3. Eval 결과 스냅샷


| 지표                          | 값   |
| --------------------------- | --- |
| 전체 케이스                      | 9   |
| 통과 케이스                      | 9   |
| 실패 케이스                      | 0   |
| 통과율                         | 1.0 |
| 오탐 케이스                      | 0   |
| 미탐 케이스                      | 0   |
| Action mismatch 케이스         | 0   |
| Gateway effect mismatch 케이스 | 0   |


Action confusion 요약:


| 기대 action  | 실제 action  | 개수  |
| ---------- | ---------- | --- |
| `none`     | `none`     | 1   |
| `redacted` | `redacted` | 3   |
| `blocked`  | `blocked`  | 5   |


현재 근거 모드는 `detector_output`이므로 detector/action 품질은 runner 출력으로 직접 확인된다. Gateway effect는 v1 계약과 corpus expectation을 기준으로 해석한다. `gateway_safety_output` 보고서가 생성되면 provider/cache bypass 관련 claim은 계약 기반 기대값에서 runtime evidence로 승격할 수 있다.

## 4. Detector type별 품질 요약


| Detector type                  | 기대 action  | 포함 케이스 | 통과 케이스 | Detector 통과율 | Precision | Recall | FP  | FN  | Count mismatch |
| ------------------------------ | ---------- | ------ | ------ | ------------ | --------- | ------ | --- | --- | -------------- |
| `email`                        | `redacted` | 2      | 2      | 1.0          | 1.0       | 1.0    | 0   | 0   | 0              |
| `phone_number`                 | `redacted` | 1      | 1      | 1.0          | 1.0       | 1.0    | 0   | 0   | 0              |
| `resident_registration_number` | `blocked`  | 1      | 1      | 1.0          | 1.0       | 1.0    | 0   | 0   | 0              |
| `api_key`                      | `blocked`  | 1      | 1      | 1.0          | 1.0       | 1.0    | 0   | 0   | 0              |
| `authorization_header`         | `blocked`  | 1      | 1      | 1.0          | 1.0       | 1.0    | 0   | 0   | 0              |
| `jwt`                          | `blocked`  | 1      | 1      | 1.0          | 1.0       | 1.0    | 0   | 0   | 0              |
| `private_key`                  | `blocked`  | 1      | 1      | 1.0          | 1.0       | 1.0    | 0   | 0   | 0              |


포함 케이스는 해당 detector가 expected 또는 actual detected types에 등장한 case 기준으로 계산했다. 이 통과율 요약은 리뷰 가독성을 위한 문서화일 뿐이며, PR 3는 자동 지표 계산기를 추가하지 않는다.

## 5. Block/Redact 기대 동작

`redacted` 동작:

- `email`과 `phone_number`는 redacted prompt representation을 사용해 요청을 계속 진행하는 것이 기대 동작이다.
- Downstream cache/provider stage는 raw sensitive value를 받으면 안 된다.
- 더 엄격한 detector가 함께 존재하지 않으면 요청은 정상 success semantics로 완료될 수 있다.

`blocked` 동작:

- `resident_registration_number`, `api_key`, `authorization_header`, `jwt`, `private_key`는 cache lookup과 provider call 전에 멈추는 것이 기대 동작이다.
- 기대 terminal result는 `blocked`다.
- 기대 HTTP status는 `403`이다.
- 기대 error code는 `sensitive_data_blocked`다.
- 기대 provider call result는 `providerCalled=false`다.
- 기대 cache lookup result는 `cacheLookup=false`다.

이는 v1 safety 계약과 일치한다. 낮은 위험도의 연락처 데이터는 데모 안전성이 확보된 provider request를 위해 redaction 후 진행할 수 있고, credential 및 고위험 identity material은 Gateway 밖으로 나가기 전에 block된다.

## 6. v1 Safety Checklist


| 체크 항목                                                                | 보고서 상태                        | 근거                                                         |
| -------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------- |
| Masking이 cache/provider보다 먼저 실행됨                                     | 계약상 충족                        | `contracts.md`, `gateway-flow.md`, `pii-masking-policy.md` |
| Block이 provider call 전에 멈춤                                           | 계약 및 corpus expectation 기준 충족 | `contracts.md`, PR 2 expected gateway effects              |
| Block이 cache lookup을 건너뜀                                             | 계약 및 corpus expectation 기준 충족 | `contracts.md`, PR 2 expected gateway effects              |
| Redact가 redacted representation만 downstream으로 보냄                     | 계약상 충족                        | `pii-masking-policy.md`, `gateway-flow.md`                 |
| Cache key가 raw prompt 기반이 아님                                         | 계약상 충족                        | `contracts.md`, `gateway-flow.md`                          |
| Report에 raw prompt, raw response, raw secret, raw detected value가 없음 | 필수이며 검증됨                      | PR 2 security scan 및 PR 3 document review                  |
| Blocked request는 시스템 장애가 아니라 정책 적용 결과임                               | 계약상 충족                        | `pii-masking-policy.md`, `contracts.md`                    |


## 7. known limitation

- 이 보고서는 v1 demo baseline만 다룬다.
- 근거는 합성 text-only safety corpus를 기반으로 한다.
- 현재 참조한 report mode는 detector output이며, 실제 Gateway 실행 기록이 아니다.
- 전체 DLP coverage는 v1 범위 밖이다.
- OCR, file upload scanning, image/audio input, RAG corpus scanning, provider response re-identification protection은 범위 밖이다.
- Corpus는 모든 국가별 식별자 format, 모든 credential format, 모든 오탐 edge case를 포괄한다고 주장하지 않는다.
- Provider/cache bypass가 실제 runtime에서 발생했다는 증명은 향후 `gateway_safety_output` report 또는 Gateway integration evidence에서 확인해야 한다.

향후 PR 2 결과에 실패 케이스, 미탐, 오탐, action mismatch가 포함되면 이 보고서는 이를 명확히 적고 quality claim을 낮춰야 한다.

## 8. Raw Sensitive Value 처리 규칙

이 보고서에 포함할 수 있는 것:

- Case ID.
- Detector type.
- 기대 action과 실제 action.
- 통과/실패 결과.
- 집계 지표.
- Report metadata.
- Documentation path.

이 보고서에 포함하면 안 되는 것:

- Source prompt template 또는 전체 prompt.
- Fixture 또는 eval case에서 복사한 redacted preview text.
- Raw response.
- Raw secret, credential, token, authorization value.
- Raw detected sensitive value.
- Sample hash value.
- Full fixture result body.

근거가 필요하면 case payload를 복사하지 말고 PR 2 report path를 연결한 뒤 안전한 집계 field만 요약한다.

## 9. 리뷰 Q&A

Q: 이 문서가 live Gateway block-before-provider behavior를 증명하는가?

A: report mode가 `detector_output`인 동안에는 이 문서만으로 직접 증명하지 않는다. 이 문서는 detector/action 품질을 보여주고, gateway effect는 v1 contract와 corpus expectation을 근거로 설명한다. `gateway_safety_output` report가 있으면 직접적인 runtime evidence를 제공할 수 있다.

Q: 향후 report에서 detector가 실패하면 어떻게 되는가?

A: 실패 케이스 수, mismatch reason, 영향을 받은 detector, limitation을 문서화해야 한다. 실패가 해결되거나 명시적으로 accepted되기 전까지 이 report는 safety rule이 충분하다고 주장하면 안 된다.

## 10. 검증 메모

이 문서의 verification checklist:


| 확인 항목                          | 기대 결과                                                             |
| ------------------------------ | ----------------------------------------------------------------- |
| PR 2 report 존재                 | `reports/safety-eval/safety-eval-report.json` exists              |
| Report summary와 이 문서 일치        | 전체 9개, 통과 9개, 실패 0개                                               |
| Detector 행과 PR 2 output 일치     | Precision/recall은 1.0이고 FP/FN/count mismatch는 0                   |
| Runner/parser/comparison 변경 없음 | PR 3에는 코드 변경 없음                                                   |
| API/DB/Event 변경 없음             | PR 3에는 contract shape 변경 없음                                       |
| 금지된 민감 literal 스캔              | 새 문서가 기존 PR 2 scanner를 통과                                         |
| 수동 raw-value review            | Raw prompt, raw response, raw secret, raw detected value를 복사하지 않음 |


권장 local check:

```text
# Repository root에서:
python scripts/dev/v1-safety-eval-corpus-smoke.py

# apps/ai-service에서:
python -m app.services.safety_eval_runner --mode detector-output --corpus ../../docs/archive/v1.0.0/fixtures/safety-eval-corpus.jsonl --fixture app/tests/fixtures/safety_eval/detector-output.fixture.json --out ../../reports/safety-eval
```

Merge 전에는 기존 forbidden-value scanner를 이 문서에 실행한다. 실패하면 scanner를 약화하지 말고 unsafe field 또는 literal을 제거한다.