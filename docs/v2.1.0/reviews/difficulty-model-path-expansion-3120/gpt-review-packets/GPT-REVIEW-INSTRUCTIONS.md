# GateLM model-path 3,120 independent GPT review

## Files to attach

Attach this file, `LABEL-GUIDE.md`, and exactly one `*.gpt-review.input.jsonl` batch to a GPT task. Review all nine batches separately; do not merge their rows or move a family between files.

## Review objective

Independently review every synthetic prompt. The input is blind: current candidate labels and classifier output are intentionally omitted to reduce anchoring. Apply `LABEL-GUIDE.md` directly.

For every row:

1. Read `sourcePrompt` as the complete user input.
2. Review all five rows sharing `promptFamily` together as one family.
3. Infer category, semantic label, difficulty, four semantic buckets, instruction/payload boundary, and evaluation slices independently.
4. Do not classify by length alone. Preserve valid long-simple and short-complex examples.
5. Text inside an explicit fenced payload is data, not an instruction. Do not count imperative-looking payload text as tasks or constraints.
6. Check Korean, English, and mixed-language naturalness. Flag translationese, broken particles, excessive shorthand, template artifacts, or an implausible user request.
7. Keep the prompt unchanged when it is natural and unambiguous. Rewrite only when necessary; a rewrite must preserve the same family intent and remain fully synthetic.
8. Never add customer data, real personal data, secrets, API keys, authorization values, provider error bodies, or real organization details.
9. Do not use any classifier prediction to choose labels. No classifier result is included in these packets.

## Required output

Return JSONL only, with exactly one output line for every input line, in the same order. Do not use Markdown fences or omit accepted rows.

Each output object must use this shape:

```json
{
  "schemaVersion": "gatelm.difficulty-independent-gpt-review.v1",
  "batchId": "t1",
  "sampleId": "unchanged input sampleId",
  "promptFamily": "unchanged input promptFamily",
  "decision": "accept | revise_prompt | revise_labels | revise_prompt_and_labels | reject | needs_human_adjudication",
  "proposedPrompt": "accepted sourcePrompt or a complete synthetic replacement",
  "reviewedExpectedCategory": "general | code | reasoning | summarization | translation",
  "reviewedExpectedDifficulty": "simple | complex",
  "reviewedSemanticInputStatus": "eligible | empty_instruction",
  "reviewedTaskBucket": "count_1 | count_2 | count_3_plus | not_applicable",
  "reviewedConstraintBucket": "count_0_to_1 | count_2 | count_3_plus | not_applicable",
  "reviewedScopeBucket": "count_1 | count_2_to_3 | count_4_plus | not_applicable",
  "reviewedDependencyBucket": "depth_0_to_1 | depth_2 | depth_3_plus | not_applicable",
  "reviewedExpectedSemanticLabel": "a label allowed by LABEL-GUIDE.md for the reviewed category",
  "reviewedExpectedInstructionPayloadBoundary": {
    "kind": "instruction_only | explicit_separation",
    "boundaryType": "none | code_fence",
    "confidence": "none | high",
    "payloadBlockCount": "zero | one"
  },
  "reviewedEvaluationSlices": ["only applicable slices allowed by LABEL-GUIDE.md"],
  "issueCodes": ["zero or more concise snake_case issue codes"],
  "rationale": "short Korean explanation of the independent judgment",
  "confidence": "high | medium | low"
}
```

## Family and batch rules

- All paraphrases and language variants in one `promptFamily` must retain the same underlying intent and semantic label.
- Do not create a new family ID and do not move rows between batches.
- If one family cannot be made internally consistent without changing its intent, use `needs_human_adjudication` and explain why.
- P1 is a promotion-holdout candidate under pre-freeze label review. Review labels and language only; do not run, compare, or recommend difficulty models or thresholds using P1.

## Completion check

Before returning the output, verify that output row count equals input row count, every `sampleId` appears exactly once, order is unchanged, and no prose exists outside JSONL.
