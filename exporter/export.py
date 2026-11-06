"""
Snapshots in, the site's data out: JSON files under one folder.

Two sections, never added together (the user, 2026-11-05):
  pub     pubduel.db: the pub bot's matches, and Neobot's games beside them
  league  baseduel.db: the league bot's matches

A file is rewritten only when its bytes change, so a deploy uploads only what
a new match touched, and a file nothing produced any more is removed.

What is never exported: bd_settings, bd_arena_bases, and every list in
bd_player_flags but the bot list (the allow, follow and notify lists).
"""
import itertools
import json
import os
import time

from exporter import insights, mates, readers, records
from exporter.rules import (
    CAREER_KEYS, LEAGUE_SCOPES, NEOBOT_UNTRACKED_STATS, PUB_SCOPES, TOP_STATS,
    fold, freqs_of, glob_match, match_seconds, player_key, result,
)

EXPORT_VERSION = 1

# Matches per data file: the pub bot's and the league's carry rounds and
# round players (about 2 KB a match gzipped), Neobot's only their screen.
OWN_BUCKET = 10
NEOBOT_BUCKET = 100

# Cloudflare Pages' free plan: 20,000 files and 25 MiB a file. The export
# stops well short, so a deploy can never fail on them unseen.
MAX_FILES = 15000
MAX_FILE_BYTES = 20 * 2 ** 20

# Matches the home page lists for each section.
RECENT = 12

# The pub section's extra career: earlier and recent pub matches together.
PUB_COMBINED = "pub_all"


class ExportError(Exception):
    pass


class Writer:
    """Writes JSON under `root`, only when a file's bytes change, and removes
    the .json files a run did not produce."""

    def __init__(self, root):
        self.root = root
        self.written = set()
        self.changed = 0
        self.bytes = 0

    def json(self, rel, obj):
        data = json.dumps(obj, separators=(",", ":"), ensure_ascii=False,
                          allow_nan=False).encode("utf-8")
        if len(data) > MAX_FILE_BYTES:
            raise ExportError("%s is %d bytes, over the %d limit"
                              % (rel, len(data), MAX_FILE_BYTES))
        if rel in self.written:
            raise ExportError("%s written twice" % rel)
        self.written.add(rel)
        self.bytes += len(data)
        path = os.path.join(self.root, rel)
        try:
            with open(path, "rb") as f:
                if f.read() == data:
                    return
        except FileNotFoundError:
            pass
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
        self.changed += 1

    def stale(self, keep=()):
        """The .json files under root this run has not written."""
        out = []
        for folder, _dirs, files in os.walk(self.root):
            for name in files:
                rel = os.path.relpath(os.path.join(folder, name), self.root)
                if (name.endswith(".json") and rel not in self.written
                        and rel not in keep):
                    out.append(rel)
        return out

    def finish(self):
        if len(self.written) > MAX_FILES:
            raise ExportError("%d files, over the %d limit"
                              % (len(self.written), MAX_FILES))
        stale = self.stale()
        for rel in stale:
            os.remove(os.path.join(self.root, rel))
        return len(stale)


def table(dict_rows, cols):
    """Rows as {"cols": [...], "rows": [[...]]}: the keys once, not per row."""
    return {"cols": list(cols), "rows": [[r.get(c) for c in cols]
                                         for r in dict_rows]}


def by_match(rows):
    out = {}
    for r in rows:
        out.setdefault(r["match_id"], []).append(r)
    return out


# Columns of a bd_match_players row on a match page, and in a player's history.
MATCH_PLAYER_COLS = (
    "player_name", "team", "freq", "is_captain", "is_winner", "no_result",
    "exit_kind", "safe_touches", "kills", "deaths", "teamkills",
    "best_streak", "streaks", "streak_ends", "dmg_given", "dmg_taken",
    "attaches", "attached_to", "reps", "bursts", "max_bounty", "active_time",
)
ROUND_COLS = ("seq", "round_no", "attempt", "counted", "base_num",
              "winner_freq", "ended_by", "scorer_name", "score_a", "score_b",
              "started_at", "ended_at", "duration_s")
