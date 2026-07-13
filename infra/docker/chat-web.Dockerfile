ARG NODE_VERSION=22
ARG PNPM_VERSION=9.15.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV NEXT_TELEMETRY_DISABLED=1
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/chat-web/package.json apps/chat-web/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/web-bff/package.json packages/web-bff/package.json
RUN pnpm install --frozen-lockfile --filter @gatelm/chat-web...

FROM deps AS builder
COPY apps/chat-web apps/chat-web
COPY packages/ui packages/ui
COPY packages/web-bff packages/web-bff
ENV GATELM_NEXT_OUTPUT_STANDALONE=true
RUN pnpm --filter @gatelm/chat-web build

FROM node:${NODE_VERSION}-bookworm-slim AS runner
LABEL org.opencontainers.image.title="GateLM Chat Web"
LABEL org.opencontainers.image.description="GateLM Chat browser client and same-origin BFF"
ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3002
WORKDIR /app
COPY --from=builder --chown=node:node /app/apps/chat-web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/chat-web/.next/static ./apps/chat-web/.next/static
COPY --from=builder --chown=node:node /app/apps/chat-web/public ./apps/chat-web/public
USER node
EXPOSE 3002
STOPSIGNAL SIGTERM
CMD ["node", "apps/chat-web/server.js"]
