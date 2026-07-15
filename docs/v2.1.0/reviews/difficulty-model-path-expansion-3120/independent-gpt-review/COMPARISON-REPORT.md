# Independent GPT review comparison

- Status: validated_pending_owner_adjudication
- Records/families: 3120/624
- Decisions: accept 1354, revise_prompt 1766
- Prompt changes: 1766
- Tracked packet-alias normalizations (fenced_block -> code_fence): 322
- Records with one or more candidate-label conflicts: 2472
- Owner adjudication queue: 2525
- Prompt-only high-confidence batch-approval queue: 308
- Proposed schema failures: 0
- Security pattern hits: 0
- Candidate and owner-approval files remain unchanged and pending.

## Batch summary

| batch | rows | accept | revise prompt | prompt changes | label conflicts | owner queue | schema failures |
|---|---:|---:|---:|---:|---:|---:|---:|
| T1 | 400 | 179 | 221 | 221 | 319 | 325 | 0 |
| T2 | 400 | 182 | 218 | 218 | 338 | 345 | 0 |
| T3 | 400 | 180 | 220 | 220 | 305 | 306 | 0 |
| T4 | 395 | 171 | 224 | 224 | 313 | 319 | 0 |
| C1 | 275 | 110 | 165 | 165 | 211 | 222 | 0 |
| C2 | 250 | 115 | 135 | 135 | 203 | 205 | 0 |
| E1 | 375 | 149 | 226 | 226 | 303 | 307 | 0 |
| E2 | 375 | 156 | 219 | 219 | 290 | 300 | 0 |
| P1 | 250 | 112 | 138 | 138 | 190 | 196 | 0 |

## Files

- `raw/`: exact GPT outputs and the GPT-provided validation summary
- `normalized/`: normalized review rows
- `normalization-audit.jsonl`: lossless audit of packet aliases converted to active contract values
- `diff/`: record-level candidate versus independent-review diff
- `proposed/`: unapproved analysis candidates and minimal Go-audit manifests
- `owner-adjudication-queue.jsonl`: records requiring explicit owner judgment
- `prompt-revision-batch-approval-queue.jsonl`: high-confidence prompt-only revisions eligible for one batch decision after Go/duplicate gates
