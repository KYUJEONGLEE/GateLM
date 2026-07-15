# GateLM Difficulty Expansion 2,000 — GPT Independent Review

## 사용자 전달 방법

이 지시문과 `difficulty-label-expansion-2000.gpt-review.batch-NN.input.jsonl` 하나를 GPT의 새 대화에 함께 첨부한다. Batch는 01부터 20까지 각각 별도 대화에서 처리하는 것을 권장한다. GPT가 반환한 JSONL은 입력 번호를 유지해 `difficulty-label-expansion-2000.gpt-review.batch-NN.output.jsonl`로 저장한다.

## GPT에게 전달할 작업 지시

당신은 GateLM difficulty dataset의 독립 adjudicator다. 첨부된 JSONL의 synthetic prompt 100개를 **모두** 검토하라. 기존 `proposed` 값을 정답으로 가정하지 말고 아래 기준으로 독립 판정한다. 어떤 항목도 생략·병합·재정렬하지 말고 각 `sampleId`를 정확히 한 번 반환한다.

이 작업은 AI 재검수다. 사람 검수, owner 승인 또는 training 승인을 의미하지 않는다. 출력에 reviewer identity, `human_review`, `approved`, token, embedding, feature vector, probability 또는 model score를 만들지 마라.

### 판정 순서

1. Prompt에서 instruction과 payload의 기대 경계를 먼저 판정한다. 실제 parser 출력이나 proposed 값을 따라가지 말고 문법과 의미를 직접 검토한다.
2. 의미 있는 instruction이 없으면 `semanticInputStatus=empty_instruction`, 네 bucket을 모두 `not_applicable`로 둔다. Payload 내용은 category·difficulty·semantic label의 instruction 근거로 사용하지 않는다. 이 경우 category fallback은 `general`, semantic label은 `general_other`, difficulty는 `simple`로 판정한다.
3. 의미 있는 instruction이 있으면 primary requested output 기준으로 category 하나와 category 내부 semantic label 하나를 고른다.
4. 분리된 instruction만 기준으로 task, constraint, dependency를 센다. Scope는 instruction 기준이지만 명시적으로 분리된 source block 수를 보완 근거로 사용할 수 있다.
5. 길이가 아니라 독립 작업, 제약, source 종합, 의존 깊이로 `simple | complex`를 판정한다.
6. 같은 primary category와 semantic label의 paraphrase, 언어 변형, boundary 변형, simple/complex contrast는 같은 `promptFamily`로 유지한다. Family 안의 category 또는 semantic label을 바꿔야 한다면 영향받는 family 행을 일관되게 교정한다.
7. 부자연스러운 문장, template 결합 오류, label로 해결할 수 없는 모순이 있으면 `promptAction=replace`와 안전한 synthetic `replacementPrompt`를 제공하고 교체 문장을 기준으로 모든 label을 판정한다.
8. 마지막으로 language slice, 길이 slice, boundary 조합과 출력 enum을 자체 검산한 뒤 JSONL만 반환한다.

### Category와 semantic label

- `general`: `general_qa | general_explanation | general_extraction | general_support | general_transformation | general_other`
- `code`: `code_generation | code_debugging | code_refactoring | code_review | code_explanation | code_design`
- `translation`: `translation_direct | translation_localization | translation_style_preserving`
- `summarization`: `summarization_direct | summarization_key_points | summarization_structured | summarization_multi_source`
- `reasoning`: `reasoning_comparison | reasoning_planning | reasoning_decision | reasoning_constraint_solving | reasoning_causal`

Payload에 code, translation, summary, reasoning cue가 있어도 primary instruction category를 바꾸지 않는다. 둘 이상의 instruction intent가 있으면 최종 산출물을 지배하는 intent를 고른다.

### 네 semantic head target

- `taskBucket`: `count_1 | count_2 | count_3_plus | not_applicable`
- `constraintBucket`: `count_0_to_1 | count_2 | count_3_plus | not_applicable`
- `scopeBucket`: `count_1 | count_2_to_3 | count_4_plus | not_applicable`
- `dependencyBucket`: `depth_0_to_1 | depth_2 | depth_3_plus | not_applicable`

Intermediate reasoning step와 별도 요청 산출물을 구분한다. 예를 들어 “A와 B를 대조해 기준을 세운 뒤 그 기준으로 선택하고 실패 대안을 제시”는 비교 과정 자체가 별도 산출물이 아닐 수 있지만, 최종 선택과 실패 대안은 독립 requested output일 수 있다. 출력 형식 제약은 dependency가 아니다. 같은 조건의 동의어 반복은 중복 계수하지 않는다.

`not_applicable`은 `empty_instruction`일 때만 허용한다. `eligible`이면 네 bucket 모두 실제 3-class target 중 하나여야 한다.

### Instruction/payload boundary

허용 조합만 사용한다.

