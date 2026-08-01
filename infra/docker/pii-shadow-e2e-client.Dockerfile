ARG GO_VERSION=1.24

FROM golang:${GO_VERSION}-bookworm AS builder

WORKDIR /src/apps/gateway-core

COPY apps/gateway-core/go.mod apps/gateway-core/go.sum ./
RUN go mod download

COPY apps/gateway-core ./
RUN CGO_ENABLED=0 GOOS=linux go build \
  -trimpath \
  -ldflags="-s -w" \
  -o /out/pii-shadow-e2e-client \
  ./cmd/pii-shadow-e2e-client

FROM scratch

COPY --from=builder /out/pii-shadow-e2e-client /pii-shadow-e2e-client
