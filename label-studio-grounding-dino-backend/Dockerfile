# syntax=docker/dockerfile:1
FROM pytorch/pytorch:2.1.2-cuda12.1-cudnn8-devel

ARG DEBIAN_FRONTEND=noninteractive
ARG TEST_ENV=false
ARG GROUNDINGDINO_REF=main
ARG LABEL_STUDIO_ML_REF=master

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_CACHE_DIR=/.cache \
    PORT=9090 \
    WORKERS=1 \
    THREADS=4 \
    MODEL_DIR=/data/models \
    CUDA_HOME=/usr/local/cuda \
    GROUNDINGDINO_REPO_PATH=/GroundingDINO

ENV PATH="${CUDA_HOME}/bin:${PATH}"
ENV TORCH_CUDA_ARCH_LIST="6.0;6.1;7.0;7.5;8.0;8.6+PTX;8.9;9.0"

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      build-essential \
      ffmpeg \
      freeglut3-dev \
      g++ \
      gcc \
      git \
      libffi-dev \
      libfreeimage-dev \
      libglu1-mesa \
      libglu1-mesa-dev \
      libsm6 \
      libx11-dev \
      libxext6 \
      libxi-dev \
      libxmu-dev \
      ninja-build \
      python3-dev \
      python3-pip \
      wget; \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-test.txt ./
RUN --mount=type=cache,target=${PIP_CACHE_DIR},sharing=locked \
    pip install --no-cache-dir -r requirements.txt && \
    if [ "$TEST_ENV" = "true" ]; then pip install --no-cache-dir -r requirements-test.txt; fi

RUN git clone --depth 1 --branch "${LABEL_STUDIO_ML_REF}" https://github.com/HumanSignal/label-studio-ml-backend.git /opt/label-studio-ml-backend
RUN --mount=type=cache,target=${PIP_CACHE_DIR},sharing=locked \
    pip install --no-cache-dir --no-deps /opt/label-studio-ml-backend && \
    python -c "import label_studio_ml; print('label_studio_ml', label_studio_ml.__version__)"

RUN git clone --depth 1 --branch "${GROUNDINGDINO_REF}" https://github.com/IDEA-Research/GroundingDINO.git /GroundingDINO
WORKDIR /GroundingDINO
RUN --mount=type=cache,target=${PIP_CACHE_DIR},sharing=locked \
    pip install --no-cache-dir -e . && \
    python -c "import groundingdino; print('groundingdino import ok')"

WORKDIR /GroundingDINO/weights
RUN wget -q https://github.com/IDEA-Research/GroundingDINO/releases/download/v0.1.0-alpha/groundingdino_swint_ogc.pth

WORKDIR /app
COPY dino.py _wsgi.py log_utils.py ./

RUN mkdir -p /data/models

# groundingdino pip install upgrades numpy/transformers; pin them back last.
# Pre-cache bert-base-uncased for offline / air-gapped deploy (GroundingDINO text encoder).
RUN pip install --no-cache-dir \
    "numpy>=1.23,<2" \
    "transformers==4.38.2" \
    "huggingface-hub>=0.16,<1" \
    "opencv-python<4.10" && \
    python -c "from transformers import AutoTokenizer, AutoModel; \
AutoTokenizer.from_pretrained('bert-base-uncased'); \
AutoModel.from_pretrained('bert-base-uncased'); \
print('bert-base-uncased cached ok')" && \
    python -c "import label_studio_ml, groundingdino, numpy, transformers, cv2; print('runtime imports ok', label_studio_ml.__version__, numpy.__version__, transformers.__version__, cv2.__version__)"

# Runtime: do not contact huggingface.co (models must exist from build step above).
ENV HF_HOME=/root/.cache/huggingface \
    TRANSFORMERS_CACHE=/root/.cache/huggingface \
    TRANSFORMERS_OFFLINE=1 \
    HF_HUB_OFFLINE=1

EXPOSE 9090

CMD gunicorn --preload --bind :${PORT} --workers ${WORKERS} --threads ${THREADS} --timeout 0 _wsgi:app