- `instruction_only`: `boundaryType=none`, `confidence=none`, `payloadBlockCount=zero`
- `explicit_separation`: `boundaryType=code_fence | role_tag | role_heading | begin_end | blockquote | inline_cue | multiple`, `confidence=low | medium | high`, `payloadBlockCount=one | multiple`
- `ambiguous_separation`: `boundaryType=unsupported | multiple`, `confidence=low`, `payloadBlockCount=zero | one | multiple`
- `payload_only`: `boundaryType=code_fence | role_tag | role_heading | begin_end | blockquote | inline_cue | multiple | unsupported`, `confidence=low | medium | high`, `payloadBlockCount=one | multiple`

계약에 없는 `sentence_context`, `quoted_text`, `context`, `input`, `data`, `body`, `message`, `system`, `requirements`, `constraints`, `format` 같은 값을 boundary type으로 만들지 않는다. Offset, substring 또는 분리된 원문을 출력하지 않는다.

### Difficulty와 evaluation slice

- `expectedDifficulty`: `simple | complex`
- `evaluationSlices`: `negation | indirect_expression | synonym | short_complex | long_simple | payload_contamination | korean | english | mixed_language | category_confusion | ood_terminology`

Slice 규칙:

- `korean`, `english`, `mixed_language`는 입력의 `language`와 정확히 일치해야 한다.
- `short_complex`는 최종 prompt가 complex이고 Unicode code point 길이 120 이하일 때만, 그리고 반드시 포함한다.
- `long_simple`은 최종 prompt가 simple이고 Unicode code point 길이 120 초과일 때만, 그리고 반드시 포함한다.
- `payload_contamination`은 payload 내부의 명령형 문장이나 category/difficulty cue가 instruction 판정을 오염시킬 수 있을 때 사용한다. `instruction_only`에는 사용할 수 없다.
- `category_confusion`은 의미 있는 instruction에 둘 이상의 category cue가 있거나, payload cue가 분리 실패 시 category를 혼동시킬 수 있는 challenge case에 사용한다.
- 한 record는 여러 slice를 가질 수 있다. 배열 순서는 입력 proposed 순서를 우선하고 새 slice는 위 허용 목록 순서에 맞춘다.

### Prompt family

`promptFamily`는 소문자 영숫자로 시작하고 소문자 영숫자, `.`, `_`, `:`, `-`만 사용한다. Prompt 내용, 사람/고객 식별자, secret, timestamp, batch 번호 또는 `train | calibration | holdout` 이름을 넣지 않는다. 같은 family의 10행은 현재 batch 안에 모두 들어 있다.

### 출력 형식

응답은 설명, 요약, Markdown, code fence 없이 **JSONL 100줄만** 반환한다. 입력 순서를 그대로 유지한다. 각 줄에는 아래 필드만 정확히 포함한다.

    {"schemaVersion":"gatelm.difficulty-gpt-adjudication.v1","sampleId":"...","decision":"accept|correct","expectedCategory":"general|code|translation|summarization|reasoning","expectedDifficulty":"simple|complex","semanticInputStatus":"eligible|empty_instruction","taskBucket":"...","constraintBucket":"...","scopeBucket":"...","dependencyBucket":"...","expectedSemanticLabel":"...","promptFamily":"...","expectedInstructionPayloadBoundary":{"kind":"...","boundaryType":"...","confidence":"...","payloadBlockCount":"..."},"evaluationSlices":["..."],"promptAction":"keep_source|accept_proposed_rewrite|replace","replacementPrompt":null,"confidence":0.0,"rationaleCodes":["..."]}

Rationale code 허용 값:

- `accepted_as_proposed`
- `category_changed`
- `difficulty_changed`
- `semantic_input_status_changed`
- `semantic_label_changed`
- `bucket_changed`
- `family_changed`
- `boundary_changed`
- `slice_changed`
- `prompt_rewrite_changed`
- `insufficient_context`

추가 규칙:

- `decision=accept`는 proposed의 모든 반환 대상 field를 그대로 수락하고 `promptAction=keep_source`, `replacementPrompt=null`, `rationaleCodes=["accepted_as_proposed"]`일 때만 사용한다.
- 하나라도 바꾸면 `decision=correct`와 실제 변경을 설명하는 rationale code를 모두 사용한다.
- `replacementPrompt`는 `promptAction=replace`일 때만 문자열이고 그 외에는 null이다.
- Proposed prompt가 이미 별도 rewrite를 제안한 경우에만 `accept_proposed_rewrite`를 쓸 수 있다. 이번 input은 일반적으로 `keep_source | replace`만 필요하다.
- Confidence는 이 판정에 대한 `0.0~1.0`의 신뢰도이며 difficulty probability가 아니다.
- 확신이 낮아도 행을 생략하지 말고 최선의 판정과 `insufficient_context`를 반환한다.
- 출력하기 전 JSON parse 가능 여부, 정확히 100줄인지, sampleId 중복·누락이 없는지 자체 확인한다.

