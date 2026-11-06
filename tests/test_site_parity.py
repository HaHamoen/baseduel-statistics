"""
What the site DRAWS is what the bots print.

test_parity.py proves the data equals the bots' readers. This proves the
site's TypeScript turns that data into the same figures as PyCore's own
board code: every match's board, row by row and cell by cell (R and KPM to
two places, the Time share, the Team row, the markers, Neobot's brackets),
its highlights, and every career's record, Win%, K/D and KPM.

    python3 tests/test_site_parity.py [DATA_DIR]

Needs Node and web/node_modules (it runs web/tools/cells.mjs), and PyCore at
$BD_STATS_PYCORE or ~/PyCore, imported read-only with no bytecode written.
"""
import json
import os
import re
import string
import subprocess
import sys
import tempfile
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True
PYCORE = os.environ.get("BD_STATS_PYCORE", os.path.expanduser("~/PyCore"))

FREQS = {"pub": (0, 1), "private": (100, 200)}


ASCII_LOWER = str.maketrans(string.ascii_uppercase, string.ascii_lowercase)


def fold(name):
    """SQLite's LOWER(): ASCII letters only, as players are grouped."""
    return name.translate(ASCII_LOWER)


def board_name(cell):
    """The player a board row is, without its marker or Neobot's brackets."""
    name = re.sub(r" \*[A-Z]$", "", cell)
    if name.startswith("(") and name.endswith(")"):
        name = name[1:-1]
    return fold(name)


def check_history(site_history, bot_boards, board, fail):
    """A player's match list draws its own KPM column: for each match, every
    row's KPM is that player's KPM on the match's board. An earlier match's
    list row is the player's whole game, so one who changed freq (two lines
    on its board) is checked only for being there."""
    kpm_at = {"own": board.SB_COLS.index("KPM") + 1,
              "neobot": board.NEOBOT_COLS.index("KPM") + 1}
    checked = 0
    for key, theirs in bot_boards.items():
        at = kpm_at["neobot" if key.startswith("neobot:") else "own"]
        lines = {}
        for r in theirs:
            if r[0] not in ("#line", "Team"):
                lines.setdefault(board_name(r[0]), []).append(r[at])
        listed = [(fold(n), k) for n, k in site_history.get(key, [])]
        checked += 1
        if key.startswith("neobot:"):
            if Counter(n for n, _ in listed) != Counter({n: 1 for n in lines}):
                fail("%s: the match lists name %r, the board %r"
                     % (key, sorted(n for n, _ in listed), sorted(lines)))
            for n, k in listed:
                if len(lines.get(n, ())) == 1 and lines[n][0] != k:
                    fail("%s %s: list KPM %s, board %s" % (key, n, k, lines[n][0]))
        elif Counter(listed) != Counter((n, k) for n, ks in lines.items() for k in ks):
            fail("%s: list KPM %r, board %r" % (key, sorted(listed), sorted(lines.items())))
    return checked


def rows(t):
    return [dict(zip(t["cols"], r)) for r in t["rows"]]


def load(data, rel):
    with open(os.path.join(data, rel), encoding="utf-8") as f:
        return json.load(f)


def board_rows(items):
    """PyCore's board items as [name, cell, ...] lists, as cells.mjs flattens
    the site's: every player and Team row, in order."""
    out = []
    for item in items:
        if item[0] == "line":
            out.append(["#line", item[1]])
        elif item[0] == "row" and item[1] != "Player":
            name = "Team" if item[1] == "  Team" else item[1]
            out.append([name] + [str(c) for c in item[2]])
    return out


def site_rows(got):
    return [[str(c) for c in r] for r in got]


def highlight_strings(site):
    label_w = 18  # len("Most streaks ended"), the longest category
    out = ["==== Highlights ===="]
    for label, names, more, value in site:
        who = ", ".join(names) + (" +%d more" % more if more else "")
        out.append("%s : %s (%s)" % (label.ljust(label_w), who, value))
    return out if len(out) > 1 else []


