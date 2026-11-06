"""
The site's numbers are the bots' numbers.

Runs PyCore's own readers -- the code behind !bdstats and !bdmatch -- on a
private copy of each snapshot, and compares every player's career in every
scope, and every match, with what the exporter wrote.

    python3 tests/test_parity.py [PUB_SNAPSHOT LEAGUE_SNAPSHOT DATA_DIR]

Defaults: .snap/pubduel.db, .snap/baseduel.db, web/public/data. PyCore is
found at $BD_STATS_PYCORE or ~/PyCore and only ever read: no bytecode is
written there, and its readers run on a copy, since their start() migrates.
"""
import json
import math
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.dont_write_bytecode = True

from exporter.rules import (  # noqa: E402
    LEAGUE_SCOPES, PUB_SCOPES, fold, glob_match, player_key,
)
from exporter.snapshot import open_snapshot, snapshot  # noqa: E402

PYCORE = os.environ.get("BD_STATS_PYCORE",
                        os.path.expanduser("~/PyCore"))

PUB_ARGS = {"all": (None, None), "pub": ("pub", None),
            "private": ("private", None), "hard": ("pub", "hard"),
            "neobot": ("neobot", None)}
LEAGUE_ARGS = {"all": None, "league": "match", "scrim": "scrim",
               "pickup": "pickup"}
assert set(PUB_ARGS) == set(PUB_SCOPES)
assert set(LEAGUE_ARGS) == set(LEAGUE_SCOPES)


def same(a, b):
    if isinstance(a, float) or isinstance(b, float):
        return a is not None and b is not None and abs(a - b) < 1e-6
    return a == b


class Report:
    def __init__(self):
        self.checked = 0
        self.failures = []

    def compare(self, where, theirs, ours, keys=None):
        self.checked += 1
        if theirs is None or ours is None:
            if theirs is not ours:
                self.failures.append("%s: bot %r, site %r" % (where, theirs,
                                                              ours))
            return
        for k in keys or theirs.keys():
            if k not in ours:
                self.failures.append("%s: site lacks %s" % (where, k))
            elif not same(theirs[k], ours[k]):
                self.failures.append("%s.%s: bot %r, site %r"
                                     % (where, k, theirs[k], ours[k]))


def table_rows(t):
    return [dict(zip(t["cols"], r)) for r in t["rows"]]


def load(data, rel):
    with open(os.path.join(data, rel), encoding="utf-8") as f:
        return json.load(f)


def check_careers(rep, db, data, section, args_for, call):
    for p in table_rows(load(data, "players.json")):
        doc = load(data, "p/%s.json" % p["key"])
        sec = doc.get(section)
        for scope, args in args_for.items():
            theirs = call(db, doc["name"], args)
            ours = sec["careers"][scope] if sec else None
            rep.compare("%s %s [%s]" % (section, doc["name"], scope),
                        theirs, ours)


def check_pub_combined(rep, db, data, neobot_sums):
    """The site's one extra career, every pub match earlier and recent: the
    bot's own 'pub' and 'neobot' careers, merged as PubDuelDB merges its
    no-scope career (with PyCore's own _NEOBOT_SUMS)."""
    for p in table_rows(load(data, "players.json")):
        doc = load(data, "p/%s.json" % p["key"])
        own = db.get_player_career(doc["name"], mode="pub")
        old = db.get_player_career(doc["name"], mode="neobot")
        if own is None:
            theirs = old
        elif old is None:
            theirs = own
        else:
            theirs = dict(own)
            for key in neobot_sums:
                theirs[key] = (own[key] or 0) + (old[key] or 0)
            theirs["neobot_matches"] = old["matches"]
        ours = doc["pub"]["careers"]["pub_all"] if doc.get("pub") else None
        rep.compare("pub %s [pub_all]" % doc["name"], theirs, ours)


