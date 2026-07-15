# PII Production Promotion Gate Policy

상태: fail-closed evidence gate. 이 문서는 정확도나 지연 목표값을 정하는 제품 계약이 아니다.

## 결정 원칙

- 저장 결과는 aggregate check 상태와 bounded reason code만 포함한다.
- 원문, 탐지값, span/offset, 요청·사용자 식별자, endpoint 위치, artifact digest는 결과에 복사하지 않는다.
- 저장소는 production 정확도·지연·메모리 임계값의 기본값을 제공하지 않는다.
- 제품·보안 책임자가 별도 승인한 `pii-promotion-owner-policy.v1` 정책이 없으면 gate는 차단한다.
- 현재 합성 평가의 `65.6%` case pass rate와 `12.83%` email precision은 production 승인 근거가 아니며, 현재 자료만 입력하면 gate는 차단한다.

## 필수 증거

| Check | 필수 조건 |
|---|---|
| owner policy | 책임자가 승인한 전체·PII 유형별 정확도, locale 범위, warm/cold latency, peak RSS, startup failure, 반복 횟수 기준 |
| artifact integrity | manifest의 모든 파일을 실행 직전에 재검증한 aggregate count와 checksum failure 0건 |
| quality | untouched·governance-approved holdout, span-level 유형별 precision/recall, rules-only 대 hybrid ablation |
| warm runtime | benchmark v2, 실제 sidecar·target latency 관측, evidence completeness·원문 노출 gate 통과; timeout이 발생한 run이면 fallback도 관측 |
| cold runtime | 독립 process 반복 cold run의 p50/p95, 실패율, peak RSS aggregate |
| Tenant Chat E2E | Tenant Chat private 경로, 모델 호출, enforce redact/block, Provider 억제, fallback, 비저장 검증 |

모든 실행 증거는 같은 manifest/model revision과 source revision에 binding되어야 한다. `gitRevision`은 branch나 abbreviated SHA가 아닌 lowercase full Git object ID(40 또는 64 hex)여야 한다. checksum 검증 여부는 artifact verifier 성공 결과에서만 가져오며 runner가 추정하지 않는다. 입력 증거에는 binding이 있지만 최종 gate 결과에는 revision이나 digest 자체를 재출력하지 않는다.

## 승격 범위

Owner policy의 `scope.requiredPiiTypes`는 아래 10종을 모두 명시해야 한다.

```text
email
phone_number
resident_registration_number
account_number
postal_address
private_date
private_url
secret
person_name
organization_name
```

`person_name`과 `organization_name`은 현재 rule backstop 결과지만 hybrid 전체를 승격하는 범위에 포함된다. 따라서 untouched holdout, rules-only 대 hybrid ablation, 유형별 precision/recall에서 두 유형도 빠지면 안 된다. Locale 승격 범위는 `ko-KR`과 `en-US` 두 개 모두이며 single-locale 승격은 차단한다. `scope.requiredLocales`, quality의 `scope.locales`, 유형별 threshold map, `byPiiType`은 owner가 선언한 범위와 exact match해야 한다.

## Provenance 연결

Artifact verifier가 만드는 root object는 아래 6개 필드만 가진다.

```json
{
  "schemaVersion": "pii-artifact-verification.v1",
  "aggregateOnly": true,
  "filesExpected": 1,
  "filesVerified": 1,
  "checksumFailures": 0,
  "evidenceBinding": {
    "schemaVersion": "pii-promotion-evidence-binding.v1",
    "manifestVersion": "<manifest-version>",
    "modelRevisions": {"<model-id>": "<immutable-model-revision>"},
    "artifactChecksumsVerified": true,
    "gitRevision": "<full-lowercase-git-object-id>"
  }
}
```

Warm benchmark와 repeated-cold runner에는 이 artifact verification JSON을 `--artifact-verification`으로 전달한다. 두 runner는 `filesVerified == filesExpected`, `checksumFailures == 0`, binding shape를 다시 확인한 뒤 같은 binding을 결과 root에 넣는다. `--evidence-binding` 직접 입력은 격리된 테스트·evidence 작업용이며 production 연결 방식이 아니다.

Repeated-cold 결과는 아래 aggregate shape를 사용한다. 매 run은 새 process에서 preload와 고정 synthetic probe를 완료해야 성공이다. Linux는 `ru_maxrss`, Windows는 `PeakWorkingSetSize`를 사용하며 실제 peak를 읽지 못하면 run 실패로 집계한다.

