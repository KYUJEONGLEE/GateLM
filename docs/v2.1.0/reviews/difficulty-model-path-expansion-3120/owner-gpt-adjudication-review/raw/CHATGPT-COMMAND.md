첨부한 GateLM owner GPT adjudication ZIP의 압축을 풀고 OWNER-GPT-ADJUDICATION-INSTRUCTIONS.md와 LABEL-GUIDE.md를 먼저 전부 읽어라.

그다음 T1, T2, T3, T4, C1, C2, E1, E2, P1 순서로 9개 input JSONL을 중간 확인이나 추가 승인 요청 없이 모두 검토하라. 각 family의 5개 레코드는 반드시 함께 검토하되 batch는 합치거나 이동하지 마라.

기존 candidate와 blind independent GPT 제안 중 하나를 자동으로 신뢰하지 말고, label guide와 local Go/duplicate evidence를 비교해 owner-stage recommendation을 작성하라. proposedGoRoute가 model이 아닌 3건은 independent prompt를 그대로 채택하지 마라. P1은 label review에만 사용하고 모델·threshold 선택이나 승격 판단에 사용하지 마라.

OWNER-GPT-ADJUDICATION-INSTRUCTIONS.md의 출력 스키마와 파일명을 정확히 지켜 9개 output JSONL과 OWNER-GPT-VALIDATION-SUMMARY.json을 생성하라. 행 수·sampleId·순서를 유지하고, 결과 객체의 requiresHumanOwnerConfirmation은 항상 true로 둬라. owner-approved 또는 trainingEligible=true 상태를 만들지 마라.

결과 3,120건을 채팅 본문에 출력하지 말고, 코드로 파일을 작성한 뒤 10개 결과 파일을 하나의 ZIP으로 묶어서 제공하라.