def check_own_matches(rep, db, data, section, bucket):
    meta = load(data, "meta.json")["sections"][section]
    if not meta["matches"]:
        return
    shards = {}
    for mid in range(meta["first_id"], meta["last_id"] + 1):
        got = db.get_match(mid)
        b = mid // bucket
        if b not in shards:
            path = os.path.join(data, "m/%s/%d.json" % (section, b))
            shards[b] = load(data, "m/%s/%d.json" % (section, b)) \
                if os.path.exists(path) else {}
        ours = shards[b].get(str(mid))
        if got is None:
            if ours is not None:
                rep.failures.append("%s match %d: site has it, bot none"
                                    % (section, mid))
            continue
        if ours is None:
            rep.failures.append("%s match %d missing" % (section, mid))
            continue
        rep.compare("%s match %d" % (section, mid), got["match"],
                    ours["match"], keys=[k for k in ours["match"]
                                         if k in got["match"]])
        for part in ("players", "rounds", "round_players"):
            mine = table_rows(ours[part])
            if len(mine) != len(got[part]):
                rep.failures.append("%s match %d %s: bot %d rows, site %d"
                                    % (section, mid, part, len(got[part]),
                                       len(mine)))
                continue
            for i, (t, o) in enumerate(zip(got[part], mine)):
                rep.compare("%s match %d %s[%d]" % (section, mid, part, i),
                            t, o, keys=list(o))


def check_neobot(rep, db, data):
    meta = load(data, "meta.json")["neobot"]
    if not meta:
        return
    shards = {}
    for gid in range(meta["first_id"], meta["last_id"] + 1):
        got = db.get_neobot_match(gid)
        b = gid // meta["bucket"]
        if b not in shards:
            path = os.path.join(data, "m/neobot/%d.json" % b)
            shards[b] = load(data, "m/neobot/%d.json" % b) \
                if os.path.exists(path) else {}
        ours = shards[b].get(str(gid))
        if (got is None) != (ours is None):
            rep.failures.append("neobot game %d: bot %s, site %s"
                                % (gid, got is not None, ours is not None))
            continue
        if got is None:
            continue
        rep.compare("neobot game %d" % gid, got["match"], ours["match"],
                    keys=list(ours["match"]))
        for part in ("players", "lines"):
            mine = table_rows(ours[part])
            if len(mine) != len(got[part]):
                rep.failures.append("neobot game %d %s: %d rows, site %d"
                                    % (gid, part, len(got[part]), len(mine)))
                continue
            for i, (t, o) in enumerate(zip(got[part], mine)):
                rep.compare("neobot game %d %s[%d]" % (gid, part, i), t, o,
                            keys=list(o))


def check_names(rep, db, data, section):
    """Everyone the bot knows by name has a page, and its section names them
    in the bot's casing."""
    ours = {fold(p["name"]): p for p in table_rows(load(data, "players.json"))}
    for name in db.get_known_players():
        p = ours.get(fold(name))
        rep.checked += 1
        if p is None:
            rep.failures.append("%s: %s has no page" % (section, name))
            continue
        sec = load(data, "p/%s.json" % p["key"]).get(section)
        if sec is None or sec["name"] != name:
            rep.failures.append("%s: shown as %s, the bot says %s"
                                % (section, sec and sec["name"], name))


