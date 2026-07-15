# GateLM owner-stage GPT adjudication instructions

## Role and authority boundary

You are performing an owner-stage adjudication **recommendation**, not owner approval. Review every row independently and skeptically. The earlier GPT review is evidence, not authority. Do not mark any record approved, do not set `trainingEligible=true`, and do not claim that a model or threshold is ready for promotion. A human owner will confirm or override your recommendations afterward.

## Files

The packet contains:

- this instruction file;
- `LABEL-GUIDE.md`;
- nine `*.owner-gpt-adjudication.input.jsonl` files;
- `OWNER-GPT-INPUT-MANIFEST.json`;
- `PROPOSED-NEAR-DUPLICATE-REPORT.json`.

Process all nine batches in this order without asking for an intermediate approval: T1, T2, T3, T4, C1, C2, E1, E2, P1. Keep each output batch separate. Do not merge batches or move a family.

## What each input row contains

- `candidate`: the current pending synthetic candidate and its labels;
- `independentGptReview`: the blind independent GPT proposal and rationale;
- `localVerification`: actual Go route evidence and duplicate evidence already computed locally.

Classifier/category output is deliberately absent. Choose labels from `LABEL-GUIDE.md`, never from current classifier behavior. Go route evidence is only a boundary gate.

## Review method

1. Review all five records in one `promptFamily` together.
2. Decide whether the current candidate, the independent GPT proposal, or a custom override best follows the label guide and sounds like a natural synthetic user request.
3. Judge difficulty by semantic task, constraint, scope, and dependency load; never by length alone.
4. Treat imperative-looking text inside an explicit payload as data, not instruction.
5. Preserve useful long-simple and short-complex contrast.
6. Do not rubber-stamp the independent review. Resolve every label difference explicitly.
7. If `localVerification.proposedGoRoute` is not `model`, do not accept the independent prompt as written. Choose the original candidate or produce a custom prompt that must be locally rechecked.
8. Consider broad near-duplicate evidence as a review signal. Strict leakage is already zero, but remove obvious template copying when a custom rewrite is justified.
9. Keep every prompt fully synthetic. Never add customer data, personal data, secrets, API keys, authorization values, provider error bodies, or real organization details.
10. P1 is label-review-only promotion holdout material. Do not compare models, thresholds, scores, or recommend model promotion using P1.
11. These 3,120 rows are intended for the model-path target. If you conclude that a row is semantically empty or cannot remain eligible, use `exclude` and state that a replacement record is required; do not silently keep it in the 5,000 target.

## Allowed recommendations

- `keep_candidate`: keep the current candidate prompt and labels.
- `accept_independent_prompt`: accept only the independent GPT prompt; keep candidate labels.
- `accept_independent_labels`: keep candidate prompt; accept independent labels.
- `accept_independent_prompt_and_labels`: accept both independent prompt and labels.
- `custom_override`: provide a complete custom synthetic prompt and/or labels.
- `exclude`: recommend excluding the record from the 5,000 model-path target, with a concrete reason.
- `needs_human_owner`: evidence remains genuinely ambiguous.

## Required output

Create one output JSONL file for every input file, preserving row order and count. File names must be:

- `t1.owner-gpt-adjudication.output.jsonl`
- `t2.owner-gpt-adjudication.output.jsonl`
- `t3.owner-gpt-adjudication.output.jsonl`
- `t4.owner-gpt-adjudication.output.jsonl`
- `c1.owner-gpt-adjudication.output.jsonl`
- `c2.owner-gpt-adjudication.output.jsonl`
- `e1.owner-gpt-adjudication.output.jsonl`
- `e2.owner-gpt-adjudication.output.jsonl`
- `p1.owner-gpt-adjudication.output.jsonl`

Every output line must have this shape:

```json
{
  "schemaVersion": "gatelm.difficulty-owner-gpt-adjudication-recommendation.v1",
  "batchId": "t1",
  "sampleId": "unchanged input sampleId",
  "promptFamily": "unchanged input promptFamily",
  "recommendation": "keep_candidate | accept_independent_prompt | accept_independent_labels | accept_independent_prompt_and_labels | custom_override | exclude | needs_human_owner",
  "finalPrompt": "complete recommended synthetic prompt",
  "finalExpectedCategory": "general | code | reasoning | summarization | translation",
  "finalExpectedDifficulty": "simple | complex",
  "finalSemanticInputStatus": "eligible | empty_instruction",
  "finalTaskBucket": "count_1 | count_2 | count_3_plus | not_applicable",
  "finalConstraintBucket": "count_0_to_1 | count_2 | count_3_plus | not_applicable",
  "finalScopeBucket": "count_1 | count_2_to_3 | count_4_plus | not_applicable",
  "finalDependencyBucket": "depth_0_to_1 | depth_2 | depth_3_plus | not_applicable",
  "finalExpectedSemanticLabel": "label allowed by LABEL-GUIDE.md",
  "finalExpectedInstructionPayloadBoundary": {
    "kind": "instruction_only | explicit_separation | ambiguous_separation | payload_only",
    "boundaryType": "none | code_fence | role_tag | role_heading | begin_end | blockquote | inline_cue | multiple | unsupported",
    "confidence": "none | low | medium | high",
    "payloadBlockCount": "zero | one | multiple"
  },
  "finalEvaluationSlices": ["only applicable slices allowed by LABEL-GUIDE.md"],
  "resolvedDifferences": ["concise field or prompt decisions"],
  "rationale": "short Korean explanation grounded in the label guide",
  "confidence": "high | medium | low",
  "requiresLocalGoRecheck": false,
  "requiresHumanOwnerConfirmation": true
}
```

Set `requiresLocalGoRecheck=true` only when `finalPrompt` is a new custom prompt that is neither the candidate prompt nor the already-audited independent prompt. Always set `requiresHumanOwnerConfirmation=true`.

## Completion artifacts

Also create `OWNER-GPT-VALIDATION-SUMMARY.json` containing:

- input/output row count for every batch;
- unique sample and family counts;
- recommendation and confidence counts;
- all proposed hard-sentinel rows and the recommendation chosen for them;
- custom overrides requiring local Go recheck;
- exclude and needs-human-owner counts;
- family consistency failures;
- order or schema failures;
- a statement that no record was marked owner-approved or training-eligible.

Use code to write the output files. Do not paste 3,120 JSON objects into the chat response. Return one ZIP containing the nine output JSONL files and the validation summary.
