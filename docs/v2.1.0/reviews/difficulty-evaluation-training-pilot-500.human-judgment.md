# Difficulty Pilot 500 — Human Judgment Queue

> AI 보조 전수 검수 결과입니다. 이 문서는 사람 승인을 대신하지 않으며 원본 500건은 계속 `trainingEligible=false`입니다.

- 원본: `docs/v2.1.0/fixtures/difficulty-evaluation-training-pilot-500.fixture.jsonl`
- 원본 SHA-256: `278be4bcf7764ed760b8f5e67858bf1587ad53a41d0bec71652f0b73b2ca8bc8`
- 전수 검수: 500건
- 사람 판단 큐: 120건
- AI 검수 완료(최종 사람 승인 대기): 380건
- 명백한 prompt template 수정 제안: 4건
- 누락된 필수 slice: `indirect_expression`, `synonym`, `payload_contamination`, `ood_terminology`

## 판단 방법

각 항목에서 category·difficulty·네 bucket·prompt family와 문장 수정안을 확인합니다. 수락해도 전체 데이터셋은 별도의 최종 사람 승인 전까지 학습에 사용할 수 없습니다.

## 1. `difficulty_general_simple_core_taskcontrast_f03_v01`

- 판단 사유: `single_added_task_boundary`
- 확인 질문: `confirm_added_task_crosses_difficulty_boundary`, `confirm_prompt_family_pairing`
- 제안 label: `general/simple`, `general_support`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.general.taskcontrast`
- prompt 수정 제안: 없음

> 비밀번호 최소 길이는 8자이고 입력값은 6자야. 가입이 거절된 이유를 한 문장으로 알려줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 2. `difficulty_general_simple_core_constraintcontrast_f03_v02`

- 판단 사유: `single_added_constraint_boundary`
- 확인 질문: `confirm_added_constraint_crosses_difficulty_boundary`, `confirm_prompt_family_pairing`
- 제안 label: `general/simple`, `general_support`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.general.constraintcontrast`
- prompt 수정 제안: 없음

> 환불 문의에 대한 고객 답변을 작성해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 3. `difficulty_general_simple_boundary_threshold_f05_v01`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `general/simple`, `general_qa`
- 제안 bucket: `count_1`, `count_2`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.general.simple.template.f05`
- prompt 수정 제안: 없음

> 전문 용어가 포함되어 있어도 추가 분석은 하지 말고 서비스 점검 시간의 뜻이나 위치만 그대로 알려줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 4. `difficulty_general_simple_boundary_threshold_f05_v02`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `general/simple`, `general_qa`
- 제안 bucket: `count_1`, `count_2`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.general.simple.template.f05`
- prompt 수정 제안: 없음

> 전문 용어가 포함되어 있어도 추가 분석은 하지 말고 계정 이름 변경 위치의 뜻이나 위치만 그대로 알려줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 5. `difficulty_general_simple_boundary_threshold_f05_v03`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `general/simple`, `general_qa`
- 제안 bucket: `count_1`, `count_2`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.general.simple.template.f05`
- prompt 수정 제안: 없음

> 전문 용어가 포함되어 있어도 추가 분석은 하지 말고 배송 상태 표시 의미의 뜻이나 위치만 그대로 알려줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 6. `difficulty_general_simple_boundary_threshold_f05_v04`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `general/simple`, `general_qa`
- 제안 bucket: `count_1`, `count_2`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.general.simple.template.f05`
- prompt 수정 제안: 없음

> 전문 용어가 포함되어 있어도 추가 분석은 하지 말고 회의실 예약 취소 방법의 뜻이나 위치만 그대로 알려줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 7. `difficulty_general_simple_boundary_threshold_f05_v05`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `general/simple`, `general_qa`
- 제안 bucket: `count_1`, `count_2`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.general.simple.template.f05`
- prompt 수정 제안: 없음

> 전문 용어가 포함되어 있어도 추가 분석은 하지 말고 구독 만료일 확인 경로의 뜻이나 위치만 그대로 알려줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 8. `difficulty_general_simple_boundary_threshold_f05_v06`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `general/simple`, `general_qa`
- 제안 bucket: `count_1`, `count_2`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.general.simple.template.f05`
- prompt 수정 제안: 없음

> 전문 용어가 포함되어 있어도 추가 분석은 하지 말고 알림 소리 끄는 메뉴의 뜻이나 위치만 그대로 알려줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 9. `difficulty_general_simple_boundary_threshold_f05_v07`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `general/simple`, `general_qa`
- 제안 bucket: `count_1`, `count_2`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.general.simple.template.f05`
- prompt 수정 제안: 없음

> Even if the wording sounds technical, just state the meaning or location of the office Wi-Fi guest password policy without further analysis.

- [ ] 제안 수락
- [ ] 수정 필요

## 10. `difficulty_general_simple_boundary_threshold_f05_v08`

- 판단 사유: `difficulty_threshold`, `prompt_template_artifact_corrected`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`, `confirm_prompt_rewrite`
- 제안 label: `general/simple`, `general_qa`
- 제안 bucket: `count_1`, `count_2`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.general.simple.template.f05`
- prompt 수정 제안: 있음

> Even if the wording sounds technical, state where the billing history page is without further analysis.

- [ ] 제안 수락
- [ ] 수정 필요

## 11. `difficulty_general_simple_boundary_threshold_f05_v09`

- 판단 사유: `difficulty_threshold`, `prompt_template_artifact_corrected`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`, `confirm_prompt_rewrite`
- 제안 label: `general/simple`, `general_qa`
- 제안 bucket: `count_1`, `count_2`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.general.simple.template.f05`
- prompt 수정 제안: 있음

> Even if the wording sounds technical, state what the yellow status icon means without further analysis.

- [ ] 제안 수락
- [ ] 수정 필요

## 12. `difficulty_general_simple_boundary_threshold_f05_v10`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `general/simple`, `general_qa`
- 제안 bucket: `count_1`, `count_2`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.general.simple.template.f05`
- prompt 수정 제안: 없음

> technical term이어도 분석하지 말고 Dashboard의 usage badge 의미의 meaning이나 location만 알려줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 13. `difficulty_general_complex_core_taskcontrast_f03_v01`

- 판단 사유: `single_added_task_boundary`
- 확인 질문: `confirm_added_task_crosses_difficulty_boundary`, `confirm_prompt_family_pairing`
- 제안 label: `general/complex`, `general_support`
- 제안 bucket: `count_2`, `count_0_to_1`, `count_1`, `depth_2`
- 제안 family: `pilot.general.taskcontrast`
- prompt 수정 제안: 없음

> 비밀번호 최소 길이는 8자이고 입력값은 6자야. 가입이 거절된 이유를 한 문장으로 알려줘. 그리고 가입 복구 절차를 작성해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 14. `difficulty_general_complex_core_constraintcontrast_f03_v02`

