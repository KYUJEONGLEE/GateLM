ARG NODE_VERSION=22
ARG PNPM_VERSION=9.15.0

FROM node:${NODE_VERSION}-bookworm-slim AS base

ARG PNPM_VERSION

ENV NEXT_TELEMETRY_DISABLED=1
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

WORKDIR /app

RUN corepack enable \
  && corepack prepare pnpm@${PNPM_VERSION} --activate

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/application/package.json apps/application/package.json
COPY apps/web/package.json apps/web/package.json

RUN pnpm install --frozen-lockfile --filter @gatelm/application... --filter @gatelm/web...

FROM deps AS builder

COPY apps/application apps/application
COPY apps/web apps/web
COPY docs/v1.0.0/fixtures docs/v1.0.0/fixtures

RUN pnpm --filter @gatelm/application build

FROM node:${NODE_VERSION}-bookworm-slim AS runner

LABEL org.opencontainers.image.title="GateLM Application"
LABEL org.opencontainers.image.version="0.1.0"
LABEL org.opencontainers.image.description="GateLM customer application production image"

ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3002

WORKDIR /app

COPY --from=builder --chown=node:node /app/apps/application/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/application/.next/static ./apps/application/.next/static

USER node

EXPOSE 3002

CMD ["node", "apps/application/server.js"]
