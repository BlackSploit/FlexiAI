import asyncio

import pytest

from physiocoach.call.speaker import Speaker
from physiocoach.core import phrases
from physiocoach.core.coach_rules import live_cue_ids, rule_note_ids
from physiocoach.core.rep_engine import Rep
from physiocoach.core.scoring import SetMetrics

CLIP_S = 0.02


class FakeAgent:
    def __init__(self):
        self.said: list[str] = []
        self.events: list[dict] = []
        self.timeline: list[tuple[str, str]] = []

    async def say(self, text: str, interrupt: bool = False) -> None:
        self.said.append(text)
        self.timeline.append(("say", text))

    async def send_custom_event(self, payload: dict) -> None:
        self.events.append(payload)
        self.timeline.append(("caption", payload.get("id", "")))


@pytest.fixture
async def rig():
    agent = FakeAgent()
    interrupts: list[float] = []

    async def interrupt():
        interrupts.append(1)

    sp = Speaker(agent, lambda text: CLIP_S, interrupt_audio=interrupt)
    task = asyncio.create_task(sp.run())
    yield sp, agent, interrupts
    task.cancel()


def ml(*ids):
    return [phrases.get(i).ml for i in ids]


async def test_rule_note_is_spoken_id_by_id_with_one_caption(rig):
    sp, agent, _ = rig
    ids = rule_note_ids(SetMetrics(10, 10, 60, 48.0, 48.0, 48.0, 2.5, 0, 88.0, []), "flex")
    sp.say_ids(ids, "note")
    await asyncio.sleep(0)
    await sp.wait_idle()
    assert agent.said == ml(*ids)                                   # exact catalogue strings, in order
    captions = [e for e in agent.events if e["type"] == "pc.caption"]
    assert len(captions) == 1 and captions[0]["kind"] == "note"
    assert captions[0]["en"] == "Good effort, you bent to 48° on average, but the target is 60°. Next: do 3 more reps, slowly."


async def test_counts_and_cues_play_in_order(rig):
    sp, agent, _ = rig
    for n in (1, 2):
        sp.say_ids(live_cue_ids(Rep(n, 40, 2.5, False), 60, "flex"), "count")
    await asyncio.sleep(0)
    await sp.wait_idle()
    assert agent.said == ml("count.01", "cue.bend_more", "count.02", "cue.bend_more")


async def test_stale_cue_is_dropped_but_counts_never_are():
    agent = FakeAgent()
    sp = Speaker(agent, lambda text: 0.15, max_cue_age=0.05)          # each clip outlasts the cue's max age
    task = asyncio.create_task(sp.run())
    sp.say_ids(["count.01"], "count")
    sp.say_ids(["cue.slow"], "cue")                                   # waits 0.15 s behind count.01 -> stale
    sp.say_ids(["count.02"], "count")
    await asyncio.sleep(0)
    await sp.wait_idle()
    task.cancel()
    assert agent.said == ml("count.01", "count.02")
    assert sp.stats.dropped_cues == 1


async def test_physio_gate_blocks_audio_but_not_captions_and_collapses_counts(rig):
    sp, agent, interrupts = rig
    await sp.physio_started()
    assert interrupts and sp.physio_speaking
    for n in (1, 2, 3):
        sp.say_ids([f"count.{n:02d}"], "count")
    await asyncio.sleep(0.05)
    assert agent.said == []                                          # nothing plays while the physio talks
    assert [e["id"] for e in agent.events] == ["count.01", "count.02", "count.03"]   # captions still out
    sp.physio_stopped()
    await asyncio.sleep(0)
    await sp.wait_idle()
    assert agent.said == ml("count.03")                              # queued counts collapsed to the latest


async def test_safety_while_physio_speaks_alerts_now_and_plays_first_after_release(rig):
    sp, agent, _ = rig
    await sp.physio_started()
    sp.say_ids(["pos.ok"], "prompt")
    await sp.safety()
    assert agent.events[-1]["kind"] == "safety"                      # caption immediately, even gated
    await asyncio.sleep(0.05)
    assert agent.said == []                                          # only the audio waits
    sp.physio_stopped()
    await asyncio.sleep(0)
    await sp.wait_idle()
    assert agent.said == ml("safety.stop")                           # queue was flushed: safety only


