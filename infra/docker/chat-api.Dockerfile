ARG NODE_VERSION=22
ARG PNPM_VERSION=9.15.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate \
  && apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/chat-api/package.json apps/chat-api/package.json
COPY apps/control-plane-api/package.json apps/control-plane-api/package.json
COPY packages/rag-config/package.json packages/rag-config/package.json
COPY packages/tenant-content-crypto/package.json packages/tenant-content-crypto/package.json
RUN pnpm install --frozen-lockfile --filter @gatelm/chat-api... --filter @gatelm/control-plane-api...

FROM deps AS builder
COPY apps/chat-api apps/chat-api
COPY apps/control-plane-api/prisma apps/control-plane-api/prisma
COPY apps/control-plane-api/prisma.config.ts apps/control-plane-api/prisma.config.ts
COPY packages/rag-config packages/rag-config
COPY packages/tenant-content-crypto packages/tenant-content-crypto
RUN pnpm --filter @gatelm/control-plane-api exec prisma generate \
  && pnpm --filter @gatelm/chat-api build

FROM base AS runner
LABEL org.opencontainers.image.title="GateLM Chat API"
LABEL org.opencontainers.image.description="GateLM Chat private session service"
ENV NODE_ENV=production
ENV CHAT_API_PORT=3003
WORKDIR /app/apps/chat-api
COPY --from=builder --chown=node:node /app/node_modules /app/node_modules
COPY --from=builder --chown=node:node /app/apps/chat-api/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/apps/chat-api/package.json ./package.json
COPY --from=builder --chown=node:node /app/apps/chat-api/dist ./dist
COPY --from=builder --chown=node:node /app/packages/rag-config/package.json /app/packages/rag-config/package.json
COPY --from=builder --chown=node:node /app/packages/rag-config/dist /app/packages/rag-config/dist
COPY --from=builder --chown=node:node /app/packages/tenant-content-crypto/package.json /app/packages/tenant-content-crypto/package.json
COPY --from=builder --chown=node:node /app/packages/tenant-content-crypto/dist /app/packages/tenant-content-crypto/dist
USER node
EXPOSE 3003
STOPSIGNAL SIGTERM
CMD ["node", "dist/main.js"]
