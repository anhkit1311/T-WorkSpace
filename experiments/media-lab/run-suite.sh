#!/usr/bin/env bash
# Full Chapter 5 suite: 3 interleaved runs of mesh and SFU, then the single-encoding and
# forced-layer-0 SFU cases. About 85 minutes on the reference machine; keep the machine idle.
#   CHROME="C:/Program Files/Google/Chrome/Application/chrome.exe" bash experiments/media-lab/run-suite.sh
set -u
cd "$(dirname "$0")/../.."
npm run build --workspace @doan/shared --workspace @doan/api >/dev/null
H=(node experiments/media-lab/harness.mjs --render=0 --seconds=60 --warmup=30)
if [ -n "${CHROME:-}" ]; then H+=("--chrome=$CHROME"); fi
for run in 1 2 3; do
  echo "== run $run"
  "${H[@]}" --mode=mesh --clients=2,4,6,8
  "${H[@]}" --mode=sfu --clients=2,4,6,8,10
done
"${H[@]}" --mode=sfu --simulcast=0 --clients=2,4,6,8
"${H[@]}" --mode=sfu --layer=0 --clients=6,10
node experiments/media-lab/summarize.mjs