def check_records(rep, path, data, section, league_exclude):
    """records/<section>.json against SQL written apart from the exporter:
    each list's values and matches, best first, the earlier match first on
    a tie, people-only lists without the section's bots. Only matches with
    a winner; a player's figure in a match, only from one of 2 hours or less."""
    import itertools
    import sqlite3
    conn = open_snapshot(path)
    conn.row_factory = sqlite3.Row
    q = lambda sql, *a: [tuple(r) for r in conn.execute(sql, a)]
    has = lambda t: bool(q("SELECT 1 FROM sqlite_master WHERE name = ?", t))
    got = load(data, "records/%s.json" % section)
    if section == "pub":
        bots = {fold(r[0]) for r in q("SELECT player FROM bd_player_flags "
                                      "WHERE flag = 'bot' AND arena = '*'")}
        is_bot = lambda n: fold(n) in bots
    else:
        is_bot = lambda n: any(glob_match(p, fold(n)) for p in league_exclude)
    earlier = has("neobot_players")
    n = got["top"]
    # Matches a person played in, the bot's and the earlier ones apart.
    people_in = {"own": {mid for mid, name in q("SELECT match_id, player_name FROM bd_match_players")
                         if not is_bot(name)},
                 "old": ({mid for mid, name in q("SELECT match_id, player_name FROM neobot_players")
                          if not is_bot(name)} if earlier else set())}

    def compare(where, theirs, ours):
        rep.checked += 1
        if theirs != ours:
            rep.failures.append("records %s %s: sql %r, site %r"
                                % (section, where, theirs[:3], ours[:3]))

    secs = ("COALESCE(m.ended_at - m.started_at - COALESCE(m.held_seconds, 0)"
            " - COALESCE(m.dead_seconds, 0), 0)")
    for stat, old_too in (("kills", True), ("dmg_given", True),
                          ("best_streak", False), ("safe_touches", False)):
        sql = ("SELECT p.player_name, p.match_id, p.%s, 'own' FROM bd_match_players p "
               "JOIN bd_matches m ON m.id = p.match_id WHERE p.%s > 0 "
               "AND m.winner_freq IS NOT NULL AND %s <= 7200" % (stat, stat, secs))
        if old_too and earlier:
            sql += (" UNION ALL SELECT p.player_name, p.match_id, p.%s, 'old' FROM neobot_players p"
                    " JOIN neobot_matches m ON m.neobot_id = p.match_id WHERE p.%s > 0"
                    " AND m.winner_freq IS NOT NULL AND COALESCE(m.active_seconds, 0) <= 7200"
                    % (stat, stat))
        rows = sorted((r for r in q(sql) if r[1] in people_in[r[3]]),
                      key=lambda r: (-r[2], r[1]))
        for which, keep in (("all", rows), ("people", [r for r in rows if not is_bot(r[0])])):
            compare("%s.%s" % (stat, which), [(r[2], r[1]) for r in keep[:n]],
                    [(e["value"], e["match"]) for e in got[stat][which]])

    # Winning runs: the longest group of W in each player's results in
    # match order, with N and no-winner matches dropped first.
    res = ("CASE WHEN m.winner_freq IS NULL THEN '-' WHEN p.no_result THEN 'N' "
           "WHEN p.is_winner THEN 'W' ELSE 'L' END")
    sql = ("SELECT p.player_name, p.match_id, %s, 'own' FROM bd_match_players p "
           "JOIN bd_matches m ON m.id = p.match_id" % res)
    if earlier:
        sql += (" UNION ALL SELECT p.player_name, p.match_id, %s, 'old' FROM neobot_players p "
                "JOIN neobot_matches m ON m.neobot_id = p.match_id" % res)
    per = {}
    for name, mid, r, era in q(sql):
        if mid not in people_in[era]:
            continue
        per.setdefault(fold(name), []).append((mid, r, name))
    runs = []
    for lname, rs in per.items():
        rs.sort(key=lambda t: t[0])
        decided = [t for t in rs if t[1] in ("W", "L")]
        bestrun = None
        for won, grp in itertools.groupby(decided, key=lambda t: t[1] == "W"):
            grp = list(grp)
            if won and (bestrun is None or len(grp) > bestrun[0]):
                bestrun = (len(grp), grp[-1][0])
        if bestrun:
            runs.append((bestrun[0], bestrun[1], rs[0][2]))
    runs.sort(key=lambda r: (-r[0], r[1]))
    for which, keep in (("all", runs), ("people", [r for r in runs if not is_bot(r[2])])):
        compare("winning_run.%s" % which, [(r[0], r[1]) for r in keep[:n]],
                [(e["value"], e["to"]) for e in got["winning_run"][which]])

    secs = ("ended_at - started_at - COALESCE(held_seconds, 0) - COALESCE(dead_seconds, 0)")
    won = "SELECT id FROM bd_matches WHERE winner_freq IS NOT NULL"
    ok = people_in["own"]
    compare("longest_match", [(round(r[1]), r[0]) for r in sorted(
        (r for r in q("SELECT id, %s FROM bd_matches WHERE started_at AND ended_at AND %s > 0 "
                      "AND winner_freq IS NOT NULL" % (secs, secs)) if r[0] in ok),
        key=lambda r: (-r[1], r[0]))[:n]],
        [(e["value"], e["match"]) for e in got["longest_match"]])
    compare("most_rounds", [r for r in q(
        "SELECT COUNT(*), match_id FROM bd_rounds WHERE counted = 1 AND match_id IN (%s) "
        "GROUP BY match_id ORDER BY 1 DESC, 2" % won) if r[1] in ok][:n],
        [(e["value"], e["match"]) for e in got["most_rounds"]])
    compare("longest_round", [(round(r[0]), r[1]) for r in q(
        "SELECT duration_s, match_id FROM bd_rounds WHERE counted = 1 AND duration_s > 0 "
        "AND match_id IN (%s) ORDER BY duration_s DESC, match_id, seq" % won) if r[1] in ok][:n],
        [(e["value"], e["match"]) for e in got["longest_round"]])

    # Comebacks: the loser's biggest lead over the winner after any counted
    # round, in matches with a winner and no score set by an official.
    out = []
    for mid, mode, winner in q("SELECT id, mode, winner_freq FROM bd_matches "
                               "WHERE winner_freq IS NOT NULL AND id NOT IN "
                               "(SELECT match_id FROM bd_rounds WHERE ended_by = 'setscore')"):
        freqs = sorted({r[0] for r in q("SELECT freq FROM bd_match_players WHERE match_id = ?", mid)})
        low = {"pub": 0, "private": 100}.get(mode, freqs[0] if len(freqs) == 2 else 0)
        leads = [(b - a) if winner == low else (a - b) for a, b in q(
            "SELECT score_a, score_b FROM bd_rounds WHERE match_id = ? AND counted = 1", mid)]
        if leads and max(leads) > 0 and mid in ok:
            out.append((max(leads), mid))
    out.sort(key=lambda r: (-r[0], r[1]))
    compare("comeback", out[:n], [(e["value"], e["match"]) for e in got["comeback"]])
    conn.close()


