# Difficulty Threshold-Only v4 Evaluation

| Field | Value |
|---|---|
| Status | Offline candidate failed the promotion Holdout gate; not runtime-promoted |
| Evaluated on | 2026-07-15 |
| Execution shape | Runtime-equivalent single request |
| Product routing | Unchanged rule result |

## Calibration-only feasibility

The already consumed promotion Holdout was not used for threshold selection. The v3 artifact was evaluated only on its existing 100-record, 20-family calibration partition with family-grouped out-of-fold calibrated probabilities and a fixed `0.00..1.00` grid in `0.01` increments.

The reference `0.45` operating point produced accuracy `0.93` and `complex -> simple=4`. The safety-constrained calibration operating point was `0.06`, with accuracy `0.95`, `complex -> simple=0`, `simple -> complex=5`, and category directional non-regression. The aggregate evidence is [`difficulty-v3-calibration-threshold-feasibility.json`](difficulty-v3-calibration-threshold-feasibility.json).

Because threshold-only feasibility passed on calibration, a v4 offline candidate was derived without changing the 118 weights, bias, Platt calibrator, PCA, semantic heads, or their component hashes. Only the artifact and bundle identity plus `difficulty-threshold-v2 = 0.06` changed. The derivation evidence is [`difficulty-v4-threshold-selection-evidence.json`](difficulty-v4-threshold-selection-evidence.json).

## Untouched Holdout result

Before reading any candidate score, [`../v2.1.0/evaluation/difficulty-promotion-holdout-100.v2.json`](../v2.1.0/evaluation/difficulty-promotion-holdout-100.v2.json) froze 10 whole families and 100 records. It excludes all 10 families consumed by the v1 promotion Holdout, has no overlap with the previous owner-approved 500 dataset, and contains 10 simple plus 10 complex records per category.

The first and only v4 evaluation produced:

| Metric | v4 | Frozen gate |
|---|---:|---:|
| Accuracy | `0.56` | `>= 0.91` — failed |
| Complex to simple | `0` | `<= 1` — passed |
| Simple to complex | `44` | Observed diagnostic |
| Category complex-to-simple non-regression | Passed | Must pass |
| Rule baseline accuracy | `0.78` | Comparison only |

The aggregate result is [`difficulty-promotion-holdout-100-v4-result.json`](difficulty-promotion-holdout-100-v4-result.json). It contains no raw prompt, embedding, vector, model parameter, or individual score.

## Decision

The v4 candidate is a failed offline artifact and is not eligible for Go bundle generation, Python/Go parity, Gateway routing-invariance replay, opt-in live shadow, or product routing. The v3 limited-development guardrail approval remains immutable historical evidence, but it is inapplicable after the Gateway decision boundary changed; [`difficulty-live-shadow-boundary-supersession.json`](difficulty-live-shadow-boundary-supersession.json) requires shadow to remain disabled before encoder creation. It never extends to v4.

The v2 Holdout is now consumed and must not be used to adjust the threshold, calibrator, model weights, PCA, semantic heads, sampling, or subsets. The calibration/Holdout divergence shows that the selected calibration operating point did not generalize. A future candidate must use independent train and family-disjoint calibration data, strengthen hard-simple coverage while preserving short-complex recall, select candidates with grouped nested validation, jointly validate calibration and threshold behavior, and freeze another outcome-untouched whole-family Holdout before evaluation.
