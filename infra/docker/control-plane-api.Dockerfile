ARG NODE_VERSION=22
ARG PNPM_VERSION=9.15.0

FROM node:${NODE_VERSION}-bookworm-slim AS base

ARG PNPM_VERSION

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

WORKDIR /app

RUN corepack enable \
  && corepack prepare pnpm@${PNPM_VERSION} --activate \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/control-plane-api/package.json apps/control-plane-api/package.json

RUN pnpm install --frozen-lockfile --filter @gatelm/control-plane-api...

FROM deps AS builder

COPY apps/control-plane-api apps/control-plane-api
COPY scripts/dev/ensure-control-plane-prisma-client.mjs scripts/dev/ensure-control-plane-prisma-client.mjs

RUN pnpm --filter @gatelm/control-plane-api db:generate \
  && pnpm --filter @gatelm/control-plane-api build

FROM base AS runner

LABEL org.opencontainers.image.title="GateLM Control Plane API"
LABEL org.opencontainers.image.version="2.1.0"
LABEL org.opencontainers.image.description="GateLM self-host Control Plane API production image"

ENV CONTROL_PLANE_PORT=3001
ENV NODE_ENV=production

WORKDIR /app/apps/control-plane-api

COPY --from=builder --chown=node:node /app/node_modules /app/node_modules
COPY --from=builder --chown=node:node /app/apps/control-plane-api/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/apps/control-plane-api/package.json ./package.json
COPY --from=builder --chown=node:node /app/apps/control-plane-api/dist ./dist
COPY --from=builder --chown=node:node /app/apps/control-plane-api/prisma ./prisma
COPY --from=builder --chown=node:node /app/apps/control-plane-api/prisma.config.ts ./prisma.config.ts

USER node

EXPOSE 3001

CMD ["node", "dist/src/main.js"]