def check_insights(rep, pub_path, league_path, data, league_exclude):
    """insights.json against GROUP BY queries written apart from the
    exporter: matches a person played in (bots by the lists, folded by
    SQLite's own LOWER), shares of the matches somebody won, the people on
    each freq as the rows not on the bot list."""
    got = load(data, "insights.json")
    conn = open_snapshot(pub_path)
    q = lambda sql, *a: [tuple(r) for r in conn.execute(sql, a)]
    games = """
      WITH bots AS (SELECT LOWER(player) n FROM bd_player_flags WHERE flag = 'bot' AND arena = '*'),
      g AS (
        SELECT 'earlier' era, m.neobot_id id, m.winner_freq w,
               SUM(p.freq = 0 AND LOWER(p.player_name) NOT IN bots) c0,
               SUM(p.freq = 1 AND LOWER(p.player_name) NOT IN bots) c1,
               SUM(LOWER(p.player_name) NOT IN bots) people
          FROM neobot_matches m JOIN neobot_players p ON p.match_id = m.neobot_id GROUP BY m.neobot_id
        UNION ALL
        SELECT 'pub', m.id, m.winner_freq,
               SUM(p.freq = 0 AND LOWER(p.player_name) NOT IN bots),
               SUM(p.freq = 1 AND LOWER(p.player_name) NOT IN bots),
               SUM(LOWER(p.player_name) NOT IN bots)
          FROM bd_matches m JOIN bd_match_players p ON p.match_id = m.id WHERE m.mode = 'pub' GROUP BY m.id),
      gp AS (SELECT * FROM g WHERE people > 0)
    """

    def equal(a, b):
        if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
            return len(a) == len(b) and all(equal(x, y) for x, y in zip(a, b))
        if isinstance(a, float) or isinstance(b, float):
            return abs(a - b) <= 1e-6 * max(1.0, abs(a))
        return a == b

    def same(where, theirs, ours):
        rep.checked += 1
        if not equal(theirs, ours):
            rep.failures.append("insights %s: sql %r, site %r" % (where, theirs, ours))

    sides = {era: [n, f0] for era, n, f0 in q(games + "SELECT era, COUNT(*), SUM(w = 0) FROM gp WHERE w IS NOT NULL GROUP BY era")}
    for era in ("earlier", "pub"):
        same("sides " + era, sides.get(era, [0, 0]), got["sides"][era])
    eras = [list(r) for r in q(games + "SELECT MIN(id), MAX(id), COUNT(*), SUM(w = 0) FROM gp WHERE w IS NOT NULL "
                                       "GROUP BY era = 'pub', CASE era WHEN 'earlier' THEN id / ? ELSE 0 END "
                                       "ORDER BY era = 'pub', MIN(id)", got["block"])]
    same("eras", eras, got["eras"])
    g = got["gap_max"]
    for era in ("earlier", "pub"):
        lines = dict((gap, [gap, n, f0]) for gap, n, f0 in q(
            games + "SELECT MAX(-?, MIN(?, c0 - c1)) gap, COUNT(*), SUM(w = 0) FROM gp "
                    "WHERE era = ? AND w IS NOT NULL GROUP BY gap", g, g, era))
        same("gap " + era, [lines.get(k, [k, 0, 0]) for k in range(-g, g + 1)], got["gap"][era])
        same("more " + era, list(q(games + "SELECT COUNT(*), SUM(c0 > c1), SUM(c0 < c1) FROM gp "
                                           "WHERE era = ? AND w IS NOT NULL", era)[0]), got["more"][era])
        same("vs bots " + era, list(q(games + "SELECT COUNT(*), SUM((c0 > 0 AND w = 0) OR (c1 > 0 AND w = 1)) FROM gp "
                                              "WHERE era = ? AND w IS NOT NULL AND (c0 = 0) <> (c1 = 0)", era)[0]),
             got["vs_bots"][era])
        table = "neobot_players" if era == "earlier" else "bd_match_players"
        play = {("bots" if bot else "people"): [k, d, t] for bot, k, d, t in q(
            games + "SELECT LOWER(player_name) IN bots, SUM(kills), SUM(deaths), SUM(active_time) FROM " + table +
            " WHERE match_id IN (SELECT id FROM gp WHERE era = ?) GROUP BY 1", era)}
        for who in ("people", "bots"):
            same("play %s %s" % (era, who), play[who], got["play"][era][who])
    people = ("id IN (SELECT match_id FROM bd_match_players WHERE LOWER(player_name) NOT IN "
              "(SELECT LOWER(player) FROM bd_player_flags WHERE flag = 'bot' AND arena = '*'))")
    same("sides private", list(q("SELECT COUNT(*), SUM(winner_freq = 100) FROM bd_matches WHERE mode = 'private' "
                                 "AND winner_freq IS NOT NULL AND " + people)[0]), got["sides"]["private"])
    hard = q("SELECT COUNT(*), SUM(winner_freq IS NOT NULL), SUM(winner_freq = game_mode_freq), "
             "SUM(game_mode_until IS NOT NULL), SUM(CASE game_mode_freq WHEN 0 THEN score_a ELSE score_b END), "
             "SUM(CASE game_mode_freq WHEN 0 THEN score_b ELSE score_a END) FROM bd_matches "
             "WHERE game_mode = 'hard' AND mode = 'pub' AND " + people)[0]
    h = got["hard"]
    same("hard", [x or 0 for x in hard],
         [h["matches"], h["decided"], h["team_won"], h["ended_early"], h["team_points"], h["other_points"]])
    conn.close()
    conn = open_snapshot(league_path)
    globs = " OR ".join("LOWER(player_name) GLOB ?" for _ in league_exclude) or "0"
    league = conn.execute(
        "SELECT COUNT(*), SUM(winner_freq = 0) FROM bd_matches WHERE winner_freq IS NOT NULL AND id IN "
        "(SELECT match_id FROM bd_match_players WHERE NOT (" + globs + "))", tuple(league_exclude)).fetchone()
    same("sides league", [league[0], league[1] or 0], got["sides"]["league"])
    conn.close()


