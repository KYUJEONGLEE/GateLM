# Difficulty model-path expansion 3,120 — owner review

All nine batches remain separate. This packet presents them together for one owner decision; it does not concatenate the candidate files.

- Candidate state: pending owner review
- Training eligible: false
- Total: 3,120 records / 624 new families
- Actual Go route: 3,120 modelPath, 0 hard sentinel, 0 simple sentinel
- Exact duplicates / existing family collisions / split leakage: 0 / 0 / 0
- Strict cross-partition or existing-source near duplicates: 0
- Broad near-duplicate candidates for owner sampling: 305
- Category classifier disagreements: 1133; these are error-analysis evidence and never changed expected labels

## All batches

| batch | role | records | families | Go modelPath | classifier disagreement | broad near-dup | review files |
|---|---|---:|---:|---:|---:|---:|---|
| T1 | train | 400 | 80 | 400 | 130 | 76 | [candidate](./t1/t1.candidate.jsonl) · [report](./t1/t1.owner-review.md) · [decision](./t1/t1.owner-approval.json) |
| T2 | train | 400 | 80 | 400 | 141 | 74 | [candidate](./t2/t2.candidate.jsonl) · [report](./t2/t2.owner-review.md) · [decision](./t2/t2.owner-approval.json) |
| T3 | train | 400 | 80 | 400 | 144 | 87 | [candidate](./t3/t3.candidate.jsonl) · [report](./t3/t3.owner-review.md) · [decision](./t3/t3.owner-approval.json) |
| T4 | train | 395 | 79 | 395 | 141 | 78 | [candidate](./t4/t4.candidate.jsonl) · [report](./t4/t4.owner-review.md) · [decision](./t4/t4.owner-approval.json) |
| C1 | calibration | 275 | 55 | 275 | 122 | 31 | [candidate](./c1/c1.candidate.jsonl) · [report](./c1/c1.owner-review.md) · [decision](./c1/c1.owner-approval.json) |
| C2 | calibration | 250 | 50 | 250 | 102 | 39 | [candidate](./c2/c2.candidate.jsonl) · [report](./c2/c2.owner-review.md) · [decision](./c2/c2.owner-approval.json) |
| E1 | evaluation | 375 | 75 | 375 | 125 | 53 | [candidate](./e1/e1.candidate.jsonl) · [report](./e1/e1.owner-review.md) · [decision](./e1/e1.owner-approval.json) |
| E2 | evaluation | 375 | 75 | 375 | 144 | 69 | [candidate](./e2/e2.candidate.jsonl) · [report](./e2/e2.owner-review.md) · [decision](./e2/e2.owner-approval.json) |
| P1 | promotion | 250 | 50 | 250 | 84 | 42 | [candidate](./p1/p1.candidate.jsonl) · [report](./p1/p1.owner-review.md) · [decision](./p1/p1.owner-approval.json) |

Supporting aggregate files: [generation index](./generation-index.json), [verification summary](./verification-summary.json), [near-duplicate report](./near-duplicate-report.json), [review summary](./review-summary.json).

## Promotion holdout caution

P1 is a separate 250-record promotion candidate. Review its labels before model/threshold selection, then freeze the approved candidate hash and do not inspect model results on P1 until the final promotion decision. Use the [blind index](./p1/p1.blind-index.json) for identity/hash checks. Opening P1 later to choose a model would contaminate it as promotion evidence.

## One-time owner decision

Reply with approval for all nine batches, or list exceptions as `batch / sampleId / proposed decision / reason`. Approval will be recorded separately, adjudications and label-change history will be preserved, and approved datasets will be materialized without modifying these candidate files.
