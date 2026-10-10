# Model weights

Baked into the Docker image at `/opt/models` (`PC_MODELS_DIR`); never downloaded at runtime.
Weights are not committed (`.gitignore`). `SHA256SUMS` pins the files the image build downloads.

| File | Source |
|---|---|
| `pose_landmarker_full.task`, `pose_landmarker_lite.task` | `https://storage.googleapis.com/mediapipe-models/pose_landmarker/<name>/float16/latest/<name>.task` |
| `yolo26n-pose.pt` | Ultralytics assets release (downloaded by `ultralytics.YOLO("yolo26n-pose.pt")` at build time) |
| `silero_vad.onnx` | added in Milestone 3 (barge-in) |
