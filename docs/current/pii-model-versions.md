# GateLM PII Model Version Registry

| Field | Value |
|---|---|
| Status | Active operational metadata |
| Authority | GateLM 전용 PII 모델 artifact의 이름과 SHA-256 결속 |
| Applies to | GateLM KoELECTRA PII NER 모델 |
| Current model version | `v0.1.1` |
| Current legacy label | `v3.14` |
| Last audited | 2026-08-01 |

이 문서는 제품 버전, API·DB·Event·Metrics 계약 또는 production 승인 상태를 변경하지 않는다. 모델 버전은 artifact의 신원을 나타내고, 품질 gate와 배포 lifecycle은 별도로 기록한다.

## 1. Canonical Lineage

| Model version | Legacy label | Artifact binding | Model gate | Deployment lifecycle |
|---|---|---|---|---|
| `v0.1.0` | `v3.6` | ONNX SHA-256 `dfd9b29ea35974d91d866817d70905844ffd4c65ecda98d8ac2085869ba9f410` | final offline quality와 model-active local Gateway E2E 최초 동시 통과 | 최초 운영 Gateway 연결(`8db6cf30`), 이후 `v0.1.1`로 교체 |
| `v0.1.1` | `v3.14` | ONNX SHA-256 `8a5cb146e84d413910a423d304e662a6aba9f69e83db129f5061d007a6de9381` | offline, product-adapter와 private regression gate 통과 | [production 배포 run `29846604941`](https://github.com/KYUJEONGLEE/GateLM/actions/runs/29846604941) 성공; PII role health·Tenant Chat smoke와 local 동일 모델 Shadow E2E 통과, production model-active Gateway PII E2E는 미추적 |

`v3.6`은 아무 gate나 처음 통과한 모델이라는 뜻이 아니다. `v3.2`는 semantic development·regression 단계의 첫 후보였고 `v3.3`은 frozen internal engineering gate를 통과했지만, final offline quality와 model-active local Gateway E2E를 모두 처음 통과한 모델은 `v3.6`이었다.

`v0.1.1`은 현재 선택된 모델이며 main SHA `fbe6b766737df142d9115e6ef06f5d6aa19ac673`의 production 배포에서 설치·검증과 PII role health까지 통과했다. 같은 run의 public auth와 Tenant Chat smoke도 성공했다. 2026-08-01 local 동일 모델 Shadow E2E는 실제 Gateway sampler·HTTP adapter와 기준/후보 ONNX 호출을 포함한 배관을 검증했지만 production traffic이나 전체 Chat API 경로는 아니다. 현재 서버 online 여부와 production Gateway PII E2E·장시간 Shadow/Canary는 별도이므로, 이 근거만으로 production-grade DLP 검증 완료를 선언하지 않는다. [`documentation-gaps.md`](documentation-gaps.md)의 `DOC-025`가 잔여 evidence를 관리한다.

### v0.1.0 evidence binding

- Runtime manifest: [`../../deploy/aws-triage/pii-v36-model-manifest.sha256`](../../deploy/aws-triage/pii-v36-model-manifest.sha256)
- Manifest SHA-256: `36d2ec38968390440a30cb68eed1020c51a0c5ecafc6b0933f050ab678c76682`
- Model ONNX SHA-256: `dfd9b29ea35974d91d866817d70905844ffd4c65ecda98d8ac2085869ba9f410`
- Runtime manifest introduction Git SHA: `e8bee43ff6c2e6f6ebc4fc82751663963f8aca48`
- Gateway cutover Git SHA: `8db6cf305a78f57b3e2f74652bdc9115a8132b68`
- 제한: final evaluation과 model-active E2E 원본은 현재 source control에 없어 결과의 독립 재현 근거가 완전하지 않다.

### v0.1.1 evidence binding

- Runtime manifest: [`../../deploy/aws-triage/pii-v314-model-manifest.sha256`](../../deploy/aws-triage/pii-v314-model-manifest.sha256)
- Runtime manifest SHA-256: `320a4afd888071052975158eee1a22973f66e8782300d18d3007dac25336f74b`
- Package manifest: [`../ai-safety-lab/pii-model-manifest-v314-20260721.json`](../ai-safety-lab/pii-model-manifest-v314-20260721.json)
- Package manifest SHA-256: `a3168b3a3d9bea915a6c524bb31c7d2999dc0596f540406931d0795b07f706eb`
- Evaluation summary: [`../ai-safety-lab/pii-model-evaluation-summary-v314-20260721.json`](../ai-safety-lab/pii-model-evaluation-summary-v314-20260721.json)
- Evaluation summary SHA-256: `3eef55e889878b84316f0f5ae0bf463acb6acb376ee94d6893b7d6b5c4ecc578`
- Bundle SHA-256: `3c42b2dfb8e0b3e5a22bdb2c4669c9d08904c6d30aba482f82a8509306d2eb95`
- Immutable release ID: `tenant-chat-pii-models-v314-20260721`
- Initial package Git SHA: `7394aa261b87da2d17cc39f02d9d8966d87affbb`
- Current package/evaluation Git SHA: `3d7d77c426dc8a14bdc0d14f97b4b61b63c25065`
- Runtime manifest introduction and production target promotion Git SHA: `7dff23898c8b09282ef9a5df2033cddefc0280ec`
- Promotion merge evidence: PR #510 (`953e9f48`), main promotion PR #513 (`01d047a5`)
- Production deployment evidence: [Actions run `29846604941`](https://github.com/KYUJEONGLEE/GateLM/actions/runs/29846604941), main SHA `fbe6b766737df142d9115e6ef06f5d6aa19ac673`, completed `success` (2026-07-22 KST)
- Run evidence: v0.1.1(legacy v3.14) pin, private S3 download, artifact install/verify, PII role health와 authenticated Tenant Chat smoke 성공
- Local concurrency evidence: [초기 동시성 측정](../testing/pii-inference-concurrency-v0.1.1-20260731.md), [고정 4 CPU 예산과 bounded HTTP 비교](../testing/pii-thread-budget-matrix-v0.1.1-20260731.md)
- Local same-model Shadow E2E: [설명과 한계](../testing/pii-shadow-v0.1.1-e2e-20260801.md), [aggregate JSON](../testing/pii-shadow-v0.1.1-e2e-20260801.json)
- Shadow E2E binding: implementation Git SHA `faaa3a5f7a859a5ecba24b381889ef2167126566`, aggregate JSON SHA-256 `b7f3cb68aebcfaa83628b7cf439e9f75b7c27de4eecedae74bdd5beb9cfb8022`
- Concurrency evidence Git SHAs: 초기 direct `970c0c08e315c45e535b9470bc5907a7cbf8c195`, 초기 HTTP `a8a82e0138a9d2b17c083a01e26d02666d29aba4`, fixed-budget matrix/HTTP `63c3f6f1a83694386d915b3ca6519bd9942ce04b`

위 파일의 `v314`, `v3.14` 표기는 2026-07-21에 생성된 증거와 배포 식별자의 일부이므로 고치거나 이름을 바꾸지 않는다. 현재 문서에서는 동일한 ONNX SHA-256을 `v0.1.1`로 부른다.

동시성 evidence와 2026-08-01 실제 4-vCPU Linux host의 aggregate-only direct 재검증에 따라 PR #564로 고정 AWS PII profile active 2/intra-op 2가 `dev`에 병합됐다. 이 선택과 local Shadow E2E는 production 재배포, authenticated Chat API 전체 경로 또는 운영 SLA 완료를 뜻하지 않는다.

## 2. First-pass Historical Aliases

최초 합격 전의 대표 학습 artifact는 요청한 `v0.0.n` 규칙으로 소급 정리한다. 이 값은 과거 문서 표기를 읽기 위한 비릴리스 alias이며, 현재의 배포 가능 model SemVer 발급 규칙에는 사용하지 않는다. 버전은 당시 결과의 합격을 뜻하지 않는다.

| New version | Legacy label | Artifact type | SHA-256 | Result |
|---|---|---|---|---|
| `v0.0.1` | `v1` | training checkpoint | `dc3c7978c25e7d23278979b53e647c991d8e7a662c110abae1bd0484e59e9e35` | 비배포, 품질 gate 실패 |
| `v0.0.2` | `v2` | QInt8 ONNX | `e992ad9dc02fd98848b7a5acb5ea35f48384a4cd4a2b863c43ba805d2166af0c` | candidate gate 실패 |
| `v0.0.3` | `v3` | QInt8 ONNX | `d56b3b97ab0a4ece1ac22f24b3f6126fb3b83e8d029715c4499289718f0ca007` | engineering gate 실패 |
| `v0.0.4` | `v3.1` | QInt8 ONNX | `ed40352c0faa921652280ff4de97959fbe5118235138aaeaf657f6d6173af98f` | recall·negative FP gate 실패 |
| `v0.0.5` | `v3.2` | QInt8 ONNX | `a39e9a574dde2be4f9cbe401b0c240d93bfa6a9cc3bc0b86fde28ccc3b5f5431` | holdout gate 실패 |
| `v0.0.6` | `v3.3` | QInt8 ONNX | `98a32767cbefe8daddeedc3816b45a933f75c33d41b9d2fdb5e2e0fffa435f5d` | frozen gate 통과 후 private-final 실패 |
| `v0.0.7` | `v3.4` | QInt8 ONNX | `54965c83e3d15ee300e4ebc526595099c2b9c068a6fc380b2e06cba1b9d945d4` | negative FP gate 실패 |
| `v0.0.8` | `v3.5` | QInt8 ONNX | `c33a99be2285106d3860258de9f07b5a70f4a76e5b33a7fc965f88dcdb00f5d9` | exact·recall gate 실패 |

과거 artifact 대부분은 source control 밖의 실험 저장소에만 남아 있다. 위 alias와 SHA-256은 계보를 잃지 않기 위한 감사 기록이며, tracked manifest가 없는 행을 재현 가능한 release로 해석하지 않는다.

## 3. v0.1.1 Development Candidates

`v0.1.0` 이후 만들어졌지만 최종 선택되지 않은 서로 다른 ONNX는 정식 patch 버전을 소비하지 않는다. 다음 목표 버전의 prerelease와 artifact flavor, SHA-256 앞 12자리로 1:1 구분한다.

| Legacy artifact | New development version | ONNX SHA-256 | Result |
|---|---|---|---|
| `v3.7` | `v0.1.1-dev.1+onnx.qint8.bfc71830cfef` | `bfc71830cfef2416f77db6a03469fcef3aa951264b72ec26be0f79609ea81517` | 미채택 |
| `v3.7b` | `v0.1.1-dev.2+onnx.qint8.28dc4f636151` | `28dc4f6361510ec6a86735c87f18895681c6348098f7fa0d88b3f9c56d5b34db` | latency·legacy regression 미달 |
| `v3.8b` | `v0.1.1-dev.3+onnx.qint8.45dbd0d57078` | `45dbd0d57078f2e5e53d9520da66dec5dea278e3ee14086e0e0d65f66f3b1a2e` | frozen gate 실패 |
| `v3.9` | `v0.1.1-dev.4+onnx.qint8.beceb084e49e` | `beceb084e49e19e3897dfde43f4552f57154faf3bf2c6a6dfda6c5eb177b2a2d` | validation negative FP 미달 |
| `v3.9b` | `v0.1.1-dev.5+onnx.qint8.7c6d1dd1ee03` | `7c6d1dd1ee03ff95c90302a5d53610f6aaf886d74c2e1867b259e04ad6dec59b` | frozen gate 실패 |
| `v3.10` QInt8 | `v0.1.1-dev.6.1+onnx.qint8.74c175090910` | `74c175090910741120741ba390499f797e18dc71c4eed4be1d19e53fae10ff06` | validation 미달 |
| `v3.10` FP32 | `v0.1.1-dev.6.2+onnx.fp32.44a3fb3ac55a` | `44a3fb3ac55a3f54aa91d9fd5b6614f507e44f26ee0d368337f7d2d373923bbc` | diagnostic export; 별도 promotion gate 미실행·미채택 |
| `v3.10` mixed2 | `v0.1.1-dev.6.3+onnx.mixed2.1a742a84da00` | `1a742a84da00c79ffcb7793773508e32fc9510dbd222f489f412238bac9281b7` | 미채택 |
| `v3.10` mixed4 | `v0.1.1-dev.6.4+onnx.mixed4.842b43f768e8` | `842b43f768e873e6878561777cd85d343d078d6c1d577cf9ed4ada6dffd82bf9` | 미채택 |
| `v3.10` mixed6 | `v0.1.1-dev.6.5+onnx.mixed6.bda7e797fc7d` | `bda7e797fc7df8930b0dc5ed6bd393da3b8b5dabdd5b270522b1e5586b4c923e` | 미채택 |
| `v3.10` mixed7 | `v0.1.1-dev.6.6+onnx.mixed7.17260f712639` | `17260f712639d38ac5acad9a17696a99e08522448c09ac5afd87ba0f0db169bb` | 미채택 |
| `v3.10` lower2 | `v0.1.1-dev.6.7+onnx.lower2.83e66794c7bd` | `83e66794c7bd8cf843a01aa5489370d74495f8a7f1a2abf0ba2dcb89cbb3ccbf` | 미채택 |
| `v3.10` lower4 | `v0.1.1-dev.6.8+onnx.lower4.fd70af02da42` | `fd70af02da42ef7170d588d6b1455ceb63c50f97b66969ea5b30270aa0e71acf` | 미채택 |
| `v3.10` lower6 | `v0.1.1-dev.6.9+onnx.lower6.a1ca406a39f0` | `a1ca406a39f03cad12639d8d652ce685817a4c62a10184497a7474155550ce2a` | 신규 frozen 통과 후 legacy regression 실패 |
| `v3.11` | `v0.1.1-dev.7+onnx.qint8.9f343bf8456b` | `9f343bf8456bdaf119a3082e1c72b6b0ee3673d5061708abc9f5ce86c810dc49` | frozen gate 실패 |
| `v3.12` | `v0.1.1-dev.8+onnx.qint8.be23f65fe2b6` | `be23f65fe2b60cf4c3a95da3a434c59cfca27f22997d41814da3d8cbe705b80a` | frozen 통과 후 legacy address regression 실패 |
| `v3.13` QInt8 | `v0.1.1-dev.9.1+onnx.qint8.af727ec59c95` | `af727ec59c9520fcb76b144d7ea9228bc838d570588143bcc3ea3c613d122f65` | private regression·phone recall 미달 |
| `v3.13` FP32 | `v0.1.1-dev.9.2+onnx.fp32.1e4a11a060e6` | `1e4a11a060e68339cd421e72e3a73e534235f2413e723d91413c6b59333165f7` | diagnostic export; 별도 gate 미실행·미채택 |
| `v3.14` QInt8 | `v0.1.1-dev.10+onnx.qint8.8a5cb146e84d` → `v0.1.1` | `8a5cb146e84d413910a423d304e662a6aba9f69e83db129f5061d007a6de9381` | offline gate 통과 후 동일 SHA를 production에 배포하고 PII role health 확인; model-active Gateway PII E2E evidence 미추적 |

ONNX가 만들어지지 않은 run은 모델 SemVer를 부여하지 않고 training run ID와 checkpoint/report SHA로 보존한다.

| Legacy run | Artifact | SHA-256 | Model SemVer |
|---|---|---|---|
| `v3.7 attempt 1` | training report | `9b664af29f9e281e370cfedb6ec4434bda96d9a25043a4fb9ba7128eda4f8918` | 없음 |
| `v3.7 attempt 2` | training report | `3c5c3362255caa86c6143b37382526e09e631229b995f2c6a657d095f52624cc` | 없음 |
| `v3.8` | training checkpoint | `05e641a3fe79e9a48d21aa251db0c2dc52fe599adb861492e79914dda3ec82ba` | 없음 |
| `v3.10b` | training checkpoint | `7cd5c53057539669cff4826048e92c3c08941c8035096c95258e7994f14ab42d` | 없음 |
| `v3.10c` | training checkpoint | `ab181cfa8594aa6cc9e983a385d6e0709510fd5d1724acf4774eeb7bef9d426f` | 없음 |

## 4. Version Rules

1. `v0.1.0` 이후의 model SemVer는 배포 가능한 하나의 모델 artifact와 정확히 하나의 SHA-256을 가리킨다.
2. `v0.0.n`은 이번 정리에서만 사용하는 pre-pass historical alias다. 앞으로 ONNX가 없는 checkpoint와 training report에는 model SemVer를 부여하지 않는다.
3. 학습을 시작했다는 이유만으로 정식 patch를 올리지 않는다. 서로 다른 후보 artifact에는 target version의 `dev.N` prerelease와 SHA metadata를 부여한다.
4. 합의된 모델 품질 gate를 통과해 선택된 동일 artifact만 prerelease를 제거한다.
5. 같은 label·tokenizer·입출력 계약을 유지한 후속 모델은 patch를 올린다. 다음 목표는 `v0.1.2-dev.1`이다.
6. label 집합, tokenizer, backbone 또는 외부 입출력 계약이 호환되지 않게 바뀌면 다음 minor인 `v0.2.0`부터 시작한다.
7. 모델 밖의 호환 가능한 후처리 수정은 model SemVer를 바꾸지 않고 AI Service 코드와 release descriptor로 추적한다.
8. model version, evaluation status, deployment status와 제품 release version을 서로 대신 사용하지 않는다.
9. 과거 manifest, report, release ID, S3·IAM 경로와 스크립트명의 legacy label은 provenance이므로 일괄 치환하지 않는다.

`monologg/koelectra-small-v3-discriminator`와 `gatelm/koelectra-small-v3-pii-ner`의 `v3`는 backbone/model ID의 일부다. `ai-safety-detector.v1`, schema/report의 `.v1`도 계약·문서 형식 버전이므로 이 모델 SemVer 이관 대상이 아니다.
