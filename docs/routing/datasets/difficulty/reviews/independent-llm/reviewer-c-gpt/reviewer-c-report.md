# Reviewer C 구조화 정밀 검토 및 B/C 비교

- 증거일: 2026-07-21
- 검증된 Reviewer C 결과: 3,650건 / 73 batch
- Reviewer C 역할: 같은 GPT 계열의 blind second pass; 독립 리뷰어 수에는 포함하지 않음
- dataset label, human_reviewed, review_status, training_eligible 변경: 없음

## 수신 복구

첫 제출은 C-0002가 C-0001의 복제본이고 이후 파일 내용이 한 batch씩 밀려 실제 C-0073이 없었다. 내부 batch_id와 item_id로 C-0001~C-0072 3,600건을 복구하고 별도 재요청한 C-0073 50건을 결합했다.

## Reviewer C 판정

| 항목 | 개수 |
|---|---:|
| Simple | 3,012 |
| Complex | 638 |
| High confidence | 2,223 |
| Medium confidence | 1,361 |
| Low confidence | 66 |
| needs_human_adjudication | 78 |
| 대상 subset 길이 단독 ROC-AUC | 0.6187 |

이 ROC-AUC는 B와 후보가 다르거나 B가 불확실했던 3,650건 subset에 한정되므로 전체 15,000개 길이 편향 수치로 해석하지 않는다.

## Reviewer B/C 비교

| 항목 | 개수 |
|---|---:|
| B/C 라벨 일치 | 3,348 |
| B/C 라벨 불일치 | 302 |
| B/C 일치율 | 91.73% |
| 같은 계열 고신뢰 합의 후보 | 1,401 |
| 사람 adjudication queue | 2,249 |

## 기존 후보까지 포함한 패턴

| 패턴 | 개수 |
|---|---:|
| 후보=B=C | 133 |
| B=C, 후보만 다름 | 3,215 |
| B/C 불일치, 후보=B | 26 |
| B/C 불일치, 후보=C | 276 |

## Reviewer C 언어별 판정

| 구분 | Simple | Complex | 합계 | Complex 비율 |
|---|---:|---:|---:|---:|
| ko | 1,640 | 512 | 2,152 | 23.79% |
| en | 1,094 | 107 | 1,201 | 8.91% |
| mixed | 278 | 19 | 297 | 6.40% |

## Reviewer C 출처별 판정

| 구분 | Simple | Complex | 합계 | Complex 비율 |
|---|---:|---:|---:|---:|
| public | 3,009 | 622 | 3,631 | 17.13% |
| boundary | 3 | 0 | 3 | 0.00% |
| synthetic | 0 | 16 | 16 | 100.00% |

## Reviewer C 길이 bucket별 판정

| 구분 | Simple | Complex | 합계 | Complex 비율 |
|---|---:|---:|---:|---:|
| short | 1,801 | 250 | 2,051 | 12.19% |
| medium | 1,150 | 388 | 1,538 | 25.23% |
| long | 61 | 0 | 61 | 0.00% |

## Gate 상태

B/C가 일치하고 양쪽 모두 high confidence이며 어느 쪽도 사람 판정을 요청하지 않은 항목만 같은 계열 LLM 합의 후보로 둔다. 그 외 항목은 사람 adjudication queue에 남긴다.

Reviewer C는 Reviewer B와 같은 GPT 계열이므로 B/C 일치를 독립 모델 합의로 계산하지 않는다. Gemini A 또는 사람 adjudication과 dataset owner 승인이 끝나기 전에는 training eligible이 아니다.
