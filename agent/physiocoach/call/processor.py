"""PoseProcessor (§8.11): subscribes to the PATIENT's video itself and publishes the annotated tile.

It is a VideoPublisher only (DEV-13). Vision Agents routes just one remote video track (the first
camera to arrive) to VideoProcessors, so a physio who joins first with a camera would starve the
patient feed. Instead we listen for TrackAddedEvent, keep only the patient's VIDEO track and call
`edge.add_track_subscriber(track_id)`. The getstream edge subscribes every track at the SFU level
regardless of processors, so the subscription exists even with no VideoProcessor (Spike A 3a).

No inference before consent (§1.4 #7): until `enabled` is set the tile shows a static placeholder
and patient frames are dropped unread.

Live Coach stills (WP1b, D5): the last ANNOTATED tile is kept and `latest_jpeg()` encodes a small JPEG of it
on demand (lazy cv2). It returns None before consent / while disabled, without a frame, or when the frame
is stale, so no raw patient frame ever leaves the process through this path.
"""

import asyncio
import logging
import statistics
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from typing import Awaitable, Callable, Optional

import av
from vision_agents.core.edge.events import TrackAddedEvent, TrackRemovedEvent
from vision_agents.core.edge.types import TrackType
from vision_agents.core.processors import VideoPublisher
from vision_agents.core.utils.video_forwarder import VideoForwarder
from vision_agents.core.utils.video_track import QueuedVideoTrack, VideoFileTrack

from ..pose.base import FrameMeta, Keypoints, PoseBackend
from ..pose.draw import draw_overlay, placeholder_frame
from ..pose.overlay import OverlayState

log = logging.getLogger(__name__)

STILL_MAX_AGE_S = 2.0       # latest_jpeg() refuses an older annotated frame (camera gone / stalled)
SAMPLE_TOLERANCE = 0.75     # keep a frame when >= 75 % of the target interval has passed since the last one
KeypointsCallback = Callable[[float, Optional[Keypoints], FrameMeta], Awaitable[None]]


class FrameStats:
    """Rolling Spike A measurements, logged every `every_s` seconds."""

    def __init__(self, every_s: float = 5.0):
        self.every_s = every_s
        self.window_start = time.monotonic()
        self.cpu_start = time.process_time()
        self.frames_in = 0          # frames delivered by the forwarder
        self.frames_used = 0        # frames kept after timestamp sampling
        self.frames_out = 0
        self.loop_lag_ms = 0.0      # worst event-loop lag in the window (lag probe)
        self.infer_ms: deque[float] = deque(maxlen=300)
        self.draw_ms: deque[float] = deque(maxlen=300)
        self.samples: list[dict] = []

    def maybe_report(self) -> None:
        now = time.monotonic()
        dt = now - self.window_start
        if dt < self.every_s:
            return
        cpu = (time.process_time() - self.cpu_start) / dt * 100
        q = lambda xs, p: round(statistics.quantiles(xs, n=100)[p - 1], 1) if len(xs) >= 2 else None  # noqa: E731
        row = {
            "in_fps": round(self.frames_in / dt, 1), "used_fps": round(self.frames_used / dt, 1),
            "out_fps": round(self.frames_out / dt, 1), "loop_lag_ms": round(self.loop_lag_ms, 1),
            "infer_ms_p50": q(self.infer_ms, 50), "infer_ms_p95": q(self.infer_ms, 95),
            "draw_ms_p50": q(self.draw_ms, 50), "cpu_pct": round(cpu, 1),
        }
        self.samples.append(row)
        log.info("pose stats %s", row)
        self.window_start, self.cpu_start = now, time.process_time()
        self.frames_in = self.frames_used = self.frames_out = 0
        self.loop_lag_ms = 0.0

    async def lag_probe(self, period: float = 0.05) -> None:
        """Worst event-loop scheduling delay: a blocked loop starves frame delivery."""
        loop = asyncio.get_running_loop()
        while True:
            t0 = loop.time()
            await asyncio.sleep(period)
            self.loop_lag_ms = max(self.loop_lag_ms, (loop.time() - t0 - period) * 1000)