def check_ratings(rep, pub_path, league_path, data, league_exclude):
    """ratings/<section>.json against tools/ratings-study/, the code the
    method was chosen with: its own queries and its own Weng-Lin, replaying
    every decided match with the bots left out. Each rated player's skill,
    uncertainty and shown rating, and nobody rated on one side only."""
    import fnmatch
    sys.path.insert(0, os.path.join(ROOT, "tools", "ratings-study"))
    from compare import WengLin, load as study_load
    from exporter import ratings
    pub, league, pub_bots = study_load(pub_path, league_path)
    lbot = lambda n: any(fnmatch.fnmatchcase(n, p.lower()) for p in league_exclude)
    for section, games, is_bot in (("pub", pub, lambda n: n in pub_bots), ("league", league, lbot)):
        m = WengLin(beta=ratings.BETA, tau=ratings.TAU, team="mean")
        played = set()
        for _era, _mid, w, ps in games:
            # One rule the study never needed: a name listed twice in one
            # match (league #22) counts for neither team in it.
            names = [p[0] for p in ps if p[2]]
            people = [p for p in ps if not is_bot(p[0]) and names.count(p[0]) < 2]
            m.update(people, w)
            played.update(p[0] for p in people if p[2])
        theirs = {player_key(n): (round(m.mu[n], 3), round(math.sqrt(m.var[n]), 3),
                                  ratings.shown(m.mu[n], math.sqrt(m.var[n]))) for n in played}
        got = load(data, "ratings/%s.json" % section)
        ours = {r[0]: (r[4], r[5], r[1]) for r in got["rows"]}
        rep.checked += 1
        if set(theirs) != set(ours):
            rep.failures.append("ratings %s: study rates %d players, site %d (%d differ)" % (
                section, len(theirs), len(ours), len(set(theirs) ^ set(ours))))
        for key in sorted(set(theirs) & set(ours)):
            rep.checked += 1
            t, o = theirs[key], ours[key]
            if abs(t[0] - o[0]) > 0.002 or abs(t[1] - o[1]) > 0.002 or t[2] != o[2]:
                rep.failures.append("ratings %s %s: study %r, site %r" % (section, key, t, o))


