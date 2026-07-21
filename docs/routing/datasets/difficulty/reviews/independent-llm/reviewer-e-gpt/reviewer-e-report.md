# Reviewer E(GPT) 위험 회피형 재검수 결과

기준일은 2026-07-22이다. 수신 ZIP SHA-256은 `1427e96a8ee5bf5d809eb2b805f84b515ef0f322315239f13d97736b7465f9e4`이며 162개 batch의 7,974건이 모두 schema와 입력 순서를 통과했다.

## 판정 결과

| 항목 | 건수 |
|---|---:|
| Simple | 3,915 |
| Complex | 4,059 |
| high confidence | 6,203 |
| medium confidence | 1,308 |
| low confidence | 463 |
| needs_human_adjudication | 1,771 |

## 현재 Codex 수정본 대비

| 전환 | 건수 |
|---|---:|
| Simple → Simple | 3,911 |
| Simple → Complex | 2,786 |
| Complex → Complex | 1,273 |
| Complex → Simple | 4 |

전부 적용한다고 가정하면 전체 15,000건은 Simple 6,576 / Complex 8,424가 된다. 길이 단독 ROC-AUC는 0.4684, 35~65%를 벗어나는 작업 유형은 6개, 서비스 도메인은 2개다.

언어별 예상 분포는 한국어 Simple 5359 / Complex 6641, 영어 Simple 744 / Complex 1506, 한영 혼합 Simple 473 / Complex 277다.

## 해석과 제한

- False Simple 위험 회피 정책 때문에 현재 Simple 중 2,786건이 Complex로 이동하는 반면, 현재 Complex 중 Simple로 내려가는 항목은 4건뿐이다.
- 전체·언어·도메인 균형은 개선되지만 수학과 연구의 Complex 과다 문제는 해소되지 않는다. 적용 예상 기준 math_problem Complex 비율은 93.9%, research는 77.3%다.
- 이 결과는 같은 GPT 계열의 비대칭 routing-policy 리뷰다. 의미론적 gold label이나 사람 승인으로 취급하지 않는다.
- 현재 dataset label, human_reviewed, review_status, training_eligible은 이 import에서 변경하지 않는다.