class PoseProcessor(VideoPublisher):
    name = "physio_pose"

    def __init__(self, backend_factory: Callable[[], PoseBackend], fps: int = 12, out_w: int = 960, out_h: int = 540):
        super().__init__()
        self.fps, self.out_w, self.out_h = fps, out_w, out_h
        self.out = QueuedVideoTrack(width=out_w, height=out_h, fps=fps)
        self.patient_user_id: Optional[str] = None
        self.enabled = False                                   # NO inference before consent
        self.on_keypoints: Optional[KeypointsCallback] = None  # set by the flow
        self.overlay: Callable[[], OverlayState] = OverlayState.idle   # never None (called on every frame)
        self.stats = FrameStats()
        self.first_frame_at: Optional[float] = None
        self.subscribed_at: Optional[float] = None
        self._backend_factory = backend_factory
        self._backend: Optional[PoseBackend] = None
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="pose")
        self._fwd: Optional[VideoForwarder] = None
        self._track_id: Optional[str] = None
        self._last_t: Optional[float] = None
        self._last_pts_t: Optional[float] = None
        self._last_mono: Optional[float] = None
        self._last_placeholder = 0.0
        self._last_used_t: Optional[float] = None
        self._agent = None
        self._last_annotated = None                            # last annotated RGB tile (live-coach stills)
        self._last_annotated_at: Optional[float] = None

    def latest_jpeg(self, width: int = 384, quality: int = 60, max_age_s: float = STILL_MAX_AGE_S) -> Optional[bytes]:
        """JPEG of the last annotated tile, at most `width` px wide; None unless enabled with a fresh frame."""
        img, at = self._last_annotated, self._last_annotated_at
        if not self.enabled or img is None or at is None or time.monotonic() - at > max_age_s:
            return None
        try:
            import cv2                                         # lazy: only live mode with stills needs it
            h, w = img.shape[:2]
            if w > width:
                img = cv2.resize(img, (int(width), max(1, round(h * width / w))), interpolation=cv2.INTER_AREA)
            ok, buf = cv2.imencode(".jpg", cv2.cvtColor(img, cv2.COLOR_RGB2BGR),
                                   [int(cv2.IMWRITE_JPEG_QUALITY), int(quality)])
            return buf.tobytes() if ok else None
        except Exception as e:  # noqa: BLE001 - a still is optional
            log.debug("latest_jpeg failed: %s", e)
            return None

    def publish_video_track(self) -> QueuedVideoTrack:
        return self.out

    def attach_agent(self, agent) -> None:
        """Called by Agent.__init__ (before join): watch for the patient's camera track."""
        self._agent = agent

        @agent.events.subscribe
        async def _on_track(e: TrackAddedEvent | TrackRemovedEvent):
            if not e.participant or e.participant.user_id != self.patient_user_id:
                return
            if e.track_type != TrackType.VIDEO:                # ignore audio and screenshare
                return
            if isinstance(e, TrackRemovedEvent):
                if e.track_id == self._track_id:
                    log.info("patient video track %s removed", e.track_id)
                    await self._detach()
                return
            track = self._agent.edge.add_track_subscriber(e.track_id)
            log.info("spike 3a: add_track_subscriber(%s) -> %s", e.track_id, type(track).__name__ if track else None)
            await self._attach_track(track, e.track_id)

    async def start(self) -> None:
        self._lag_task = asyncio.create_task(self.stats.lag_probe())
        await self.out.add_frame(av.VideoFrame.from_ndarray(placeholder_frame(self.out_w, self.out_h), format="rgb24"))

    async def warmup(self) -> None:
        """Build the backend in the worker thread before join (MediaPipe/YOLO cold start is seconds)."""
        t0 = time.monotonic()
        self._backend = await asyncio.get_running_loop().run_in_executor(self._pool, self._backend_factory)
        log.info("pose backend %s ready in %.1f s", self._backend.name, time.monotonic() - t0)

    async def _attach_track(self, track, track_id: str) -> None:
        if track is None:
            return
        await self._detach()
        self._track_id = track_id
        self.subscribed_at = time.monotonic()
        # The forwarder throttles handlers by ARRIVAL time (min 1/fps since the last call): a 15 fps camera
        # with a 12 fps handler then runs at ~7.5 fps. We take every frame and sample by frame timestamp.
        self._fwd = VideoForwarder(track, max_buffer=3, fps=30, name=f"pose-{track_id}")
        self._fwd.add_frame_handler(self._on_frame, fps=None, name="pose")
        self._last_used_t = None

    async def attach_file(self, path: str) -> None:
        """Replay mode: the same pipeline fed from a looping file instead of the patient's camera."""
        await self._attach_track(VideoFileTrack(path, fps=30), f"file:{path}")

    async def _detach(self) -> None:
        if self._fwd:
            await self._fwd.remove_frame_handler(self._on_frame)
        self._fwd, self._track_id = None, None
        self._last_annotated, self._last_annotated_at = None, None

    def _frame_time(self, frame: av.VideoFrame) -> float:
        """Continuous, strictly increasing seconds.

        Advances by the frame's own pts while it moves forward plausibly (arrival time adds forwarder
        jitter to rep durations), else by wall time (file loop, RTP reset). MediaPipe VIDEO mode needs
        strictly increasing timestamps.
        """
        mono = time.monotonic()
        pts_t = float(frame.pts * frame.time_base) if frame.pts is not None and frame.time_base else None
        if self._last_t is None:
            t = mono
        elif pts_t is not None and self._last_pts_t is not None and 0 < pts_t - self._last_pts_t <= 2.0:
            t = self._last_t + (pts_t - self._last_pts_t)
        else:
            t = self._last_t + max(1e-3, mono - (self._last_mono or mono))
        if self._last_t is not None and t <= self._last_t:
            t = self._last_t + 1e-3
        self._last_t, self._last_pts_t, self._last_mono = t, pts_t, mono
        return t

    async def _on_frame(self, frame: av.VideoFrame) -> None:
        if self.first_frame_at is None:
            self.first_frame_at = time.monotonic()
            log.info("spike 3a: first patient frame %dx%d after %.2f s", frame.width, frame.height,
                     self.first_frame_at - (self.subscribed_at or self.first_frame_at))
        self.stats.frames_in += 1
        try:
            if not (self.enabled and self._backend):          # before consent: placeholder only, frame unread
                now = time.monotonic()
                if now - self._last_placeholder >= 0.5:
                    self._last_placeholder = now
                    img = placeholder_frame(self.out_w, self.out_h, self.overlay())
                    await self.out.add_frame(av.VideoFrame.from_ndarray(img, format="rgb24"))
                    self.stats.frames_out += 1
                return
            t = self._frame_time(frame)
            if self._last_used_t is not None and t - self._last_used_t < SAMPLE_TOLERANCE / self.fps:
                return                                        # sample by frame time, ~fps (15 fps input -> 15)
            self._last_used_t = t
            self.stats.frames_used += 1
            loop = asyncio.get_running_loop()
            rgb = frame.to_ndarray(format="rgb24")
            t0 = time.perf_counter()
            kp = await loop.run_in_executor(self._pool, self._backend.infer, rgb, int(t * 1000))
            t1 = time.perf_counter()
            if self.on_keypoints:
                meta = FrameMeta(rgb.shape[1], rgb.shape[0], float(rgb[::8, ::8].mean()))
                await self.on_keypoints(t, kp, meta)
            annotated = await loop.run_in_executor(self._pool, draw_overlay, rgb, kp, self.overlay(), self.out_w, self.out_h)
            t2 = time.perf_counter()
            await self.out.add_frame(av.VideoFrame.from_ndarray(annotated, format="rgb24"))
            self._last_annotated, self._last_annotated_at = annotated, time.monotonic()
            self.stats.frames_out += 1
            self.stats.infer_ms.append((t1 - t0) * 1000)
            self.stats.draw_ms.append((t2 - t1) * 1000)
        finally:
            self.stats.maybe_report()

    async def close(self) -> None:
        if getattr(self, "_lag_task", None):
            self._lag_task.cancel()
        await self._detach()
        self.out.stop()
        if self._backend:
            self._backend.close()
        self._pool.shutdown(wait=False)