def check_mates(rep, path, data, section, league_exclude):
    """Teammates and rivals on a sample of player pages (the 20 busiest and
    every 40th) against a self-join written apart from the exporter: who
    shared a freq with them and who was on the other, in decided matches,
    people only, by the page's buttons."""
    import sqlite3
    conn = open_snapshot(path)
    q = lambda sql, *a: conn.execute(sql, a).fetchall()
    if section == "pub":
        bots = {fold(r[0]) for r in q("SELECT player FROM bd_player_flags "
                                      "WHERE flag = 'bot' AND arena = '*'")}
        is_bot = lambda n: fold(n) in bots
    else:
        is_bot = lambda n: any(glob_match(p, fold(n)) for p in league_exclude)
    earlier = bool(q("SELECT 1 FROM sqlite_master WHERE name = 'neobot_players'"))
    res = "CASE WHEN p.no_result THEN 'N' WHEN p.is_winner THEN 'W' ELSE 'L' END"
    own_sql = ("SELECT o.player_name, p.freq = o.freq, %s, m.mode, m.game_mode "
               "FROM bd_match_players p JOIN bd_matches m ON m.id = p.match_id "
               "JOIN bd_match_players o ON o.match_id = p.match_id "
               "WHERE m.winner_freq IS NOT NULL AND LOWER(p.player_name) = ? "
               "AND LOWER(o.player_name) <> LOWER(p.player_name)" % res)
    old_sql = ("SELECT o.player_name, p.freq = o.freq, %s, 'pub', NULL "
               "FROM neobot_players p JOIN neobot_matches m ON m.neobot_id = p.match_id "
               "JOIN neobot_players o ON o.match_id = p.match_id "
               "WHERE m.winner_freq IS NOT NULL AND LOWER(p.player_name) = ? "
               "AND LOWER(o.player_name) <> LOWER(p.player_name)" % res)
    if section == "pub":
        scopes = {"all": lambda mode, gm: True, "pub_all": lambda mode, gm: mode == "pub",
                  "private": lambda mode, gm: mode == "private",
                  "hard": lambda mode, gm: mode == "pub" and gm == "hard"}
    else:
        scopes = {"all": lambda mode, gm: True, "league": lambda mode, gm: mode == "match",
                  "scrim": lambda mode, gm: mode == "scrim", "pickup": lambda mode, gm: mode == "pickup"}
    index = table_rows(load(data, "players.json"))
    played = "%s_played" % section
    busiest = sorted(index, key=lambda p: -p[played])[:20]
    sample = {p["key"]: p for p in busiest + index[::40] if p[played]}
    for p in sample.values():
        doc = load(data, "p/%s.json" % p["key"]).get(section)
        if not doc:
            continue
        lname = fold(doc["name"])
        rows = q(own_sql, lname) + (q(old_sql, lname) if earlier and section == "pub" else [])
        want = {}
        for name, same, r, mode, gm in rows:
            if is_bot(name):
                continue
            for sc, keep in scopes.items():
                if keep(mode, gm):
                    t = want.setdefault(sc, {"with": {}, "against": {}})["with" if same else "against"]
                    n = t.setdefault(fold(name), [0, 0, 0])
                    n[0] += 1
                    n[1] += r == "W"
                    n[2] += r == "L"
        theirs = {sc: {side: [[player_key(o), *t[o]] for o in sorted(t, key=lambda o: (-t[o][0], o))[:10]]
                       for side, t in sides.items()} for sc, sides in want.items()}
        rep.checked += 1
        if theirs != doc.get("mates", {}):
            rep.failures.append("mates %s %s: sql %r site %r" % (
                section, doc["name"], str(theirs)[:120], str(doc.get("mates"))[:120]))
    conn.close()


