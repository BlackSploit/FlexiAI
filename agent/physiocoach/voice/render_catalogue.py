"""Pre-render the Malayalam phrase catalogue to WAV clips + manifest (§9.3).

    python -m physiocoach.voice.render_catalogue --provider sarvam --speaker shubh --probe      # 1 phrase, show shapes
    python -m physiocoach.voice.render_catalogue --provider sarvam --speaker shubh               # full catalogue
    python -m physiocoach.voice.render_catalogue --provider google --voice ml-IN-Chirp3-HD-Kore
    python -m physiocoach.voice.render_catalogue --provider espeak                               # DEV voice, offline

Output: <assets>/voice/<voice_slug>/<category>/<id>.wav + manifest.json. Clips: 24 kHz 16-bit mono,
trimmed to 30 ms silence, 10 ms fades, -16 LUFS / -1 dBFS peak. Re-runs skip clips already rendered
with the same text hash (resume). `dev-espeak-ml` is a robotic offline voice for pipeline tests only:
never ship or demo it.
"""

import argparse
import asyncio
import base64
import datetime as dt
import json
import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import httpx
import numpy as np

from ..core.phrases import Phrase, catalogue
from .audio import CLIP_RATE, duration_ms, loudnorm, read_wav, resample, trim_and_fade, write_wav
from .manifest import assets_dir, text_hash

log = logging.getLogger("physiocoach.render")

SARVAM_URL = "https://api.sarvam.ai/text-to-speech"


# ---------------------------------------------------------------- providers -> (int16 samples, rate)

class Sarvam:
    def __init__(self, speaker: str, pace: float, model: str = "bulbul:v3"):
        self.speaker, self.pace, self.model = speaker, pace, model
        key = os.getenv("SARVAM_API_KEY")
        if not key:
            raise SystemExit("SARVAM_API_KEY is not set")
        self.client = httpx.AsyncClient(timeout=30, headers={"api-subscription-key": key})
        self.meta = {"provider": "sarvam", "model": model, "speaker": speaker, "pace": pace, "sample_rate": CLIP_RATE}
        self.slug = f"sarvam-{model.replace(':', '-')}-{speaker}-p{round(pace * 100):03d}"

    def body(self, text: str) -> dict:
        # [U] field names: the docs list target_language_code; confirm with --probe before a full render.
        return {"text": text, "target_language_code": "ml-IN", "speaker": self.speaker, "model": self.model,
                "pace": self.pace, "speech_sample_rate": CLIP_RATE}

    async def synth(self, text: str) -> tuple[np.ndarray, int]:
        for attempt in range(5):
            r = await self.client.post(SARVAM_URL, json=self.body(text))
            if r.status_code in (429, 500, 502, 503, 504):
                await asyncio.sleep(2 ** attempt)
                continue
            r.raise_for_status()
            return read_wav(base64.b64decode(r.json()["audios"][0]))
        raise RuntimeError(f"Sarvam kept failing for {text!r}")

    async def probe(self, text: str) -> dict:
        r = await self.client.post(SARVAM_URL, json=self.body(text))
        info: dict = {"status": r.status_code, "request_fields": sorted(self.body(text))}
        try:
            data = r.json()
            info["response_keys"] = sorted(data) if isinstance(data, dict) else type(data).__name__
            if r.is_success:
                samples, rate = read_wav(base64.b64decode(data["audios"][0]))
                info.update(wav_rate=rate, duration_ms=duration_ms(samples, rate))
            else:
                info["error"] = data
        except (ValueError, KeyError) as e:
            info["parse_error"] = repr(e)
        return info

    async def aclose(self) -> None:
        await self.client.aclose()


class Google:
    def __init__(self, voice: str, pace: float):
        from google.cloud import texttospeech            # call group
        self.tts, self.voice, self.pace = texttospeech, voice, pace
        self.client = texttospeech.TextToSpeechAsyncClient()
        self.meta = {"provider": "google", "model": "chirp3-hd", "speaker": voice, "pace": pace, "sample_rate": CLIP_RATE}
        self.slug = f"google-{voice.lower()}-p{round(pace * 100):03d}"

    async def synth(self, text: str) -> tuple[np.ndarray, int]:
        t = self.tts
        resp = await self.client.synthesize_speech(
            input=t.SynthesisInput(text=text),
            voice=t.VoiceSelectionParams(language_code="ml-IN", name=self.voice),
            audio_config=t.AudioConfig(audio_encoding=t.AudioEncoding.LINEAR16, sample_rate_hertz=CLIP_RATE,
                                       speaking_rate=self.pace))
        return read_wav(resp.audio_content)             # LINEAR16 responses carry a WAV header

    async def aclose(self) -> None:
        pass


