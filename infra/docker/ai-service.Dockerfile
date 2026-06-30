ARG PYTHON_VERSION=3.12

FROM python:${PYTHON_VERSION}-slim-bookworm AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /build

RUN python -m venv /opt/venv

ENV PATH=/opt/venv/bin:${PATH}

COPY apps/ai-service/pyproject.toml ./pyproject.toml
COPY apps/ai-service/app ./app

RUN pip install --no-cache-dir .

FROM python:${PYTHON_VERSION}-slim-bookworm AS runner

LABEL org.opencontainers.image.title="GateLM AI Service"
LABEL org.opencontainers.image.version="2.1.0"
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
