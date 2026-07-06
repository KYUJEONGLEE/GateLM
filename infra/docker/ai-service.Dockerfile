ARG PYTHON_VERSION=3.12
ARG AI_SERVICE_INSTALL_ML_DEPS=false

FROM python:${PYTHON_VERSION}-slim-bookworm AS builder

ARG AI_SERVICE_INSTALL_ML_DEPS

ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /build

RUN python -m venv /opt/venv

ENV PATH=/opt/venv/bin:${PATH}

COPY apps/ai-service/pyproject.toml ./pyproject.toml
COPY apps/ai-service/app ./app

RUN if [ "$AI_SERVICE_INSTALL_ML_DEPS" = "true" ]; then \
    pip install --no-cache-dir ".[ml]"; \
  else \
    pip install --no-cache-dir .; \
  fi

FROM python:${PYTHON_VERSION}-slim-bookworm AS runner

LABEL org.opencontainers.image.title="GateLM AI Service"
LABEL org.opencontainers.image.version="0.1.0"
LABEL org.opencontainers.image.description="GateLM self-host AI Service production image"

ENV AI_SERVICE_HOST=0.0.0.0
ENV AI_SERVICE_PORT=8001
ENV PATH=/opt/venv/bin:${PATH}
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN groupadd --system gatelm \
  && useradd --system --gid gatelm --home-dir /nonexistent --shell /usr/sbin/nologin gatelm

COPY --from=builder --chown=gatelm:gatelm /opt/venv /opt/venv

USER gatelm

EXPOSE 8001

CMD ["gatelm-ai-service"]
