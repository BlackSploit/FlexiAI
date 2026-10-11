"""PoseProcessor.latest_jpeg (WP1b, D5, H1): a small JPEG of the last ANNOTATED tile, None unless enabled
with a fresh frame. Runs in the Docker test image (vision_agents, av and cv2 installed)."""

import base64
import time

import pytest

pytest.importorskip("vision_agents")
cv2 = pytest.importorskip("cv2")
np = pytest.importorskip("numpy")

from physiocoach.call.live_coach import STILL_MAX_B64  # noqa: E402
from physiocoach.call.processor import PoseProcessor  # noqa: E402


def _tile(w=640, h=360):
    rng = np.random.default_rng(1)
    img = (rng.random((h, w, 3)) * 40).astype(np.uint8)                       # busy-ish, like a camera tile
    img[h // 4: h // 2, w // 4: w // 2] = (255, 0, 0)                          # a red block (RGB)
    return img


async def test_latest_jpeg_is_none_before_consent_and_without_a_frame():
    pose = PoseProcessor(lambda: None)
    assert pose.latest_jpeg() is None                                          # disabled, no frame
    pose.enabled = True
    assert pose.latest_jpeg() is None                                          # enabled, no frame
    pose._last_annotated, pose._last_annotated_at = _tile(), time.monotonic()
    pose.enabled = False
    assert pose.latest_jpeg() is None                                          # frame, but no consent
    pose._pool.shutdown(wait=False)


async def test_latest_jpeg_is_a_small_384px_jpeg_of_the_annotated_tile():
    pose = PoseProcessor(lambda: None)
    pose.enabled = True
    pose._last_annotated, pose._last_annotated_at = _tile(), time.monotonic()
    jpeg = pose.latest_jpeg(width=384, quality=60)
    assert jpeg[:2] == b"\xff\xd8" and len(base64.b64encode(jpeg)) <= STILL_MAX_B64
    img = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)        # BGR
    assert img.shape[:2] == (216, 384)
    b, g, r = img[216 * 3 // 8, 384 * 3 // 8]
    assert r > 200 and b < 60                                                  # RGB -> BGR handled
    pose._pool.shutdown(wait=False)


async def test_latest_jpeg_refuses_a_stale_frame_and_detach_clears_it():
    pose = PoseProcessor(lambda: None)
    pose.enabled = True
    pose._last_annotated, pose._last_annotated_at = _tile(), time.monotonic() - 10
    assert pose.latest_jpeg() is None
    pose._last_annotated_at = time.monotonic()
    assert pose.latest_jpeg() is not None
    await pose._detach()
    assert pose.latest_jpeg() is None and pose._last_annotated is None
    pose._pool.shutdown(wait=False)