- 판단 사유: `single_added_constraint_boundary`
- 확인 질문: `confirm_added_constraint_crosses_difficulty_boundary`, `confirm_prompt_family_pairing`
- 제안 label: `general/complex`, `general_support`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_2_to_3`, `depth_2`
- 제안 family: `pilot.general.constraintcontrast`
- prompt 수정 제안: 없음

> 환불 문의에 대한 고객 답변을 작성해줘. 단, 국가별 예외 규칙을 반드시 반영해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 15. `difficulty_general_complex_boundary_threshold_f05_v01`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `general/complex`, `general_support`
- 제안 bucket: `count_3_plus`, `count_0_to_1`, `count_1`, `depth_3_plus`
- 제안 family: `pilot.general.complex.template.f05`
- prompt 수정 제안: 없음

> 다음 업무를 한 문단으로 답하되 준비 조건, 실패 시 대체 경로, 완료 검증 방법을 모두 포함해줘: 신규 직원 온보딩.

- [ ] 제안 수락
- [ ] 수정 필요

## 16. `difficulty_general_complex_boundary_threshold_f05_v02`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `general/complex`, `general_support`
- 제안 bucket: `count_3_plus`, `count_0_to_1`, `count_1`, `depth_3_plus`
- 제안 family: `pilot.general.complex.template.f05`
- prompt 수정 제안: 없음

> 다음 업무를 한 문단으로 답하되 준비 조건, 실패 시 대체 경로, 완료 검증 방법을 모두 포함해줘: 배송 지연 고객 대응.

- [ ] 제안 수락
- [ ] 수정 필요

## 17. `difficulty_general_complex_boundary_threshold_f05_v03`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `general/complex`, `general_support`
- 제안 bucket: `count_3_plus`, `count_0_to_1`, `count_1`, `depth_3_plus`
- 제안 family: `pilot.general.complex.template.f05`
- prompt 수정 제안: 없음

> 다음 업무를 한 문단으로 답하되 준비 조건, 실패 시 대체 경로, 완료 검증 방법을 모두 포함해줘: 사무실 이전 준비.

- [ ] 제안 수락
- [ ] 수정 필요

## 18. `difficulty_general_complex_boundary_threshold_f05_v04`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `general/complex`, `general_support`
- 제안 bucket: `count_3_plus`, `count_0_to_1`, `count_1`, `depth_3_plus`
- 제안 family: `pilot.general.complex.template.f05`
- prompt 수정 제안: 없음

> 다음 업무를 한 문단으로 답하되 준비 조건, 실패 시 대체 경로, 완료 검증 방법을 모두 포함해줘: 구독 해지 후속 처리.

- [ ] 제안 수락
- [ ] 수정 필요

## 19. `difficulty_general_complex_boundary_threshold_f05_v05`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `general/complex`, `general_support`
- 제안 bucket: `count_3_plus`, `count_0_to_1`, `count_1`, `depth_3_plus`
- 제안 family: `pilot.general.complex.template.f05`
- prompt 수정 제안: 없음

> 다음 업무를 한 문단으로 답하되 준비 조건, 실패 시 대체 경로, 완료 검증 방법을 모두 포함해줘: 분기별 접근 권한 점검.

- [ ] 제안 수락
- [ ] 수정 필요

## 20. `difficulty_general_complex_boundary_threshold_f05_v06`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `general/complex`, `general_support`
- 제안 bucket: `count_3_plus`, `count_0_to_1`, `count_1`, `depth_3_plus`
- 제안 family: `pilot.general.complex.template.f05`
- prompt 수정 제안: 없음

> 다음 업무를 한 문단으로 답하되 준비 조건, 실패 시 대체 경로, 완료 검증 방법을 모두 포함해줘: 장애 공지와 복구 안내.

- [ ] 제안 수락
- [ ] 수정 필요

## 21. `difficulty_general_complex_boundary_threshold_f05_v07`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `general/complex`, `general_support`
- 제안 bucket: `count_3_plus`, `count_0_to_1`, `count_1`, `depth_3_plus`
- 제안 family: `pilot.general.complex.template.f05`
- prompt 수정 제안: 없음

> Answer in one paragraph, but include prerequisites, a fallback path, and completion verification for a multi-region office closure response.

- [ ] 제안 수락
- [ ] 수정 필요

## 22. `difficulty_general_complex_boundary_threshold_f05_v08`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `general/complex`, `general_support`
- 제안 bucket: `count_3_plus`, `count_0_to_1`, `count_1`, `depth_3_plus`
- 제안 family: `pilot.general.complex.template.f05`
- prompt 수정 제안: 없음

> Answer in one paragraph, but include prerequisites, a fallback path, and completion verification for an account recovery support workflow.

- [ ] 제안 수락
- [ ] 수정 필요

## 23. `difficulty_general_complex_boundary_threshold_f05_v09`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `general/complex`, `general_support`
- 제안 bucket: `count_3_plus`, `count_0_to_1`, `count_1`, `depth_3_plus`
- 제안 family: `pilot.general.complex.template.f05`
- prompt 수정 제안: 없음

> Answer in one paragraph, but include prerequisites, a fallback path, and completion verification for a vendor onboarding and approval process.

- [ ] 제안 수락
- [ ] 수정 필요

## 24. `difficulty_general_complex_boundary_threshold_f05_v10`

- 판단 사유: `difficulty_threshold`, `prompt_template_artifact_corrected`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`, `confirm_prompt_rewrite`
- 제안 label: `general/complex`, `general_support`
- 제안 bucket: `count_3_plus`, `count_0_to_1`, `count_1`, `depth_3_plus`
- 제안 family: `pilot.general.complex.template.f05`
- prompt 수정 제안: 있음

> Enterprise plan의 renewal 운영 절차를 one paragraph로 쓰되 prerequisite, fallback, completion check를 모두 포함해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 25. `difficulty_code_simple_core_taskcontrast_f03_v01`

- 판단 사유: `single_added_task_boundary`
- 확인 질문: `confirm_added_task_crosses_difficulty_boundary`, `confirm_prompt_family_pairing`
- 제안 label: `code/simple`, `code_refactoring`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.code.taskcontrast`
- prompt 수정 제안: 없음

> Go 함수의 변수 이름 userNmae를 userName으로 바꿔줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 26. `difficulty_code_simple_core_constraintcontrast_f03_v02`

- 판단 사유: `single_added_constraint_boundary`
- 확인 질문: `confirm_added_constraint_crosses_difficulty_boundary`, `confirm_prompt_family_pairing`
- 제안 label: `code/simple`, `code_refactoring`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.code.constraintcontrast`
- prompt 수정 제안: 없음

> 이 TypeScript 함수 이름을 바꿔줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 27. `difficulty_code_simple_boundary_threshold_f05_v01`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `code/simple`, `code_generation`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.code.simple.template.f05`
- prompt 수정 제안: 없음

> 아래 요구는 기술 용어가 길지만 작업은 하나뿐이야. 가장 짧은 형태로 작성해줘: Go에서 문자열 앞뒤 공백을 제거하는 코드.

- [ ] 제안 수락
- [ ] 수정 필요

## 28. `difficulty_code_simple_boundary_threshold_f05_v02`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `code/simple`, `code_generation`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.code.simple.template.f05`
- prompt 수정 제안: 없음

> 아래 요구는 기술 용어가 길지만 작업은 하나뿐이야. 가장 짧은 형태로 작성해줘: Python 리스트의 길이를 구하는 코드.

- [ ] 제안 수락
- [ ] 수정 필요

## 29. `difficulty_code_simple_boundary_threshold_f05_v03`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `code/simple`, `code_generation`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.code.simple.template.f05`
- prompt 수정 제안: 없음

> 아래 요구는 기술 용어가 길지만 작업은 하나뿐이야. 가장 짧은 형태로 작성해줘: JavaScript 숫자를 문자열로 바꾸는 코드.

- [ ] 제안 수락
- [ ] 수정 필요

## 30. `difficulty_code_simple_boundary_threshold_f05_v04`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `code/simple`, `code_generation`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.code.simple.template.f05`
- prompt 수정 제안: 없음

