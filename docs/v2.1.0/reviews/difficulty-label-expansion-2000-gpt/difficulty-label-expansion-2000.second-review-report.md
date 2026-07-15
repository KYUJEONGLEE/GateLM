# Difficulty expansion 2,000 — second GPT review merge

## 결론

- 16개 output은 1,067개 direct-review input과 순서·sampleId가 정확히 일치한다.
- 누락, 중복, 예상 밖 ID, JSON 오류와 output contract 위반은 모두 0건이다.
- 817건은 candidate 유지, 250건은 prompt 교정, reject와 label 교정은 0건이다.
- 250개 교정은 1차 candidate 위에 적용했지만 사람 승인으로 간주하지 않는다.
- 원본 fixture와 기존 owner-approved 500건은 수정하지 않았고, 2차 candidate는 계속 `pending`, `trainingEligible=false`다.

## 결과

| 항목 | 건수 |
|---|---:|
| 입력·출력 | 1067 |
| approve_candidate | 817 |
| correct_candidate | 250 |
| reject_candidate | 0 |
| prompt 교정 | 250 |
| label 교정 | 0 |
| canonical v2 검증 실패 | 0 |
| 교정 후 length slice 불일치 | 0 |
| family 충돌 | 0 |

## Prompt 교정 분포

| Category | 건수 |
|---|---:|
| code | 49 |
| general | 44 |
| reasoning | 50 |
| summarization | 50 |
| translation | 57 |

- v07: 50건
- v08: 100건
- v10: 100건
- 공통 사유: instruction이 요구한 합성 payload B 또는 C/D 누락 보완

## 승인 경계

- `difficulty-label-expansion-2000.second-review-merged-candidate.jsonl`: 250개 prompt 교정을 적용한 2,000건 pending candidate
- `difficulty-label-expansion-2000.second-review-corrections.jsonl`: 1차 candidate 대비 250개 before/after diff
- `difficulty-label-expansion-2000.owner-approval-queue.jsonl`: dataset owner가 최종 승인할 250개 항목
- GPT 추천은 `human_review` 또는 `approved` 증거가 아니다.
