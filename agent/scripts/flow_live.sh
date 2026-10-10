#!/usr/bin/env bash
# Milestone 4 live run (dev only): the full call flow on a real Stream call, inside the agent image.
#   docker compose --profile test run --rm -e VOICE_SLUG=dev-espeak-ml --entrypoint bash \
#     agent-worker-test scripts/flow_live.sh cache/dev-session.json
# Participants: physio (joins first, listens to the coach; BARGE=1 talks over it once), the agent
# (POSE_BACKEND=synthetic: periodic ~48 degree knee bends, so reps happen without a recorded clip), and
# a patient (static clip, consent, answers the pain question). A callback stub stands in for the web.
set -euo pipefail
SESSION=${1:?session json}
SID=$(python -c "import json,sys; print(json.load(open(sys.argv[1]))['sessionId'])" "$SESSION")
OUT=cache/flow-logs/$SID
mkdir -p "$OUT"
export AGENT_CALLBACK_SECRET=${AGENT_CALLBACK_SECRET:-dev-callback-secret-0123456789abcdef0123456789}
export WEB_INTERNAL_URL=http://127.0.0.1:3000

CLIP=cache/static_person.mp4
if [ ! -f "$CLIP" ]; then
  IMG=$(python -c "import ultralytics, pathlib; print(pathlib.Path(ultralytics.__file__).parent / 'assets' / 'bus.jpg')")
  ffmpeg -loglevel error -y -loop 1 -i "$IMG" -t 180 -r 15 -vf scale=640:360 -pix_fmt yuv420p "$CLIP"
fi

python -m physiocoach.devtools.callback_stub --port 3000 --log "$OUT/callbacks.jsonl" > "$OUT/stub.log" 2>&1 &
STUB=$!
BARGE_ARGS=()
if [ "${BARGE:-0}" = "1" ]; then BARGE_ARGS=(--speak-wav "assets/voice/$VOICE_SLUG/intro/intro.watch.wav" --speak-after 1.5); fi
python -m physiocoach.devtools.spike_participant physio --call-id "$SID" --seconds 160 --out-dir "$OUT/tiles" \
  "${BARGE_ARGS[@]}" > "$OUT/physio.log" 2>&1 &
PHYSIO=$!
sleep 3
POSE_BACKEND=synthetic POSE_FPS=12 python -m physiocoach.agent_main --session-id "$SID" --session-file "$SESSION" \
  --max-seconds 170 > "$OUT/agent.log" 2>&1 &
AGENT=$!
sleep 8
python -m physiocoach.devtools.spike_participant patient --call-id "$SID" --clip "$CLIP" --fps 15 --consent-after 4 \
  --seconds 150 --pain-score 3 > "$OUT/patient.log" 2>&1 &
PATIENT=$!
set +e
wait $AGENT
echo "agent exit code: $?"
kill $PATIENT $PHYSIO $STUB 2>/dev/null
wait 2>/dev/null
echo "logs in $OUT"
