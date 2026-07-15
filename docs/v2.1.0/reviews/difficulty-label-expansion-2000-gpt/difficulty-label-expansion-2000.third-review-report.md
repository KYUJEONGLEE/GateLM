# Difficulty expansion 2,000 — third GPT review merge

## 결론

- ZIP의 5개 output은 250개 third-review input과 행 수·순서·sampleId가 정확히 일치한다.
- 250건 모두 `approve_second_candidate`, confidence 0.99이며 corrected/rejected record는 0건이다.
- instruction 의미, 요청 payload 수, boundary 구조, family intent, length/language slice의 다섯 check가 250건 모두 true다.
- 행 단위 잔여 검토 큐는 0건이다.
- GPT 검토는 사람 승인 자체가 아니므로 candidate는 owner의 명시적 승인 전까지 `pending`, `trainingEligible=false`다.

## 무결성 및 결과

| 항목 | 건수 |
|---|---:|
| 입력·출력 | 250 |
| 누락·중복·예상 밖 ID | 0 |
| approve_second_candidate | 250 |
| correct_second_candidate | 0 |
| reject_second_candidate | 0 |
| false/missing check | 0 |
| canonical v2 검증 실패 | 0 |
| family 충돌 | 0 |
| 잔여 검토 큐 | 0 |

## 산출물

- `difficulty-label-expansion-2000.third-review-confirmed-candidate.jsonl`: 3차 GPT가 확인한 2,000건 pending candidate
- `difficulty-label-expansion-2000.third-review-confirmations.jsonl`: 250개 confirmation evidence
- `difficulty-label-expansion-2000.remaining-review-queue.jsonl`: 잔여 행 단위 검토 큐(현재 빈 파일)
