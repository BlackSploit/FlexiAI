"""Measure when the agent starts receiving custom events after it joins (§8.12 race; dev only).

    python -m physiocoach.devtools.spike_events --call-id ID --seconds 20

Sends a numbered pc.consent every 0.25 s as server-side call events from `--user-id`
(default dev-physio, so the agent logs it but never acts on it: consent is accepted only from the
patient). Start it just BEFORE the agent; the first event the agent logs shows how long after its
join the coordinator watch was up. Earlier events are lost (hence the pc.ready handshake).
"""

import argparse
import asyncio
import os
import time
import uuid

from getstream import AsyncStream


async def run(args) -> None:
    client = AsyncStream()
    call = client.video.call(args.call_type, args.call_id)
    end = time.monotonic() + args.seconds
    n = 0
    while time.monotonic() < end:
        n += 1
        await call.send_call_event(user_id=args.user_id, custom={
            "type": "pc.consent", "v": 1, "eventId": f"probe{n:04d}{uuid.uuid4().hex[:8]}",
            "ts": int(time.time() * 1000), "agreed": True})
        await asyncio.sleep(args.interval)
    print(f"sent {n} probe events")
    await client.aclose()


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--call-id", required=True)
    p.add_argument("--call-type", default=os.getenv("STREAM_CALL_TYPE", "default"))
    p.add_argument("--user-id", default="dev-physio")
    p.add_argument("--seconds", type=float, default=20)
    p.add_argument("--interval", type=float, default=0.25)
    asyncio.run(run(p.parse_args()))


if __name__ == "__main__":
    main()
