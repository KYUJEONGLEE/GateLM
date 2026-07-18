# GateLM AI Service

This service owns optional AI Safety and Evaluation Lab work for the v1.0.0 baseline. It is not a required dependency of the Gateway hot path.

## Private RAG extraction

`POST /internal/v1/rag/extract` is a stateless raw-body endpoint for the future Control Plane Worker. It requires `X-GateLM-AI-Service-Token` and accepts only `text/plain` (UTF-8, optional BOM) or `application/pdf` with a text layer. The service does not read S3 or PostgreSQL, call OpenAI, create embeddings, resolve tenant keys, persist chunks, or mutate jobs.

TXT normalization removes NUL characters, converts CRLF/CR to LF, applies Unicode NFC (not compatibility-changing NFKC), and collapses horizontal whitespace per line while preserving blank-line paragraph boundaries and 1-based source line ranges. PDF extraction preserves 1-based page ranges. Encrypted, damaged, scanned/image-only, over-limit, and timed-out PDFs return stable sanitized errors; OCR and embedded images/attachments are never processed.

Chunking uses the local `cl100k_base` tokenizer mapped to `text-embedding-3-large`. Profile defaults are target 600, overlap 100, and maximum 900 tokens. The tokenizer performs no OpenAI request. Runtime dependencies are pinned in `requirements-rag-extraction.lock`.

Local configuration uses `AI_SERVICE_RAG_SERVICE_TOKEN` and the `AI_SERVICE_RAG_*` bounds in `.env.example`. When `TENANT_CHAT_RAG_ENABLED=true`, `self_host`, `staging`, `production`, and `aws` deployment modes fail startup if the token is missing, shorter than 32 characters, or marked as a local/fake/example placeholder. Enabled non-local modes also require `AI_SERVICE_RAG_TEMP_DIR` to be a dedicated absolute mount; the production Compose paths bind it to a size-bounded tmpfs and clean only stale `gatelm-rag-*.source` files on startup. With the flag disabled, those RAG-only token and temp-directory dependencies are not required. `AI_SERVICE_RAG_MAX_CONCURRENT_EXTRACTIONS` bounds extraction concurrency, and PDF child processes receive configurable address-space and CPU limits in addition to the container memory and PID limits. Access logging remains disabled by default because request bodies contain document plaintext.

## RemoteSafetyEngine Prototype

RemoteSafetyEngine is an internal shadow/evaluation prototype for v2 evidence. It is disabled by default and is not connected to Gateway production blocking.

Install local dependencies when running the FastAPI prototype:

```bash
cd apps/ai-service
python -m pip install -e ".[test]"
```

Run it standalone for local evaluation:

```bash
cd apps/ai-service
AI_SERVICE_REMOTE_SAFETY_MODE=shadow python -m app.main
```

`AI_SERVICE_ACCESS_LOG_ENABLED=false` is the default for the `app.main` launcher. If running uvicorn directly, pass `--access-log false`.

Endpoint:

```text
POST /internal/v1/safety/evaluate
```

The endpoint accepts `remote-safety.v1` requests and returns non-authoritative safety metadata. It must not store raw prompt, raw response, credentials, Authorization headers, or raw detected values.

## Optional NER / Token Classification Detector

The safety lab includes an optional local token-classification adapter for sidecar experiments:

```text
prompt
-> regex detectors
-> PrivacyFilterAdapter.detect()
-> GateLM detector type normalization
-> overlap merge / dedupe
-> policy evaluator
-> redaction preview
```

Install ONNX dependencies only in a local sidecar image or experiment environment:

```bash
cd apps/ai-service
python -m pip install -e ".[onnx,test]"
```

`PrivacyFilterAdapter` lazy-loads either the direct OpenAI ONNX Runtime classifier or an Optimum ONNX token-classification pipeline. It returns only in-memory `Detection` objects with `detector_type`, `source`, `start`, `end`, and `confidence`; it does not return or store `word`, raw detected values, raw prompt fragments, or offsets through the FastAPI response. The current `/internal/v1/safety/evaluate` response contract still exposes only the existing sanitized decision and metadata shape.

The default runtime loads only the pinned `openai/privacy-filter` ONNX model. The ML candidate allowlist is limited to `phone_number` and `secret`; other supported PII categories continue through the local rule path. Keep the additional-model setting blank for this OpenAI-only configuration:

```bash
AI_SERVICE_TRANSFORMERS_OFFLINE=1
AI_SERVICE_AI_SAFETY_DETECTOR_RUNTIME=onnx
AI_SERVICE_AI_SAFETY_PRELOAD_ENABLED=true
AI_SERVICE_AI_SAFETY_MICRO_BATCH_SIZE=4
AI_SERVICE_ONNX_INTRA_OP_THREADS=4
AI_SERVICE_ONNX_INTER_OP_THREADS=1
AI_SERVICE_ONNX_ALLOW_SPINNING=false
AI_SERVICE_AI_SAFETY_ML_ALLOWED_DETECTOR_TYPES=phone_number,secret
AI_SERVICE_AI_SAFETY_PERSON_NAME_MODEL_ONLY=false
AI_SERVICE_AI_SAFETY_DETECTOR_MODEL_ID=.cache/onnx/releases/tenant-chat-pii-models-20260715/openai--privacy-filter
AI_SERVICE_AI_SAFETY_ADDITIONAL_DETECTOR_MODEL_IDS=
```

The primary model is loaded through the local ONNX Runtime pipeline and its detections are merged through the same sanitized GateLM policy path. Do not send raw prompts to hosted Hugging Face inference APIs for this path.

The pinned 2026-07-15 delivery bundle still contains the KoELECTRA artifact and the importer verifies all manifest-listed files, but a blank additional-model setting prevents that adapter from loading or warming up. If the allowlisted KoELECTRA path is explicitly enabled for an isolated evaluation, its accepted labels remain email, phone number, and resident registration number only. Person-name and organization-name detections remain rule backstops, and the supplied evaluation does not justify production-grade accuracy claims.

`AI_SERVICE_AI_SAFETY_PERSON_NAME_MODEL_ONLY` defaults to `false`. For an isolated evaluation with a separately supplied model that supports `person_name`, set the ML allowlist to include `person_name` and enable this flag. Existing name-rule matches then seed model windows but do not become final masking signals; only accepted model `person_name` detections are masked. All non-name deterministic rules stay enabled. Startup fails when the flag is enabled without `person_name` model support. This flag does not install, activate, or deploy a model by itself.

For the Gateway path, also set `GATEWAY_AI_SAFETY_PERSON_NAME_MODEL_ONLY=true`. This removes only the Gateway's local `person_name` rules so the original name reaches the AI Service; all other local PII rules remain active. Gateway startup fails unless the sidecar is enabled in `enforce` mode with a non-empty URL and matching model ID. Keep both flags `false` outside the isolated evaluation profile.

Import only manifest-listed model artifacts from the delivery archive and verify every file hash:

```bash
python scripts/tenant_chat_pii_models/import_bundle.py \
  apps/ai-service/.cache/bundles/tenant-chat-pii-model-bundle-20260715.zip
```

The importer verifies the outer bundle pin and installs into `.cache/onnx/releases/tenant-chat-pii-models-20260715` only after every manifest-listed file passes size and SHA-256 verification. These runtime assets are ignored by Git. The manifest, evaluation summary, release descriptor, third-party notices, and Apache-2.0 text remain versioned in the repository. See `docs/ai-safety-lab/tenant-chat-pii-model-integration-20260715.md` for measured evidence and promotion limits.

To produce the artifact-integrity input for the production promotion gate, bind
the verification to the same Git revision used by the other evidence runs:

```bash
python scripts/tenant_chat_pii_models/import_bundle.py \
  apps/ai-service/.cache/bundles/tenant-chat-pii-model-bundle-20260715.zip \
  --evidence-out .tmp/pii-artifact-verification.json \
  --git-revision <deployed-full-git-object-id>
```

Evidence is written only after another complete checksum verification. The JSON
contains aggregate file counts plus manifest/model/Git provenance binding; it
does not contain the bundle source, artifact paths, or artifact digests. The Git
revision must be the immutable full lowercase 40- or 64-hex object ID used by
every other promotion evidence run; branch names and abbreviated SHAs fail closed.

## AI Safety Detector Sidecar

The local detector sidecar endpoint is available at:

```text
POST /internal/ai-safety/v1/detect
POST /internal/ai-safety/v1/detect/batch
```

The single route uses `ai-safety-detector.v1`; the ordered 1-to-64 item route uses `ai-safety-detector-batch.v1`. Both return Provider-safe `redactedPrompt`, storage-safe `logSafePrompt`, sanitized detections, and an `executionSummary` that distinguishes `rules_only` from actual `hybrid` model execution. The endpoint accepts `shadow` and `enforce`: shadow observations do not change the Provider prompt or final action, while enforce results can redact or block before Provider execution. `logSafePrompt` and the preview redact detections even when the Provider policy action is `allow`. It does not return model `word`, raw detected values, raw prompt fragments, or offsets.

Tenant Chat sends all local-P0-redacted messages in one batch without concatenating message text. The sidecar preserves item boundaries and order, runs detector-type-aware dynamic ONNX micro-batches, and maps every result back to its `itemIndex`. The pinned models do not support person or organization labels, so name/organization-only candidates stay rules-only. A malformed or partial batch is rejected so Gateway can use the complete local result set.

