# syntax=docker/dockerfile:1.7

ARG GO_VERSION=1.24

FROM debian:bookworm-slim AS e5-bundle

COPY --from=difficulty_e5 / /opt/gatelm/difficulty-e5/
WORKDIR /opt/gatelm/difficulty-e5
RUN find . -type f -printf '%P\n' | sort > /tmp/e5-actual-files \
  && awk '{print $2}' difficulty-e5-gateway-image.linux-amd64.v2.sha256 \
    | { cat; echo difficulty-e5-gateway-image.linux-amd64.v2.sha256; } \
    | sort > /tmp/e5-expected-files \
  && diff -u /tmp/e5-expected-files /tmp/e5-actual-files \
  && test -z "$(find . -type l -print -quit)" \
  && sha256sum --check difficulty-e5-gateway-image.linux-amd64.v2.sha256

FROM e5-bundle AS e5-runtime
RUN rm native/libtokenizers.a

FROM golang:${GO_VERSION}-bookworm AS builder

WORKDIR /src/apps/gateway-core

COPY apps/gateway-core/go.mod apps/gateway-core/go.sum ./
RUN go mod download

COPY apps/gateway-core ./
COPY --from=e5-bundle /opt/gatelm/difficulty-e5/native/libtokenizers.a /opt/gatelm/difficulty-e5/native/libtokenizers.a
RUN CGO_ENABLED=1 \
    GOOS=linux \
    GOARCH=amd64 \
    CGO_LDFLAGS="-L/opt/gatelm/difficulty-e5/native" \
    go build -tags=difficulty_e5_onnx -trimpath -ldflags="-s -w" -o /out/gateway-core ./cmd/gateway

FROM debian:bookworm-slim AS runner

LABEL org.opencontainers.image.title="GateLM Gateway Core E5 Shadow"
LABEL org.opencontainers.image.description="GateLM Gateway Core optional Linux amd64 E5 shadow inference profile"

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates libstdc++6 \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system gatelm \
  && useradd --system --gid gatelm --home-dir /nonexistent --shell /usr/sbin/nologin gatelm

COPY --from=builder /out/gateway-core /usr/local/bin/gateway-core
COPY --from=e5-runtime --chown=gatelm:gatelm /opt/gatelm/difficulty-e5 /opt/gatelm/difficulty-e5

USER gatelm

ENV GATEWAY_PORT=8080 \
    GATEWAY_DIFFICULTY_E5_SHADOW_ENABLED=true \
    GATEWAY_DIFFICULTY_E5_SHADOW_TIMEOUT_MS=100 \
    GATEWAY_DIFFICULTY_E5_ARTIFACT_ROOT=/opt/gatelm/difficulty-e5 \
    GATEWAY_DIFFICULTY_E5_ENCODER_MANIFEST=/opt/gatelm/difficulty-e5/difficulty-e5-encoder-manifest.v2.json \
    GATEWAY_DIFFICULTY_E5_RUNTIME_LOCK=/opt/gatelm/difficulty-e5/difficulty-e5-gateway-runtime-lock.linux-amd64.v2.json

EXPOSE 8080

CMD ["gateway-core"]
