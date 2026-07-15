# GateLM AI Service

This service owns optional AI Safety and Evaluation Lab work for the v1.0.0 baseline. It is not a required dependency of the Gateway hot path.

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

The primary sidecar detector model defaults to `openai/privacy-filter`. For lightweight local Korean privacy NER experiments, keep the primary model and add the quantized KoELECTRA ONNX artifact as an additional detector:

```bash
AI_SERVICE_TRANSFORMERS_OFFLINE=1
AI_SERVICE_AI_SAFETY_DETECTOR_RUNTIME=onnx
AI_SERVICE_AI_SAFETY_PRELOAD_ENABLED=true
AI_SERVICE_AI_SAFETY_PARALLEL_ADAPTERS_ENABLED=false
AI_SERVICE_ONNX_INTRA_OP_THREADS=4
AI_SERVICE_ONNX_INTER_OP_THREADS=1
AI_SERVICE_ONNX_ALLOW_SPINNING=false
AI_SERVICE_AI_SAFETY_DETECTOR_MODEL_ID=.cache/onnx/openai--privacy-filter
AI_SERVICE_AI_SAFETY_ADDITIONAL_DETECTOR_MODEL_IDS=.cache/onnx/amoeba04--koelectra-small-v3-privacy-ner-quantized
```

Both models are loaded through local ONNX Runtime pipelines and their detections are merged through the same sanitized GateLM policy path. Keep both model directories mounted or copied into `.cache/onnx` for network-free sidecar startup. Do not send raw prompts to hosted Hugging Face inference APIs for this path.

For the pinned 2026-07-15 bundle, the accepted KoELECTRA model labels are email, phone number, and resident registration number only. Person-name and organization-name detections are intentionally excluded from both model label maps and currently come from the local rule backstop. The supplied evaluation does not justify claiming model-based Korean name or organization detection.

Import only manifest-listed model artifacts from the delivery archive and verify every file hash:

```bash
python scripts/tenant_chat_pii_models/import_bundle.py \
  apps/ai-service/.cache/bundles/tenant-chat-pii-model-bundle-20260715.zip
```

The imported `.cache/onnx` files are runtime assets and are ignored by Git. The manifest, evaluation summary, third-party notices, and Apache-2.0 text remain versioned in the repository. See `docs/ai-safety-lab/tenant-chat-pii-model-integration-20260715.md` for measured evidence and promotion limits.

## AI Safety Detector Sidecar

The local detector sidecar endpoint is available at:

```text
POST /internal/ai-safety/v1/detect
```

It uses the `ai-safety-detector.v1` draft contract and returns Provider-safe `redactedPrompt`, storage-safe `logSafePrompt`, `detectorSummary`, and sanitized `detections`. The endpoint accepts `shadow` and `enforce`: shadow observations do not change the Provider prompt or final action, while enforce results can redact or block before Provider execution. `logSafePrompt` and the preview redact detections even when the Provider policy action is `allow`. `openai/privacy-filter` remains the primary default adapter, and additional adapters such as KoELECTRA can be enabled through configuration. It does not return model `word`, raw detected values, raw prompt fragments, or offsets.

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
AI_SERVICE_AI_SAFETY_PARALLEL_ADAPTERS_ENABLED=false \
AI_SERVICE_ONNX_INTRA_OP_THREADS=4 \
AI_SERVICE_ONNX_INTER_OP_THREADS=1 \
AI_SERVICE_ONNX_ALLOW_SPINNING=false \
AI_SERVICE_AI_SAFETY_DETECTOR_MODEL_ID=.cache/onnx/openai--privacy-filter \
AI_SERVICE_AI_SAFETY_ADDITIONAL_DETECTOR_MODEL_IDS=.cache/onnx/amoeba04--koelectra-small-v3-privacy-ner-quantized \
python -m app.main
```

Use ONNX Runtime for an exported token-classification model by installing the optional ONNX dependencies and pointing the model id at the exported model directory:

```bash
cd apps/ai-service
python -m pip install -e ".[onnx,test]"
AI_SERVICE_TRANSFORMERS_OFFLINE=1 \
AI_SERVICE_AI_SAFETY_DETECTOR_RUNTIME=onnx \
AI_SERVICE_AI_SAFETY_DETECTOR_MODEL_ID=.cache/onnx/openai--privacy-filter \
AI_SERVICE_AI_SAFETY_ADDITIONAL_DETECTOR_MODEL_IDS=.cache/onnx/amoeba04--koelectra-small-v3-privacy-ner-quantized \
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
