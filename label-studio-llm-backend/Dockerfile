# syntax=docker/dockerfile:1
ARG PYTHON_VERSION=3.12

FROM python:${PYTHON_VERSION}-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=9090 \
    WORKERS=1 \
    THREADS=8 \
    MODEL_DIR=/data/models

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends git tesseract-ocr; \
    apt-get autoremove -y; \
    rm -rf /var/lib/apt/lists/*

# 依赖层单独构建并缓存：仅 requirements.txt 变更时才重新 pip install
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir -r requirements.txt

# 业务代码放最后：改 model.py 时复用上面已缓存的依赖层
COPY model.py _wsgi.py default_prompt.txt ./

RUN mkdir -p /data/models

EXPOSE 9090

CMD gunicorn --preload --bind :${PORT} --workers ${WORKERS} --threads ${THREADS} --timeout 0 _wsgi:app