LB_PUB = {"all": (None, None), "pub": ("pub", None), "private": ("private", None),
          "hard": ("pub", "hard"), "neobot": ("neobot", None)}
LB_LEAGUE = {"all": None, "league": "match", "scrim": "scrim",
             "pickup": "pickup"}


def check_bases(site_bases, fail):
    """The bases page against SQL on the snapshots: per arena and base, the
    counted rounds, who won them by side (the lower freq of the match is
    "a"), how, the rounds nobody won, !nextbase skips and the middle length.
    Matches of bots alone are left out, as on the page."""
    import sqlite3
    import statistics
    sys.path.insert(0, ROOT)
    from exporter.rules import fold
    from exporter.snapshot import open_snapshot
    checked = 0
    for section, db in (("pub", "pubduel.db"), ("league", "baseduel.db")):
        conn = open_snapshot(os.path.join(ROOT, ".snap", db))
        q = lambda sql, *a: conn.execute(sql, a).fetchall()
        if section == "pub":
            bots = {fold(r[0]) for r in q("SELECT player FROM bd_player_flags WHERE flag = 'bot' AND arena = '*'")}
            is_bot = lambda n: fold(n) in bots
        else:
            pats = load(os.path.join(ROOT, "web/public/data"), "meta.json")["league_exclude"]
            from exporter.rules import glob_match
            is_bot = lambda n: any(glob_match(p, n) for p in pats)
        people = {mid for mid, name in q("SELECT match_id, player_name FROM bd_match_players") if not is_bot(name)}
        low = {}
        for mid, mode in q("SELECT id, mode FROM bd_matches"):
            freqs = sorted({r[0] for r in q("SELECT freq FROM bd_match_players WHERE match_id = ?", mid)})
            low[mid] = {"pub": 0, "private": 100}.get(mode, freqs[0] if len(freqs) == 2 else 0)
        want = {}
        for mid, arena, base, counted, ended, winner, secs in q(
                "SELECT r.match_id, m.arena, r.base_num, r.counted, r.ended_by, r.winner_freq, r.duration_s "
                "FROM bd_rounds r JOIN bd_matches m ON m.id = r.match_id"):
            if mid not in people:
                continue
            w = want.setdefault((arena or "?", base), dict(rounds=0, decided=0, a=0, b=0, touch=0, wipe=0,
                                                         none=0, skipped=0, lengths=[]))
            if ended == "nextbase":
                w["skipped"] += 1
            elif counted:
                w["rounds"] += 1
                if winner is None:
                    w["none"] += 1
                else:
                    w["decided"] += 1
                    w["a" if winner == low[mid] else "b"] += 1
                    w["touch"] += ended == "touch"
                    w["wipe"] += ended == "wipe"
                    w["lengths"].append(secs)
        got = {(l["arena"], l["base"]): l for l in site_bases[section]}
        if set(got) != set(want):
            fail("bases %s: sql has %d lines, site %d" % (section, len(want), len(got)))
        for k, w in want.items():
            checked += 1
            l = got.get(k)
            lengths = w.pop("lengths")
            med = statistics.median(lengths) if lengths else None
            if l is None or any(l[f] != w[f] for f in w) or not same_num(l["median"], med):
                fail("bases %s %s: sql %r median %r, site %r" % (section, k, w, med, l))
        conn.close()
    return checked