ROUND_PLAYER_COLS = (
    "seq", "player_name", "team", "freq", "is_winner", "safe_touches",
    "kills", "deaths", "teamkills", "streaks", "streak_ends", "dmg_given",
    "dmg_taken", "attaches", "attached_to", "reps", "bursts", "active_time",
)
MATCH_COLS = (
    "id", "mode", "game_mode", "game_mode_freq", "game_mode_until",
    "game_mode_end", "arena", "team_a", "team_b", "target", "winby",
    "team_size", "time_limit", "score_a", "score_b", "winner_freq",
    "outcome", "started_at", "ended_at", "held_seconds", "dead_seconds",
)
NEOBOT_MATCH_COLS = ("neobot_id", "history_id", "score_a", "score_b",
                     "winner_freq", "outcome", "active_seconds",
                     "partial_stats")
NEOBOT_PLAYER_COLS = (
    "player_name", "freq", "is_winner", "no_result", "exit_kind", "kills",
    "deaths", "teamkills", "team_deaths", "dmg_given", "dmg_taken",
    "attached_to", "reps", "bursts", "greens", "active_time", "freqs_played",
)
NEOBOT_LINE_COLS = (
    "line_no", "player_name", "freq", "left_early", "kills", "deaths",
    "teamkills", "team_deaths", "dmg_given", "dmg_taken", "attached_to",
    "reps", "bursts", "greens", "active_time",
)
# A player's history: one row a match, enough to list it and link to it.
HISTORY_COLS = (
    "id", "started_at", "mode", "game_mode", "arena", "freq", "team",
    "result", "score_for", "score_against", "is_captain", "exit_kind",
    "safe_touches", "kills", "deaths", "teamkills", "best_streak",
    "dmg_given", "dmg_taken", "attaches", "attached_to", "reps", "bursts",
    "active_time",
)
NEOBOT_HISTORY_COLS = (
    "id", "freq", "result", "score_for", "score_against", "exit_kind",
    "kills", "deaths", "teamkills", "dmg_given", "dmg_taken", "attached_to",
    "reps", "bursts", "greens", "active_time", "freqs_played",
)
CAREER_COLS = CAREER_KEYS + ("player_name", "last_team", "last_match_id",
                             "neobot_matches")


def career(c):
    """A career as the site stores it: None for none, else every key, with
    None for anything not tracked."""
    if c is None:
        return None
    return {k: c.get(k) for k in CAREER_COLS}


