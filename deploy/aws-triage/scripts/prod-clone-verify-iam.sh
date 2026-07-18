#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/prod-clone-lib.sh
source "${SCRIPT_DIR}/prod-clone-lib.sh"

clone_load_env
clone_validate_env
clone_assert_role_host data
command -v aws >/dev/null 2>&1 || clone_fail "AWS CLI is required on the Data host."

verify_runtime=false
case "${1:-}" in
  "") ;;
  --runtime) verify_runtime=true ;;
  *) clone_fail "Usage: $0 [--runtime]" ;;
esac

account_id="$(aws sts get-caller-identity --query Account --output text)"
[[ "${account_id}" =~ ^[0-9]{12}$ ]] || clone_fail "Instance-profile identity is unavailable."
aws s3api head-bucket --bucket "${RAG_S3_BUCKET}" >/dev/null

tmp_payload="$(mktemp)"
tmp_download="$(mktemp)"
object_suffix="$(printf '%s' "$(hostname)-$RANDOM-$(date -u +%s%N)" | sha256sum | awk '{print $1}')"
object_key="prod-clone-iam-smoke/${object_suffix}"
object_created=false
cleanup() {
  if [[ "${object_created}" == "true" ]]; then
    aws s3api delete-object --bucket "${RAG_S3_BUCKET}" --key "${object_key}" >/dev/null 2>&1 || true
  fi
  rm -f "${tmp_payload}" "${tmp_download}"
}
trap cleanup EXIT

: > "${tmp_payload}"
aws s3api put-object \
  --bucket "${RAG_S3_BUCKET}" \
  --key "${object_key}" \
  --body "${tmp_payload}" \
  --server-side-encryption aws:kms \
  --ssekms-key-id "${RAG_S3_KMS_KEY_ID}" >/dev/null
object_created=true

read -r encryption key_id < <(aws s3api head-object \
  --bucket "${RAG_S3_BUCKET}" \
  --key "${object_key}" \
  --query '[ServerSideEncryption,SSEKMSKeyId]' \
  --output text)
[[ "${encryption}" == "aws:kms" && "${key_id}" == "${RAG_S3_KMS_KEY_ID}" ]] || \
  clone_fail "Temporary object did not use the required KMS key."

aws s3api get-object \
  --bucket "${RAG_S3_BUCKET}" \
  --key "${object_key}" \
  "${tmp_download}" >/dev/null
[[ ! -s "${tmp_download}" ]] || clone_fail "IAM smoke object payload changed unexpectedly."

aws s3api delete-object --bucket "${RAG_S3_BUCKET}" --key "${object_key}" >/dev/null
object_created=false
if aws s3api head-object --bucket "${RAG_S3_BUCKET}" --key "${object_key}" >/dev/null 2>&1; then
  clone_fail "Temporary IAM smoke object still exists after deletion."
fi

clone_log "Data instance profile S3 List/Put/Get/Delete and KMS-through-S3 access passed; temporary object was deleted."

if [[ "${verify_runtime}" != "true" ]]; then
  exit 0
fi

container_id="$(clone_compose --profile rag ps -q rag-worker 2>/dev/null || true)"
[[ -n "${container_id}" ]] || clone_fail "RAG Worker is not running; start the rag profile before --runtime verification."
container_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}" 2>/dev/null || true)"
[[ "${container_status}" == "healthy" || "${container_status}" == "running" ]] || \
  clone_fail "RAG Worker must be healthy before runtime IAM verification."

runtime_suffix="$(printf '%s' "$(hostname)-runtime-$RANDOM-$(date -u +%s%N)" | sha256sum | awk '{print $1}')"
if ! docker exec -i \
  -e "GATELM_IAM_SMOKE_SUFFIX=${runtime_suffix}" \
  "${container_id}" \
  node <<'NODE'
const {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} = require('@aws-sdk/client-s3');

const bucket = process.env.RAG_S3_BUCKET;
const kmsKeyId = process.env.RAG_S3_KMS_KEY_ID;
const region = process.env.RAG_S3_REGION;
const suffix = process.env.GATELM_IAM_SMOKE_SUFFIX;
const key = `prod-clone-runtime-iam-smoke/${suffix}`;
const client = new S3Client({ region });
let objectCreated = false;

async function deleteObject() {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  objectCreated = false;
}

async function main() {
  if (!bucket || !kmsKeyId || !region || !suffix) {
    throw new Error('runtime_environment_missing');
  }

  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: Buffer.alloc(0),
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: kmsKeyId,
    }));
    objectCreated = true;

    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    if (head.ServerSideEncryption !== 'aws:kms' || head.SSEKMSKeyId !== kmsKeyId) {
      throw new Error('runtime_kms_mismatch');
    }

    const downloaded = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const payload = await downloaded.Body.transformToByteArray();
    if (payload.length !== 0) {
      throw new Error('runtime_payload_changed');
    }

    await deleteObject();
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      throw new Error('runtime_object_still_exists');
    } catch (error) {
      if (error.message === 'runtime_object_still_exists') {
        throw error;
      }
      if (error?.$metadata?.httpStatusCode !== 404) {
        throw error;
      }
    }

    process.stdout.write('runtime_iam=passed\n');
  } finally {
    if (objectCreated) {
      await deleteObject().catch(() => undefined);
    }
  }
}

main().catch((error) => {
  const reason = typeof error?.message === 'string' ? error.message : 'unknown';
  process.stderr.write(`runtime_iam=failed:${reason}\n`);
  process.exitCode = 1;
});
NODE
then
  clone_fail "RAG Worker container could not use its runtime S3/KMS credentials."
fi

clone_log "RAG Worker container S3 Put/Get/Delete and KMS-through-S3 access passed; temporary object was deleted."
