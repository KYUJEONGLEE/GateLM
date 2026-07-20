# Dataset 2 Policy Finalization Report

최신 owner 규칙은 provisional과 Reviewer A의 difficulty가 같으면 해당 difficulty를 field-level로 확정한다. 이 규칙은 이전 structured-summary 113건의 `complex` group-policy 결정을 supersede하며 두 입력의 일치값인 `simple`로 되돌린다.

## Coverage

- 전체 record: 5,000
- Difficulty consensus confirmation: 3861
- Difficulty conflict adjudication: 1139
- Non-core queue adjudication: 3314
- 11-field exact-agreement full audit: 367
- Reviewer A unnatural-language flags retained as labelable OOD surface: 517
- Rejected records: 0

## Exact-agreement audit

- 그대로 확인: 201
- 제3 pass에서 non-difficulty field 수정: 166

## Final label changes against the original candidate

- 변경된 record: 4136
- 변경된 field 수: 10823
- Difficulty 변경: 761
- Task/constraint/scope/dependency 변경: 8432
- Boundary 변경: 0
- Evaluation slice 변경: 1630
- 최종 difficulty: simple 2257, complex 2743

## Integrity

- Families: 1,000; family당 5 records
- Split: train 3,000 / validation 1,000 / test 1,000
- Cross-split family overlap: 0
- Exact duplicate prompt: 0
- Normalized duplicate prompt: 0
- Dataset 1 exact/normalized/family overlap: 0
- Existing four-gram near-duplicate gates: pass
- Schema/category-semantic/boundary/slice consistency: pass
- Original candidate prompt content changed: no
- Original candidate file changed: no

## Status

별도 policy-finalized artifact에 최종 label을 반영했고, 2026-07-20 dataset owner의 명시적 전체 승인에 따라 모든 record를 `human_review + approved + reviewerCount=1`로 승격했다. `trainingEligible=true`는 training input eligibility만 승인한다. Train 3,000건만 model fit에 사용하고, validation 1,000건은 model selection/calibration, test 1,000건은 evaluation 전용으로 유지한다.