> 아래 요구는 기술 용어가 길지만 작업은 하나뿐이야. 가장 짧은 형태로 작성해줘: SQL에서 상위 다섯 행만 조회하는 문장.

- [ ] 제안 수락
- [ ] 수정 필요

## 31. `difficulty_code_simple_boundary_threshold_f05_v05`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `code/simple`, `code_generation`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.code.simple.template.f05`
- prompt 수정 제안: 없음

> 아래 요구는 기술 용어가 길지만 작업은 하나뿐이야. 가장 짧은 형태로 작성해줘: Java에서 현재 시간이 비어 있는지 확인하는 조건문.

- [ ] 제안 수락
- [ ] 수정 필요

## 32. `difficulty_code_simple_boundary_threshold_f05_v06`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `code/simple`, `code_generation`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.code.simple.template.f05`
- prompt 수정 제안: 없음

> 아래 요구는 기술 용어가 길지만 작업은 하나뿐이야. 가장 짧은 형태로 작성해줘: CSS 버튼 글자를 가운데 정렬하는 속성.

- [ ] 제안 수락
- [ ] 수정 필요

## 33. `difficulty_code_simple_boundary_threshold_f05_v07`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `code/simple`, `code_generation`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.code.simple.template.f05`
- prompt 수정 제안: 없음

> The terminology is long, but this is one operation: write the shortest form of a Rust function that adds two integers.

- [ ] 제안 수락
- [ ] 수정 필요

## 34. `difficulty_code_simple_boundary_threshold_f05_v08`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `code/simple`, `code_generation`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.code.simple.template.f05`
- prompt 수정 제안: 없음

> The terminology is long, but this is one operation: write the shortest form of a TypeScript type for an optional name.

- [ ] 제안 수락
- [ ] 수정 필요

## 35. `difficulty_code_simple_boundary_threshold_f05_v09`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `code/simple`, `code_generation`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.code.simple.template.f05`
- prompt 수정 제안: 없음

> The terminology is long, but this is one operation: write the shortest form of a Bash command that prints the working directory.

- [ ] 제안 수락
- [ ] 수정 필요

## 36. `difficulty_code_simple_boundary_threshold_f05_v10`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `code/simple`, `code_generation`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.code.simple.template.f05`
- prompt 수정 제안: 없음

> technical wording은 길지만 single operation이야. Kotlin에서 nullable String을 확인하는 if문을 shortest form으로 작성해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 37. `difficulty_code_complex_core_taskcontrast_f03_v01`

- 판단 사유: `single_added_task_boundary`
- 확인 질문: `confirm_added_task_crosses_difficulty_boundary`, `confirm_prompt_family_pairing`
- 제안 label: `code/complex`, `code_refactoring`
- 제안 bucket: `count_2`, `count_0_to_1`, `count_2_to_3`, `depth_2`
- 제안 family: `pilot.code.taskcontrast`
- prompt 수정 제안: 없음

> Go 함수의 변수 이름 userNmae를 userName으로 바꿔줘. 그리고 이 함수를 호출하는 부분도 수정해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 38. `difficulty_code_complex_core_constraintcontrast_f03_v02`

- 판단 사유: `single_added_constraint_boundary`
- 확인 질문: `confirm_added_constraint_crosses_difficulty_boundary`, `confirm_prompt_family_pairing`
- 제안 label: `code/complex`, `code_refactoring`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_2`
- 제안 family: `pilot.code.constraintcontrast`
- prompt 수정 제안: 없음

> 이 TypeScript 함수 이름을 바꿔줘. 단, 외부 API 호환성을 유지해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 39. `difficulty_code_complex_boundary_threshold_f05_v01`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `code/complex`, `code_debugging`
- 제안 bucket: `count_3_plus`, `count_0_to_1`, `count_1`, `depth_3_plus`
- 제안 family: `pilot.code.complex.template.f05`
- prompt 수정 제안: 없음

> 다음 대상이 가끔만 실패한다. 로그를 늘릴 위치, 가설 검증 순서, 안전한 롤백 조건을 짧게 제시해줘: 동시 요청에서 중복 결제가 발생하는 서비스.

- [ ] 제안 수락
- [ ] 수정 필요

## 40. `difficulty_code_complex_boundary_threshold_f05_v02`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `code/complex`, `code_debugging`
- 제안 bucket: `count_3_plus`, `count_0_to_1`, `count_1`, `depth_3_plus`
- 제안 family: `pilot.code.complex.template.f05`
- prompt 수정 제안: 없음

> 다음 대상이 가끔만 실패한다. 로그를 늘릴 위치, 가설 검증 순서, 안전한 롤백 조건을 짧게 제시해줘: 캐시 갱신 중 오래된 값이 되살아나는 모듈.

- [ ] 제안 수락
- [ ] 수정 필요

## 41. `difficulty_code_complex_boundary_threshold_f05_v03`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `code/complex`, `code_debugging`
- 제안 bucket: `count_3_plus`, `count_0_to_1`, `count_1`, `depth_3_plus`
- 제안 family: `pilot.code.complex.template.f05`
- prompt 수정 제안: 없음

> 다음 대상이 가끔만 실패한다. 로그를 늘릴 위치, 가설 검증 순서, 안전한 롤백 조건을 짧게 제시해줘: 여러 파일에 흩어진 권한 검사 로직.

- [ ] 제안 수락
- [ ] 수정 필요

## 42. `difficulty_code_complex_boundary_threshold_f05_v04`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `code/complex`, `code_debugging`
- 제안 bucket: `count_3_plus`, `count_0_to_1`, `count_1`, `depth_3_plus`
- 제안 family: `pilot.code.complex.template.f05`
- prompt 수정 제안: 없음

> 다음 대상이 가끔만 실패한다. 로그를 늘릴 위치, 가설 검증 순서, 안전한 롤백 조건을 짧게 제시해줘: 재시도와 타임아웃이 겹치는 작업 큐.

- [ ] 제안 수락
- [ ] 수정 필요

## 43. `difficulty_code_complex_boundary_threshold_f05_v05`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `code/complex`, `code_debugging`
- 제안 bucket: `count_3_plus`, `count_0_to_1`, `count_1`, `depth_3_plus`
- 제안 family: `pilot.code.complex.template.f05`
- prompt 수정 제안: 없음

> 다음 대상이 가끔만 실패한다. 로그를 늘릴 위치, 가설 검증 순서, 안전한 롤백 조건을 짧게 제시해줘: 메모리 사용량이 계속 증가하는 스트림 처리기.

- [ ] 제안 수락
- [ ] 수정 필요

## 44. `difficulty_code_complex_boundary_threshold_f05_v06`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `code/complex`, `code_debugging`
- 제안 bucket: `count_3_plus`, `count_0_to_1`, `count_1`, `depth_3_plus`
- 제안 family: `pilot.code.complex.template.f05`
- prompt 수정 제안: 없음

> 다음 대상이 가끔만 실패한다. 로그를 늘릴 위치, 가설 검증 순서, 안전한 롤백 조건을 짧게 제시해줘: 두 버전의 API를 함께 지원해야 하는 클라이언트.

- [ ] 제안 수락
- [ ] 수정 필요

## 45. `difficulty_code_complex_boundary_threshold_f05_v07`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `code/complex`, `code_debugging`
- 제안 bucket: `count_3_plus`, `count_0_to_1`, `count_1`, `depth_3_plus`
- 제안 family: `pilot.code.complex.template.f05`
- prompt 수정 제안: 없음

> a distributed lock that occasionally admits two workers fails intermittently; briefly specify instrumentation points, hypothesis order, and safe rollback conditions.

- [ ] 제안 수락
- [ ] 수정 필요

## 46. `difficulty_code_complex_boundary_threshold_f05_v08`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `code/complex`, `code_debugging`
- 제안 bucket: `count_3_plus`, `count_0_to_1`, `count_1`, `depth_3_plus`
- 제안 family: `pilot.code.complex.template.f05`
- prompt 수정 제안: 없음

> a schema migration with rolling deployment compatibility fails intermittently; briefly specify instrumentation points, hypothesis order, and safe rollback conditions.

- [ ] 제안 수락
- [ ] 수정 필요

## 47. `difficulty_code_complex_boundary_threshold_f05_v09`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `code/complex`, `code_debugging`
- 제안 bucket: `count_3_plus`, `count_0_to_1`, `count_1`, `depth_3_plus`
- 제안 family: `pilot.code.complex.template.f05`
- prompt 수정 제안: 없음

> an event consumer that loses ordering during retries fails intermittently; briefly specify instrumentation points, hypothesis order, and safe rollback conditions.

- [ ] 제안 수락
- [ ] 수정 필요

## 48. `difficulty_code_complex_boundary_threshold_f05_v10`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `code/complex`, `code_debugging`
- 제안 bucket: `count_3_plus`, `count_0_to_1`, `count_1`, `depth_3_plus`
- 제안 family: `pilot.code.complex.template.f05`
- prompt 수정 제안: 없음

> multi-tenant cache의 key isolation 문제이 intermittent하게 실패해. instrumentation, hypothesis order, safe rollback condition을 짧게 줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 49. `difficulty_translation_simple_core_taskcontrast_f03_v01`

- 판단 사유: `single_added_task_boundary`
- 확인 질문: `confirm_added_task_crosses_difficulty_boundary`, `confirm_prompt_family_pairing`
- 제안 label: `translation/simple`, `translation_direct`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.translation.taskcontrast`
- prompt 수정 제안: 없음

