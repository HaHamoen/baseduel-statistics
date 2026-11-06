"""
python3 -m exporter snapshot SRC DST [--immutable]
python3 -m exporter export --pub PUBDB --league LEAGUEDB --out DIR
                           [--replays INDEX] [--replay-site URL]
                           [--league-exclude 'Zero-EG-*']

`snapshot` copies a live database with the backup API. `export` reads two
snapshots and writes the site's data. Prints one summary line as JSON.
"""
import argparse
import json
import sys

from exporter.export import export
from exporter.rules import parse_exclude_list
from exporter.snapshot import open_snapshot, snapshot


def load_replays(path):
    """ss-replay's index.json, as {lowercased replay id: id}: only replays
    that are published get a link."""
    with open(path, encoding="utf-8") as f:
        entries = json.load(f)
    return {e["id"].lower(): e["id"] for e in entries if e.get("id")}


def main(argv=None):
    ap = argparse.ArgumentParser(prog="exporter")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("snapshot", help="copy a live database")
    s.add_argument("src")
    s.add_argument("dst")
    s.add_argument("--immutable", action="store_true",
                   help="the source is a copy nobody is writing")
    e = sub.add_parser("export", help="write the site's data")
    e.add_argument("--pub", required=True, help="snapshot of pubduel.db")
    e.add_argument("--league", required=True, help="snapshot of baseduel.db")
    e.add_argument("--out", required=True, help="the data folder")
    e.add_argument("--replays", help="ss-replay's data/index.json")
    e.add_argument("--replay-site", default="https://ss-replay.pages.dev")
    e.add_argument("--league-exclude", default="Zero-EG-*",
                   help="BASEDUEL_STATS_EXCLUDE's patterns, comma-separated")
    args = ap.parse_args(argv)

    if args.cmd == "snapshot":
        snapshot(args.src, args.dst, immutable=args.immutable)
        print(json.dumps({"snapshot": args.dst}))
        return 0
    pub, league = open_snapshot(args.pub), open_snapshot(args.league)
    try:
        got = export(pub, league, args.out,
                     league_exclude=parse_exclude_list(args.league_exclude),
                     replays=load_replays(args.replays) if args.replays
                     else None,
                     replay_site=args.replay_site)
    finally:
        pub.close()
        league.close()
    print(json.dumps(got))
    return 0


if __name__ == "__main__":
    sys.exit(main())