Example request shape:

```json
{
  "contractVersion": "ai-safety-detector.v1",
  "mode": "enforce",
  "input": {
    "promptText": "Use synthetic text only.",
    "locale": "en-US"
  },
  "detectorConfig": {
    "detectorSet": "privacy-filter-default",
    "returnConfidence": true,
    "detectorPolicies": [
      {"detectorType": "email", "action": "redact"},
      {"detectorType": "api_key", "action": "block"}
    ]
  }
}
```

Run locally with ONNX dependencies installed:

```bash
cd apps/ai-service
python -m pip install -e ".[onnx,test]"
AI_SERVICE_TRANSFORMERS_OFFLINE=1 \
AI_SERVICE_AI_SAFETY_DETECTOR_RUNTIME=onnx \
AI_SERVICE_AI_SAFETY_PRELOAD_ENABLED=true \
AI_SERVICE_AI_SAFETY_MICRO_BATCH_SIZE=4 \
AI_SERVICE_ONNX_INTRA_OP_THREADS=4 \
AI_SERVICE_ONNX_INTER_OP_THREADS=1 \
AI_SERVICE_ONNX_ALLOW_SPINNING=false \
AI_SERVICE_AI_SAFETY_ML_ALLOWED_DETECTOR_TYPES=phone_number,secret \
AI_SERVICE_AI_SAFETY_DETECTOR_MODEL_ID=.cache/onnx/releases/tenant-chat-pii-models-20260715/openai--privacy-filter \
AI_SERVICE_AI_SAFETY_ADDITIONAL_DETECTOR_MODEL_IDS="" \
python -m app.main
```

Use ONNX Runtime for an exported token-classification model by installing the optional ONNX dependencies and pointing the model id at the exported model directory:

```bash
cd apps/ai-service
python -m pip install -e ".[onnx,test]"
AI_SERVICE_TRANSFORMERS_OFFLINE=1 \
AI_SERVICE_AI_SAFETY_DETECTOR_RUNTIME=onnx \
AI_SERVICE_AI_SAFETY_ML_ALLOWED_DETECTOR_TYPES=phone_number,secret \
AI_SERVICE_AI_SAFETY_DETECTOR_MODEL_ID=.cache/onnx/releases/tenant-chat-pii-models-20260715/openai--privacy-filter \
AI_SERVICE_AI_SAFETY_ADDITIONAL_DETECTOR_MODEL_IDS="" \
python -m app.main
```

Build an AI service image with local ML dependencies when running the detector in a container:

```bash
docker build -f infra/docker/ai-service.Dockerfile \
  --build-arg AI_SERVICE_INSTALL_ML_DEPS=true \
  -t gatelm/ai-service:ml-local .
```

## Resource / Latency Benchmark Runner

Run the AI Safety Lab sidecar latency benchmark after starting the local sidecar:

```bash
cd apps/ai-service
python -m pip install -e ".[ml,benchmark,test]"
python -m app.services.ai_safety_latency_benchmark_runner \
  --target http \
  --endpoint-url http://127.0.0.1:8000/internal/ai-safety/v1/detect \
  --runtime-profile cpu_local_pipeline \
  --timeout-ms 300 \
  --request-timeout-ms 3000 \
  --corpus ../../docs/ai-safety-lab/fixtures/resource-latency-benchmark-corpus.jsonl \
  --out ../../reports/ai-safety-lab
```

The runner writes sanitized aggregate-only reports to `reports/ai-safety-lab/resource-latency-benchmark.json` and `.md`. It does not write source input text, detected sensitive values, raw offsets, model token text, request identifiers, trace identifiers, hashes, or raw error bodies.

## Safety Eval Runner

Run detector-output fixture evaluation:

```bash
cd apps/ai-service
python -m app.services.safety_eval_runner \
  --mode detector-output \
  --corpus ../../docs/v1.0.0/fixtures/safety-eval-corpus.jsonl \
  --fixture app/tests/fixtures/safety_eval/detector-output.fixture.json \
  --out ../../reports/safety-eval
```

Run gateway-safety-output fixture evaluation:

```bash
cd apps/ai-service
python -m app.services.safety_eval_runner \
  --mode gateway-safety-output \
  --corpus ../../docs/v1.0.0/fixtures/safety-eval-corpus.jsonl \
  --fixture app/tests/fixtures/safety_eval/gateway-safety-output.fixture.json \
  --out ../../reports/safety-eval
```

Reports intentionally exclude raw prompts, raw responses, raw detected values, sample hashes, and Authorization headers. Only aggregate counts, detector types, outcomes, and preview hashes are written.

## Tests

```bash
cd apps/ai-service
python -m unittest discover -s app/tests -p "test_*.py"
```