> '빌드가 통과했습니다'를 영어로 번역해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 50. `difficulty_translation_simple_core_constraintcontrast_f03_v02`

- 판단 사유: `single_added_constraint_boundary`
- 확인 질문: `confirm_added_constraint_crosses_difficulty_boundary`, `confirm_prompt_family_pairing`
- 제안 label: `translation/simple`, `translation_direct`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.translation.simple.constraintcontrast`
- prompt 수정 제안: 없음

> '상태 보고서: 점검이 끝났습니다'를 영어로 번역해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 51. `difficulty_translation_simple_boundary_threshold_f05_v01`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `translation/simple`, `translation_direct`
- 제안 bucket: `count_1`, `count_3_plus`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.translation.simple.template.f05`
- prompt 수정 제안: 없음

> 여러 의미를 분석하지 말고 가장 흔한 뜻으로 '회의는 세 시에 시작합니다'를 영어로 한 번만 번역해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 52. `difficulty_translation_simple_boundary_threshold_f05_v02`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `translation/simple`, `translation_direct`
- 제안 bucket: `count_1`, `count_3_plus`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.translation.simple.template.f05`
- prompt 수정 제안: 없음

> 여러 의미를 분석하지 말고 가장 흔한 뜻으로 '문을 닫아 주세요'를 일본어로 한 번만 번역해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 53. `difficulty_translation_simple_boundary_threshold_f05_v03`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `translation/simple`, `translation_direct`
- 제안 bucket: `count_1`, `count_3_plus`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.translation.simple.template.f05`
- prompt 수정 제안: 없음

> 여러 의미를 분석하지 말고 가장 흔한 뜻으로 '배송이 완료되었습니다'를 영어로 한 번만 번역해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 54. `difficulty_translation_simple_boundary_threshold_f05_v04`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `translation/simple`, `translation_direct`
- 제안 bucket: `count_1`, `count_3_plus`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.translation.simple.template.f05`
- prompt 수정 제안: 없음

> 여러 의미를 분석하지 말고 가장 흔한 뜻으로 '오늘은 휴무입니다'를 중국어로 한 번만 번역해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 55. `difficulty_translation_simple_boundary_threshold_f05_v05`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `translation/simple`, `translation_direct`
- 제안 bucket: `count_1`, `count_3_plus`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.translation.simple.template.f05`
- prompt 수정 제안: 없음

> 여러 의미를 분석하지 말고 가장 흔한 뜻으로 '비밀번호를 다시 입력하세요'를 영어로 한 번만 번역해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 56. `difficulty_translation_simple_boundary_threshold_f05_v06`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `translation/simple`, `translation_direct`
- 제안 bucket: `count_1`, `count_3_plus`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.translation.simple.template.f05`
- prompt 수정 제안: 없음

> 여러 의미를 분석하지 말고 가장 흔한 뜻으로 '예약이 확정되었습니다'를 프랑스어로 한 번만 번역해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 57. `difficulty_translation_simple_boundary_threshold_f05_v07`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `translation/simple`, `translation_direct`
- 제안 bucket: `count_1`, `count_3_plus`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.translation.simple.template.f05`
- prompt 수정 제안: 없음

> Translate 'The package arrived safely' into Korean once using the most common meaning, without analyzing alternatives.

- [ ] 제안 수락
- [ ] 수정 필요

## 58. `difficulty_translation_simple_boundary_threshold_f05_v08`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `translation/simple`, `translation_direct`
- 제안 bucket: `count_1`, `count_3_plus`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.translation.simple.template.f05`
- prompt 수정 제안: 없음

> Translate 'Please wait here' into Spanish once using the most common meaning, without analyzing alternatives.

- [ ] 제안 수락
- [ ] 수정 필요

## 59. `difficulty_translation_simple_boundary_threshold_f05_v09`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `translation/simple`, `translation_direct`
- 제안 bucket: `count_1`, `count_3_plus`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.translation.simple.template.f05`
- prompt 수정 제안: 없음

> Translate 'The meeting was canceled' into German once using the most common meaning, without analyzing alternatives.

- [ ] 제안 수락
- [ ] 수정 필요

## 60. `difficulty_translation_simple_boundary_threshold_f05_v10`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `translation/simple`, `translation_direct`
- 제안 bucket: `count_1`, `count_3_plus`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.translation.simple.template.f05`
- prompt 수정 제안: 없음

> alternative 분석 없이 common meaning으로 '업데이트가 ready되었습니다'를 자연스러운 English로 한 번만 translate해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 61. `difficulty_translation_complex_core_taskcontrast_f03_v01`

- 판단 사유: `single_added_task_boundary`
- 확인 질문: `confirm_added_task_crosses_difficulty_boundary`, `confirm_prompt_family_pairing`
- 제안 label: `translation/complex`, `translation_direct`
- 제안 bucket: `count_2`, `count_0_to_1`, `count_1`, `depth_2`
- 제안 family: `pilot.translation.taskcontrast`
- prompt 수정 제안: 없음

> '빌드가 통과했습니다'를 영어로 번역해줘. 그리고 용어 선택 이유를 설명해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 62. `difficulty_translation_complex_core_constraintcontrast_f03_v02`

- 판단 사유: `single_added_constraint_boundary`
- 확인 질문: `confirm_added_constraint_crosses_difficulty_boundary`, `confirm_prompt_family_pairing`
- 제안 label: `translation/complex`, `translation_style_preserving`
- 제안 bucket: `count_1`, `count_2`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.translation.complex.constraintcontrast`
- prompt 수정 제안: 없음

