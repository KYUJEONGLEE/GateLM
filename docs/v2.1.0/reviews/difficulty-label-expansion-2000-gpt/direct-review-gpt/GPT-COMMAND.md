# Difficulty expansion 2,000 — selected direct review command

## 전달 방법

이 파일과 같은 폴더의 `review-NN.input.jsonl` 하나를 GPT의 새 대화에 첨부한다. 한 번에 파일 하나만 전달한다. 같은 `promptFamily`의 선택된 행은 batch 사이에 쪼개지지 않는다. 응답은 같은 번호의 `review-NN.output.jsonl`로 저장한다.

## GPT에게 전달할 지시

당신은 GateLM difficulty expansion candidate의 2차 독립 검토자다. 이 출력은 사람 승인 자체가 아니며 최종 dataset owner가 별도로 승인한다. 첨부 JSONL의 모든 행을 독립적으로 검토하고 입력 순서대로 정확히 한 번씩 반환하라.

첨부 행은 아래 조건 중 하나 이상에 해당해 선별되었다.

- 기존 GPT의 `decision=correct`
- GPT confidence가 0.90 미만
- category, difficulty, 네 semantic bucket 또는 promptFamily 변경
- `promptAction=replace`
- boundary가 `ambiguous_separation` 또는 `payload_only`
- 같은 family 안의 category/semantic label 판정 충돌
- simple/complex contrast pair의 difficulty가 서로 뒤집힘
- 계약 밖 enum 또는 boundary 조합의 정규화 발생

각 행에서 다음을 확인한다.

1. `sourcePrompt`와 `candidatePrompt`를 비교해 candidate가 instruction 의미, 합성 payload 수, 언어와 primary intent를 보존하는지 확인한다.
2. `sourceProposed`와 `proposed`를 비교해 기존 GPT의 변경이 실제 prompt 근거와 맞는지 확인한다.
3. `proposed.expectedInstructionPayloadBoundary`가 실제 prompt 경계와 일치하는지 확인한다. 특히 `ambiguous_separation`과 `payload_only`를 엄격히 본다.
4. payload의 category cue를 instruction으로 오인하지 않았는지 확인한다.
5. 같은 `promptFamily` 안에서 category와 semantic label이 같고, 각 행의 difficulty·bucket·slice가 prompt에 맞는지 확인한다.
6. v01↔v06, v02↔v07, v03↔v08, v04↔v09, v05↔v10은 simple/complex contrast pair다. 뒤집힘 표시가 있으면 두 행을 함께 검증한다.
7. 의미 있는 instruction이 없으면 `payload_only + empty_instruction + 네 not_applicable bucket + general/simple/general_other`인지 확인한다.
8. `normalizations`가 있으면 원래 값이 canonical enum으로 안전하게 변환됐는지 확인한다.
9. token, embedding, score, probability, reviewer identity, secret 또는 실제 고객 데이터를 만들지 않는다.

설명이나 Markdown 없이 입력과 같은 수의 JSONL만 반환한다. 각 줄은 아래 필드만 사용한다.

    {"schemaVersion":"gatelm.difficulty-expansion-human-review-recommendation.v1","sampleId":"...","recommendation":"approve_candidate|correct_candidate|reject_candidate","correctedPrompt":null,"correctedProposed":null,"confidence":0.0,"rationaleCodes":["..."],"reviewNote":"..."}

- `approve_candidate`: candidate prompt와 proposed 전체를 유지한다. `correctedPrompt=null`, `correctedProposed=null`이다.
- `correct_candidate`: prompt만 바꾸면 `correctedPrompt`에 전체 교체 문장을 넣고, label만 바꾸면 `correctedProposed`에 입력 `proposed`와 같은 전체 object shape로 교정값을 넣는다. 바꾸지 않는 쪽은 null이다.
- `reject_candidate`: 합성 데이터로 복구하기 어렵거나 family 의도가 무너진 경우다. 두 corrected field는 null이다.
- `confidence`는 추천 판단의 신뢰도이며 model probability가 아니다.
- `reviewNote`는 240자 이하로 쓰고 prompt 원문 조각, 사람 이름 또는 secret을 넣지 않는다.
- rationale code는 `candidate_confirmed | prompt_rewrite | category_or_semantic_label | difficulty_or_semantic_head | instruction_payload_boundary | empty_instruction | family_consistency | evaluation_slice | insufficient_context`만 사용한다.
- 행을 생략하거나 재정렬하지 말고, JSON parse와 sampleId 중복·누락을 마지막에 자체 확인한다.
