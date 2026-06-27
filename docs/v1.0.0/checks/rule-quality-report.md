# GateLM v1 Rule Quality Report

## 1. Executive Summary

This report explains why the v1 Gateway rule-based safety baseline is sufficient for the demo and review scope.

The evidence source is the PR 2 Safety Eval Runner output:

| Item | Value |
|---|---|
| Primary evidence | `reports/safety-eval/safety-eval-report.json` |
| Supporting evidence | `reports/safety-eval/safety-eval-report.md` |
| Report version | `safety-eval-report.v1` |
| Generated at | `2026-06-27T07:15:03.743582Z` |
| Eval mode | `detector_output` |
| Fixture | `v1-safety-eval-detector-output-pass` |
| Fixture version | `2026-06-27.v1` |
| Corpus | `docs/v1.0.0/fixtures/safety-eval-corpus.jsonl` |

Current result: 9 of 9 cases passed. There are no failed cases, false positives, false negatives, action mismatches, or gateway effect mismatches in the referenced PR 2 report.

This document does not introduce a new evaluator, parser, API, DB table, event field, or runtime policy. It only turns the PR 2 result into a review-ready explanation.

## 2. PR 2 / PR 3 Responsibility Boundary

| Area | PR 2 Safety Eval Runner | PR 3 Rule Quality Report |
|---|---|---|
| Corpus parsing | Owns | Does not implement |
| Actual result fixture parsing | Owns | Does not implement |
| Expected versus actual comparison | Owns | Does not implement |
| Detector metric calculation | Owns | Reads the reported metrics |
| JSON and Markdown eval output | Owns | References the output |
| Forbidden sensitive literal scan | Owns | Reuses as a verification step |
| Human-facing quality narrative | Produces machine-oriented report | Owns |
| API / DB / Event changes | None | None |

PR 3 must stay a documentation PR. If the eval shape, comparison logic, detector coverage, or fixture format needs to change, that belongs to PR 2 or a follow-up eval-runner PR, not this report.

## 3. Contract Evidence From Docs

The report is grounded in the v1 documentation set:

| Source | Evidence used in this report |
|---|---|
| `docs/v1.0.0/contracts.md` | v1 safety uses rule-based redaction/block. Safety Lab owns corpus and evaluation evidence. Gateway owns hot-path execution and governance metadata. |
| `docs/v1.0.0/implementation-plan.md` | Python/FastAPI Safety Lab is optional, shadow, and evaluation path. v1 smoke must pass without depending on the Python service. |
| `docs/architecture/gateway-flow.md` | Sensitive detection and policy evaluation happen before routing, cache, and provider call. Blocked requests stop before provider call. |
| `docs/policies/pii-masking-policy.md` | Provider-call-before-redaction is prohibited. Raw sensitive values must not be stored. Detector actions and the safety checklist are defined here. |
| `docs/architecture/llm-log-schema.md` | Logs and detail views store redacted/hash/metadata forms, not raw prompt, response, credential, or detected values. |
| `docs/architecture/api-spec.md` | Masking metadata is exposed as safe summary fields, and masking analytics remain aggregate-only. |

The strongest safety claim this report makes is demo-baseline quality for the v1 rule set. It does not claim full DLP coverage or production-grade detection for every possible sensitive data format.

## 4. Eval Result Snapshot

| Metric | Value |
|---|---:|
| Total cases | 9 |
| Passed cases | 9 |
| Failed cases | 0 |
| Pass rate | 1.0 |
| False positive cases | 0 |
| False negative cases | 0 |
| Action mismatch cases | 0 |
| Gateway effect mismatch cases | 0 |

Action confusion summary:

| Expected action | Actual action | Count |
|---|---|---:|
| `none` | `none` | 1 |
| `redacted` | `redacted` | 3 |
| `blocked` | `blocked` | 5 |

Because the current evidence mode is `detector_output`, the detector/action quality is directly evidenced by the runner output. Gateway effects are interpreted from the v1 contract and corpus expectations. When a `gateway_safety_output` report is produced, the provider/cache bypass claims can be promoted from contract-backed expectation to runtime evidence.

## 5. Detector Type Quality Summary

| Detector type | Expected action | Covered cases | Passed cases | Detector pass rate | Precision | Recall | FP | FN | Count mismatch |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `email` | `redacted` | 2 | 2 | 1.0 | 1.0 | 1.0 | 0 | 0 | 0 |
| `phone_number` | `redacted` | 1 | 1 | 1.0 | 1.0 | 1.0 | 0 | 0 | 0 |
| `resident_registration_number` | `blocked` | 1 | 1 | 1.0 | 1.0 | 1.0 | 0 | 0 | 0 |
| `api_key` | `blocked` | 1 | 1 | 1.0 | 1.0 | 1.0 | 0 | 0 | 0 |
| `authorization_header` | `blocked` | 1 | 1 | 1.0 | 1.0 | 1.0 | 0 | 0 | 0 |
| `jwt` | `blocked` | 1 | 1 | 1.0 | 1.0 | 1.0 | 0 | 0 | 0 |
| `private_key` | `blocked` | 1 | 1 | 1.0 | 1.0 | 1.0 | 0 | 0 | 0 |

Covered cases are counted from cases where the detector appears in expected or actual detected types. The pass-rate summary is documented here for review readability only; PR 3 does not add an automated metric calculator.