def main(argv):
    pub_snap, league_snap, data = (argv + [None] * 3)[:3]
    pub_snap = pub_snap or os.path.join(ROOT, ".snap/pubduel.db")
    league_snap = league_snap or os.path.join(ROOT, ".snap/baseduel.db")
    data = data or os.path.join(ROOT, "web/public/data")
    if not os.path.isdir(os.path.join(PYCORE, "pubduel")):
        print("SKIP: no PyCore at %s" % PYCORE)
        return 0
    sys.path.insert(0, PYCORE)
    from baseduel.db import BaseduelDB
    from pubduel import db as pubdb
    from pubduel.db import PubDuelDB

    rep = Report()
    with tempfile.TemporaryDirectory() as tmp:
        pub_copy = snapshot(pub_snap, os.path.join(tmp, "pub.db"),
                            immutable=True)
        league_copy = snapshot(league_snap, os.path.join(tmp, "league.db"),
                               immutable=True)
        pub = PubDuelDB(pub_copy, read_timeout=60)
        league = BaseduelDB(league_copy, read_timeout=60)
        pub.start()
        league.start()
        try:
            check_careers(rep, pub, data, "pub", PUB_ARGS,
                          lambda db, n, a: db.get_player_career(
                              n, mode=a[0], game_mode=a[1]))
            check_careers(rep, league, data, "league", LEAGUE_ARGS,
                          lambda db, n, a: db.get_player_career(n, mode=a))
            check_pub_combined(rep, pub, data, pubdb._NEOBOT_SUMS)
            check_own_matches(rep, pub, data, "pub",
                              load(data, "meta.json")["sections"]["pub"]
                              ["bucket"])
            check_own_matches(rep, league, data, "league",
                              load(data, "meta.json")["sections"]["league"]
                              ["bucket"])
            check_neobot(rep, pub, data)
            check_names(rep, pub, data, "pub")
            check_names(rep, league, data, "league")
            check_records(rep, pub_copy, data, "pub", ())
            check_records(rep, league_copy, data, "league",
                          load(data, "meta.json")["league_exclude"])
            check_mates(rep, pub_copy, data, "pub", ())
            check_mates(rep, league_copy, data, "league",
                        load(data, "meta.json")["league_exclude"])
            check_insights(rep, pub_copy, league_copy, data,
                           load(data, "meta.json")["league_exclude"])
            check_ratings(rep, pub_copy, league_copy, data,
                          load(data, "meta.json")["league_exclude"])
        finally:
            pub.close()
            league.close()
    print("parity: %d comparisons, %d differences"
          % (rep.checked, len(rep.failures)))
    for f in rep.failures[:40]:
        print("  " + f)
    if len(rep.failures) > 40:
        print("  ... and %d more" % (len(rep.failures) - 40))
    return 1 if rep.failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