class Espeak:
    """Offline robotic Malayalam (espeak-ng `ml`). DEV ONLY: proves the audio path without API keys."""

    def __init__(self, pace: float):
        self.exe = shutil.which("espeak-ng")
        if not self.exe:
            raise SystemExit("espeak-ng is not installed (apt-get install espeak-ng)")
        self.wpm = int(150 * pace)
        self.meta = {"provider": "espeak-ng", "model": "ml", "speaker": "default", "pace": pace,
                     "sample_rate": CLIP_RATE, "dev_only": True}
        self.slug = "dev-espeak-ml"

    async def synth(self, text: str) -> tuple[np.ndarray, int]:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            path = f.name
        try:
            proc = await asyncio.create_subprocess_exec(self.exe, "-v", "ml", "-s", str(self.wpm), "-w", path, text,
                                                        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            _, err = await proc.communicate()
            if proc.returncode:
                raise RuntimeError(err.decode(errors="replace"))
            return read_wav(Path(path).read_bytes())
        finally:
            os.unlink(path)

    async def aclose(self) -> None:
        pass


# ---------------------------------------------------------------- rendering

def postprocess(samples: np.ndarray, rate: int) -> np.ndarray:
    return loudnorm(trim_and_fade(resample(samples, rate, CLIP_RATE), CLIP_RATE), CLIP_RATE)


async def render(provider, phrases: list[Phrase], out_root: Path, concurrency: int) -> Path:
    root = out_root / provider.slug
    manifest_path = root / "manifest.json"
    old = {}
    if manifest_path.exists():
        old = {p["id"]: p for p in json.loads(manifest_path.read_text(encoding="utf-8"))["phrases"]}
    entries: dict[str, dict] = {}
    sem = asyncio.Semaphore(concurrency)
    done = 0

    async def one(p: Phrase) -> None:
        nonlocal done
        h = text_hash(p.ml, provider.slug)
        rel = f"{p.category}/{p.id}.wav"
        prev = old.get(p.id)
        if prev and prev["hash"] == h and (root / rel).exists():
            entries[p.id] = prev                       # resume: same text, already rendered
            return
        async with sem:
            samples, rate = await provider.synth(p.ml)
        clip = postprocess(samples, rate)
        if duration_ms(clip, CLIP_RATE) < 200:
            raise RuntimeError(f"{p.id}: rendered clip is too short or silent")
        (root / p.category).mkdir(parents=True, exist_ok=True)
        (root / rel).write_bytes(write_wav(clip, CLIP_RATE))
        entries[p.id] = {"id": p.id, "category": p.category, "text_ml": p.ml, "gloss_en": p.en, "hash": h,
                         "file": rel, "duration_ms": duration_ms(clip, CLIP_RATE),
                         "review": {"status": "pending", "reviewer": None, "notes": None}}
        done += 1
        if done % 50 == 0:
            log.info("rendered %d clips", done)

    try:
        await asyncio.gather(*(one(p) for p in phrases))
    finally:
        root.mkdir(parents=True, exist_ok=True)
        ordered = [entries[p.id] for p in phrases if p.id in entries]
        manifest_path.write_text(json.dumps({
            "voice": provider.meta, "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "phrases": ordered}, ensure_ascii=False, indent=1), encoding="utf-8")
        await provider.aclose()
    log.info("%s: %d clips (%d newly rendered) -> %s", provider.slug, len(entries), done, root)
    return root


def select(only: str | None, limit: int | None) -> list[Phrase]:
    phrases = list(catalogue().expand_all())
    if only:
        wanted = {x.strip() for x in only.split(",")}
        phrases = [p for p in phrases if p.category in wanted or p.id in wanted or p.id.rsplit(".", 1)[0] in wanted]
    return phrases[:limit] if limit else phrases


def main() -> None:
    p = argparse.ArgumentParser(prog="physiocoach.voice.render_catalogue")
    p.add_argument("--provider", choices=["sarvam", "google", "espeak"], required=True)
    p.add_argument("--speaker", default="shubh", help="sarvam speaker")
    p.add_argument("--voice", default="ml-IN-Chirp3-HD-Kore", help="google voice name")
    p.add_argument("--pace", type=float, default=0.9)
    p.add_argument("--only", help="comma-separated categories, ids or template ids (e.g. count,cue,note.target)")
    p.add_argument("--limit", type=int)
    p.add_argument("--concurrency", type=int, default=4)
    p.add_argument("--out", type=Path, default=None, help="assets/voice root (default: agent/assets/voice)")
    p.add_argument("--probe", action="store_true", help="sarvam: render one phrase and print the API shapes")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    if args.provider == "sarvam":
        provider = Sarvam(args.speaker, args.pace)
    elif args.provider == "google":
        provider = Google(args.voice, args.pace)
    else:
        provider = Espeak(args.pace)

    if args.probe:
        if not isinstance(provider, Sarvam):
            raise SystemExit("--probe is for the sarvam provider")
        print(json.dumps(asyncio.run(provider.probe(catalogue().get("count.01").ml)), ensure_ascii=False, indent=2))
        return
    asyncio.run(render(provider, select(args.only, args.limit), args.out or assets_dir(), args.concurrency))


if __name__ == "__main__":
    main()
