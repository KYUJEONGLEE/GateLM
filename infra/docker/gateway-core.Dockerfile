ARG GO_VERSION=1.24

FROM golang:${GO_VERSION}-bookworm AS builder

WORKDIR /src/apps/gateway-core

COPY apps/gateway-core/go.mod apps/gateway-core/go.sum ./
RUN go mod download

COPY apps/gateway-core ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/gateway-core ./cmd/gateway

FROM debian:bookworm-slim AS runner

LABEL org.opencontainers.image.title="GateLM Gateway Core"
LABEL org.opencontainers.image.version="0.1.0"
LABEL org.opencontainers.image.description="GateLM self-host Gateway Core production image"

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system gatelm \
  && useradd --system --gid gatelm --home-dir /nonexistent --shell /usr/sbin/nologin gatelm

COPY --from=builder /out/gateway-core /usr/local/bin/gateway-core

USER gatelm

ENV GATEWAY_PORT=8080

EXPOSE 8080

CMD ["gateway-core"]
