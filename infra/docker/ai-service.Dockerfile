ARG PYTHON_VERSION=3.12
ARG AI_SERVICE_INSTALL_ML_DEPS=true

FROM python:${PYTHON_VERSION}-slim-bookworm AS builder

ARG AI_SERVICE_INSTALL_ML_DEPS

ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /build

RUN python -m venv /opt/venv

ENV PATH=/opt/venv/bin:${PATH}
ENV TIKTOKEN_CACHE_DIR=/opt/venv/tiktoken-cache

COPY apps/ai-service/pyproject.toml ./pyproject.toml
COPY apps/ai-service/requirements-rag-extraction.lock ./requirements-rag-extraction.lock
COPY apps/ai-service/app ./app

RUN if [ "$AI_SERVICE_INSTALL_ML_DEPS" = "true" ]; then \
    pip install --no-cache-dir ".[onnx]"; \
RUN pip install --no-cache-dir --requirement requirements-rag-extraction.lock \
  && if [ "$AI_SERVICE_INSTALL_ML_DEPS" = "true" ]; then \
    pip install --no-cache-dir ".[ml]"; \
  else \
    pip install --no-cache-dir --no-deps .; \
  fi \
  && mkdir -p "$TIKTOKEN_CACHE_DIR" \
  && python -c "import tiktoken; assert tiktoken.encoding_for_model('text-embedding-3-large').name == 'cl100k_base'"

FROM python:${PYTHON_VERSION}-slim-bookworm AS runner

LABEL org.opencontainers.image.title="GateLM AI Service"
LABEL org.opencontainers.image.version="2.1.0"
LABEL org.opencontainers.image.description="GateLM self-host AI Service production image"

ENV AI_SERVICE_HOST=0.0.0.0
ENV AI_SERVICE_PORT=8001
ENV PATH=/opt/venv/bin:${PATH}
ENV TIKTOKEN_CACHE_DIR=/opt/venv/tiktoken-cache
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN groupadd --system gatelm \
  && useradd --system --gid gatelm --home-dir /nonexistent --shell /usr/sbin/nologin gatelm \
  && mkdir -p /models \
  && chown gatelm:gatelm /models

COPY --from=builder --chown=gatelm:gatelm /opt/venv /opt/venv

USER gatelm

EXPOSE 8001

CMD ["gatelm-ai-service"]
