"""
The bots' own rules, carried over exactly, so a number on the site is the
number a player gets in game from !bdstats, !bdtop and !bdmatch.

Each rule names where it comes from in PyCore. This module reads nothing and
writes nothing: values in, values out.
"""
import fnmatch
import hashlib

# baseduel/db.py BaseduelDB._CAREER_SUMS: the columns a career adds up.
CAREER_SUMS = (
    "safe_touches", "kills", "deaths", "teamkills", "streaks",
    "streak_ends", "dmg_given", "dmg_taken", "attaches", "attached_to",
    "reps", "bursts", "active_time",
)

# pubduel/db.py _NEOBOT_SUMS: what a Neobot career adds to one of the pub
# bot's. Everything else on a career (safe touches, streaks, attaches, rounds,
# captaincy) is the pub bot's alone.
NEOBOT_SUMS = ("matches", "wins", "no_results", "kills", "deaths",
               "teamkills", "dmg_given", "dmg_taken", "attached_to", "reps",
               "bursts", "active_time")

# What a career carries besides the sums, as get_player_career returns it.
CAREER_KEYS = (("matches", "wins", "no_results", "captained", "best_streak")
               + CAREER_SUMS + ("rounds", "rounds_won"))

# The stats commands' scopes, one name each on the site.
#   Pub section (pubduel/board.py STATS_SCOPES): no word counts both eras;
#   'pub' / 'private' / a game mode are the pub bot's matches only; 'neobot'
#   is the old bot's games only.
#   League section (BaseduelBot.py _SCOPE_MODES): no word counts every mode;
#   'league' is mode 'match', and 'scrim' / 'pickup' narrow to those.
PUB_SCOPES = {
    "all":     {},
    "pub":     {"mode": "pub"},
    "private": {"mode": "private"},
    "hard":    {"mode": "pub", "game_mode": "hard"},
    "neobot":  {"neobot": True},
}
LEAGUE_SCOPES = {
    "all":    {},
    "league": {"mode": "match"},
    "scrim":  {"mode": "scrim"},
    "pickup": {"mode": "pickup"},
}

# baseduel/db.py _TOP_STATS: the leaderboards, their minimum matches and the
# volume floors that keep a player with 1 kill and 0 deaths off the top of
# the K/D board. 'floor' names what the floor is counted in.
TOP_STATS = {
    "kills":   {"label": "Kills",   "min": 1},
    "deaths":  {"label": "Deaths",  "min": 1},
    "tk":      {"label": "TK",      "min": 1},
    "touches": {"label": "Touches", "min": 1},
    "streak":  {"label": "Streak",  "min": 1},
    "matches": {"label": "Played",  "min": 1},
    "wins":    {"label": "Wins",    "min": 1},
    "dmg":     {"label": "Damage",  "min": 1},
    "kd":      {"label": "K/D",     "min": 2, "floor": "kills+deaths", "at": 50},
    "kpm":     {"label": "KPM",     "min": 2, "floor": "field seconds", "at": 300},
    "dpm":     {"label": "Dmg/min", "min": 2, "floor": "field seconds", "at": 300},
    "winpct":  {"label": "Win%",    "min": 3, "floor": "decided", "at": 3},
}
# pubduel/board.py NEOBOT_UNTRACKED_STATS: boards Neobot had nothing for. With
# no scope, such a board is the pub bot's matches alone.
NEOBOT_UNTRACKED_STATS = ("touches", "streak")

# CLAUDE.md "Tracked today, not by Neobot": a field Neobot never tracked is
# shown as not tracked, never as 0.
NEOBOT_UNTRACKED_FIELDS = ("safe_touches", "best_streak", "streaks",
                           "streak_ends", "attaches", "captained")


_ASCII_LOWER = {c: c + 32 for c in range(ord("A"), ord("Z") + 1)}


def fold(name):
    """A name as the bots compare it: SQLite's LOWER() and COLLATE NOCASE
    fold ASCII letters only, so Python's str.lower(), which folds every
    letter, could put two names together that the bots keep apart."""
    return name.translate(_ASCII_LOWER)


def player_key(name):
    """The file name for a player: names like 'o;' and 'Ripp3n K|tt3N' break
    paths, so a short hash of the folded name stands in for it."""
    return hashlib.sha1(fold(name).encode("utf-8")).hexdigest()[:10]


def rating(kills, teamkills, deaths):
    """The board's R and !bdtop's K/D: (kills - teamkills) / (deaths + 1)."""
    return ((kills or 0) - (teamkills or 0)) / ((deaths or 0) + 1)


def result(winner_freq, is_winner, no_result):
    """W, L, N (no result: pubduel/stats.py decide()), or '-' for a match
    nobody won, which counts in no record."""
    if winner_freq is None:
        return "-"
    if no_result:
        return "N"
    return "W" if is_winner else "L"


KIND_PUB, KIND_PRIVATE = "pub", "private"


def freqs_of(mode, players):
    """The two freqs a match was played on (pubduel/board.py freqs_of): by
    its kind, else from its rows. score_a is always the lower freq's."""
    if mode == KIND_PRIVATE:
        return (100, 200)
    if mode == KIND_PUB:
        return (0, 1)
    seen = sorted({p["freq"] for p in players})
    return tuple(seen) if len(seen) == 2 else (0, 1)


def match_seconds(m):
    """pubduel/board.py match_seconds: seconds of PLAY in a bd_matches row,
    wall clock less timeouts and the gaps between rounds."""
    started, ended = m.get("started_at"), m.get("ended_at")
    if not (started and ended):
        return 0.0
    return max(0.0, (ended - started) - (m.get("held_seconds") or 0.0)
               - (m.get("dead_seconds") or 0.0))


def glob_match(pattern, name):
    """SQLite's GLOB, as BaseduelDB._exclude_sql uses it on LOWER(name):
    * ? and [...] as in fnmatch, with [^...] for a negated class."""
    return fnmatch.fnmatchcase(fold(name), fold(pattern).replace("[^", "[!"))


def parse_exclude_list(raw):
    """BaseduelBot.py parse_exclude_list: BASEDUEL_STATS_EXCLUDE's patterns."""
    return tuple(p for p in (t.strip().lower() for t in (raw or "").split(","))
                 if p)
