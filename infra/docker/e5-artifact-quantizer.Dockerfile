# syntax=docker/dockerfile:1.7

FROM python:3.12.11-slim-bookworm@sha256:519591d6871b7bc437060736b9f7456b8731f1499a57e22e6c285135ae657bf7

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /opt/gatelm

COPY scripts/routing_difficulty_model/e5-quantizer-requirements.lock.txt ./requirements.lock.txt
RUN python -m pip install --no-compile --requirement requirements.lock.txt

COPY scripts/routing_difficulty_model/quantize_e5_onnx.py ./quantize_e5_onnx.py
RUN chmod 0444 ./quantize_e5_onnx.py

ENTRYPOINT ["python", "/opt/gatelm/quantize_e5_onnx.py"]
