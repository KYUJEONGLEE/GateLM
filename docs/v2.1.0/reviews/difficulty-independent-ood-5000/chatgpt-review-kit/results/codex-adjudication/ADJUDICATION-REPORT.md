# Dataset 2 Codex Core Adjudication Report

판정 정책: `difficulty-independent-ood-codex-adjudication.2026-07-20.v1`

## 결과

- 전수 판정: 1,353 / 1,353
- core decision이 provisional과 일치: 479
- core decision이 Reviewer A와 일치: 747
- core decision이 두 결과를 혼합: 14
- core decision이 양쪽과 모두 일치: 0
- residual human-review queue: 191
- 사람 승인 상태: 미승인. 모든 결과는 Codex proposed 상태다.

## Core 선택 출처

| 선택 | 건수 |
|---|---:|
| reviewer_a | 747 |
| provisional | 479 |
| neither | 113 |
| mixed | 14 |

## 전체 8개 판정 선택 출처

| 선택 | 건수 |
|---|---:|
| neither | 637 |
| mixed | 420 |
| reviewer_a | 289 |
| provisional | 7 |

## 구조 판정 선택 출처

| 선택 | 건수 |
|---|---:|
| neither | 560 |
| reviewer_a | 481 |
| provisional | 139 |
| mixed | 97 |
| consensus | 76 |

## Field별 선택 출처

| Field | Consensus | Provisional | Reviewer A | Neither |
|---|---:|---:|---:|---:|
| expectedCategory | 1100 | 253 | 0 | 0 |
| expectedDifficulty | 101 | 378 | 761 | 113 |
| semanticInputStatus | 1353 | 0 | 0 | 0 |
| expectedSemanticLabel | 1092 | 261 | 0 | 0 |
| taskBucket | 950 | 167 | 115 | 121 |
| constraintBucket | 481 | 81 | 449 | 342 |
| scopeBucket | 151 | 184 | 796 | 222 |
| dependencyBucket | 512 | 8 | 800 | 33 |

## 최종 difficulty

| Difficulty | 건수 |
|---|---:|
| complex | 1,081 |
| simple | 272 |

## Provisional 대비 difficulty 변화

| 변화 | 건수 |
|---|---:|
| simple->complex | 615 |
| complex->complex | 466 |
| complex->simple | 259 |
| simple->simple | 13 |

## Category 분포

| Category | 건수 |
|---|---:|
| summarization | 472 |
| reasoning | 259 |
| translation | 235 |
| general | 198 |
| code | 189 |

## Renderer coverage

44개 renderer의 core conflict를 모두 처리했다. Core conflict 중 실제 core decision이 필요한 record는 1,353건이다.

## 사용 제한

이 결과만으로 candidate record를 `human_review`, `approved` 또는 training-eligible로 승격하지 않는다. residual queue 검토와 별도의 층화 무작위 감사가 끝나기 전에는 provisional dataset을 덮어쓰지 않는다.
