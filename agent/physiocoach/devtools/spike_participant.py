"""Headless call participant for Spike A (dev only).

    python -m physiocoach.devtools.spike_participant physio  --call-id ID [--seconds 60]
    python -m physiocoach.devtools.spike_participant patient --call-id ID --clip clip.mp4 [--consent-after 8]

physio  joins with a camera (a static frame), subscribes to the AGENT's video, measures the tile fps
        it receives end to end, saves snapshots to cache/spike-tiles/ and logs pc.* custom events.
patient publishes a looping clip as its camera, then sends pc.consent as a server-side call event
        with user_id = patient (the agent sees it on its coordinator WebSocket like a browser event).
"""

import argparse
import asyncio
import logging
import os
import time
import uuid
from pathlib import Path

import av
import cv2
import numpy as np
from getstream import AsyncStream
from getstream.video import rtc
from getstream.video.rtc.pb.stream.video.sfu.models.models_pb2 import TrackType as StreamTrackType
from getstream.video.rtc.tracks import SubscriptionConfig, TrackSubscriptionConfig
from vision_agents.core.utils.video_track import QueuedVideoTrack, VideoFileTrack

log = logging.getLogger("spike.participant")


def envelope(type_: str, **fields) -> dict:
    return {"type": type_, "v": 1, "eventId": uuid.uuid4().hex, "ts": int(time.time() * 1000), **fields}


async def static_camera(w: int = 640, h: int = 360) -> QueuedVideoTrack:
    track = QueuedVideoTrack(width=w, height=h, fps=15)
    img = np.full((h, w, 3), (40, 60, 90), dtype=np.uint8)
    cv2.putText(img, "physio camera (static)", (20, h // 2), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2)
    await track.add_frame(av.VideoFrame.from_ndarray(img, format="rgb24"))
    return track


async def watch_agent_video(conn, agent_user_id: str, out_dir: Path, stop: asyncio.Event) -> None:
    """Count frames of the agent's tile as received by a subscriber (end-to-end tile fps)."""
    started = asyncio.Event()

    @conn.on("track_added")
    async def _added(track_id, kind, user):
        if kind != "video" or getattr(user, "user_id", None) != agent_user_id or started.is_set():
            return
        started.set()
        track = conn.subscriber_pc.add_track_subscriber(track_id)
        log.info("subscribed to agent tile %s -> %s", track_id, type(track).__name__ if track else None)
        if track is None:
            return
        out_dir.mkdir(parents=True, exist_ok=True)
        n, window_start, last_snap = 0, time.monotonic(), 0.0
        while not stop.is_set():
            try:
                frame = await asyncio.wait_for(track.recv(), timeout=5)
            except asyncio.TimeoutError:
                log.warning("no agent tile frame for 5 s")
                continue
            except Exception as e:  # noqa: BLE001 - track ended
                log.info("agent tile ended: %s", e)
                return
            n += 1
            now = time.monotonic()
            if now - last_snap >= 10:
                last_snap = now
                path = out_dir / f"tile-{int(time.time())}.png"
                cv2.imwrite(str(path), frame.to_ndarray(format="bgr24"))
                log.info("tile snapshot %dx%d -> %s", frame.width, frame.height, path)
            if now - window_start >= 5:
                log.info("tile received fps=%.1f", n / (now - window_start))
                n, window_start = 0, now


async def run(args) -> None:
    client = AsyncStream()
    call = client.video.call(args.call_type, args.call_id)
    user_id = args.user_id or f"dev-{args.role}"
    types = [StreamTrackType.TRACK_TYPE_VIDEO] if args.role == "physio" else []
    conn = await rtc.join(call, user_id, create=False,
                          subscription_config=SubscriptionConfig(default=TrackSubscriptionConfig(track_types=types)))
    stop = asyncio.Event()

    @conn.on("custom")
    def _custom(ev: dict):
        data = ev.get("custom") or {}
        sender = (ev.get("user") or {}).get("id")
        if data.get("type", "").startswith("pc."):
            delay = round(time.time() * 1000 - data.get("ts", 0))
            log.info("custom %s from %s (%d ms) %s", data.get("type"), sender, delay,
                     {k: v for k, v in data.items() if k not in ("type", "v", "eventId", "ts")})

    async with conn:
        log.info("%s joined %s:%s", user_id, args.call_type, args.call_id)
        if args.role == "physio":
            await conn.add_tracks(video=await static_camera())
            watcher = asyncio.create_task(watch_agent_video(conn, args.agent_user_id, Path(args.out_dir), stop))
        else:
            await conn.add_tracks(video=VideoFileTrack(args.clip, fps=args.fps))
            watcher = None
            await asyncio.sleep(args.consent_after)
            for _ in range(args.consent_repeats):           # the UI re-sends until the phase moves
                await call.send_call_event(user_id=user_id, custom=envelope("pc.consent", agreed=True))
                log.info("sent pc.consent")
                await asyncio.sleep(2)
        await asyncio.sleep(args.seconds)
        stop.set()
        if watcher:
            watcher.cancel()
    await client.aclose()


def main() -> None:
    p = argparse.ArgumentParser(prog="physiocoach.devtools.spike_participant")
    p.add_argument("role", choices=["physio", "patient"])
    p.add_argument("--call-id", required=True)
    p.add_argument("--call-type", default=os.getenv("STREAM_CALL_TYPE", "default"))
    p.add_argument("--user-id")
    p.add_argument("--agent-user-id", default="physiocoach-agent")
    p.add_argument("--clip", help="patient: video clip to publish as the camera")
    p.add_argument("--fps", type=int, default=30, help="patient: frame rate the clip is published at")
    p.add_argument("--consent-after", type=float, default=8.0)
    p.add_argument("--consent-repeats", type=int, default=2)
    p.add_argument("--seconds", type=float, default=60.0)
    p.add_argument("--out-dir", default="cache/spike-tiles")
    args = p.parse_args()
    if args.role == "patient" and not args.clip:
        p.error("patient needs --clip")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
