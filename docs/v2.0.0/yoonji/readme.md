# 이윤지 v2.0.0 계약/의존성 정리

## 1. 내 역할의 v2 main path

- 역할: AI Safety & Evaluation Lab.
- Gateway 요청에서 Provider 호출 전에 request-side safety 판단을 끝낸다.
- RuntimeSnapshot에 publish된 safety policy 후보를 소비해 `pass/redact/block` 계열의 판단을 만든다.
- raw prompt/raw response 없이 redacted preview, hash, detector summary, masking action 후보만 남기는 방향을 검증한다.
- Semantic Cache는 core 응답 경로가 아니라 evidence track으로 두고, redaction 이후 normalized prompt 기준으로만 실험한다.
- Streaming thin slice에서도 request-side safety는 streaming 시작 전에 끝난다. response-side safety scan, token별 safety logging은 v2.0.0 core 범위 밖으로 둔다.

## 2. 내가 다른 역할에게 받아야 하는 계약

- 재혁님(Control Plane): RuntimeConfig/RuntimeSnapshot에 포함될 safety policy 후보 shape, publish validation 실패 시 동작, snapshot provenance 최소 세트.
- 이지섭(Gateway): safety stage 호출 위치, safety 결과를 domain outcome/terminal status로 변환하는 규칙, block/redact 시 Provider 호출 bypass 계약.
- 이규정(Observability): Request Detail/Dashboard에 저장/집계할 safety outcome 후보, detector summary grain, redacted preview/hash 노출 범위, metrics label 허용/금지 목록, freshness/query budget 제약.
- 김규민(Product Experience): Employee Chat/Demo UI에서 사용자에게 보여줄 safety 안내 수준, preset demo 입력 범위, 자유 입력 sandbox 여부.
- 전체: P0 legacy field cleanup inventory 중 safety/log/request detail 관련 필드 확인 범위.

## 3. 내가 다른 역할에게 제공해야 하는 계약

- safety decision 후보: `passed`, `redacted`, `blocked`, `not_checked` 등은 공식 필드 확정 전까지 후보로만 둔다.
- detector result 후보: detector category summary, detected count, masking action, sanitized reason/code.
- safety result는 raw value, raw offset, raw prompt fragment를 포함하지 않는 방향으로 둔다.
- remote/shadow safety 실험은 Gateway hot path를 차단하지 않는 evidence track으로 분리하고, core 차단 판단은 published RuntimeSnapshot 정책 기준으로만 한다.
- redaction/block fixture 후보: 실제 개인정보나 secret 없이 합성 문자열만 사용한다.
- safety policy validation 후보: RuntimeSnapshot publish 전에 rule config가 비어 있거나 잘못된 경우 실패시키는 최소 기준.
- evidence report 후보: Semantic Cache candidate, detector precision/false positive sample, 안전한 preset corpus 결과.
- k6/metrics 해석 후보: safety block/redaction은 기본적으로 정책 결과로 보고, 시스템 error rate와 섞지 않는다.

## 4. 내가 막히는 dependency

- RuntimeSnapshot 최소 safety policy shape가 없으면 safety engine이 어떤 설정을 소비해야 하는지 고정할 수 없다.
- RuntimeSnapshot active binding key와 reload 실패 시 last known safe 의미가 없으면 어떤 policy version으로 safety 판단했는지 설명하기 어렵다.
- Gateway의 domain outcome 구조가 없으면 safety 결과를 Request Log/Detail에 어떤 단위로 넘길지 고정할 수 없다.
- redacted preview/hash 저장 허용 범위가 없으면 fixture와 dashboard evidence를 확정할 수 없다.
- Employee Chat 호출 방식(browser direct vs Web BFF/server-side)이 정해지지 않으면 App Token 노출 방지와 사용자 안내 문구 범위를 확정하기 어렵다.

## 5. 내가 늦어지면 막히는 다른 역할

- 이지섭: Gateway pipeline에서 safety stage interface, block/redact provider bypass, terminal status 결정 구현이 늦어진다.
- 재혁님: RuntimeSnapshot publish validation과 safety policy editor/fixture 범위가 늦어진다.
- 이규정: Safety Dashboard grain, Request Detail safety row, k6 safety scenario 기준이 늦어진다.
- 김규민: Demo preset, Employee Chat 안전 안내, block/redaction UX가 늦어진다.

## 6. 계약 확정 전에도 병렬로 할 수 있는 shadow/evidence 작업

- raw 값이 없는 synthetic safety corpus 정리.
- v1 rule-based detector 결과를 v2 domain outcome 후보로 매핑하는 shadow report.
- redaction 이후 normalized prompt만 사용한 Semantic Cache candidate offline 실험.
- streaming thin slice에서 request-side precheck가 먼저 끝나는지 검증하는 sequence note.
- P0 legacy field cleanup 중 raw prompt/raw response/cache key/log label 위험 후보 inventory 작성.

## 7. P0로 먼저 확정해야 하는 항목

- request-side safety가 cache/routing/provider/streaming보다 먼저 끝난다는 pipeline 순서.
- safety block 시 Provider 호출, cache write, streaming start가 모두 일어나지 않는다는 계약.
- redaction 후 cache key/evidence에 사용할 수 있는 입력은 raw prompt가 아니라 normalized redacted prompt 계열이라는 원칙.
- Request Detail에 허용되는 safety provenance 최소 세트.
- Metrics label에는 raw/high-cardinality safety 값, prompt hash, error detail을 넣지 않는 기준.
- RuntimeSnapshot provenance에 safety policy hash/version 계열을 둘지, full policy copy는 금지할지.
- Auth 실패와 safety block을 같은 `blocked` 계열로 볼지, httpStatus/errorCode와 domain outcome으로 분리할지.

## 8. 아직 공식 API/DB/Event/Metrics/Schema 필드로 확정하면 안 되는 후보 용어

- `safety.outcome`
- `maskingAction`
- `detectedTypes`
- `detectedCount`
- `redactedPromptPreview`
- `promptHash`
- `requestBodyHash`
- `safetyPolicyHash`
- `normalizedRedactedPrompt`
- `semanticCacheCandidate`
- `wouldHaveHit`
- `candidateSimilarity`
- `evaluationPassRate`
- `safety_block_provider_bypass`

위 용어는 계약 후보이며, `contracts.md` 확정 전에는 API/DB/Event/Metrics/JSON Schema 필드로 고정하지 않는다.

## 9. 첫 구현 PR로 쪼갤 수 있는 단위

- PR 1: P0 legacy safety/log field cleanup inventory와 제거/유지 판단표.
- PR 2: Safety domain outcome 후보와 terminal status 매핑 문서/fixture 초안.
- PR 3: RuntimeSnapshot safety policy 최소 shape와 publish validation fixture 초안.
- PR 4: Gateway safety stage contract fixture: pass/redact/block/provider bypass.
- PR 5: Synthetic safety corpus와 evaluation runner baseline.
- PR 6: Semantic Cache evidence track offline report. core cache hit/cost 지표와 분리.

## 추가 검토 필요

- Employee Chat Gateway 호출 방식에 따른 token 보관과 안전 안내 책임 경계.
- RuntimeSnapshot provenance 최소 세트에서 `safetyPolicyHash` 또는 `securityPolicyHash` 중 어떤 후보를 남길지.
- Dashboard safety grain을 detector type까지 열지, category summary까지만 열지.
- redacted preview 길이/retention/RBAC 기준.
