# Dataset 2 Reviewer A — Owner Adjudication Guide

Reviewer A의 5,000개 결과는 형식·batch·sampleId·enum·boundary·slice 검증을 통과했다. 그러나 provisional label과의 agreement는 accuracy나 human approval이 아니다. 현재 candidate는 계속 pending이며 training-ineligible이다.

## 확인 순서

1. `priority/02-core-label-conflicts.jsonl`: category, difficulty, semantic input status 또는 semantic label이 다른 1,353건을 먼저 확인한다.
2. `priority/02-core-label-family-context.jsonl`: 위 core conflict가 속한 527 family의 5개 변형을 함께 보며 family 일관성을 판정한다.
3. `priority/03-low-confidence-or-quality.jsonl`: core conflict가 아니면서 confidence 0.90 미만이거나 문장 품질 issue가 있는 354건을 확인한다.
4. `priority/04-structure-conflicts.jsonl`: core/품질 문제가 없고 task·constraint·scope·dependency·boundary만 다른 2,564건을 규칙 단위로 검토한다.
5. `priority/05-slice-only-conflicts.jsonl`: evaluation slice만 다른 396건을 마지막에 확인한다.

`priority/01-gpt-escalation.jsonl`은 Reviewer A가 모든 행을 `label_complete`로 반환했기 때문에 비어 있다.

## 판정 원칙

- GPT label을 자동 정답으로 채택하지 않는다.
- `changedFields`의 `provisional`과 `reviewerA`를 비교해 owner가 선택한다.
- category와 semantic label 변경은 반드시 family-context에서 같은 family 전체를 함께 확인한다.
- difficulty는 길이나 bucket 합계만으로 결정하지 않는다.
- 구조 conflict가 대량으로 반복되면 개별 행을 무작정 승인하기 전에 task/scope/dependency 계수 규칙의 해석 차이를 먼저 결정한다.
- 생성된 queue 파일을 직접 덮어쓰지 않는다. Owner 결정은 별도 파생 decision artifact로 기록한다.
