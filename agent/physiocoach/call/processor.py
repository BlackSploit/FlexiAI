"""PoseProcessor (§8.11): subscribes to the PATIENT's video itself and publishes the annotated tile.

It is a VideoPublisher only (DEV-13). Vision Agents routes just one remote video track (the first
camera to arrive) to VideoProcessors, so a physio who joins first with a camera would starve the
patient feed. Instead we listen for TrackAddedEvent, keep only the patient's VIDEO track and call
`edge.add_track_subscriber(track_id)`. The getstream edge subscribes every track at the SFU level
regardless of processors, so the subscription exists even with no VideoProcessor (Spike A 3a).

No inference before consent (§1.4 #7): until `enabled` is set the tile shows a static placeholder
and patient frames are dropped unread.
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

from ..pose.base import Keypoints, PoseBackend
from ..pose.draw import OverlayState, draw_overlay, placeholder_frame

log = logging.getLogger(__name__)

KeypointsCallback = Callable[[float, Optional[Keypoints], tuple[int, ...]], Awaitable[None]]


class FrameStats:
    """Rolling Spike A measurements, logged every `every_s` seconds."""

    def __init__(self, every_s: float = 5.0):
        self.every_s = every_s
        self.window_start = time.monotonic()
        self.cpu_start = time.process_time()
        self.frames_in = 0
        self.frames_out = 0
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
            "in_fps": round(self.frames_in / dt, 1), "out_fps": round(self.frames_out / dt, 1),
            "infer_ms_p50": q(self.infer_ms, 50), "infer_ms_p95": q(self.infer_ms, 95),
            "draw_ms_p50": q(self.draw_ms, 50), "cpu_pct": round(cpu, 1),
        }
        self.samples.append(row)
        log.info("pose stats %s", row)
        self.window_start, self.cpu_start = now, time.process_time()
        self.frames_in = self.frames_out = 0


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
        self._agent = None

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
        self._fwd = VideoForwarder(track, max_buffer=3, fps=self.fps, name=f"pose-{track_id}")
        self._fwd.add_frame_handler(self._on_frame, fps=self.fps, name="pose")

    async def attach_file(self, path: str) -> None:
        """Replay mode: the same pipeline fed from a looping file instead of the patient's camera."""
        await self._attach_track(VideoFileTrack(path, fps=30), f"file:{path}")

    async def _detach(self) -> None:
        if self._fwd:
            await self._fwd.remove_frame_handler(self._on_frame)
        self._fwd, self._track_id = None, None

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
            loop = asyncio.get_running_loop()
            rgb = frame.to_ndarray(format="rgb24")
            t = self._frame_time(frame)
            t0 = time.perf_counter()
            kp = await loop.run_in_executor(self._pool, self._backend.infer, rgb, int(t * 1000))
            t1 = time.perf_counter()
            if self.on_keypoints:
                await self.on_keypoints(t, kp, rgb.shape)
            annotated = await loop.run_in_executor(self._pool, draw_overlay, rgb, kp, self.overlay(), self.out_w, self.out_h)
            t2 = time.perf_counter()
            await self.out.add_frame(av.VideoFrame.from_ndarray(annotated, format="rgb24"))
            self.stats.frames_out += 1
            self.stats.infer_ms.append((t1 - t0) * 1000)
            self.stats.draw_ms.append((t2 - t1) * 1000)
        finally:
            self.stats.maybe_report()

    async def close(self) -> None:
        await self._detach()
        self.out.stop()
        if self._backend:
            self._backend.close()
        self._pool.shutdown(wait=False)
