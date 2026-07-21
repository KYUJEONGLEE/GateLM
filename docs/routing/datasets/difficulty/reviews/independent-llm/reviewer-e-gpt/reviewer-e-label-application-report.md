# Reviewer E 위험 회피형 라벨 적용 보고서

기준일은 2026-07-22이다. 검증된 Reviewer E 결과 7,974건을 Codex advisory 수정본 위에 별도 revision으로 적용했다.

## 적용 결과

| 항목 | 건수 |
|---|---:|
| Reviewer E Simple | 3,915 |
| Reviewer E Complex | 4,059 |
| Simple → Complex | 2,786 |
| Complex → Simple | 4 |

전체 15,000건은 Simple 6,576 / Complex 8,424이며 `needs_adjudication`은 3,565건이다.

## 의미 중복 해소

누적 후보 9쌍을 8개 의미 클러스터로 묶었다. Prompt와 라벨은 변경하지 않았고, 연결된 기존 합성 변형 그룹까지 원자적으로 병합했다.
교차 split 클러스터를 원자화하고 70/15/15 건수를 유지하기 위해 7개 record의 split만 재배치했다.
pinned multilingual-E5 재감사 결과는 통과이며 후보는 0쌍이다.
해소 근거는 `docs/routing/datasets/difficulty/reviews/independent-llm/reviewer-e-gpt/reviewer-e-semantic-dedup-resolution.json`에 Prompt 없이 기록했다.

Reviewer E는 같은 GPT 계열의 위험 회피형 정책 재판정이다. 모든 record는 `human_reviewed=false`이며 독립 검수와 사람 adjudication 완료 전까지 `training_eligible=false`다.
