# Safety Eval Report

- Report Version: `safety-eval-report.v1`
- Generated At: `2026-06-27T07:15:03.743582Z`
- Mode: `detector_output`

## Summary

| Metric | Value |
|---|---:|
| totalCases | 9 |
| passedCases | 9 |
| failedCases | 0 |
| passRate | 1.0 |
| falsePositiveCases | 0 |
| falseNegativeCases | 0 |
| actionMismatchCases | 0 |
| gatewayEffectMismatchCases | 0 |

## Detector Results

| Detector | TP | FP | FN | TN | Precision | Recall | Count Mismatch |
|---|---:|---:|---:|---:|---:|---:|---:|
| api_key | 1 | 0 | 0 | 8 | 1.0 | 1.0 | 0 |
| authorization_header | 1 | 0 | 0 | 8 | 1.0 | 1.0 | 0 |
| email | 2 | 0 | 0 | 7 | 1.0 | 1.0 | 0 |
| jwt | 1 | 0 | 0 | 8 | 1.0 | 1.0 | 0 |
| phone_number | 1 | 0 | 0 | 8 | 1.0 | 1.0 | 0 |
| private_key | 1 | 0 | 0 | 8 | 1.0 | 1.0 | 0 |
| resident_registration_number | 1 | 0 | 0 | 8 | 1.0 | 1.0 | 0 |

## Action Confusion

| Expected | Actual | Count |
|---|---|---:|
| blocked | blocked | 5 |
| none | none | 1 |
| redacted | redacted | 3 |

## Failed Cases

| Case ID | Expected | Actual | Missing Types | Extra Types | Reasons |
|---|---|---|---|---|---|
| _none_ |  |  |  |  |  |