async def test_safety_interrupts_current_audio(rig):
    sp, agent, interrupts = rig
    sp.say_ids(["intro.greet", "intro.watch"], "prompt")
    await asyncio.sleep(0.005)
    await sp.safety()
    await asyncio.sleep(0)
    await sp.wait_idle()
    assert interrupts                                                # current audio stopped
    assert agent.said[-1] == phrases.get("safety.stop").ml


async def test_free_text_note_is_said_whole(rig):
    sp, agent, _ = rig
    sp.say_text("നല്ല ശ്രമം. ഇനി 3 തവണ കൂടി.", "Good effort. 3 more.")
    await asyncio.sleep(0)
    await sp.wait_idle()
    assert agent.said == ["നല്ല ശ്രമം. ഇനി 3 തവണ കൂടി."]


async def test_oversized_caption_is_split(rig):
    sp, agent, _ = rig
    long_ml = "മ" * 1700                                              # 3 bytes/char -> over 4.8 KB
    sp.say_text(long_ml, "x")
    await asyncio.sleep(0)
    await sp.wait_idle()
    caps = [e for e in agent.events if e["type"] == "pc.caption"]
    assert len(caps) == 2 and caps[0]["id"] == caps[1]["id"] and caps[0]["en"] == "" and caps[1]["ml"] == ""


def test_unknown_phrase_id_fails_loudly():
    sp = Speaker(FakeAgent(), lambda t: 0.0)
    with pytest.raises(KeyError):
        sp.say_ids(["nope"], "cue")


# ------------------------------------------------------------------ live-coach hooks

async def test_hold_delays_prompts_but_never_safety_or_counts():
    agent = FakeAgent()
    holding = {"on": True}
    asked: list[str] = []

    def hold(kind):
        asked.append(kind)
        return 5.0 if holding["on"] else 0.0

    sp = Speaker(agent, lambda t: CLIP_S, hold=hold)
    task = asyncio.create_task(sp.run())
    sp.say_ids(["pos.ok"], "prompt")
    await asyncio.sleep(0.1)
    assert agent.said == [] and sp.busy                  # held: still queued, so busy
    sp.say_ids(["count.01"], "count")                    # a count behind a held prompt waits its turn
    await asyncio.sleep(0.05)
    assert agent.said == []
    holding["on"] = False
    await asyncio.sleep(0.25)                            # the hold is re-checked at least every 0.2 s
    await sp.wait_idle()
    assert agent.said == ml("pos.ok", "count.01")
    assert "count" not in asked                          # counts are never even asked about
    task.cancel()


async def test_safety_during_a_hold_plays_at_once_and_drops_the_stale_prompt():
    agent = FakeAgent()
    sp = Speaker(agent, lambda t: CLIP_S, hold=lambda kind: 5.0)   # the coach "speaks" forever
    task = asyncio.create_task(sp.run())
    sp.say_ids(["pos.ok"], "prompt")
    await asyncio.sleep(0.05)
    await sp.safety()
    await asyncio.sleep(0.05)
    assert agent.said == ml("safety.stop")              # first, without waiting for the hold
    await asyncio.sleep(0.3)
    assert ml("pos.ok")[0] not in agent.said            # the stale prompt was flushed by safety()
    task.cancel()


async def test_before_play_is_called_first_and_a_broken_hook_never_blocks_audio():
    agent = FakeAgent()
    calls: list[tuple[str, int]] = []

    def before(kind):
        calls.append((kind, len(agent.said)))
        raise RuntimeError("hook bug")

    sp = Speaker(agent, lambda t: CLIP_S, before_play=before, hold=lambda k: 1 / 0)
    task = asyncio.create_task(sp.run())
    sp.say_ids(["count.01"], "count")
    sp.say_ids(["pos.ok"], "prompt")
    await asyncio.sleep(0)
    await sp.wait_idle()
    assert agent.said == ml("count.01", "pos.ok")
    assert calls == [("count", 0), ("prompt", 1)]       # before each clip, nothing said yet for it
    task.cancel()


async def test_busy_and_playing_kind_follow_clip_durations():
    agent = FakeAgent()
    sp = Speaker(agent, lambda t: 0.1)
    task = asyncio.create_task(sp.run())
    assert not sp.busy and sp.playing_kind is None
    sp.say_ids(["count.01"], "count")
    assert sp.busy
    await asyncio.sleep(0.02)
    assert sp.busy and sp.playing_kind == "count"
    await asyncio.sleep(0.15)
    assert not sp.busy and sp.playing_kind is None
    task.cancel()