> '상태 보고서: 점검이 끝났습니다'를 영어로 번역해줘. 단, 표 제목인 '상태 보고서'는 번역하지 마.

- [ ] 제안 수락
- [ ] 수정 필요

## 63. `difficulty_translation_complex_boundary_threshold_f05_v01`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `translation/complex`, `translation_localization`
- 제안 bucket: `count_3_plus`, `count_3_plus`, `count_2_to_3`, `depth_2`
- 제안 family: `pilot.translation.complex.template.f05`
- prompt 수정 제안: 없음

> 짧은 문구인 개인정보 처리방침의 정의와 예외 조항을 영어로 번역이지만 규제 의미와 브랜드 말투가 모두 유지되도록 두 후보를 만들고 차이를 설명해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 64. `difficulty_translation_complex_boundary_threshold_f05_v02`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `translation/complex`, `translation_localization`
- 제안 bucket: `count_3_plus`, `count_3_plus`, `count_2_to_3`, `depth_2`
- 제안 family: `pilot.translation.complex.template.f05`
- prompt 수정 제안: 없음

> 짧은 문구인 의료기기 사용 안내와 경고 문구를 일본어로 번역이지만 규제 의미와 브랜드 말투가 모두 유지되도록 두 후보를 만들고 차이를 설명해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 65. `difficulty_translation_complex_boundary_threshold_f05_v03`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `translation/complex`, `translation_localization`
- 제안 bucket: `count_3_plus`, `count_3_plus`, `count_2_to_3`, `depth_2`
- 제안 family: `pilot.translation.complex.template.f05`
- prompt 수정 제안: 없음

> 짧은 문구인 결제 약관의 의무 표현과 상호 참조를 영어로 번역이지만 규제 의미와 브랜드 말투가 모두 유지되도록 두 후보를 만들고 차이를 설명해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 66. `difficulty_translation_complex_boundary_threshold_f05_v04`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `translation/complex`, `translation_localization`
- 제안 bucket: `count_3_plus`, `count_3_plus`, `count_2_to_3`, `depth_2`
- 제안 family: `pilot.translation.complex.template.f05`
- prompt 수정 제안: 없음

> 짧은 문구인 게임 캐릭터 대사의 말투와 말장난을 프랑스어로 번역이지만 규제 의미와 브랜드 말투가 모두 유지되도록 두 후보를 만들고 차이를 설명해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 67. `difficulty_translation_complex_boundary_threshold_f05_v05`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `translation/complex`, `translation_localization`
- 제안 bucket: `count_3_plus`, `count_3_plus`, `count_2_to_3`, `depth_2`
- 제안 family: `pilot.translation.complex.template.f05`
- prompt 수정 제안: 없음

> 짧은 문구인 제품 UI 문자열과 치환 변수를 독일어로 번역이지만 규제 의미와 브랜드 말투가 모두 유지되도록 두 후보를 만들고 차이를 설명해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 68. `difficulty_translation_complex_boundary_threshold_f05_v06`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `translation/complex`, `translation_localization`
- 제안 bucket: `count_3_plus`, `count_3_plus`, `count_2_to_3`, `depth_2`
- 제안 family: `pilot.translation.complex.template.f05`
- prompt 수정 제안: 없음

> 짧은 문구인 투자 보고서의 전문 용어와 표 제목을 영어로 번역이지만 규제 의미와 브랜드 말투가 모두 유지되도록 두 후보를 만들고 차이를 설명해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 69. `difficulty_translation_complex_boundary_threshold_f05_v07`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `translation/complex`, `translation_localization`
- 제안 bucket: `count_3_plus`, `count_3_plus`, `count_2_to_3`, `depth_2`
- 제안 family: `pilot.translation.complex.template.f05`
- prompt 수정 제안: 없음

> Although a legal notice with defined terms into Korean is short, produce two translations preserving regulatory meaning and brand voice, then explain the difference.

- [ ] 제안 수락
- [ ] 수정 필요

## 70. `difficulty_translation_complex_boundary_threshold_f05_v08`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `translation/complex`, `translation_localization`
- 제안 bucket: `count_3_plus`, `count_3_plus`, `count_2_to_3`, `depth_2`
- 제안 family: `pilot.translation.complex.template.f05`
- prompt 수정 제안: 없음

> Although a clinical trial summary with dosage units into Japanese is short, produce two translations preserving regulatory meaning and brand voice, then explain the difference.

- [ ] 제안 수락
- [ ] 수정 필요

## 71. `difficulty_translation_complex_boundary_threshold_f05_v09`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `translation/complex`, `translation_localization`
- 제안 bucket: `count_3_plus`, `count_3_plus`, `count_2_to_3`, `depth_2`
- 제안 family: `pilot.translation.complex.template.f05`
- prompt 수정 제안: 없음

> Although a marketing campaign with culture-specific humor into Korean is short, produce two translations preserving regulatory meaning and brand voice, then explain the difference.

- [ ] 제안 수락
- [ ] 수정 필요

## 72. `difficulty_translation_complex_boundary_threshold_f05_v10`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `translation/complex`, `translation_localization`
- 제안 bucket: `count_3_plus`, `count_3_plus`, `count_2_to_3`, `depth_2`
- 제안 family: `pilot.translation.complex.template.f05`
- prompt 수정 제안: 없음

> 짧은 API migration guide의 code token을 보존해 한국어로지만 regulatory meaning과 brand voice를 유지한 두 translation과 차이를 줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 73. `difficulty_summarization_simple_core_taskcontrast_f03_v01`

- 판단 사유: `single_added_task_boundary`
- 확인 질문: `confirm_added_task_crosses_difficulty_boundary`, `confirm_prompt_family_pairing`
- 제안 label: `summarization/simple`, `summarization_direct`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.summarization.simple.taskcontrast`
- prompt 수정 제안: 없음

> '배포일은 금요일이고 담당자는 아직 정해지지 않았다'를 한 문장으로 요약해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 74. `difficulty_summarization_simple_core_constraintcontrast_f03_v02`

- 판단 사유: `single_added_constraint_boundary`
- 확인 질문: `confirm_added_constraint_crosses_difficulty_boundary`, `confirm_prompt_family_pairing`
- 제안 label: `summarization/simple`, `summarization_direct`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.summarization.constraintcontrast`
- prompt 수정 제안: 없음

> '점검은 월요일에 끝났고 서비스는 정상이다'를 요약해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 75. `difficulty_summarization_simple_boundary_threshold_f05_v01`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `summarization/simple`, `summarization_direct`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.summarization.simple.template.f05`
- prompt 수정 제안: 없음

> 표현은 업무 문서처럼 길지만 정보는 하나뿐이야. 다음 문장을 짧게 줄여줘: 공지: 정기 점검은 화요일 오전 두 시부터 세 시까지 진행됩니다

- [ ] 제안 수락
- [ ] 수정 필요

## 76. `difficulty_summarization_simple_boundary_threshold_f05_v02`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `summarization/simple`, `summarization_direct`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.summarization.simple.template.f05`
- prompt 수정 제안: 없음

> 표현은 업무 문서처럼 길지만 정보는 하나뿐이야. 다음 문장을 짧게 줄여줘: 회의 메모: 다음 회의는 금요일이며 장소는 3층 회의실입니다

