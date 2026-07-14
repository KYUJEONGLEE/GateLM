# Difficulty Semantic Candidate Comparison

| Field | Value |
|---|---|
| Status | Offline selection evidence; not runtime promotion |
| Dataset | `difficulty_training_2026_07_15_owner_approved_500_v2` |
| Split | Family-disjoint train 300 / calibration 100 / holdout 100 |
| Membership hash | `sha256:58cb615596e96d141a78c9c22124019d0fff18b930c47ab42180138ee10e2a3b` |
| Runtime changed | `false` |
| Evidence date | 2026-07-15 |

세 후보는 동일한 sample order, label, family partition과 `modelPath`를 사용한다. PCA는 train 300건의 raw pooled E5 384D에만 fit하고, semantic heads는 그 PCA와 L2를 통과한 canonical 64D representation으로 train 300건에서만 fit한다. 후보별 Logistic Regression은 train 300건, 후보별 calibrator는 calibration 100건으로 독립 fit했다. Holdout 100건은 세 조합의 selection evidence에만 사용했다.

| Candidate | Dimension | Calibrator | Holdout accuracy | Complex → Simple |
|---|---:|---|---:|---:|
| A: `ruleVectorV1` | 42 | Platt | 0.70 | 9 |
| B: `ruleVectorV1 + semanticProjection` | 106 | Platt | 0.90 | 1 |
| C: `ruleVectorV1 + semanticProjection + semanticHeads` | 118 | Platt | 0.92 | 1 |

Current rule-based holdout accuracy는 `0.86`이다. 이 결과는 Candidate C의 runtime 승격 결정을 뜻하지 않는다. 이 holdout으로 조합을 선택하면 해당 100건은 selection에 사용된 것이므로 final promotion gate에는 새로운 untouched holdout이 필요하다.

Machine-readable artifact와 aggregate report는 `scripts/routing_difficulty_model/artifacts/candidates/`에 있다. Raw prompt, instruction text, token, embedding, assembled vector, semantic head probability와 sample별 calibrated score는 artifact 또는 report에 저장하지 않는다.
