# Safety Eval Report

- Report Version: `safety-eval-report.v2`
- Generated At: `2026-06-30T04:50:17.686677Z`
- Mode: `gateway_safety_output_v2`

## Summary

| Metric | Value |
|---|---:|
| totalCases | 28 |
| passedCases | 28 |
| failedCases | 0 |
| passRate | 1.0 |
| falsePositiveCases | 0 |
| falseNegativeCases | 0 |
| actionMismatchCases | 0 |
| gatewayEffectMismatchCases | 0 |

## Semantic Cache Evidence

| Field | Value |
|---|---:|
| evidenceOnly | True |
| normalizedRedactedPromptOnly | True |
| candidateCount | 4 |
| wouldHaveMatchedCount | 1 |

## Detector Results

| Detector | TP | FP | FN | TN | Precision | Recall | Count Mismatch |
|---|---:|---:|---:|---:|---:|---:|---:|
| account_id | 1 | 0 | 0 | 27 | 1.0 | 1.0 | 0 |
| api_key | 1 | 0 | 0 | 27 | 1.0 | 1.0 | 0 |
| authorization_header | 1 | 0 | 0 | 27 | 1.0 | 1.0 | 0 |
| bank_account | 1 | 0 | 0 | 27 | 1.0 | 1.0 | 0 |
| cloud_access_key | 1 | 0 | 0 | 27 | 1.0 | 1.0 | 0 |
| credit_card | 1 | 0 | 0 | 27 | 1.0 | 1.0 | 0 |
| customer_id | 1 | 0 | 0 | 27 | 1.0 | 1.0 | 0 |
| database_url | 1 | 0 | 0 | 27 | 1.0 | 1.0 | 0 |
| date_of_birth | 1 | 0 | 0 | 27 | 1.0 | 1.0 | 0 |
| driver_license | 1 | 0 | 0 | 27 | 1.0 | 1.0 | 0 |
| email | 2 | 0 | 0 | 26 | 1.0 | 1.0 | 0 |
| employee_id | 1 | 0 | 0 | 27 | 1.0 | 1.0 | 0 |
| github_token | 1 | 0 | 0 | 27 | 1.0 | 1.0 | 0 |
| ip_address | 1 | 0 | 0 | 27 | 1.0 | 1.0 | 0 |
| jwt | 1 | 0 | 0 | 27 | 1.0 | 1.0 | 0 |
| passport_number | 1 | 0 | 0 | 27 | 1.0 | 1.0 | 0 |
| password_assignment | 1 | 0 | 0 | 27 | 1.0 | 1.0 | 0 |
| person_name | 1 | 0 | 0 | 27 | 1.0 | 1.0 | 0 |
| phone_number | 1 | 0 | 0 | 27 | 1.0 | 1.0 | 0 |
| postal_address | 1 | 0 | 0 | 27 | 1.0 | 1.0 | 0 |
| private_key | 1 | 0 | 0 | 27 | 1.0 | 1.0 | 0 |
| provider_api_key | 1 | 0 | 0 | 27 | 1.0 | 1.0 | 0 |
| resident_registration_number | 1 | 0 | 0 | 27 | 1.0 | 1.0 | 0 |
| session_cookie | 1 | 0 | 0 | 27 | 1.0 | 1.0 | 0 |
| slack_token | 1 | 0 | 0 | 27 | 1.0 | 1.0 | 0 |
| webhook_url | 1 | 0 | 0 | 27 | 1.0 | 1.0 | 0 |

## Action Confusion

| Expected | Actual | Count |
|---|---|---:|
| blocked | blocked | 17 |
| none | none | 1 |
| redacted | redacted | 10 |

## Failed Cases

| Case ID | Expected | Actual | Missing Types | Extra Types | Reasons |
|---|---|---|---|---|---|
| _none_ |  |  |  |  |  |
