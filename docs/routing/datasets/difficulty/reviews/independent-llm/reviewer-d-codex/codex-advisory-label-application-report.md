# Codex 7축 advisory 라벨 적용 보고서

기준일은 2026-07-22이다. B/C 사람 판정 대기 2,249건에 대해 저장된 블라인드 Reviewer C의 7축 구조화 판정을 Codex advisory 정책으로 다시 결합한 결과를 별도 dataset revision에 적용했다. Prompt를 새 판정 이력에 복제하지 않는다.

## 적용 결과

| 항목 | 건수 |
|---|---:|
| Codex Simple | 1,727 |
| Codex Complex | 522 |
| 기존 Simple → Codex Complex | 373 |
| 기존 Complex → Codex Simple | 2 |
| 기존과 동일 | 1,874 |

전체 15,000건의 현재 라벨은 Simple 9,358 / Complex 5,642다. 최초 규칙 후보는 `automatic_label`에 보존한다.

## 판정 정책

- 7개 축 중 강한 복잡성 신호가 하나 이상이면 Complex다.
- 강한 신호가 없더라도 의존적 2단계와 중간 신호 2개 이상이 결합되거나, 중간 신호가 3개 이상이면 Complex다.
- 나머지는 Simple이다. 길이·언어·전문 용어·코드 포함 여부는 단독 신호로 사용하지 않는다.
- 이는 새 독립 사람 판정이 아니라 같은 GPT 계열 구조화 판정에 대한 Codex advisory 재결합이다.

## 남은 제한

- 2,249건 모두 `needs_adjudication`, `human_reviewed=false`를 유지한다.
- B/C queue, 모든 boundary, 모든 Test record의 최소 사람 검수 합집합은 5,854건이다.
- 현재 라벨은 Simple 62.4% / Complex 37.6%다.
- 길이 단독 ROC-AUC는 0.6288이고, 라벨 비율 35~65%를 벗어난 작업 유형은 9개, 서비스 도메인은 12개다.
- 영어는 Simple 1,771 / Complex 479, 한영 혼합은 Simple 627 / Complex 123다.
- Codex 라벨 기준 embedding 의미 중복 검사는 아직 통과하지 않았다 (후보 6쌍).
- Gemini Reviewer A, 실제 사람 adjudication, dataset owner 승격 전에는 `training_eligible=false`다.
