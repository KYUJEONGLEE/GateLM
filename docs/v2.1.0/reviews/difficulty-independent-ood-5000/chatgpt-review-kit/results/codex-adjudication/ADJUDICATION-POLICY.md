# Dataset 2 Codex Core Adjudication Policy v1

문서 상태: 1,353개 core conflict에 적용한 고정 AI 보조 판정 규칙이다. 사람 검토나 training 승인이 아니다.

## 계수 규칙

1. Task는 독립적으로 요청된 행동을 센다. 최종 산출물의 형식 표기는 별도 task가 아니다. 명시적인 inspect/reconcile/verify 단계는 task다.
2. Constraint는 명시된 must/must-not, 보존·금지 조건과 task와 별도로 제시된 출력 형식 제한을 한 번씩 센다. 단순 배경은 세지 않는다.
3. Scope는 실제 처리 대상과 명시적으로 분리되거나 이름 붙은 source를 센다. 긴 단일 source는 하나다.
4. Dependency는 뒤 행동이 앞 행동의 결과를 사용할 때만 깊이를 올린다. 문장 순서, bullet, 출력 형식은 dependency가 아니다.
5. Category와 semantic label은 primary requested output으로 정한다. 제공된 노트에서 결정·근거·후속 조치를 구조화하는 작업은 새 계획 생성이 아니라 summarization이다.
6. Difficulty는 category별 active contract를 적용한다. 길이나 bucket 합만으로 정하지 않는다.

## Difficulty 적용

- 다단계 결과 의존, 명시적인 multi-source 공동 처리, 독립 제약 2개 이상, scope 4개 이상은 complex evidence다.
- general의 복수 작업, translation의 번역+추가 적응 작업, summarization의 복수 facet은 complex evidence다.
- summarization_multi_source, summarization_structured, reasoning_comparison과 이 corpus의 multi-factor reasoning_decision은 산출물 자체가 complex evidence다.
- 한 scope 안의 bounded code debug/refactor/explanation 보조 작업은 다른 구조 근거가 없으면 simple일 수 있다.
- localization/style-preserving 조건 하나만 있는 bounded translation은 여러 보존 제약이 결합된 경우가 아니므로 simple 경계 사례로 둔다.

## 객관성 제한

Codex는 Dataset 2 생성과 이전 비교 과정에 참여했으므로 독립 인간 reviewer가 아니다. 결과는 `codex_proposed_not_human_approved`로만 기록한다. confidence 0.90 미만, category difficulty 경계 및 두 입력 label 어느 쪽과도 일치하지 않는 구조 판정은 residual human-review queue로 보낸다.
