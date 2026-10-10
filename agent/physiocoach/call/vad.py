"""Silero VAD with a lean ONNX Runtime session.

Vision Agents' SileroVADSessionPool sets only inter_op_num_threads=1, so ONNX Runtime's intra-op
pool uses every core with spin-waiting threads. Run ~50x/s on the physio's audio, that burnt 3-4
cores in the Milestone 4 live run and starved video decoding (patient frames fell to ~1 fps).
One thread, no spinning: a 512-sample Silero step is well under a millisecond anyway.
"""

import onnxruntime as ort
from vision_agents.core.vad.silero import SileroVADSessionPool


class LeanSileroVADSessionPool(SileroVADSessionPool):
    def __init__(self, model_path: str):
        opts = ort.SessionOptions()
        opts.inter_op_num_threads = 1
        opts.intra_op_num_threads = 1
        opts.add_session_config_entry("session.intra_op.allow_spinning", "0")
        opts.add_session_config_entry("session.inter_op.allow_spinning", "0")
        self._model = ort.InferenceSession(model_path, sess_options=opts, providers=["CPUExecutionProvider"])