class Section:
    """One bot's database, read once."""

    def __init__(self, name, conn, scopes, is_bot, replays=None,
                 replay_site=None):
        self.name = name
        self.scopes = scopes
        self.is_bot = is_bot
        self.matches = readers.own_matches(conn)
        self.match_by_id = {m["id"]: m for m in self.matches}
        self.players = readers.own_players(conn)
        self.players_by_match = by_match(self.players)
        self.players_by_lname = {}
        for p in self.players:
            self.players_by_lname.setdefault(fold(p["player_name"]),
                                             []).append(p)
        self.rounds_by_match = by_match(readers.own_rounds(conn))
        self.round_players_by_match = by_match(readers.own_round_players(conn))
        self.careers = {}
        neobot_rows = readers.neobot_career_rows(conn)
        for scope_name, scope in scopes.items():
            if scope.get("neobot"):
                self.careers[scope_name] = {
                    lname: c for lname, c in
                    ((l, readers.neobot_career(r))
                     for l, r in neobot_rows.items()) if c is not None}
            else:
                self.careers[scope_name] = readers.own_careers(conn, scope)
        if "neobot" in scopes:
            own_all, own_pub = self.careers["all"], self.careers["pub"]
            old = self.careers["neobot"]
            self.careers["all"] = {
                lname: readers.merge_all(own_all.get(lname), old.get(lname))
                for lname in set(own_all) | set(old)}
            # Every pub match, earlier and recent, as one career (the user,
            # 2026-11-05: combine them). Not a scope the bot has: its own
            # 'pub' and 'neobot' careers, put together by the very rule its
            # no-scope career uses.
            self.careers[PUB_COMBINED] = {
                lname: readers.merge_all(own_pub.get(lname), old.get(lname))
                for lname in set(own_pub) | set(old)}
        self.neobot_names = {l: r["name"] for l, r in neobot_rows.items()}
        self.neobot_matches = readers.neobot_matches(conn)
        self.neobot_players = readers.neobot_players(conn)
        # The screens' lines are read as they are written (export), not here.
        self.conn = conn
        self.replay = {}
        if replays is not None:
            for m in self.matches:
                rid = ("%s-%s" % (m.get("arena"), m.get("recording"))
                       if m.get("recording") else None)
                if rid and rid.lower() in replays:
                    self.replay[m["id"]] = "%s/r/%s" % (
                        replay_site.rstrip("/"), replays[rid.lower()])

    def last_seen(self):
        """{folded name: (latest ended_at, casing then)}: get_known_players'
        casing, the one of their latest match."""
        out = {}
        for p in self.players:
            m = self.match_by_id[p["match_id"]]
            when = m.get("ended_at") or m.get("started_at") or 0
            lname = fold(p["player_name"])
            if lname not in out or when > out[lname][0]:
                out[lname] = (when, p["player_name"])
        return out

    def history(self, lname):
        """A player's own rows, newest first, as HISTORY_COLS."""
        out = []
        for p in self.players_by_lname.get(lname, ()):
            m = self.match_by_id[p["match_id"]]
            fa, _fb = freqs_of(m["mode"], self.players_by_match[m["id"]])
            mine, theirs = ((m["score_a"], m["score_b"]) if p["freq"] == fa
                            else (m["score_b"], m["score_a"]))
            row = dict(p, id=m["id"], started_at=m.get("started_at"),
                       mode=m["mode"], game_mode=m.get("game_mode"),
                       arena=m.get("arena"),
                       result=result(m["winner_freq"], p["is_winner"],
                                     p["no_result"]),
                       score_for=mine, score_against=theirs)
            out.append(row)
        out.sort(key=lambda r: -r["id"])
        return out

    def match_doc(self, m):
        mid = m["id"]
        doc = {k: m.get(k) for k in MATCH_COLS}
        doc.update(played_seconds=match_seconds(m),
                   rounds_counted=m["rounds_counted"],
                   replay=self.replay.get(mid))
        return {
            "match": doc,
            "players": table(self.players_by_match.get(mid, []),
                             MATCH_PLAYER_COLS),
            "rounds": table(self.rounds_by_match.get(mid, []), ROUND_COLS),
            "round_players": table(self.round_players_by_match.get(mid, []),
                                   ROUND_PLAYER_COLS),
        }

    def facts(self, keys):
        """Every match and every player-match row, for the browser to filter
        and count: the matches list now, the leaderboards next."""
        matches = []
        for m in self.matches:
            doc = {k: m.get(k) for k in MATCH_COLS}
            doc.update(played_seconds=match_seconds(m),
                       rounds_counted=m["rounds_counted"],
                       players=m["players"],
                       replay=self.replay.get(m["id"]))
            matches.append(doc)
        players = []
        for p in self.players:
            m = self.match_by_id[p["match_id"]]
            players.append(dict(p, key=keys[fold(p["player_name"])],
                                result=result(m["winner_freq"],
                                              p["is_winner"],
                                              p["no_result"])))
        cols = ("match_id", "key", "freq", "result") + tuple(
            c for c in MATCH_PLAYER_COLS if c not in ("player_name", "team",
                                                      "freq"))
        return {"matches": table(matches, tuple(matches[0]) if matches
                                 else MATCH_COLS),
                "players": table(players, cols)}


# A round on the bases page: where it was played and how it ended. "side"
# is who won it: "a" the lower freq (0, or 100 in a private match), "b" the
# higher, None for no point.
ROUND_FACT_COLS = ("match", "arena", "mode", "base", "counted", "ended_by",
                   "side", "seconds")


def round_facts(section):
    """rounds/<section>.json: every round of every match a person played in
    (records.py's rule: bots alone tell nothing about a base), skipped ones
    too."""
    people, _earlier = records.with_people(section)
    out = []
    for m in section.matches:
        if m["id"] not in people:
            continue
        fa, _fb = freqs_of(m["mode"], section.players_by_match.get(m["id"], []))
        for r in section.rounds_by_match.get(m["id"], []):
            w = r["winner_freq"]
            out.append({"match": m["id"], "arena": m.get("arena"),
                        "mode": m["mode"], "base": r["base_num"],
                        "counted": r["counted"], "ended_by": r["ended_by"],
                        "side": None if w is None else "a" if w == fa else "b",
                        "seconds": r["duration_s"]})
    return table(out, ROUND_FACT_COLS)


