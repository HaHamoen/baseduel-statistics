#!/usr/bin/env bash
# The VM's job, run by bd-stats-refresh.timer: snapshot the live databases,
# export, and deploy only when the site changed; when the databases have not
# been written since the last run, none of that. One line in the journal a
# run says what happened.
#
#   tools/refresh.sh [preview|main]      preview by default
#
# A change is anything in the data, the exporter, the site's code or the
# deploy script newer than the last deploy to that branch (.deployed-<branch>,
# touched only after a deploy succeeds), so a deploy that failed is tried
# again on the next run, and pulled code goes up without waiting for a match.
# DRY_RUN=1 does everything but the deploy.
#
# Where the databases are, and which league names are bots:
#   BDSTATS_PUB_DB      ~/PyCore/pubduel.db
#   BDSTATS_LEAGUE_DB   ~/PyCore/baseduel.db
#   BDSTATS_REPLAYS     ~/ss-replay/web/public/data/index.json (links to the
#                       league's published replays; skipped if missing)
#   BDSTATS_LEAGUE_EXCLUDE  Zero-EG-*  (the league bot's BASEDUEL_STATS_EXCLUDE)
set -euo pipefail
cd "$(dirname "$0")/.."
export PYTHONDONTWRITEBYTECODE=1

branch="${1:-preview}"
case "$branch" in
  preview|main) ;;
  *) echo "usage: tools/refresh.sh [preview|main]" >&2; exit 2 ;;
esac

# One run at a time: a slow deploy must not overlap the next tick.
exec 9>.refresh.lock
if ! flock -n 9; then echo "refresh: another run is going, skipped"; exit 0; fi

pub_db="${BDSTATS_PUB_DB:-$HOME/PyCore/pubduel.db}"
league_db="${BDSTATS_LEAGUE_DB:-$HOME/PyCore/baseduel.db}"
replays="${BDSTATS_REPLAYS:-$HOME/ss-replay/web/public/data/index.json}"
started=$(date +%s)

marker=".deployed-$branch"
newer() {
  find web/public/data web/src web/index.html web/public/_headers web/package.json \
    tools/deploy.sh exporter -newer "$marker" -print -quit
}

# Most runs fall between matches, when nothing has been written: those stop
# here, having looked at four files' sizes and times, the databases and their
# write-ahead logs. Any write by a bot makes a full run.
mkdir -p .snap
seen=$(for f in "$pub_db" "$pub_db-wal" "$league_db" "$league_db-wal"; do
  stat -L -c '%n %s %.9Y' "$f" 2>/dev/null || echo "$f none"; done)
if [ -f "$marker" ] && [ "$seen" = "$(cat .snap/seen 2>/dev/null)" ] && [ -z "$(newer)" ]; then
  echo "refresh: databases unchanged, nothing to do"
  exit 0
fi

# The backup API, never cp: the bots have these open.
python3 -m exporter snapshot "$pub_db" .snap/pubduel.db >/dev/null
python3 -m exporter snapshot "$league_db" .snap/baseduel.db >/dev/null
args=(--pub .snap/pubduel.db --league .snap/baseduel.db --out web/public/data
      --league-exclude "${BDSTATS_LEAGUE_EXCLUDE:-Zero-EG-*}")
if [ -f "$replays" ]; then args+=(--replays "$replays"); fi
summary=$(python3 -m exporter export "${args[@]}")
# Taken before the snapshots: a write while they ran makes the next run full.
printf '%s\n' "$seen" > .snap/seen

changed=""
if [ -f "$marker" ]; then changed=$(newer); fi
if [ -f "$marker" ] && [ -z "$changed" ]; then
  echo "refresh: no change, no deploy ($(( $(date +%s) - started ))s) $summary"
  exit 0
fi
if [ "${DRY_RUN:-}" = 1 ]; then
  echo "refresh: would deploy to $branch (${changed:-first deploy}) $summary"
  exit 0
fi
# The marker takes the time from before the upload: anything changed while it
# ran is newer, so the next run sends it.
touch "$marker.next"
if ! tools/deploy.sh "$branch" >.deploy.log 2>&1; then
  echo "refresh: deploy to $branch FAILED, tried again next run:" >&2
  tail -n 5 .deploy.log >&2
  rm -f "$marker.next"
  exit 1
fi
mv "$marker.next" "$marker"
echo "refresh: deployed to $branch ($(( $(date +%s) - started ))s) $summary"
