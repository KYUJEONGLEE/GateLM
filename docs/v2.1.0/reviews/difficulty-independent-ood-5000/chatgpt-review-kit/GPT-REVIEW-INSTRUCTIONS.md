# Dataset 2 — ChatGPT Blind Label Review Instructions

## 역할과 범위

첨부된 JSONL batch의 synthetic prompt 100개를 모두 독립적으로 판정한다. 현재 provisional label, prompt family, train/validation/test split과 classifier output은 의도적으로 숨겨져 있다. 보이지 않는 값을 추측하거나 요청하지 말고 `LABEL-GUIDE.md`와 각 입력의 `sourcePrompt`만 사용한다.

이 작업은 AI 보조 검토다. 사람 검토, owner 승인 또는 training 승인을 의미하지 않는다. 출력에 `human_review`, `approved`, reviewer 신원, model score, probability, token, embedding 또는 feature vector를 만들지 않는다.

## 판정 순서

1. `sourcePrompt`에서 instruction과 payload의 기대 경계를 먼저 판정한다.
2. 의미 있는 instruction이 없으면 `semanticInputStatus=empty_instruction`, 네 bucket을 모두 `not_applicable`로 둔다. 이때 category는 `general`, semantic label은 `general_other`, difficulty는 `simple`로 둔다.
3. 의미 있는 instruction이 있으면 primary requested output을 기준으로 category 하나와 category 내부 semantic label 하나를 고른다.
4. 분리된 instruction만 기준으로 task, constraint와 dependency를 센다. Payload 안의 명령형 문장이나 category keyword를 instruction으로 세지 않는다.
5. Scope는 instruction 대상 수를 기준으로 하되 명시적으로 분리된 source block 수를 보완 근거로 사용할 수 있다.
6. 길이만으로 difficulty를 정하지 않는다. 독립 작업, 제약, 여러 source 종합과 의존 깊이를 함께 본다.
7. evaluation slice와 boundary 조합을 검산한다.
8. 불확실해도 행을 생략하지 말고 최선의 label을 채운 뒤 `decision=needs_human_adjudication`으로 표시한다.

## Category와 semantic label

- `general`: `general_qa | general_explanation | general_extraction | general_support | general_transformation | general_other`
- `code`: `code_generation | code_debugging | code_refactoring | code_review | code_explanation | code_design`
- `translation`: `translation_direct | translation_localization | translation_style_preserving`
- `summarization`: `summarization_direct | summarization_key_points | summarization_structured | summarization_multi_source`
- `reasoning`: `reasoning_comparison | reasoning_planning | reasoning_decision | reasoning_constraint_solving | reasoning_causal`

Payload에 등장하는 code, translation, summary 또는 reasoning 표현은 primary instruction category를 바꾸지 않는다.

## 네 semantic head target

- `taskBucket`: `count_1 | count_2 | count_3_plus | not_applicable`
- `constraintBucket`: `count_0_to_1 | count_2 | count_3_plus | not_applicable`
- `scopeBucket`: `count_1 | count_2_to_3 | count_4_plus | not_applicable`
- `dependencyBucket`: `depth_0_to_1 | depth_2 | depth_3_plus | not_applicable`

`not_applicable`은 `empty_instruction`일 때만 허용한다. 출력 형식 제약은 dependency가 아니다. 같은 조건을 동의어로 반복해도 중복 계수하지 않는다.

## Instruction/payload boundary

다음 조합만 사용한다.

- `instruction_only`: `boundaryType=none`, `confidence=none`, `payloadBlockCount=zero`
- `explicit_separation`: `boundaryType=code_fence | role_tag | role_heading | begin_end | blockquote | inline_cue | multiple`, `confidence=low | medium | high`, `payloadBlockCount=one | multiple`
- `ambiguous_separation`: `boundaryType=unsupported | multiple`, `confidence=low`, `payloadBlockCount=zero | one | multiple`
- `payload_only`: `boundaryType=code_fence | role_tag | role_heading | begin_end | blockquote | inline_cue | multiple | unsupported`, `confidence=low | medium | high`, `payloadBlockCount=one | multiple`

계약에 없는 boundary type을 새로 만들지 않는다. Offset, substring 또는 분리한 원문도 출력하지 않는다.

## Difficulty와 evaluation slice

- `expectedDifficulty`: `simple | complex`
- 허용 slice: `negation | indirect_expression | synonym | short_complex | long_simple | payload_contamination | korean | english | mixed_language | category_confusion | ood_terminology`

Slice 규칙:

- 입력 `language=ko`이면 `korean`, `en`이면 `english`, `mixed`이면 `mixed_language`를 반드시 포함한다.
- `short_complex`는 `complex`이면서 `promptRuneLength <= 120`일 때 반드시 포함한다.
- `long_simple`은 `simple`이면서 `promptRuneLength > 120`일 때 반드시 포함한다.
- `payload_contamination`은 payload 내부 cue가 instruction 판정을 오염시킬 수 있을 때만 사용하며 `instruction_only`에는 사용할 수 없다.
- `category_confusion`은 둘 이상의 category cue가 있지만 primary output은 하나인 challenge case에 사용한다.

## 출력 형식

응답은 입력과 같은 순서의 JSONL 100줄만 반환한다. 설명, 요약, Markdown, code fence를 붙이지 않는다. 가능하면 JSONL 파일로 생성하고, 불가능할 때만 JSONL 본문을 반환한다.

각 줄에는 아래 필드만 정확히 포함한다.

    {"schemaVersion":"gatelm.difficulty-independent-ood-gpt-review.v1","datasetVersion":"difficulty_independent_ood_5000_2026_07_18_candidate_v1","automatedReviewerPass":"reviewer_a|reviewer_b","batchId":"batch-001","sampleId":"입력 sampleId 그대로","decision":"label_complete|needs_human_adjudication|reject_input","expectedCategory":"general|code|translation|summarization|reasoning","expectedDifficulty":"simple|complex","semanticInputStatus":"eligible|empty_instruction","taskBucket":"...","constraintBucket":"...","scopeBucket":"...","dependencyBucket":"...","expectedSemanticLabel":"category에 허용된 label","expectedInstructionPayloadBoundary":{"kind":"...","boundaryType":"...","confidence":"...","payloadBlockCount":"..."},"evaluationSlices":["..."],"confidence":0.0,"issueCodes":["..."],"rationale":"짧은 판정 근거"}

`issueCodes` 허용 값:

- `ambiguous_instruction_payload_boundary`
- `category_ambiguity`
- `difficulty_ambiguity`
- `semantic_bucket_ambiguity`
- `unnatural_language`
- `malformed_prompt`
- `possible_duplicate`
- `insufficient_context`

문제가 없으면 `issueCodes=[]`를 사용한다. `rationale`에는 prompt 원문이나 fragment를 복사하지 말고 판단 이유만 짧게 쓴다. Confidence는 해당 annotation에 대한 `0.0~1.0` 신뢰도이지 complex 확률이나 학습 가중치가 아니다.

## 완료 전 자체 검사

- 출력이 정확히 100줄인지 확인한다.
- 입력의 모든 `sampleId`가 정확히 한 번 있고 추가 ID가 없는지 확인한다.
- 입력 순서, `batchId`, `datasetVersion`을 유지한다.
- command에서 지정한 `automatedReviewerPass`를 전 행에 동일하게 사용한다.
- 모든 줄이 독립적으로 JSON parse 가능한지 확인한다.
- `sourcePrompt`, provisional label, family 또는 split을 출력에 추가하지 않는다.