```json
{
  "schemaVersion": "pii-repeated-cold-evidence.v1",
  "aggregateOnly": true,
  "runs": 5,
  "successfulRuns": 5,
  "failedRuns": 0,
  "startupFailureRate": 0,
  "coldP50Ms": 0,
  "coldP95Ms": 0,
  "peakRssMb": 0.1,
  "evidenceBinding": {"schemaVersion": "pii-promotion-evidence-binding.v1"},
  "contentSafety": {
    "rawContentIncluded": false,
    "requestIdentifiersIncluded": false,
    "endpointLocationsIncluded": false,
    "artifactDigestsIncluded": false,
    "childErrorDetailIncluded": false
  }
}
```

위 예시는 shape 설명용이라 nested binding을 축약했다. 실제 파일은 binding schema의 5개 필드를 모두 포함해야 한다. `successfulRuns + failedRuns == runs`, 실패율 일치, `coldP50Ms <= coldP95Ms`도 gate가 직접 확인한다.

Tenant Chat E2E 증거는 raw prompt나 request ID 없이 아래 boolean aggregate만 허용한다.

현재 저장소는 이 E2E JSON을 자동 생성하지 않는다. 실제 pinned ONNX artifact가 배치된 production-like stack에서 Tenant Chat private 경로, 실제 `hybrid` 모델 호출, redact/block 시 Provider 전달 여부, sidecar 장애 fallback, DB·Redis·로그의 원문 비저장을 함께 관측해야 하기 때문이다. 이 실행 전에는 `tenant_chat_e2e_evidence_missing`으로 승격이 차단된다. Unit test나 사용자가 직접 작성한 boolean JSON을 production 증거로 대신하면 안 된다.

```json
{
  "schemaVersion": "pii-tenant-chat-model-e2e.v1",
  "aggregateOnly": true,
  "tenantChatPathVerified": true,
  "modelInvocationObserved": true,
  "enforceRedactionVerified": true,
  "blockProviderSuppressionVerified": true,
  "fallbackObserved": true,
  "noRawPersistenceVerified": true,
  "evidenceBinding": {"schemaVersion": "pii-promotion-evidence-binding.v1"}
}
```

여기도 nested binding은 설명을 위해 축약했다. exact 계약은 `schemas/pii-tenant-chat-model-e2e.schema.json`을 따른다.

## 실행 순서

```text
1. manifest-listed artifact를 다시 checksum 검증하고 artifact verification JSON 생성
2. 그 JSON을 --artifact-verification으로 warm benchmark에 전달
3. 같은 JSON을 --artifact-verification으로 repeated-cold runner에 전달
4. 동일 full Git object ID와 model revision에 묶인 quality·Tenant Chat E2E 증거 준비
5. owner policy와 모든 aggregate 증거를 promotion gate에 전달
```

## CLI

`python -m app.services.ai_safety_promotion_gate`는 manifest와 quality 자료를 기본으로 읽는다. owner policy나 runtime/E2E 자료가 빠지면 종료 코드 1과 `blocked` aggregate 결과를 반환한다. CI에서 현재 자료가 계속 차단되는지를 확인할 때만 `--expect-blocked`를 사용한다.

```bash
python -m app.services.ai_safety_repeated_cold_runner \
  --artifact-verification <artifact-verification-json> \
  --runs <owner-approved-run-count> \
  --out <cold-evidence-json>

python -m app.services.ai_safety_latency_benchmark_runner \
  --target http \
  --artifact-verification <artifact-verification-json> \
  --out <benchmark-output-directory>

python -m app.services.ai_safety_promotion_gate \
  --owner-policy <owner-policy-json> \
  --artifact-verification <artifact-verification-json> \
  --benchmark <benchmark-json> \
  --cold-start <cold-evidence-json> \
  --tenant-chat-e2e <tenant-chat-e2e-json> \
  --out <promotion-result-json>
```

출력 schema는 `schemas/pii-promotion-evidence.schema.json`, owner 승인 정책 shape는 `schemas/pii-promotion-owner-policy.schema.json`을 따른다. Artifact, binding, repeated-cold, Tenant Chat E2E 입력은 각각 같은 디렉터리의 versioned schema를 따른다.
