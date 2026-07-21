#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get install -y ca-certificates curl docker-compose-v2 docker.io unzip

if ! command -v aws >/dev/null 2>&1; then
  curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip \
    -o /tmp/awscliv2.zip
  rm -rf /tmp/aws
  unzip -q /tmp/awscliv2.zip -d /tmp
  /tmp/aws/install
  rm -rf /tmp/aws /tmp/awscliv2.zip
fi

systemctl enable --now docker
