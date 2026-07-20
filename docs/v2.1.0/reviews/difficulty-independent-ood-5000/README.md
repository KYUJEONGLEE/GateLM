# Difficulty Independent OOD 5,000 Blind Review

| Field | Value |
|---|---|
| Status | Candidate labels pending human review |
| Dataset | `difficulty_independent_ood_5000_2026_07_18_candidate_v1` |
| Training eligible | `false` |
| Model evaluation allowed | No |

[`difficulty-independent-ood-5000.v1.blind-review.jsonl`](difficulty-independent-ood-5000.v1.blind-review.jsonl)은 두 reviewer가 독립적으로 사용하는 유일한 prompt 입력이다. 이 파일에는 provisional category, difficulty, bucket, semantic label, prompt family와 dataset split이 없다.

## Review Order

1. Reviewer A와 Reviewer B가 서로의 결과와 candidate label을 보지 않고 5,000건을 각각 판정한다.
2. 각 reviewer는 `sampleId`별 category, difficulty, 네 semantic bucket, semantic label, instruction/payload boundary와 confidence만 제출한다.
3. 두 결과가 모두 일치한 record만 approval candidate로 보낸다.
4. 불일치, 낮은 confidence, category confusion과 boundary ambiguity는 `needs_adjudication` queue로 보낸다.
5. Owner가 최종 승인한 새 파생 artifact만 평가에 사용할 수 있다. 현재 candidate 파일은 덮어쓰지 않는다.

## Leakage Guard

- Reviewer에게 `evaluation/difficulty-independent-ood-5000.v1.candidate.jsonl`, manifest, split assignment 또는 model output을 제공하지 않는다.
- Human approval 전에 Gateway/model을 실행하거나 provisional label 기준 accuracy를 계산하지 않는다.
- Human approval 이후 train 3,000건은 weight fit, validation 1,000건은 model·calibrator·threshold 선택에만 사용한다.
- Test 1,000건은 모든 선택과 artifact freeze가 끝난 뒤 final gate에 한 번만 사용한다.
- Test 결과를 보고 artifact를 다시 수정하면 test는 소비된 것이므로 새 untouched dataset이 필요하다.

## Verification

5,000건을 ChatGPT에 직접 전달하려면 [`chatgpt-review-kit/README.md`](chatgpt-review-kit/README.md)의 100건×50-batch blind package를 사용한다. GPT 결과는 automated supporting evidence이며 human review status나 training eligibility를 단독으로 변경하지 않는다.

Reviewer A의 5,000건 output은 2026-07-20에 [`chatgpt-review-kit/results/reviewer-a/COMPARISON-REPORT.md`](chatgpt-review-kit/results/reviewer-a/COMPARISON-REPORT.md)로 import했다. 형식 검증은 통과했지만 exact 11-field agreement는 367건이며, 이 일치 결과를 accuracy나 owner approval로 해석하지 않는다. Core label conflict 1,353건/527 family를 먼저 owner adjudication한다.

```powershell
corepack pnpm run verify:v2.1-difficulty-independent-ood-5000
corepack pnpm run verify:v2.1-difficulty-independent-ood-5000-gpt-review
corepack pnpm run verify:v2.1-difficulty-independent-ood-5000-gpt-review-import
```