- [ ] 제안 수락
- [ ] 수정 필요

## 77. `difficulty_summarization_simple_boundary_threshold_f05_v03`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `summarization/simple`, `summarization_direct`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.summarization.simple.template.f05`
- prompt 수정 제안: 없음

> 표현은 업무 문서처럼 길지만 정보는 하나뿐이야. 다음 문장을 짧게 줄여줘: 배송 안내: 상품은 오늘 출고되었고 도착 예정일은 목요일입니다

- [ ] 제안 수락
- [ ] 수정 필요

## 78. `difficulty_summarization_simple_boundary_threshold_f05_v04`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `summarization/simple`, `summarization_direct`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.summarization.simple.template.f05`
- prompt 수정 제안: 없음

> 표현은 업무 문서처럼 길지만 정보는 하나뿐이야. 다음 문장을 짧게 줄여줘: 업데이트 노트: 검색 버튼의 위치만 상단으로 변경되었습니다

- [ ] 제안 수락
- [ ] 수정 필요

## 79. `difficulty_summarization_simple_boundary_threshold_f05_v05`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `summarization/simple`, `summarization_direct`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.summarization.simple.template.f05`
- prompt 수정 제안: 없음

> 표현은 업무 문서처럼 길지만 정보는 하나뿐이야. 다음 문장을 짧게 줄여줘: 휴무 안내: 고객센터는 공휴일에 운영하지 않습니다

- [ ] 제안 수락
- [ ] 수정 필요

## 80. `difficulty_summarization_simple_boundary_threshold_f05_v06`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `summarization/simple`, `summarization_direct`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.summarization.simple.template.f05`
- prompt 수정 제안: 없음

> 표현은 업무 문서처럼 길지만 정보는 하나뿐이야. 다음 문장을 짧게 줄여줘: 신청 결과: 교육 참가 신청이 승인되었습니다

- [ ] 제안 수락
- [ ] 수정 필요

## 81. `difficulty_summarization_simple_boundary_threshold_f05_v07`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `summarization/simple`, `summarization_direct`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.summarization.simple.template.f05`
- prompt 수정 제안: 없음

> The wording is formal and long, but it contains one fact; shorten it: Notice: The library closes at 6 p.m. on Friday

- [ ] 제안 수락
- [ ] 수정 필요

## 82. `difficulty_summarization_simple_boundary_threshold_f05_v08`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `summarization/simple`, `summarization_direct`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.summarization.simple.template.f05`
- prompt 수정 제안: 없음

> The wording is formal and long, but it contains one fact; shorten it: Meeting note: The owner is Mina and the due date is Monday

- [ ] 제안 수락
- [ ] 수정 필요

## 83. `difficulty_summarization_simple_boundary_threshold_f05_v09`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `summarization/simple`, `summarization_direct`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.summarization.simple.template.f05`
- prompt 수정 제안: 없음

> The wording is formal and long, but it contains one fact; shorten it: Release note: Only the icon color changed in this update

- [ ] 제안 수락
- [ ] 수정 필요

## 84. `difficulty_summarization_simple_boundary_threshold_f05_v10`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `summarization/simple`, `summarization_direct`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.summarization.simple.template.f05`
- prompt 수정 제안: 없음

> formal wording이지만 fact는 하나야. 다음을 short summary로 줄여줘: 공지: beta launch는 8월 1일이고 장소는 online입니다

- [ ] 제안 수락
- [ ] 수정 필요

## 85. `difficulty_summarization_complex_core_taskcontrast_f03_v01`

- 판단 사유: `single_added_task_boundary`
- 확인 질문: `confirm_added_task_crosses_difficulty_boundary`, `confirm_prompt_family_pairing`
- 제안 label: `summarization/complex`, `summarization_structured`
- 제안 bucket: `count_2`, `count_0_to_1`, `count_1`, `depth_2`
- 제안 family: `pilot.summarization.complex.taskcontrast`
- prompt 수정 제안: 없음

> '배포일은 금요일이고 담당자는 아직 정해지지 않았다'를 한 문장으로 요약해줘. 그리고 미해결 항목을 따로 적어줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 86. `difficulty_summarization_complex_core_constraintcontrast_f03_v02`

- 판단 사유: `single_added_constraint_boundary`
- 확인 질문: `confirm_added_constraint_crosses_difficulty_boundary`, `confirm_prompt_family_pairing`
- 제안 label: `summarization/complex`, `summarization_direct`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.summarization.constraintcontrast`
- prompt 수정 제안: 없음

> '점검은 월요일에 끝났고 서비스는 정상이다'를 요약해줘. 단, 각 문장에 출처 표시를 유지해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 87. `difficulty_summarization_complex_boundary_threshold_f05_v01`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `summarization/complex`, `summarization_multi_source`
- 제안 bucket: `count_1`, `count_3_plus`, `count_2_to_3`, `depth_2`
- 제안 family: `pilot.summarization.complex.template.f05`
- prompt 수정 제안: 없음

> 결과는 세 문장만 쓰되 세 팀의 장애 회고와 서로 다른 원인 분석의 변화 추세, 핵심 예외, 의사결정에 필요한 불확실성을 모두 보존해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 88. `difficulty_summarization_complex_boundary_threshold_f05_v02`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `summarization/complex`, `summarization_multi_source`
- 제안 bucket: `count_1`, `count_3_plus`, `count_4_plus`, `depth_2`
- 제안 family: `pilot.summarization.complex.template.f05`
- prompt 수정 제안: 없음

> 결과는 세 문장만 쓰되 분기별 사용자 인터뷰와 상충하는 개선 요청의 변화 추세, 핵심 예외, 의사결정에 필요한 불확실성을 모두 보존해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 89. `difficulty_summarization_complex_boundary_threshold_f05_v03`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `summarization/complex`, `summarization_multi_source`
- 제안 bucket: `count_1`, `count_3_plus`, `count_4_plus`, `depth_2`
- 제안 family: `pilot.summarization.complex.template.f05`
- prompt 수정 제안: 없음

> 결과는 세 문장만 쓰되 여러 회의의 결정 사항과 미지정 후속 작업의 변화 추세, 핵심 예외, 의사결정에 필요한 불확실성을 모두 보존해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 90. `difficulty_summarization_complex_boundary_threshold_f05_v04`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `summarization/complex`, `summarization_multi_source`
- 제안 bucket: `count_1`, `count_3_plus`, `count_2_to_3`, `depth_2`
- 제안 family: `pilot.summarization.complex.template.f05`
- prompt 수정 제안: 없음

> 결과는 세 문장만 쓰되 정책 개정 전후 문서와 변경 근거의 변화 추세, 핵심 예외, 의사결정에 필요한 불확실성을 모두 보존해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 91. `difficulty_summarization_complex_boundary_threshold_f05_v05`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `summarization/complex`, `summarization_multi_source`
- 제안 bucket: `count_1`, `count_3_plus`, `count_2_to_3`, `depth_2`
- 제안 family: `pilot.summarization.complex.template.f05`
- prompt 수정 제안: 없음

> 결과는 세 문장만 쓰되 두 공급업체 보고서의 비용과 위험 주장의 변화 추세, 핵심 예외, 의사결정에 필요한 불확실성을 모두 보존해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 92. `difficulty_summarization_complex_boundary_threshold_f05_v06`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `summarization/complex`, `summarization_multi_source`
- 제안 bucket: `count_1`, `count_3_plus`, `count_4_plus`, `depth_2`
- 제안 family: `pilot.summarization.complex.template.f05`
- prompt 수정 제안: 없음

> 결과는 세 문장만 쓰되 장기간 프로젝트 기록과 반복된 일정 변경의 변화 추세, 핵심 예외, 의사결정에 필요한 불확실성을 모두 보존해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 93. `difficulty_summarization_complex_boundary_threshold_f05_v07`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `summarization/complex`, `summarization_multi_source`
- 제안 bucket: `count_1`, `count_3_plus`, `count_2_to_3`, `depth_2`
- 제안 family: `pilot.summarization.complex.template.f05`
- prompt 수정 제안: 없음

> Use only three sentences, but preserve trends, key exceptions, and decision-relevant uncertainty from incident reports from three regions with conflicting timelines.

- [ ] 제안 수락
- [ ] 수정 필요

## 94. `difficulty_summarization_complex_boundary_threshold_f05_v08`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `summarization/complex`, `summarization_multi_source`
- 제안 bucket: `count_1`, `count_3_plus`, `count_4_plus`, `depth_2`
- 제안 family: `pilot.summarization.complex.template.f05`
- prompt 수정 제안: 없음

> Use only three sentences, but preserve trends, key exceptions, and decision-relevant uncertainty from multiple research notes with overlapping and contradictory findings.

- [ ] 제안 수락
- [ ] 수정 필요

## 95. `difficulty_summarization_complex_boundary_threshold_f05_v09`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `summarization/complex`, `summarization_multi_source`
- 제안 bucket: `count_1`, `count_3_plus`, `count_4_plus`, `depth_2`
- 제안 family: `pilot.summarization.complex.template.f05`
- prompt 수정 제안: 없음

> Use only three sentences, but preserve trends, key exceptions, and decision-relevant uncertainty from a quarter of meeting notes with decisions, owners, and unresolved risks.

- [ ] 제안 수락
- [ ] 수정 필요

## 96. `difficulty_summarization_complex_boundary_threshold_f05_v10`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `summarization/complex`, `summarization_multi_source`
- 제안 bucket: `count_1`, `count_3_plus`, `count_4_plus`, `depth_2`
- 제안 family: `pilot.summarization.complex.template.f05`
- prompt 수정 제안: 없음

> three sentences만 쓰되 여러 sprint retro의 action item과 unresolved risk의 trend, key exception, decision uncertainty를 모두 보존해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 97. `difficulty_reasoning_simple_core_taskcontrast_f03_v01`

- 판단 사유: `single_added_task_boundary`
- 확인 질문: `confirm_added_task_crosses_difficulty_boundary`, `confirm_prompt_family_pairing`
- 제안 label: `reasoning/simple`, `reasoning_decision`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_2_to_3`, `depth_0_to_1`
- 제안 family: `pilot.reasoning.taskcontrast`
- prompt 수정 제안: 없음