def check_activity(site_act, fail):
    """The activity page against SQL on the snapshots, the clock in UTC. Per
    day and per week (from Monday), up to the export: the matches a person
    played in, the people in them, the new players (their first match in the
    section: never, for a pub player with an earlier game) and the time
    played. The matches started in each hour of the week, and the last 7
    days."""
    import datetime
    sys.path.insert(0, ROOT)
    from exporter.rules import fold, glob_match
    from exporter.snapshot import open_snapshot
    utc = datetime.timezone.utc
    day = lambda t: datetime.datetime.fromtimestamp(t, utc).date()
    monday = lambda t: day(t) - datetime.timedelta(day(t).weekday())
    built = load(os.path.join(ROOT, "web/public/data"), "meta.json")["built"]
    checked = 0
    for section, db in (("pub", "pubduel.db"), ("league", "baseduel.db")):
        conn = open_snapshot(os.path.join(ROOT, ".snap", db))
        q = lambda sql, *a: conn.execute(sql, a).fetchall()
        if section == "pub":
            bots = {fold(r[0]) for r in q("SELECT player FROM bd_player_flags WHERE flag = 'bot' AND arena = '*'")}
            is_bot = lambda n: fold(n) in bots
            earlier = {fold(r[0]) for r in q("SELECT DISTINCT player_name FROM neobot_players")}
        else:
            pats = load(os.path.join(ROOT, "web/public/data"), "meta.json")["league_exclude"]
            is_bot = lambda n: any(glob_match(p, n) for p in pats)
            earlier = set()
        people, firsts = {}, {}
        for mid, name in q("SELECT match_id, player_name FROM bd_match_players"):
            firsts[fold(name)] = min(firsts.get(fold(name), mid), mid)
            if not is_bot(name):
                people.setdefault(mid, set()).add(fold(name))
        matches = []
        for mid, start, end, held, dead in q(
                "SELECT id, started_at, ended_at, held_seconds, dead_seconds FROM bd_matches "
                "WHERE started_at IS NOT NULL ORDER BY started_at"):
            if mid in people:
                secs = max(0.0, (end - start) - (held or 0.0) - (dead or 0.0)) if end else 0.0
                matches.append((mid, start, secs))
        conn.close()
        now = max(built, matches[-1][1])

        def tally(ms):
            seen, new, secs = set(), 0, 0.0
            for mid, _at, s in ms:
                secs += s
                for l in people[mid]:
                    seen.add(l)
                    new += l not in earlier and firsts[l] == mid
            return dict(matches=len(ms), people=len(seen), fresh=new, seconds=secs)

        def runs(key, step):
            groups = {}
            for m in matches:
                groups.setdefault(key(m[1]), []).append(m)
            k, out = min(groups), []
            while k <= max(max(groups), key(now)):
                out.append((k.isoformat(), tally(groups.get(k, []))))
                k += datetime.timedelta(step)
            return out

        got = site_act[section]
        for name, field, want in (("days", "day", runs(day, 1)), ("weeks", "week", runs(monday, 7))):
            have = [(d[field], {k: d[k] for k in ("matches", "people", "fresh", "seconds")}) for d in got[name]]
            if [k for k, _ in have] != [k for k, _ in want]:
                fail("activity %s %s: sql runs %s..%s, site %s..%s" % (
                    section, name, want[0][0], want[-1][0], have[0][0], have[-1][0]))
            for (k, w), (_k, h) in zip(want, have):
                checked += 1
                if any(w[f] != h[f] for f in ("matches", "people", "fresh")) or not same_num(w["seconds"], h["seconds"]):
                    fail("activity %s %s %s: sql %r, site %r" % (section, name, k, w, h))
        grid = [[0] * 24 for _ in range(7)]
        for _mid, at, _s in matches:
            d = datetime.datetime.fromtimestamp(at, utc)
            grid[d.weekday()][d.hour] += 1
        checked += 7 * 24
        if grid != got["heat"]:
            fail("activity %s heat: sql %r, site %r" % (section, grid, got["heat"]))
        w = tally([m for m in matches if now - 7 * 86400 < m[1] <= now])
        h = got["last7"]
        checked += 1
        if any(w[f] != h[f] for f in ("matches", "people", "fresh")) or not same_num(w["seconds"], h["seconds"]):
            fail("activity %s last 7 days: sql %r, site %r" % (section, w, h))
    return checked


def same_num(a, b):
    return a == b or (a is not None and b is not None and abs(a - b) < 1e-6)


