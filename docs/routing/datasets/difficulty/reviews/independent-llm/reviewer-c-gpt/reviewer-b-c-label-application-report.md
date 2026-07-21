# Reviewer B/C GPT 합의 라벨 적용 보고서

기준일은 2026-07-21이다. 같은 GPT 계열의 블라인드 1차(B)·정밀 2차(C)가 동일한 라벨을 냈고 기존 후보와 달랐던 3,215건을 현재 후보 라벨에 반영했다. 원본 15,000건은 리뷰 입력 증거로 보존하고, 수정본을 별도 dataset revision으로 생성한다.

## 적용 결과

| 항목 | 건수 |
|---|---:|
| 전체 라벨 변경 | 3,215 |
| Complex → Simple | 2,722 |
| Simple → Complex | 493 |
| B/C 모두 high, 기존 사람 queue 밖 | 1,401 |
| 라벨은 변경했지만 사람 adjudication 유지 | 1,814 |
| B/C 비교 전체 사람 adjudication queue | 2,249 |

수정 후 공개 7,000건은 Simple 5,729 / Complex 1,271이고, 전체 15,000건은 Simple 9,729 / Complex 5,271이다. 요청대로 GPT 합의를 모두 반영했기 때문에 기존 50:50 후보 균형은 유지되지 않는다.

`automatic_label`은 최초 규칙 후보의 provenance로 보존한다. 변경된 3,215건만 `label_source=llm_same_family_consensus_candidate`로 기록한다. `label_confidence=0.9`는 B/C 모두 high이고 사람 요청 이력이 없는 1,401건, 나머지는 보수적으로 `0.5`다. 이 값은 보정된 확률이 아니라 workflow tier다.

## 아직 남은 작업

- Gemini Reviewer A의 독립 판정 3,650건은 아직 미수신이다. B/C는 같은 GPT 계열이므로 독립 리뷰어 두 명의 합의로 계산하지 않는다.
- 현재 B/C 비교 기준 사람 adjudication queue는 2,249건이다. 라벨을 GPT 답으로 바꾼 3,215건 중에서도 1,814건은 이 queue에 남는다.
- 기존 정책의 B/C queue, 모든 boundary record, 모든 Test record를 합친 최소 사람 검수 집합은 중복 제거 후 5,854건이다. 언어·작업·도메인·source별 무작위 품질 표본은 아직 더 정해야 한다.
- 전체 15,000건의 `human_reviewed`는 여전히 0건이며 dataset-owner 승격도 없다.
- 현재 라벨은 Simple 9,729건(64.9%) / Complex 5,271건(35.1%)으로 class 재균형이 필요하다. 최초 `automatic_label`은 7,500/7,500으로 별도 보존된다.
- 길이 단독 ROC-AUC는 0.6517로 0.60 상한을 다시 초과했다.
- 35~65% 라벨 비율을 벗어난 작업 유형은 9개, 서비스 도메인은 17개다.
- 영어는 Simple 1,988 / Complex 262, 한영 혼합은 Simple 646 / Complex 104로 GPT 판정의 언어별 편향을 별도 교정해야 한다.
- 직접 사람 작성 공개 Prompt는 2,674건으로 60% 목표보다 1,526건 부족하고, 승인된 실제 서비스 사용자 Prompt는 0건이다.
- 수정 라벨 기준 embedding 의미 중복 재검사는 아직 통과하지 않았다 (후보 7쌍).
- 따라서 수정본도 `training_eligible=false`이며 gold label이나 운영 승격 근거가 아니다.

## 산출물

- `docs/routing/datasets/difficulty/data/public-prompts-7000.reviewer-b-c-revised.jsonl`
- `docs/routing/datasets/difficulty/data/enterprise-synthetic-8000.reviewer-b-c-revised.jsonl` (라벨 변경 없음; 19건의 review status만 반영)
- `docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.reviewer-b-c-revised.jsonl`
- `docs/routing/datasets/difficulty/reviews/independent-llm/reviewer-c-gpt/reviewer-b-c-label-overrides.jsonl` (Prompt 원문 미포함)
