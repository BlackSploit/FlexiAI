#!/usr/bin/env bash
# Spike B live voice run (dev only), inside the agent image:
#   VOICE_SLUG=dev-espeak-ml docker compose --profile test run --rm -e VOICE_SLUG --entrypoint bash \
#     agent-worker-test scripts/spike_b.sh cache/dev-session.json
# The physio listens to the coach's audio (onset/stop times) and talks over the greeting 1.5 s in
# (barge-in). The agent then speaks three counts (say() -> first audio heard latency).
set -euo pipefail
SESSION=${1:?session json}
SPEECH=${SPEECH_WAV:-assets/voice/${VOICE_SLUG:?set VOICE_SLUG}/intro/intro.watch.wav}
SID=$(python -c "import json,sys; print(json.load(open(sys.argv[1]))['sessionId'])" "$SESSION")
OUT=cache/spike-logs/$SID-voice
mkdir -p "$OUT"

python -m physiocoach.devtools.spike_participant physio --call-id "$SID" --seconds 55 --out-dir "$OUT/tiles" \
  --speak-wav "$SPEECH" --speak-after 1.5 > "$OUT/physio.log" 2>&1 &
PHYSIO=$!
sleep 3
SPIKE_VOICE_TEST=1 PC_REPORT_DIR="$OUT" python -m physiocoach.agent_main --session-id "$SID" \
  --session-file "$SESSION" --max-seconds 50 > "$OUT/agent.log" 2>&1 &
AGENT=$!
wait $AGENT $PHYSIO || true
echo "logs in $OUT"