def check_leaderboards(site_lbs, data, fail):
    """Every board the bot has, against get_leaderboard on a copy of the
    snapshot, with the bots left off as the bots leave them: rank by rank,
    the player, the value, the matches and the wins. The site's own combined
    pub board has no bot twin: it is held to the combined careers."""
    sys.path.insert(0, ROOT)
    from exporter.rules import fold, player_key
    from exporter.snapshot import snapshot
    from baseduel.db import BaseduelDB
    from pubduel import board
    from pubduel.db import PubDuelDB

    snaps = {s: os.path.join(ROOT, ".snap", "%s.db" % s)
             for s in ("pubduel", "baseduel")}
    if not all(os.path.exists(p) for p in snaps.values()):
        print("SKIP leaderboards: no snapshots in .snap/")
        return 0
    meta = load(data, "meta.json")
    checked = 0
    with tempfile.TemporaryDirectory() as tmp:
        pub = PubDuelDB(snapshot(snaps["pubduel"], os.path.join(tmp, "p.db"),
                                 immutable=True), read_timeout=120)
        league = BaseduelDB(snapshot(snaps["baseduel"],
                                     os.path.join(tmp, "l.db"),
                                     immutable=True), read_timeout=120)
        pub.start()
        league.start()
        try:
            bots = pub._submit_sync(lambda c: [
                r[0].lower() for r in c.execute(
                    "SELECT player FROM bd_player_flags "
                    "WHERE flag='bot' AND arena='*'")])
            pub_ex = [board.glob_escape(b) for b in bots]
            league_ex = meta["league_exclude"]
            jobs = [("pub", s, pub, a[0], a[1], pub_ex)
                    for s, a in LB_PUB.items()]
            jobs += [("league", s, league, m, None, league_ex)
                     for s, m in LB_LEAGUE.items()]
            for section, scope, db, mode, gmode, ex in jobs:
                for stat in sorted(db._TOP_STATS):
                    got = db.get_leaderboard(stat, mode=mode, limit=10 ** 7,
                                             exclude=ex, game_mode=gmode)
                    theirs = [(player_key(fold(r["name"])), r["value"],
                               r["matches"], r["wins"]) for r in got["rows"]]
                    ours = site_lbs["%s:%s:%s" % (section, scope, stat)]
                    checked += 1
                    if len(theirs) != len(ours) or got["ranked"] != len(ours):
                        fail("%s %s %s: bot ranks %d, site %d"
                             % (section, scope, stat, got["ranked"], len(ours)))
                        continue
                    for i, (t, o) in enumerate(zip(theirs, ours)):
                        if (t[0], t[2], t[3]) != (o[0], o[2], o[3]) or \
                                abs(t[1] - o[1]) > 1e-9 * max(1, abs(t[1])):
                            fail("%s %s %s #%d: bot %r site %r"
                                 % (section, scope, stat, i + 1, t, o))
                            break
        finally:
            pub.close()
            league.close()

    # The combined pub board, which the bot does not have: each row's played
    # and wins are that player's combined career.
    for stat in ("kills", "matches", "wins", "kd", "dmg", "deaths"):
        for key, value, matches, wins in site_lbs["pub:pub_all:%s" % stat]:
            c = load(data, "p/%s.json" % key)["pub"]["careers"]["pub_all"]
            checked += 1
            if (c["matches"], c["wins"]) != (matches, wins):
                fail("pub_all %s %s: career %d/%d, board %d/%d"
                     % (stat, key, c["matches"], c["wins"], matches, wins))
    return checked


