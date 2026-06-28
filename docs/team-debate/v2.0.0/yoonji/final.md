# Final - Yoonji / AI Safety & Evaluation

> 이 문서는 이윤지 역할 관점의 v2.0.0 team-debate 최종 의견 초안입니다.
> 공식 계약이 아니며 API, DB, Event, Metrics, security-sensitive field를 확정하지 않습니다.
> raw prompt/response/secret 예시는 포함하지 않습니다.

## 결론

지섭 제안에 대체로 동의합니다. v2.0.0은 엔터프라이즈 기술을 한 번에 붙이는 버전이 아니라, v1.x에서 검증한 실제 Provider, streaming, runtime config, performance evidence 위에 조직 기반 LLMOps Gateway MVP를 선언하는 목표 버전이어야 합니다.

AI Safety & Evaluation 관점에서 v2.0.0의 핵심은 더 많은 detector를 붙이는 것이 아니라, Gateway가 안전 판단을 일관되게 소비하고 팀이 그 판단을 raw data 없이 설명할 수 있게 만드는 것입니다.

## 윤지 역할의 제안

Main path는 SafetyDecision 책임 범위, synthetic PII expected outcome, rule-based detector 회귀 방지, Gateway 흐름 반영 확인입니다.

Shadow/evidence path는 PII masking 개선, detector corpus 확장, FP/FN report, RemoteSafetyEngine shadow evaluation, prompt injection/toxicity 후보 실험입니다.

소비해야 하는 계약은 RuntimeSnapshot safety policy, Gateway lifecycle, Observability 요약 요구, Product/Demo 표시 수준입니다.

생산해야 하는 계약은 SafetyDecision 책임 범위, synthetic evaluation case, expected outcome, detector 품질 report, raw data 없는 audit evidence입니다.

## v1.x 우선 처리

- P0 masking/block 동작 안정화
- synthetic PII corpus와 expected outcome 정리
- Gateway 처리 결과와 detector 결과의 불일치 확인
- raw prompt/response 저장 금지 기본값 유지
- SafetyDecision 책임 범위 초안 작성

## v2.0.0까지 남길 것

- RemoteSafetyEngine 실제 포함 여부
- prompt injection/toxicity의 제품 범위
- evaluation metric과 event/log field 이름
- 보안 민감 필드 저장/표시/접근 통제
- dashboard에 노출할 safety detail 수준

## 데모 Evidence

v2.0.0 데모에서는 실제 민감 정보가 아니라 synthetic case로 safety가 동작한다는 근거를 보여주는 것이 안전합니다. 보여줄 evidence는 redaction/block/pass outcome, regression 결과, FP/FN report, detector latency 후보, Gateway 흐름에 safety decision이 반영되는 장면입니다.

## 팀 결정 항목

- SafetyDecision을 내부 결정 객체로 둘지 외부 계약으로 승격할지
- raw prompt/response 저장 opt-in을 허용할지
- v2.0.0 safety category 범위를 어디까지 둘지
- demo 입력을 preset 중심으로 제한할지
- safety evidence를 dashboard에 어느 수준까지 보여줄지

## 한 줄 결론

Safety의 목표는 화려한 detector 목록이 아니라, v1.x에서 검증한 안전 판단을 v2.0.0 Gateway MVP 안에서 재현 가능하고 설명 가능하게 만드는 것입니다.
