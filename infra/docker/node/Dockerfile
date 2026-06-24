ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-bookworm-slim

ARG PNPM_VERSION=9.15.0

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

RUN corepack enable \
  && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /workspace

CMD ["bash"]
