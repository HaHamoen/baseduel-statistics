#!/usr/bin/env bash
# Every check, in order. The two parity checks need PyCore (read-only) and
# snapshots in .snap/; without them they print SKIP.
#   tools/check.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export PYTHONDONTWRITEBYTECODE=1

python3 tests/test_export.py
web/node_modules/.bin/tsc -p web --noEmit && echo "typecheck: ok"
if [ -f .snap/pubduel.db ] && [ -f .snap/baseduel.db ]; then
  python3 -m exporter export --pub .snap/pubduel.db --league .snap/baseduel.db \
    --out web/public/data ${REPLAYS:+--replays "$REPLAYS"}
  python3 tests/test_parity.py
  python3 tests/test_site_parity.py
else
  echo "SKIP parity: no snapshots in .snap/"
fi