## 6. Expected Block/Redact Behavior

`redacted` behavior:

- `email` and `phone_number` are expected to continue the request using a redacted prompt representation.
- Downstream cache/provider stages must not receive the raw sensitive value.
- The request can complete with normal success semantics when no stricter detector is present.

`blocked` behavior:

- `resident_registration_number`, `api_key`, `authorization_header`, `jwt`, and `private_key` are expected to stop before cache lookup and provider call.
- Expected terminal result is `blocked`.
- Expected HTTP status is `403`.
- Expected error code is `sensitive_data_blocked`.
- Expected provider call result is `providerCalled=false`.
- Expected cache lookup result is `cacheLookup=false`.

This matches the v1 safety contract: low-risk contact data can be redacted for a demo-safe provider request, while credential and high-risk identity material is blocked before leaving the Gateway.

## 7. v1 Safety Checklist

| Checklist item | Report status | Evidence basis |
|---|---|---|
| Masking happens before cache/provider | Satisfied by contract | `contracts.md`, `gateway-flow.md`, `pii-masking-policy.md` |
| Block stops before provider call | Satisfied by contract and corpus expectation | `contracts.md`, PR 2 expected gateway effects |
| Block skips cache lookup | Satisfied by contract and corpus expectation | `contracts.md`, PR 2 expected gateway effects |
| Redact sends only redacted representation downstream | Satisfied by contract | `pii-masking-policy.md`, `gateway-flow.md` |
| Cache key is not based on raw prompt | Satisfied by contract | `contracts.md`, `gateway-flow.md` |
| Report contains no raw prompt, raw response, raw secret, or raw detected value | Required and verified | PR 2 security scan plus PR 3 document review |
| Blocked requests are policy outcomes, not system failures | Satisfied by contract | `pii-masking-policy.md`, `contracts.md` |

## 8. Known Limitations

- This report covers the v1 demo baseline only.
- The evidence is based on a synthetic, text-only safety corpus.
- The current referenced report mode is detector output, not a live Gateway execution transcript.
- Full DLP coverage is out of scope for v1.
- OCR, file upload scanning, image/audio input, RAG corpus scanning, and provider response re-identification protection are out of scope.
- The corpus does not claim coverage for every national identifier format, every credential format, or every false-positive edge case.
- Runtime proof that provider/cache bypass happened should be taken from a future `gateway_safety_output` report or Gateway integration evidence.

If any PR 2 result later includes failed cases, false negatives, false positives, or action mismatches, this report must state that plainly and lower the quality claim.

## 9. Raw Sensitive Value Handling Rules

This report may include:

- Case IDs.
- Detector types.
- Expected and actual actions.
- Pass/fail outcomes.
- Aggregate metrics.
- Report metadata.
- Documentation paths.

This report must not include:

- Source prompt templates or full prompts.
- Redacted preview text copied from fixtures or eval cases.
- Raw responses.
- Raw secrets, credentials, tokens, or authorization values.
- Raw detected sensitive values.
- Sample hash values.
- Full fixture result bodies.

When evidence is needed, link to the PR 2 report path and summarize safe aggregate fields instead of copying case payloads.

## 10. Review Q&A

Q: Is this duplicating PR 2?

A: No. PR 2 executes and calculates the evaluation. PR 3 explains the already-produced result for reviewers.

Q: Does this prove live Gateway block-before-provider behavior?

A: Not by itself while the report mode is `detector_output`. It shows detector/action quality and uses the v1 contract plus corpus expectations for gateway effects. A `gateway_safety_output` report can provide direct runtime evidence later.

Q: Why are no sample prompts or values shown?

A: The v1 contract and PII policy prohibit storing or copying raw sensitive values in reports and documents. Reviewers should use IDs, detector types, actions, and aggregate metrics.

Q: What happens if a detector fails in a future report?

A: The failed case count, mismatch reason, affected detector, and limitation must be documented. The report must not claim the safety rule is sufficient until the failure is resolved or explicitly accepted.

Q: Does PR 3 change API, DB, or Event contracts?

A: No. PR 3 is documentation-only and does not alter runtime behavior or contracts.

## 11. Verification Notes

Verification checklist for this document:

| Check | Expected result |
|---|---|
| PR 2 report exists | `reports/safety-eval/safety-eval-report.json` is present |
| Report summary matches this document | 9 total, 9 passed, 0 failed |
| Detector rows match PR 2 output | Precision/recall are 1.0 and FP/FN/count mismatch are 0 |
| No runner/parser/comparison changes | No code changes in PR 3 |
| No API/DB/Event changes | No contract shape changes in PR 3 |
| Forbidden sensitive literal scan | New document passes existing PR 2 scanner |
| Manual raw-value review | No raw prompt, raw response, raw secret, or raw detected value copied |

Recommended local checks:

```text
# From the repository root:
python scripts/dev/v1-safety-eval-corpus-smoke.py

# From apps/ai-service:
python -m app.services.safety_eval_runner --mode detector-output --corpus ../../docs/v1.0.0/fixtures/safety-eval-corpus.jsonl --fixture app/tests/fixtures/safety_eval/detector-output.fixture.json --out ../../reports/safety-eval
```

Run the existing forbidden-value scanner against this document before merging. If it fails, remove the unsafe field or literal instead of weakening the scanner.
