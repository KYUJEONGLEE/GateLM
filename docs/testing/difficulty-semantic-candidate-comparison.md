# Difficulty Semantic Candidate Comparison

| Field | Value |
|---|---|
| Status | Single-request immutable artifact diagnostic; not runtime promotion |
| Dataset | `difficulty_training_2026_07_15_owner_approved_500_v2` |
| Split | Family-disjoint train 300 / calibration 100 / holdout 100 |
| Membership hash | `sha256:58cb615596e96d141a78c9c22124019d0fff18b930c47ab42180138ee10e2a3b` |
| Execution shape | `difficulty-e5-single-request-execution.2026-07-15.v1`, batch size `1` |
| Runtime changed | `false` |
| Evidence date | 2026-07-15 |

기존에 선택된 Candidate C 118D architecture는 유지했다. PCA fit, semantic-head training, final Logistic Regression training, calibration, diagnostic evaluation과 Gateway replay는 모두 요청 하나마다 tokenizer/QInt8 encoder를 한 번 호출한 결과만 사용한다. 여러 요청의 pooled embedding을 한 batch로 만들지 않으며 matrix가 필요한 단계는 single-request 결과를 사후 stack한다.

| Diagnostic path | Dimension | Calibrator | Accuracy | Complex → Simple |
|---|---:|---|---:|---:|
| Frozen C: `ruleVectorV1 + semanticProjection + semanticHeads` | 118 | Platt | 0.91 | 1 |
| Current rule baseline | 42 rule features | n/a | 0.86 | 10 |

이 100건은 과거 artifact 결과를 이미 확인한 Holdout이므로 새 v3 artifact에는 diagnostic replay일 뿐이다. `general` category의 `complex -> simple` 비악화 gate도 실패한다. 별도로 artifact 생성 후 준비한 score-independent promotion Holdout 100건은 [`difficulty-promotion-holdout-100-result.json`](difficulty-promotion-holdout-100-result.json)에 기록했으며 accuracy `0.70`으로 `>=0.91` gate를 실패했다. 같은 Holdout을 재튜닝에 사용하지 않는다.

Machine-readable artifact와 aggregate report는 `scripts/routing_difficulty_model/artifacts/candidates/`에 있다. Raw prompt, instruction text, token, embedding, assembled vector, semantic head probability와 sample별 calibrated score는 artifact 또는 report에 저장하지 않는다.

## Go Shadow-Preparation Bundle

Selected Candidate C는 `difficulty-offline.owner-approved-500.single-request.2026-07-15.42d-rule-vector-v1-plus-projection-plus-semantic-head-probabilities.v3`, `bundleHash=sha256:4209fbc2ea2a3a222bb8eae2b1003f8c358939c7f4a66ae2b2ef187972351220`, `contentHash=sha256:72eb5171c30b191716553cb24cdf25cf314c2a53c9085542619de2283f6d1bdd`를 pin한 checked-in Go data bundle로 생성된다. Bundle은 pooled synthetic `float32[384]`에서 PCA 64D, four-head 12D, final 118D Logistic Regression과 Platt score까지 Python canonical implementation과 numeric tolerance 및 label parity를 검증한다. 실제 prompt, embedding, vector 또는 head output fixture/report는 만들지 않는다.

Linux amd64 Gateway replay는 독립 process 3회에서 Python/Go label `100/100`, routing decision/modelRef 불변 `100/100`, 최대 `ComplexityScore` delta `1.71361551770666e-6`로 `1e-5` tolerance를 통과했다. `accuracy=0.91`, `complex -> simple=1`도 offline single-request aggregate와 같았고 bounded busy queue와 timeout 후 recovery를 포함한 failure isolation이 통과했다. 이 bundle은 opt-in shadow 준비물이며 product route는 계속 rule 결과를 사용한다. Diagnostic Holdout replay는 final promotion evidence로 재사용하지 않는다.
