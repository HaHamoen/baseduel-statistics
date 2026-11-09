#!/usr/bin/env bash
# Every check, in order. The two parity checks need PyCore (read-only) and
# snapshots in .snap/; without them they print SKIP.
#   tools/check.sh
# REPLAYS=<ss-replay index.json> links the league's replays. REPLAYS_DATA=<the
# folder holding it and the replays> also works out their base control
# (web/tools/control.mjs, with ss-replay's code from $BD_STATS_SSREPLAY or
# ~/ss-replay) into .snap/control and checks it.
set -euo pipefail
cd "$(dirname "$0")/.."
export PYTHONDONTWRITEBYTECODE=1
ssreplay="${BD_STATS_SSREPLAY:-$HOME/ss-replay}"

python3 tests/test_export.py
web/node_modules/.bin/tsc -p web --noEmit && echo "typecheck: ok"
node web/tools/control-rounds.test.mjs
if [ -f .snap/pubduel.db ] && [ -f .snap/baseduel.db ]; then
  control=()
  if [ -n "${REPLAYS_DATA:-}" ]; then
    replays_data="$(cd "$REPLAYS_DATA" && pwd)"
    (cd web && node tools/control.mjs "$replays_data" "$ssreplay/web/src" ../.snap/control)
    control=(--control .snap/control)
    export CONTROL_DIR=.snap/control
  fi
  python3 -m exporter export --pub .snap/pubduel.db --league .snap/baseduel.db \
    --out web/public/data ${REPLAYS:+--replays "$REPLAYS"} "${control[@]}"
  python3 tests/test_parity.py
  python3 tests/test_site_parity.py
else
  echo "SKIP parity: no snapshots in .snap/"
fi
