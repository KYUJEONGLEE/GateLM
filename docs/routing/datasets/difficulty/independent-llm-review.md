# GateLM 15,000개 독립 LLM 난이도 리뷰 패키지

## 목적

현재 15,000개 후보 데이터의 `simple | complex` 라벨을 Gemini 리뷰어 A와 GPT 리뷰어 B가 서로 독립적으로 다시 판정할 수 있는 블라인드 패키지를 생성한다. 이 단계는 사람 승인이나 gold label 확정이 아니다.

## 블라인드 범위

리뷰어 패키지는 다음 값만 포함한다.

- 불투명한 `item_id`
- 불투명한 `review_group_id`
- 안전 필터를 통과한 `prompt`

다음 값은 패키지에서 제외한다.

- 원본 `sample_id`, `group_id`
- `automatic_label`, 현재 `label`, `label_confidence`, `label_reason`
- 언어, 출처, 작업 유형, 서비스 도메인, 길이·추론·제약 metadata
- split과 다른 리뷰어의 결과

원본 `sample_id` 일부가 후보 라벨 문자열을 포함하므로 ID도 그대로 노출하지 않는다. `item_id`와 원본 ID의 매핑은 `.tmp/routing-difficulty-independent-review/private-do-not-send/`에 만들며 리뷰어에게 전달하지 않는다.

## 생성과 전달

```powershell
corepack pnpm run routing:difficulty:generate-independent-review-packets
```

생성된 다음 두 디렉터리를 각각 ZIP으로 압축해 해당 리뷰어에게 전달한다.

```text
.tmp/routing-difficulty-independent-review/reviewer-a-gemini/
.tmp/routing-difficulty-independent-review/reviewer-b-gpt/
```

각 패키지의 `COPY-PASTE-PROMPT.txt`를 채팅 명령으로 그대로 사용할 수 있다. batch는 `review_group_id`를 분리하지 않으며 최대 100개 record, prompt 본문 합계 최대 70,000자로 구성한다. 한 review task의 context와 출력 한도를 넘기지 않도록 batch별 JSONL 결과를 받는다.

## 판정 계약

리뷰어는 프롬프트에 답하지 않고 다음 필드만 반환한다.

```json
{
  "schema_version": "gatelm.routing-difficulty-independent-review-result.v1",
  "reviewer_id": "A",
  "batch_id": "A-0001",
  "item_id": "ri_0123456789abcdef01234567",
  "difficulty": "simple",
  "confidence": "high",
  "reason_codes": ["single_bounded_task"],
  "needs_human_adjudication": false
}
```

자유 서술 rationale과 prompt 인용은 저장하지 않는다. `simple | complex`는 반드시 하나를 선택하며, 모호하거나 자료가 누락된 경우 최선의 라벨과 함께 `needs_human_adjudication=true`를 반환한다.

## 후속 adjudication

두 결과가 모두 도착하면 다음 항목을 사람 검수 queue에 넣는다.

- A/B 라벨 불일치
- 한쪽이라도 `needs_human_adjudication=true`
- 한쪽이라도 `confidence=low`
- 경계 사례 전체와 최종 Test 후보
- 각 언어·작업 유형·도메인·source의 무작위 품질 표본

A/B 일치만으로 `human_reviewed=true`, `review_status=approved`, `training_eligible=true`로 바꾸지 않는다. 사람 adjudication 기록과 dataset owner 승인이 별도로 필요하다.

## 현재 수신 상태

- 리뷰어 B(GPT): 2026-07-21 결과 15,000건 수신, 계약 검증 결과는 [`reviews/independent-llm/reviewer-b-gpt/reviewer-b-report.md`](reviews/independent-llm/reviewer-b-gpt/reviewer-b-report.md)에 기록한다.
- 리뷰어 A(Gemini): 미수신

리뷰어 B 결과만으로 현재 dataset label을 덮어쓰지 않는다. B 결과와 기존 후보의 불일치 및 낮은 확신 항목은 사람 검수 우선순위로 사용할 수 있다.

리뷰어 A의 후속 판정은 B와 기존 후보의 불일치 3,491건, B의 low confidence 308건, B의 `needs_human_adjudication` 316건의 합집합을 사용한다. low confidence 308건은 모두 `needs_human_adjudication`에 포함되고, 불일치 집합 밖의 불확실 항목은 159건이므로 중복 제거 후 대상은 3,650건이다. Gemini 패키지에는 이 선정 사유와 B의 판정·confidence·reason code를 넣지 않는다.

```powershell
corepack pnpm run routing:difficulty:generate-gemini-targeted-review-packet
corepack pnpm run verify:routing-difficulty-gemini-targeted-review-packet
```

같은 GPT 계열의 정밀 재검토는 Reviewer C 보조 증거로 분리한다. C는 같은 3,650건을 B와 다른 순서로 받고, 기존 후보·B 결과·선정 사유 없이 추론, 작업 의존성, 제약 trade-off, 전문 판단, 문맥 통합, 도구·외부 근거, 검증 필요성의 7개 축을 먼저 구조화한다. 같은 모델 계열의 second pass이므로 독립 리뷰어 한 명이 추가된 것으로 계산하지 않는다.

```powershell
corepack pnpm run routing:difficulty:generate-gpt-reviewer-c-deep-review-packet
corepack pnpm run verify:routing-difficulty-gpt-reviewer-c-deep-review-packet
```

B/C가 일치하고 모두 high confidence인 항목은 LLM 합의 후보로만 표시한다. B/C 불일치, 어느 한쪽의 low confidence, 또는 한 번이라도 `needs_human_adjudication=true`였던 항목은 사람 adjudication queue에서 제거하지 않는다. Gemini A까지 일치해도 `human_reviewed=true`로 자동 전환하지 않는다.

Reviewer C 결과 3,650건의 수신·복구·7축 schema 검증과 B/C 비교 결과는 [`reviews/independent-llm/reviewer-c-gpt/reviewer-c-report.md`](reviews/independent-llm/reviewer-c-gpt/reviewer-c-report.md)에 기록한다. C는 B와 같은 GPT 계열이므로 import가 완료돼도 독립 리뷰어 A 완료로 표시하지 않는다.

Dataset owner 요청에 따라 B/C가 같은 라벨을 냈고 기존 후보와 달랐던 3,215건은 별도 수정본에 반영한다. 원본 dataset은 B/C 리뷰 입력의 재현 가능한 증거로 보존한다. 수정본도 `human_reviewed=false`, `training_eligible=false`이며 B/C 사람 adjudication queue 2,249건을 제거하지 않는다. 적용 결과와 남은 blocker는 [`reviews/independent-llm/reviewer-c-gpt/reviewer-b-c-label-application-report.md`](reviews/independent-llm/reviewer-c-gpt/reviewer-b-c-label-application-report.md)에 기록한다.