def main(argv):
    data = argv[0] if argv else os.path.join(ROOT, "web/public/data")
    if not os.path.isdir(os.path.join(PYCORE, "pubduel")):
        print("SKIP: no PyCore at %s" % PYCORE)
        return 0
    sys.path.insert(0, PYCORE)
    from pubduel import board

    with tempfile.TemporaryDirectory() as tmp:
        cells = os.path.join(tmp, "cells.json")
        subprocess.run(["node", "tools/cells.mjs", data, cells],
                       cwd=os.path.join(ROOT, "web"), check=True)
        with open(cells, encoding="utf-8") as f:
            site = json.load(f)

    failures, checked = [], 0
    bot_boards = {}

    def fail(msg):
        if len(failures) < 40:
            failures.append(msg)
        else:
            failures.append(None)

    # ---- boards ----
    for section in ("pub", "league"):
        folder = os.path.join(data, "m", section)
        for fname in os.listdir(folder):
            for mid, doc in load(data, "m/%s/%s" % (section, fname)).items():
                m, players = doc["match"], rows(doc["players"])
                fa, fb = (FREQS.get(m["mode"]) or
                          board.freqs_of(m["mode"], players))
                names = ({fa: m["team_a"], fb: m["team_b"]}
                         if section == "league"
                         else {fa: "Freq %d" % fa, fb: "Freq %d" % fb})
                theirs = board_rows(board.scoreboard_items(
                    players, m["winner_freq"], m["played_seconds"], names))
                bot_boards["%s:%s" % (section, mid)] = theirs
                got = site["boards"]["%s:%s" % (section, mid)]
                checked += 1
                if site_rows(got["rows"]) != theirs:
                    fail("%s %s board: bot %r site %r"
                         % (section, mid, theirs[:2], got["rows"][:2]))
                if highlight_strings(got["highlights"]) != \
                        board.highlight_lines(players):
                    fail("%s %s highlights" % (section, mid))
    for fname in os.listdir(os.path.join(data, "m", "neobot")):
        for gid, doc in load(data, "m/neobot/%s" % fname).items():
            m = doc["match"]
            lines, players = rows(doc["lines"]), rows(doc["players"])
            theirs = board_rows(board.neobot_items(
                lines, players, m["winner_freq"], float(m["active_seconds"])))
            bot_boards["neobot:%s" % gid] = theirs
            got = site["boards"]["neobot:%s" % gid]
            checked += 1
            if site_rows(got["rows"]) != theirs:
                fail("neobot %s board" % gid)
            if highlight_strings(got["highlights"]) != \
                    board.highlight_lines(players):
                fail("neobot %s highlights" % gid)

    # ---- careers: !bdstats' record, Win%, K/D and KPM ----
    head = re.compile(r" (\d+)-(\d+) \((\d+)%\)")
    figs = re.compile(r"K/D (\S+)  KPM (\S+)")
    for key, got in site["careers"].items():
        pkey, section, scope = key.split(":")
        c = load(data, "p/%s.json" % pkey)[section]["careers"][scope]
        lines = board.career_lines(c, None)
        wins, losses, pct = head.search(lines[0]).groups()
        kd, kpm = figs.search(lines[1]).groups()
        checked += 1
        if [int(losses), int(pct), kd, kpm] != \
                [got["losses"], got["pct"], got["kd"], got["kpm"]]:
            fail("%s: bot %s-%s (%s%%) K/D %s KPM %s, site %r"
                 % (key, wins, losses, pct, kd, kpm, got))

    # ---- leaderboards: PyCore's own get_leaderboard, everyone ranked ----
    checked += check_leaderboards(site["leaderboards"], data, fail)

    # ---- the bases page ----
    checked += check_bases(site["bases"], fail)

    # ---- the activity page ----
    checked += check_activity(site["activity"], fail)

    # ---- every player's match list: its KPM is the board's ----
    checked += check_history(site["history"], bot_boards, board, fail)

    # ---- the compare page's head to head equals the teammates and rivals
    # lines, worked out apart (exporter/mates.py from the rosters, which
    # test_parity holds against a self-join) ----
    for k, got in site["compare"].items():
        pkey, section, scope, side, other = k.split(":")
        line = next(e for e in load(data, "p/%s.json" % pkey)[section]["mates"][scope][side]
                    if e[0] == other)
        checked += 1
        if got != line[1:]:
            fail("compare %s: site %r, teammates and rivals %r" % (k, got, line[1:]))

    shown = [f for f in failures if f]
    print("site parity: %d boards and careers, %d differences"
          % (checked, len(failures)))
    for f in shown:
        print("  " + f)
    if len(failures) > len(shown):
        print("  ... and %d more" % (len(failures) - len(shown)))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
