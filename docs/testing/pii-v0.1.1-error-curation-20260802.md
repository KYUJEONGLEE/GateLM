# PII v0.1.1 오류 데이터 선별 근거 — 2026-08-02

## 결론

canonical `v0.1.1`의 기존 positive 7건과 이름 오탐 회귀 6건은 모두 통과했다. 103건 screening을 최신 product path로 실행했을 때 rules-only와 `v0.1.1`은 모두 84건을 통과했고, 모델 호출은 0건이었다. 최신 빠른 규칙이 이 subset의 모델 대상 구간을 먼저 처리하므로 이 결과만으로 모델 오류를 판정하지 않았다.

같은 103건을 `v0.1.1` product adapter에 직접 실행한 결과 detector type, 개수와 `start·end`가 모두 정확히 일치한 case는 64건이고 39건이 불일치 후보였다. 타입·개수는 같지만 경계가 다른 추가 후보는 0건이었다. 이 중 비대상 날짜를 전화번호로 본 8건과 비대상 URL을 이메일로 본 2건은 실제 hard-negative 모델 오류 권고다. 나머지 positive miss 29건은 master corpus renderer가 실제 PII 형태 대신 `SYNTHETIC_*` 또는 명시적인 synthetic 표식을 넣어 생긴 fixture artifact 제외 권고다. `risk-false-positive` 22건은 모두 올바르게 무탐지됐다.

두 분류는 사람 승인이 아니라 재현 가능한 권고다. 39건은 아직 학습 데이터가 아니다. 원문과 span을 저장하지 않고 case ID, 기대·실제 detector type과 권고 reason code만 담은 review template를 생성했으며, dataset owner가 모든 후보를 승인 또는 제외하기 전에는 `trainingEligible=false`로 차단한다. 승인된 실제 오류만 기존 학습 dataset에 deterministic 확장하는 CLI 경로도 추가했으며, pending·부분·변조 review와 regression guard 실패 report는 거부한다.

`dataset_owner` 값은 사람이 JSON을 수정했다는 수동 attestation이며 실제 승인자의 신원이나 권한을 검증하지 않는다. 이 장치는 실수 방지용 로컬 게이트로만 사용한다. 병합·승격 권한을 증명하려면 별도의 CODEOWNERS 승인 또는 서명된 승인 근거가 필요하다.

## 실행 결속

| 항목 | 값 |
|---|---|
| 기준 Git SHA | `3bec6a30f7e89901d904be9df6d929e2e1e6057f` |
| 모델 | `v0.1.1` |
| ONNX SHA-256 | `8a5cb146e84d413910a423d304e662a6aba9f69e83db129f5061d007a6de9381` |
| canonical registry artifact | 7개 중 7개 byte size·SHA 일치 |
| 데이터 | 저장소의 합성 master corpus와 103건 case-ID subset |

Windows `core.autocrlf=true` checkout에서는 corpus worktree bytes가 Git blob의 LF checksum과 달라 기존 runner가 시작 전에 차단됐다. checksum 입력을 UTF-8 canonical text로 정규화하고 LF/CRLF 양쪽 회귀 테스트를 추가했다. case 내용이나 expectation은 바꾸지 않았다.

## 결과

| 검증 | 결과 |
|---|---:|
| positive guard | 7/7 통과 |
| 기존 이름 오탐 guard | 6/6 통과 |
| hybrid rules-only | 84/103 통과 |
| hybrid v0.1.1 | 84/103 통과 |
| hybrid v0.1.1 모델 호출 | 0 |
| direct adapter exact type·span 일치 | 64/103 |
| 동일 타입·개수의 span 경계 불일치 | 0 |
| direct adapter 불일치 후보 | 39 |
| hard-negative 후보 | 10 |
| positive 후보 | 29 |
| 실제 모델 오류 권고 | 10 |
| fixture artifact 제외 권고 | 29 |
| 오탐 위험 문장 정상 무탐지 | 22/22 |

## 안전 처리

- 합성 fixture만 사용했다.
- 추적 근거에는 원문, 탐지값, span/offset, 로컬 절대 경로를 넣지 않았다.
- AWS 계정번호, 버킷명과 실제 URI를 넣지 않았다.
- review가 pending이면 큐레이션 학습 입력 확장을 허용하지 않는다.
- regression guard가 하나라도 실패하면 report와 review를 생성하지 않으며, 별도로 작성된 실패 report도 학습 loader가 거부한다.
- JSON review는 승인자 인증 수단이 아니며 CODEOWNERS 또는 서명 근거를 대체하지 않는다.
- API, DB, Event, Metrics와 포트는 변경하지 않았다.

## 확인된 차단 조건

접근 가능한 기존 AWS PII artifact에는 canonical runtime bundle만 있고 trainable `v0.1.1` checkpoint, 학습 데이터와 평가 report는 없었다. Git과 Git LFS에도 과거 product-adapter 5,000건, six-type 4,270건, private regression 1,000건의 원본이 없다. 따라서 dataset owner review가 끝나더라도 현재 자료만으로는 기존 세 frozen gate 전체를 재실행할 수 없다.

받은 archive의 canonical registry artifact 7개는 byte size와 SHA가 모두 일치하고 ONNX도 canonical SHA와 일치했지만, tar.gz 전체 checksum은 과거 문서의 package digest와 달랐다. 모델 검증에는 registry가 고정한 내부 immutable file checksum을 사용했으며 archive 재패키징 차이는 한계로 남긴다.

이 상태에서 새 ONNX를 만들더라도 기존 전체 gate를 통과한 `v0.1.2-dev.1`로 선언하지 않는다. 누락된 trainable checkpoint·frozen 평가 자료를 공식 원격 artifact로 제공하거나, 별도 승인된 재학습-from-base와 새 frozen gate를 정의해야 한다.

## 저장소 검증

- AI Service: 423건 실행, 420건 통과, 3건 skip
- Gateway: module 전체 `go test ./...` 통과
- 문서 검증과 `git diff --check`: 통과
- 추가 내용의 절대 로컬 경로·비밀 형태·구체 포트 변경 검사: 0건
- `verify:v2-final`: 실패. 이 변경과 무관한 Windows WSL optional component 부재, routing fixture의 CRLF checksum 차이, routing 테스트 환경의 `sklearn` 부재가 원인이다.
