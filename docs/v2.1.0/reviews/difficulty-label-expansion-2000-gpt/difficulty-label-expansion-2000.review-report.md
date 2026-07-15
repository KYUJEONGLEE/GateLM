# Difficulty expansion 2,000 — GPT merge and human review queue

## 결론

- GPT 출력 2,000건은 원본 sampleId와 정확히 1:1 대응한다.
- 누락, 중복, 예상 밖 ID, JSON 오류, enum 위반, boundary tuple 위반은 모두 0건이다.
- GPT는 label·family·boundary·slice를 바꾸지 않았고, 합성 prompt 800건의 문장 교체만 제안했다.
- 사용자가 지정한 직접 검토 조건의 합집합은 1067건(53.3%)이다.
- 원본 fixture는 수정하지 않았다. 병합 candidate는 `pending`, `trainingEligible=false`이며 사람 승인으로 간주하지 않는다.

## 무결성·정규화

| 항목 | 결과 |
|---|---:|
| 파싱된 GPT 행 | 2000 |
| 고유 sampleId | 2000 |
| 누락 | 0 |
| 중복 | 0 |
| 예상 밖 ID | 0 |
| enum 위반 | 0 |
| boundary 조합 위반 | 0 |
| 실제 정규화 | 0 |

## GPT 변경 제안

| 항목 | 건수 |
|---|---:|
| accept | 1200 |
| correct | 800 |
| prompt 교체 | 800 |
| category/difficulty/semantic target/family/boundary/slice 변경 | 0 |
| 교체 후 length slice 불일치 | 0 |

800개 prompt 교체는 후보와 승인 diff에 반영했지만 원본에 자동 반영하지 않았다. 행 단위 검토 큐 밖의 교체도 최종 owner 승인 전까지 승인된 데이터가 아니다.

## Family 일관성

- family: 200개
- family당 record: 10개
- category/semantic label/family manifest 충돌: 0건
- partition 변경 또는 family 이동: 0건
- simple/complex contrast pair 뒤집힘: 0쌍

## 직접 검토 큐 1067건의 선정 이유

아래 이유의 합집합만 `difficulty-label-expansion-2000.human-review-queue.jsonl`에 포함했다. 이유별 수는 서로 겹친다.

| 이유 | 건수 |
|---|---:|
| `ambiguous_instruction_payload_boundary` | 180 |
| `gpt_decision_correct` | 800 |
| `payload_only_empty_instruction` | 100 |
| `prompt_action_replace` | 800 |

| Category | 큐 건수 |
|---|---:|
| code | 183 |
| general | 259 |
| reasoning | 210 |
| summarization | 203 |
| translation | 212 |

- 큐 안에서 prompt diff가 있는 행: 800건
- label 확인만 필요한 행: 267건
- 큐 밖 자동 후보: 933건

## 승인 방법

1. 사람은 human review queue의 `sourcePrompt`, `candidatePrompt`, `proposed`, `queueReasons`만 확인한다.
2. 800개 문장 변경 전체의 최종 diff는 `difficulty-label-expansion-2000.human-approval-diff.jsonl`에서 일괄 승인 여부를 확인한다.
3. 승인 전에는 candidate를 기존 owner-approved 500건과 합치거나 학습 입력으로 승격하지 않는다.
4. 승인 결과를 별도 artifact로 남긴 뒤에만 `human_review + approved` 파생 dataset을 만든다.
5. GPT 검토 보조가 필요하면 `direct-review-gpt/GPT-COMMAND.md`와 같은 폴더의 `review-NN.input.jsonl` 하나만 함께 전달한다. GPT 응답은 owner의 사람 승인으로 간주하지 않는다.

## 산출물

- `difficulty-label-expansion-2000.gpt-adjudication.raw.jsonl`: ZIP 20개 batch의 canonical merge
- `difficulty-label-expansion-2000.gpt-adjudication.normalized.jsonl`: enum/boundary 정규화 결과와 normalization audit
- `difficulty-label-expansion-2000.gpt-merged-candidate.jsonl`: GPT prompt 교체를 적용한 2,000건 candidate
- `difficulty-label-expansion-2000.human-approval-diff.jsonl`: 800개 변경의 사람 승인용 before/after diff
- `difficulty-label-expansion-2000.human-review-queue.jsonl`: 지정 조건의 통합 직접 검토 큐
- `direct-review-gpt/review-NN.input.jsonl`: family-complete, 최대 80건의 GPT 전달용 큐
- `direct-review-gpt/GPT-COMMAND.md`: GPT 2차 검토 명령문
- `difficulty-label-expansion-2000.review-report.json`: 해시와 전체 통계