> 월 비용만 보면 A는 10만 원, B는 12만 원, C는 11만 원이야. 가장 저렴한 것을 골라줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 98. `difficulty_reasoning_simple_core_constraintcontrast_f03_v02`

- 판단 사유: `single_added_constraint_boundary`
- 확인 질문: `confirm_added_constraint_crosses_difficulty_boundary`, `confirm_prompt_family_pairing`
- 제안 label: `reasoning/simple`, `reasoning_decision`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_2_to_3`, `depth_0_to_1`
- 제안 family: `pilot.reasoning.constraintcontrast`
- prompt 수정 제안: 없음

> A는 월 10만 원에 250ms, B는 12만 원에 180ms, C는 11만 원에 210ms야. 월 비용이 가장 낮은 것을 골라줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 99. `difficulty_reasoning_simple_boundary_threshold_f05_v01`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `reasoning/simple`, `reasoning_decision`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_2_to_3`, `depth_0_to_1`
- 제안 family: `pilot.reasoning.simple.template.f05`
- prompt 수정 제안: 없음

> 문장이 길어 보여도 규칙은 하나야. 입력을 그대로 적용해서 12와 19 중 더 큰 수의 결과 하나만 반환해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 100. `difficulty_reasoning_simple_boundary_threshold_f05_v02`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `reasoning/simple`, `reasoning_decision`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.reasoning.simple.template.f05`
- prompt 수정 제안: 없음

> 문장이 길어 보여도 규칙은 하나야. 입력을 그대로 적용해서 오후 두 시에서 세 시간 뒤의 시각의 결과 하나만 반환해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 101. `difficulty_reasoning_simple_boundary_threshold_f05_v03`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `reasoning/simple`, `reasoning_decision`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.reasoning.simple.template.f05`
- prompt 수정 제안: 없음

> 문장이 길어 보여도 규칙은 하나야. 입력을 그대로 적용해서 개당 4천 원인 물건 세 개의 합계의 결과 하나만 반환해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 102. `difficulty_reasoning_simple_boundary_threshold_f05_v04`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `reasoning/simple`, `reasoning_decision`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_2_to_3`, `depth_0_to_1`
- 제안 family: `pilot.reasoning.simple.template.f05`
- prompt 수정 제안: 없음

> 문장이 길어 보여도 규칙은 하나야. 입력을 그대로 적용해서 길이 8과 5의 차이의 결과 하나만 반환해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 103. `difficulty_reasoning_simple_boundary_threshold_f05_v05`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `reasoning/simple`, `reasoning_decision`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.reasoning.simple.template.f05`
- prompt 수정 제안: 없음

> 문장이 길어 보여도 규칙은 하나야. 입력을 그대로 적용해서 점수가 70점 이상인지 여부의 결과 하나만 반환해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 104. `difficulty_reasoning_simple_boundary_threshold_f05_v06`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `reasoning/simple`, `reasoning_decision`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_2_to_3`, `depth_0_to_1`
- 제안 family: `pilot.reasoning.simple.template.f05`
- prompt 수정 제안: 없음

> 문장이 길어 보여도 규칙은 하나야. 입력을 그대로 적용해서 세 숫자 3, 1, 2의 오름차순의 결과 하나만 반환해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 105. `difficulty_reasoning_simple_boundary_threshold_f05_v07`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `reasoning/simple`, `reasoning_decision`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_2_to_3`, `depth_0_to_1`
- 제안 family: `pilot.reasoning.simple.template.f05`
- prompt 수정 제안: 없음

> The sentence may look long, but there is one rule; apply it directly and return which is larger, 42 or 37.

- [ ] 제안 수락
- [ ] 수정 필요

## 106. `difficulty_reasoning_simple_boundary_threshold_f05_v08`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `reasoning/simple`, `reasoning_decision`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.reasoning.simple.template.f05`
- prompt 수정 제안: 없음

> The sentence may look long, but there is one rule; apply it directly and return the total cost of four items at five dollars each.

- [ ] 제안 수락
- [ ] 수정 필요

## 107. `difficulty_reasoning_simple_boundary_threshold_f05_v09`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `reasoning/simple`, `reasoning_decision`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_1`, `depth_0_to_1`
- 제안 family: `pilot.reasoning.simple.template.f05`
- prompt 수정 제안: 없음

> The sentence may look long, but there is one rule; apply it directly and return whether 18 is divisible by 3.

- [ ] 제안 수락
- [ ] 수정 필요

## 108. `difficulty_reasoning_simple_boundary_threshold_f05_v10`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `reasoning/simple`, `reasoning_decision`
- 제안 bucket: `count_1`, `count_0_to_1`, `count_2_to_3`, `depth_0_to_1`
- 제안 family: `pilot.reasoning.simple.template.f05`
- prompt 수정 제안: 없음

