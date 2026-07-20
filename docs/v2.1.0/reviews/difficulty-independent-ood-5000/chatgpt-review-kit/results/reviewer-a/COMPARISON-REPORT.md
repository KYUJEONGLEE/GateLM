# Dataset 2 Reviewer A Comparison Report

| Field | Value |
|---|---:|
| Validated GPT records | 5000 |
| Exact 11-field agreement | 367 |
| Exact agreement + high confidence + no issue | 333 |
| Record adjudication queue | 4667 |
| Family-context queue | 1000 |
| Confidence below 0.90 | 517 |
| Core-label conflict records | 1353 |
| Core-label conflict families | 527 |

Agreement는 provisional synthetic label과 Reviewer A 판정의 일치율이며 accuracy나 human approval이 아니다. GPT 결과는 automated supporting evidence이고 Dataset 2는 계속 pending, training-ineligible 상태다.

## Review priority

| Priority | Records |
|---|---:|
| `priority_1_core_label_conflict` | 1353 |
| `priority_2_low_confidence_or_quality` | 354 |
| `priority_3_structure_conflict` | 2564 |
| `priority_4_slice_only_conflict` | 396 |

## Queue reasons

| Reason | Records |
|---|---:|
| `gpt_issue_code` | 517 |
| `low_confidence` | 517 |
| `provisional_label_mismatch` | 4633 |

## Field mismatches

| Field | Records |
|---|---:|
| `expectedCategory` | 253 |
| `expectedDifficulty` | 1139 |
| `semanticInputStatus` | 0 |
| `taskBucket` | 913 |
| `constraintBucket` | 1518 |
| `scopeBucket` | 3190 |
| `dependencyBucket` | 2480 |
| `expectedSemanticLabel` | 261 |
| `expectedInstructionPayloadBoundary` | 1042 |
| `evaluationSlices` | 3067 |

Owner는 record queue를 먼저 보고, category/semantic label처럼 family 일관성이 필요한 변경은 family-context queue에서 같은 family의 5개 변형을 함께 확인해야 한다.
