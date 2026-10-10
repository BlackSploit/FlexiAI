# agent-worker image. Build context = repo root (shared/ is copied).
#   docker build -f agent/Dockerfile -t physiocoach-agent .
#   docker build -f agent/Dockerfile --build-arg INSTALL_DEV=1 -t physiocoach-agent-test .
FROM python:3.13-slim

# libegl1/libgles2: MediaPipe 1.1.0's Tasks C library dlopens libEGL.so.1 even on CPU.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libegl1 libgles2 libglib2.0-0 ffmpeg curl \
 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir "uv==0.13.0"

# The venv lives outside /app/agent so a dev bind mount of ./agent does not hide it.
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_PYTHON_DOWNLOADS=never \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app/agent
ARG INSTALL_DEV=0

# 1) dependencies only (cached layer); the project itself is not built yet
COPY agent/pyproject.toml agent/uv.lock agent/.python-version agent/README.md ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-default-groups --group call $( [ "$INSTALL_DEV" = "1" ] && echo "--group dev" ) --no-install-project

# 2) bake model weights (no runtime downloads). Checksums are verified against models/SHA256SUMS.
ENV PC_MODELS_DIR=/opt/models
COPY agent/models/ /opt/models/
RUN mkdir -p /opt/models \
 && curl -fsSL -o /opt/models/pose_landmarker_full.task \
      https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task \
 && curl -fsSL -o /opt/models/pose_landmarker_lite.task \
      https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task \
 && curl -fsSL -o /opt/models/silero_vad.onnx \
      https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx \
 && cd /opt/models \
 && /opt/venv/bin/python -c "from ultralytics import YOLO; YOLO('yolo26n-pose.pt')" \
 && rm -rf /root/.config/Ultralytics \
 && sha256sum *.task *.pt *.onnx > SHA256SUMS.actual \
 && if [ -s SHA256SUMS ]; then sha256sum -c SHA256SUMS; fi

# 3) project source, then install the project itself
COPY agent/ ./
RUN uv sync --frozen --no-default-groups --group call $( [ "$INSTALL_DEV" = "1" ] && echo "--group dev" )
COPY shared/ /app/shared/

ENV PC_SHARED_DIR=/app/shared \
    UV_NO_SYNC=1 \
    PATH=/opt/venv/bin:$PATH \
    YOLO_OFFLINE=1
HEALTHCHECK --interval=15s --timeout=3s CMD curl -fsS http://localhost:8080/healthz || exit 1
CMD ["uvicorn", "physiocoach.control.api:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