> sentence는 길어도 single rule이야. 그대로 apply해서 score 85가 cutoff 80을 넘는지 result 하나만 반환해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 109. `difficulty_reasoning_complex_core_taskcontrast_f03_v01`

- 판단 사유: `single_added_task_boundary`
- 확인 질문: `confirm_added_task_crosses_difficulty_boundary`, `confirm_prompt_family_pairing`
- 제안 label: `reasoning/complex`, `reasoning_decision`
- 제안 bucket: `count_2`, `count_0_to_1`, `count_2_to_3`, `depth_2`
- 제안 family: `pilot.reasoning.taskcontrast`
- prompt 수정 제안: 없음

> 월 비용만 보면 A는 10만 원, B는 12만 원, C는 11만 원이야. 가장 저렴한 것을 골라줘. 그리고 사용할 수 없을 때의 차선책도 정해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 110. `difficulty_reasoning_complex_core_constraintcontrast_f03_v02`

- 판단 사유: `single_added_constraint_boundary`
- 확인 질문: `confirm_added_constraint_crosses_difficulty_boundary`, `confirm_prompt_family_pairing`
- 제안 label: `reasoning/complex`, `reasoning_decision`
- 제안 bucket: `count_1`, `count_2`, `count_2_to_3`, `depth_2`
- 제안 family: `pilot.reasoning.constraintcontrast`
- prompt 수정 제안: 없음

> A는 월 10만 원에 250ms, B는 12만 원에 180ms, C는 11만 원에 210ms야. 월 비용이 가장 낮은 것을 골라줘. 단, 응답 시간이 200ms 이하여야 해.

- [ ] 제안 수락
- [ ] 수정 필요

## 111. `difficulty_reasoning_complex_boundary_threshold_f05_v01`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `reasoning/complex`, `reasoning_decision`
- 제안 bucket: `count_3_plus`, `count_3_plus`, `count_2_to_3`, `depth_3_plus`
- 제안 family: `pilot.reasoning.complex.template.f05`
- prompt 수정 제안: 없음

> 세 지역 중 신규 물류 거점 선택의 답은 하나만 쓰되 불확실한 변수 두 개와 그 변수가 뒤집힐 때의 결론까지 검토해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 112. `difficulty_reasoning_complex_boundary_threshold_f05_v02`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `reasoning/complex`, `reasoning_decision`
- 제안 bucket: `count_3_plus`, `count_3_plus`, `count_4_plus`, `depth_3_plus`
- 제안 family: `pilot.reasoning.complex.template.f05`
- prompt 수정 제안: 없음

> 한정된 인력으로 네 프로젝트의 우선순위 결정의 답은 하나만 쓰되 불확실한 변수 두 개와 그 변수가 뒤집힐 때의 결론까지 검토해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 113. `difficulty_reasoning_complex_boundary_threshold_f05_v03`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `reasoning/complex`, `reasoning_decision`
- 제안 bucket: `count_3_plus`, `count_3_plus`, `count_2_to_3`, `depth_3_plus`
- 제안 family: `pilot.reasoning.complex.template.f05`
- prompt 수정 제안: 없음

> 비용과 안정성이 다른 데이터베이스 전환안 선택의 답은 하나만 쓰되 불확실한 변수 두 개와 그 변수가 뒤집힐 때의 결론까지 검토해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 114. `difficulty_reasoning_complex_boundary_threshold_f05_v04`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `reasoning/complex`, `reasoning_decision`
- 제안 bucket: `count_3_plus`, `count_3_plus`, `count_4_plus`, `depth_3_plus`
- 제안 family: `pilot.reasoning.complex.template.f05`
- prompt 수정 제안: 없음

> 상충하는 규칙을 만족하는 배포 순서 결정의 답은 하나만 쓰되 불확실한 변수 두 개와 그 변수가 뒤집힐 때의 결론까지 검토해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 115. `difficulty_reasoning_complex_boundary_threshold_f05_v05`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `reasoning/complex`, `reasoning_decision`
- 제안 bucket: `count_3_plus`, `count_3_plus`, `count_2_to_3`, `depth_3_plus`
- 제안 family: `pilot.reasoning.complex.template.f05`
- prompt 수정 제안: 없음

> 수요가 불확실한 제품 출시 시점 판단의 답은 하나만 쓰되 불확실한 변수 두 개와 그 변수가 뒤집힐 때의 결론까지 검토해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 116. `difficulty_reasoning_complex_boundary_threshold_f05_v06`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `reasoning/complex`, `reasoning_decision`
- 제안 bucket: `count_3_plus`, `count_3_plus`, `count_4_plus`, `depth_3_plus`
- 제안 family: `pilot.reasoning.complex.template.f05`
- prompt 수정 제안: 없음

> 여러 팀의 휴가 조건을 만족하는 일정 구성의 답은 하나만 쓰되 불확실한 변수 두 개와 그 변수가 뒤집힐 때의 결론까지 검토해줘.

- [ ] 제안 수락
- [ ] 수정 필요

## 117. `difficulty_reasoning_complex_boundary_threshold_f05_v07`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `reasoning/complex`, `reasoning_decision`
- 제안 bucket: `count_3_plus`, `count_3_plus`, `count_2_to_3`, `depth_3_plus`
- 제안 family: `pilot.reasoning.complex.template.f05`
- prompt 수정 제안: 없음

> Give one answer for choosing among three vendors under cost and reliability constraints, but assess two uncertain variables and how reversing them would change the conclusion.

- [ ] 제안 수락
- [ ] 수정 필요

## 118. `difficulty_reasoning_complex_boundary_threshold_f05_v08`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `reasoning/complex`, `reasoning_decision`
- 제안 bucket: `count_3_plus`, `count_3_plus`, `count_4_plus`, `depth_3_plus`
- 제안 family: `pilot.reasoning.complex.template.f05`
- prompt 수정 제안: 없음

> Give one answer for allocating limited compute across competing workloads, but assess two uncertain variables and how reversing them would change the conclusion.

- [ ] 제안 수락
- [ ] 수정 필요

## 119. `difficulty_reasoning_complex_boundary_threshold_f05_v09`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `reasoning/complex`, `reasoning_decision`
- 제안 bucket: `count_3_plus`, `count_3_plus`, `count_2_to_3`, `depth_3_plus`
- 제안 family: `pilot.reasoning.complex.template.f05`
- prompt 수정 제안: 없음

> Give one answer for planning a migration with uncertain failure probabilities, but assess two uncertain variables and how reversing them would change the conclusion.

- [ ] 제안 수락
- [ ] 수정 필요

## 120. `difficulty_reasoning_complex_boundary_threshold_f05_v10`

- 판단 사유: `difficulty_threshold`
- 확인 질문: `confirm_expected_difficulty`, `confirm_semantic_bucket_targets`
- 제안 label: `reasoning/complex`, `reasoning_decision`
- 제안 bucket: `count_3_plus`, `count_3_plus`, `count_2_to_3`, `depth_3_plus`
- 제안 family: `pilot.reasoning.complex.template.f05`
- prompt 수정 제안: 없음

> latency와 cost trade-off가 있는 model routing 선택에 one answer를 주되 uncertain variable 두 개와 reverse 시 conclusion 변화까지 검토해줘.

- [ ] 제안 수락
- [ ] 수정 필요
