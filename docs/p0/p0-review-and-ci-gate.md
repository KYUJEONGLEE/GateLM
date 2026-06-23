# GateLM P0 Review and CI Gate v0.1

## 문서 목적

이 문서는 P0 구현 중 PR merge 전에 확인해야 하는 리뷰, 보안 검증, CI gate 기준을 정의한다.

---

## 1. Merge 전 필수 Gate

모든 PR은 아래 기준을 통과해야 한다.

| Gate | 필수 여부 | 기준 |
|---|---:|---|
| 문서 범위 확인 | Y | `p0-contract.md`에 있는 P0 범위 안의 변경인지 확인 |
| API 계약 확인 | Y | 문서에 없는 endpoint 추가 금지 |
| DB 계약 확인 | Y | 문서에 없는 table/column 추가 금지 |
| Event 계약 확인 | Y | 문서에 없는 event field/status 추가 금지 |
| 보안 금지 데이터 확인 | Y | raw prompt/response/secret 저장 또는 출력 금지 |
| 테스트 확인 | Y | `p0-test-matrix.md` 관련 항목 통과 |
| 리뷰 확인 | Y | 소유 영역 담당자 1명 이상 리뷰 |

---

## 2. 보안 리뷰 필수 변경

아래 변경은 일반 리뷰와 별도로 보안 관점 확인이 필요하다.

```text
API Key 발급/검증/폐기
App Token 발급/검증/폐기
Provider credential 저장/조회
SecretResolver
민감정보 detector/action/replacement
Authorization header 처리
Request Log / Request Detail 응답 필드
Tenant / Project / Application scope 검증
Cache key material
raw prompt/raw response 저장 정책
```

보안 리뷰에서 하나라도 실패하면 merge하지 않는다.

---

## 3. CI 최소 Gate

프로젝트 구조가 준비되는 즉시 아래 CI를 붙인다.

```text
lint
typecheck 또는 compile
unit test
integration smoke
migration validation
contract/status value check
secret-like fixture scan
raw prompt/raw response forbidden-field scan
```

P0 초기에 CI가 완성되지 않았으면 PR 본문에 수동 실행 결과를 남긴다.

---

## 4. Secret / Raw Payload Scan 기준

아래 문자열 또는 필드가 추가되면 리뷰에서 차단한다.

```text
rawPrompt
rawResponse
fullRequestBody
fullResponseBody
providerApiKey
apiKeyPlaintext
appTokenPlaintext
authorizationHeader
cookie
rawProviderErrorBody
maskingSampleRawValue
```

테스트 fixture에는 실제 secret처럼 보이는 값을 넣지 않는다. 반드시 `redacted`, `example.invalid`, `test` 성격이 드러나는 값을 사용한다.

---

## 5. PR 본문 필수 항목

```text
목표:
수정 파일:
새 파일:
참조 문서:
API 변경 여부:
DB 변경 여부:
Event 변경 여부:
보안 영향:
테스트 결과:
남은 리스크:
```

API/DB/Event 변경이 있으면 관련 P0 문서를 먼저 수정하거나, P0 범위 밖이면 구현하지 않는다.

---

## 6. Daily Smoke 기준

매일 마지막에는 한 명을 smoke owner로 지정하고 아래 흐름을 확인한다.

```text
seed reset
admin login
project/application/provider/api key/app token 준비
safe request success
email redaction
credential-like block
exact cache miss -> hit
model=auto routing
Request Log 확인
Request Detail 확인
Dashboard 숫자 확인
```

Daily smoke가 실패하면 다음 작업보다 smoke 복구를 우선한다.
