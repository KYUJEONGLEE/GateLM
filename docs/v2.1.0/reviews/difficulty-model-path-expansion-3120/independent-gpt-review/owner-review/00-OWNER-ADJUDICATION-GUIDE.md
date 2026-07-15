# Owner adjudication guide for the independent GPT review

No candidate, approval, or training file has been changed. Every record remains pending and training-ineligible.

## Verified import

- Review outputs: 3,120 records / 624 families / 9 batches
- GPT prompt decisions: accept 1,354; revise prompt 1,766
- Confidence: high 2,600; medium 520
- Packet alias normalization: 322 `fenced_block` values were losslessly mapped to the contract value `code_fence`; raw files are unchanged and the mapping is audited.
- Category conflicts: 0; semantic-label conflicts: 0; semantic-input-status conflicts: 0
- Difficulty conflicts: 81 (simple -> complex 74; complex -> simple 7)
- Records with any core-label conflict: 847
- Slice-only conflicts: 1625

## Proposed-prompt gates

- Actual Go model path: 3117/3120
- Hard sentinel blockers: 3
- Exact duplicates / family collisions: 0/0
- Strict cross-partition or existing-data near duplicates: 0
- Broad near-duplicate candidates for reporting: 450
- Security pattern hits: 0

## Recommended review order

1. Resolve all 3 Go route blockers. Do not accept those prompt revisions as written.
2. Adjudicate all 81 difficulty changes independently using the label guide.
3. Review 773 records with non-difficulty core bucket changes; overlaps with step 2 are intentional.
4. Decide whether to batch-accept the 1625 slice-only changes after checking slice policy.
5. Human-sample and then decide the 308 high-confidence prompt-only revisions as a batch.
6. Review all 520 medium-confidence records individually or family-first.

Use `family-review-summary.jsonl` to work family-first. Record-level queues deliberately overlap when one record needs more than one decision. Fill `OWNER-DECISION-TEMPLATE.json` only after review; approval is not inferred from the GPT output.