def neobot_history(games, rows):
    """One player's rows of Neobot's games, newest first, as
    NEOBOT_HISTORY_COLS. Built a player at a time, as their file is written:
    all of them at once were 220 MB."""
    out = []
    for p in rows:
        g = games[p["match_id"]]
        mine, theirs = ((g["score_a"], g["score_b"]) if p["freq"] == 0
                        else (g["score_b"], g["score_a"]))
        out.append(dict(
            p, id=g["neobot_id"],
            result=result(g["winner_freq"], p["is_winner"], p["no_result"]),
            score_for=mine, score_against=theirs))
    out.sort(key=lambda r: -r["id"])
    return out


def export(pub_conn, league_conn, out, league_exclude=(), replays=None,
           replay_site="https://ss-replay.pages.dev", now=None):
    """Write the whole site's data under `out`. Returns a summary dict."""
    started = time.monotonic()
    pub_bots = readers.bot_names(pub_conn)
    pub = Section("pub", pub_conn, PUB_SCOPES, lambda l: l in pub_bots)
    league = Section("league", league_conn, LEAGUE_SCOPES,
                     lambda l: any(glob_match(p, l) for p in league_exclude),
                     replays=replays, replay_site=replay_site)
    w = Writer(out)

    # ---- who is who ---------------------------------------------------------
    pub_seen, league_seen = pub.last_seen(), league.last_seen()
    names = {}
    for lname, name in pub.neobot_names.items():
        names[lname] = (0, name)
    for seen in (league_seen, pub_seen):
        for lname, (when, name) in seen.items():
            if lname not in names or when >= names[lname][0]:
                names[lname] = (when, name)
    keys = {}
    for lname in names:
        key = player_key(lname)
        if key in keys.values():
            raise ExportError("two players share the key %s" % key)
        keys[lname] = key

    # ---- each player ---------------------------------------------------------
    games = {g["neobot_id"]: g for g in pub.neobot_matches}
    old_rows = {}
    for p in pub.neobot_players:
        old_rows.setdefault(fold(p["player_name"]), []).append(p)
    players_by_game = by_match(pub.neobot_players)
    index = []
    for lname, (when, name) in sorted(names.items()):
        doc = {"key": keys[lname], "name": name}
        pub_careers = {s: career(pub.careers[s].get(lname))
                       for s in tuple(PUB_SCOPES) + (PUB_COMBINED,)}
        own = pub.history(lname)
        old = neobot_history(games, old_rows.get(lname, ()))
        if own or old or any(pub_careers.values()):
            # Each section names a player as its own bot does: the casing of
            # their latest match there, else Neobot's.
            doc["pub"] = {"name": pub_seen[lname][1] if lname in pub_seen
                          else pub.neobot_names.get(lname, name),
                          "bot": pub.is_bot(lname), "careers": pub_careers,
                          "matches": table(own, HISTORY_COLS),
                          "neobot": table(old, NEOBOT_HISTORY_COLS),
                          "mates": mates.mates(pub, lname, keys, old,
                                               players_by_game)}
        league_careers = {s: career(league.careers[s].get(lname))
                          for s in LEAGUE_SCOPES}
        theirs = league.history(lname)
        if theirs or any(league_careers.values()):
            doc["league"] = {"name": league_seen[lname][1]
                             if lname in league_seen else name,
                             "bot": league.is_bot(lname),
                             "careers": league_careers,
                             "matches": table(theirs, HISTORY_COLS),
                             "mates": mates.mates(league, lname, keys)}
        w.json("p/%s.json" % keys[lname], doc)
        pc, lc = pub_careers["all"], league_careers["all"]
        index.append({
            "key": keys[lname], "name": name,
            "pub_bot": bool(doc.get("pub", {}).get("bot")),
            "league_bot": bool(doc.get("league", {}).get("bot")),
            "pub_matches": pc["matches"] if pc else 0,
            "pub_played": len(own) + len(old),
            "league_matches": lc["matches"] if lc else 0,
            "league_played": len(theirs),
            "last_seen": when or None,
            # Each section's first match, for the activity page's new
            # players: an earlier game if they played one, as those came
            # first.
            "pub_first": min((r["id"] for r in old or own), default=None),
            "league_first": min((r["id"] for r in theirs), default=None),
        })
    w.json("players.json", table(index, tuple(index[0]) if index else ()))

    # ---- the matches ---------------------------------------------------------
    for section in (pub, league):
        buckets = {}
        for m in section.matches:
            buckets.setdefault(m["id"] // OWN_BUCKET, {})[str(m["id"])] = \
                section.match_doc(m)
        for b, docs in buckets.items():
            w.json("m/%s/%d.json" % (section.name, b), docs)
        w.json("facts/%s.json" % section.name, section.facts(keys))
        w.json("records/%s.json" % section.name,
               records.section_records(section, keys))
        w.json("rounds/%s.json" % section.name, round_facts(section))
    w.json("insights.json", insights.insights(pub, league))

    # Each earlier game's page, a bucket of games at a time, each written as
    # soon as it is whole: the lines come in game order, as the games do.
    lines = itertools.groupby(readers.neobot_lines(pub.conn),
                              key=lambda l: l["match_id"])
    pending = next(lines, None)
    bucket, docs = None, {}
    for g in pub.neobot_matches:
        gid = g["neobot_id"]
        while pending is not None and pending[0] < gid:
            pending = next(lines, None)
        mine = []
        if pending is not None and pending[0] == gid:
            mine = list(pending[1])
            pending = next(lines, None)
        if gid // NEOBOT_BUCKET != bucket:
            if docs:
                w.json("m/neobot/%d.json" % bucket, docs)
            bucket, docs = gid // NEOBOT_BUCKET, {}
        docs[str(gid)] = {
            "match": {k: g.get(k) for k in NEOBOT_MATCH_COLS},
            "players": table(players_by_game.get(gid, []), NEOBOT_PLAYER_COLS),
            "lines": table(mine, NEOBOT_LINE_COLS),
        }
    if docs:
        w.json("m/neobot/%d.json" % bucket, docs)
    if pub.neobot_matches:
        w.json("neobot/index.json", table(
            [dict(g, players=len(players_by_game.get(g["neobot_id"], [])))
             for g in reversed(pub.neobot_matches)],
            NEOBOT_MATCH_COLS + ("players",)))
        w.json("neobot/careers.json", table(
            [dict(c, key=keys[l]) for l, c in sorted(pub.careers["neobot"].items())],
            ("key",) + CAREER_COLS))

    # ---- what the site needs to know about all of it --------------------------
    def summary(section):
        ms = section.matches
        # The latest few, newest first, as the facts file has them: the home
        # page lists them without loading the whole file.
        recent = sorted(ms, key=lambda m: (m.get("ended_at") or
                                           m.get("started_at") or 0, m["id"]),
                        reverse=True)[:RECENT]
        return {"matches": len(ms),
                # When the bot's record begins: the site calls Neobot's games
                # "earlier matches", from before this (the user, 2026-11-05).
                "first_started": min((m["started_at"] for m in ms
                                      if m.get("started_at")), default=None),
                "first_id": ms[0]["id"] if ms else None,
                "last_id": ms[-1]["id"] if ms else None,
                "last_ended": max((m.get("ended_at") or 0 for m in ms),
                                  default=None) or None,
                "bucket": OWN_BUCKET,
                "recent": table([dict({k: m.get(k) for k in MATCH_COLS},
                                      played_seconds=match_seconds(m),
                                      players=m["players"])
                                 for m in recent],
                                MATCH_COLS + ("played_seconds", "players"))}
    # The build time moves only when the data did, so a run that changed
    # nothing leaves every file as it was and needs no deploy.
    built = int(now if now is not None else time.time())
    if w.changed == 0 and not w.stale(keep=("meta.json",)):
        try:
            with open(os.path.join(out, "meta.json"), encoding="utf-8") as f:
                built = json.load(f).get("built", built)
        except (FileNotFoundError, ValueError):
            pass
    meta = {
        "version": EXPORT_VERSION,
        "built": built,
        "sections": {"pub": summary(pub), "league": summary(league)},
        "neobot": ({"games": len(pub.neobot_matches),
                    "first_id": pub.neobot_matches[0]["neobot_id"],
                    "last_id": pub.neobot_matches[-1]["neobot_id"],
                    "bucket": NEOBOT_BUCKET}
                   if pub.neobot_matches else None),
        "players": len(index),
        "top_stats": TOP_STATS,
        "neobot_untracked_stats": list(NEOBOT_UNTRACKED_STATS),
        "league_exclude": list(league_exclude),
    }
    w.json("meta.json", meta)
    removed = w.finish()
    return {"files": len(w.written), "changed": w.changed, "removed": removed,
            "bytes": w.bytes, "seconds": round(time.monotonic() - started, 2),
            "players": len(index), "pub_matches": len(pub.matches),
            "league_matches": len(league.matches),
            "neobot_games": len(pub.neobot_matches),
            "replay_links": len(league.replay)}
