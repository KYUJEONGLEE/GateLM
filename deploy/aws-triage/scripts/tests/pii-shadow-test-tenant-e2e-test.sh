#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SCRIPT_PATH="${ROOT_DIR}/deploy/aws-triage/scripts/pii-shadow-test-tenant-e2e.sh"
DOCKERFILE_PATH="${ROOT_DIR}/infra/docker/pii-shadow-e2e-client.Dockerfile"

[[ -f "${SCRIPT_PATH}" ]] || { echo 'Missing PII Shadow test-tenant runner.' >&2; exit 1; }
[[ -f "${DOCKERFILE_PATH}" ]] || { echo 'Missing PII Shadow Gateway client Dockerfile.' >&2; exit 1; }

bash -n "${SCRIPT_PATH}"

grep -Fq 'production_assert_role_host pii' "${SCRIPT_PATH}"
grep -Fq 'production_assert_pii_model_artifact' "${SCRIPT_PATH}"
grep -Fq '8a5cb146e84d413910a423d304e662a6aba9f69e83db129f5061d007a6de9381' "${SCRIPT_PATH}"
grep -Fq '02|03|04' "${SCRIPT_PATH}"
grep -Fq 'GATELM_PII_SHADOW_APPROVED_WINDOW_OVERRIDE' "${SCRIPT_PATH}"
grep -Fq -- '--network none' "${SCRIPT_PATH}"
grep -Fq -- '--respect-night-window' "${SCRIPT_PATH}"
grep -Fq -- '--approved-window-override' "${SCRIPT_PATH}"
grep -Fq -- '--verified-clean-source' "${SCRIPT_PATH}"
grep -Fq -- '--requests 1000' "${SCRIPT_PATH}"
grep -Fq -- '--sample-basis-points 500' "${SCRIPT_PATH}"
grep -Fq 'GATELM_DEMO_TENANT_ID' "${SCRIPT_PATH}"
grep -Fq 'docker create "${client_image}" /pii-shadow-e2e-client' "${SCRIPT_PATH}"
grep -Fq 'docker cp' "${SCRIPT_PATH}"
if grep -Fq -- '--output' "${SCRIPT_PATH}"; then
  echo 'PII Shadow validation runner must support the host legacy Docker builder.' >&2
  exit 1
fi
grep -Fq 'FROM scratch' "${DOCKERFILE_PATH}"

if grep -Eq 'docker compose|systemctl|aws ec2|aws s3|--publish|^[[:space:]]+-p([[:space:]]|$)' "${SCRIPT_PATH}"; then
  echo 'PII Shadow validation runner must not deploy services, mutate AWS, or publish ports.' >&2
  exit 1
fi

if grep -Eq 'EXPOSE|ENTRYPOINT|CMD' "${DOCKERFILE_PATH}"; then
  echo 'PII Shadow Gateway client export image must remain build-only.' >&2
  exit 1
fi

echo 'PII Shadow test-tenant E2E static validation passed.'
