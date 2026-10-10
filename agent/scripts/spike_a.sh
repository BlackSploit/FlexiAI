#!/usr/bin/env bash
# Spike A end-to-end run (dev only), inside the agent image:
#   docker compose --profile test run --rm --entrypoint bash agent-worker-test scripts/spike_a.sh <session.json> [clip.mp4]
# Order matters: the PHYSIO joins first with a camera, so the old routing would starve the patient feed.
set -euo pipefail
SESSION=${1:?session json}
CLIP=${2:-}
CLIP_SIZE=${CLIP_SIZE:-960:540}       # default-clip size
CLIP_FPS=${CLIP_FPS:-30}             # frame rate the patient publishes at
SID=$(python -c "import json,sys; print(json.load(open(sys.argv[1]))['sessionId'])" "$SESSION")
OUT=cache/spike-logs/$SID
mkdir -p "$OUT"

if [ -z "$CLIP" ]; then                 # default clip: Ultralytics' bundled bus.jpg (people standing), looped
  CLIP=cache/static_person.mp4
  IMG=$(python -c "import ultralytics, pathlib; print(pathlib.Path(ultralytics.__file__).parent / 'assets' / 'bus.jpg')")
  ffmpeg -loglevel error -y -loop 1 -i "$IMG" -t 60 -r 30 -vf scale=$CLIP_SIZE -pix_fmt yuv420p "$CLIP"
fi

python -m physiocoach.devtools.spike_participant physio --call-id "$SID" --seconds 80 --out-dir "$OUT/tiles" \
  > "$OUT/physio.log" 2>&1 &
PHYSIO=$!
sleep 3
PC_REPORT_DIR="$OUT" python -m physiocoach.agent_main --session-id "$SID" --session-file "$SESSION" --max-seconds 75 \
  > "$OUT/agent.log" 2>&1 &
AGENT=$!
sleep 12
python -m physiocoach.devtools.spike_participant patient --call-id "$SID" --clip "$CLIP" --fps "$CLIP_FPS" --consent-after 8 --seconds 45 \
  > "$OUT/patient.log" 2>&1 &
PATIENT=$!
wait $PATIENT $AGENT $PHYSIO || true
echo "logs in $OUT"
