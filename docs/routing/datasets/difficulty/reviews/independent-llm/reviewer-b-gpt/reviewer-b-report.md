# 독립 LLM 난이도 리뷰 결과 — 리뷰어 B (GPT)

- 증거일: 2026-07-21
- 입력: 블라인드 15,000건 / 155 batch
- 원본 ZIP: `gatelm-reviewer-B-gpt-results.zip`
- 원본 ZIP SHA-256: `948bb5db5d9ee99d9f173e82f6a10a118748872a591375c0ba07e630e162fbba`
- 상태: 단일 독립 리뷰어 결과 검증 완료; 사람 승인 및 training eligibility 미완료

## 계약 검증

- 15,000개 item ID가 블라인드 입력과 순서까지 일치한다.
- 155개 batch의 누락·추가·중복이 없다.
- 결과에는 prompt, 기존 후보 라벨, 자유 서술 rationale이 없다.
- 모든 label, confidence, reason code, adjudication flag가 허용 enum을 지킨다.

## 판정 요약

| 항목 | 개수 |
|---|---:|
| Simple | 9,697 |
| Complex | 5,303 |
| High confidence | 10,746 |
| Medium confidence | 3,946 |
| Low confidence | 308 |
| needs_human_adjudication | 316 |
| 우선 사람 검수 queue | 316 |

## 기존 후보 라벨과 사후 비교

- 일치: 11,509건 (76.73%)
- 불일치: 3,491건
- Simple → Complex: 647건
- Complex → Simple: 2,844건
- 길이 단독 ROC-AUC: 0.6460

## 언어별 판정

| 구분 | Simple | Complex | 합계 | Complex 비율 |
|---|---:|---:|---:|---:|
| mixed | 665 | 85 | 750 | 11.33% |
| ko | 7,102 | 4,898 | 12,000 | 40.82% |
| en | 1,930 | 320 | 2,250 | 14.22% |

## 출처 구성별 판정

| 구분 | Simple | Complex | 합계 | Complex 비율 |
|---|---:|---:|---:|---:|
| public | 5,681 | 1,319 | 7,000 | 18.84% |
| synthetic | 3,016 | 2,984 | 6,000 | 49.73% |
| boundary | 1,000 | 1,000 | 2,000 | 50.00% |

## 길이 bucket별 판정

| 구분 | Simple | Complex | 합계 | Complex 비율 |
|---|---:|---:|---:|---:|
| medium | 3,166 | 3,088 | 6,254 | 49.38% |
| short | 5,611 | 1,415 | 7,026 | 20.14% |
| long | 920 | 800 | 1,720 | 46.51% |

## 해석과 다음 단계

이 결과는 기존 후보 라벨을 보지 않은 독립 판정이지만 리뷰어가 한 명뿐이다. 따라서 현재 dataset의 `label`, `human_reviewed`, `review_status`, `training_eligible`은 변경하지 않는다.

Gemini 리뷰어 A를 다시 확보하지 못하더라도 사람 adjudicator가 B 판정과 기존 후보를 독립적으로 검토할 수 있다. 최소한 low confidence 또는 `needs_human_adjudication`, B와 기존 후보 불일치, 경계 사례, Test 후보, slice별 무작위 표본은 사람 검수해야 한다.
