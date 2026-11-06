"""
Read-only SQL over a snapshot of either bot's database.

The queries are BaseduelDB's and PubDuelDB's (PyCore baseduel/db.py and
pubduel/db.py), asked for every player at once instead of one name at a
time. Grouping by LOWER(player_name) is the same partition as their
`player_name = ? COLLATE NOCASE`, so each player's numbers come out the same.

Every function takes a connection from snapshot.open_snapshot and returns
plain dicts.
"""
from exporter.rules import CAREER_SUMS, NEOBOT_SUMS, fold


def rows(conn, sql, params=()):
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def has_table(conn, name):
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' "
                        "AND name=?", (name,)).fetchone() is not None


def scope_sql(scope, alias="m"):
    """BaseduelDB._scope_sql: matches that produced a result, narrowed by
    bd_matches.mode and game_mode."""
    frag = "%s.winner_freq IS NOT NULL" % alias
    params = []
    if scope.get("mode"):
        frag += " AND %s.mode = ?" % alias
        params.append(scope["mode"])
    if scope.get("game_mode"):
        frag += " AND %s.game_mode = ?" % alias
        params.append(scope["game_mode"])
    return frag, params


def own_careers(conn, scope):
    """BaseduelDB.get_player_career for every player with a decided match in
    scope: {folded name: career}."""
    frag, params = scope_sql(scope)
    sums = ", ".join("SUM(p.%s) AS %s" % (c, c) for c in CAREER_SUMS)
    out = {}
    for r in rows(conn,
                  "SELECT LOWER(p.player_name) AS lname, COUNT(*) AS matches, "
                  "       SUM(p.is_winner) AS wins, "
                  "       SUM(p.no_result) AS no_results, "
                  "       SUM(p.is_captain) AS captained, "
                  "       MAX(p.best_streak) AS best_streak, %s "
                  "  FROM bd_match_players p "
                  "  JOIN bd_matches m ON m.id = p.match_id "
                  " WHERE %s GROUP BY LOWER(p.player_name)" % (sums, frag),
                  params):
        lname = r.pop("lname")
        r.update(rounds=0, rounds_won=0)
        out[lname] = r

    # Display casing, last team and last match: the row get_player_career's
    # ORDER BY ... LIMIT 1 picks, so the first one seen here.
    for r in rows(conn,
                  "SELECT LOWER(p.player_name) AS lname, p.player_name, "
                  "       p.team, m.id AS match_id "
                  "  FROM bd_match_players p "
                  "  JOIN bd_matches m ON m.id = p.match_id "
                  " WHERE %s ORDER BY m.ended_at DESC, m.id DESC" % frag,
                  params):
        c = out.get(r["lname"])
        if c is not None and "player_name" not in c:
            c.update(player_name=r["player_name"], last_team=r["team"],
                     last_match_id=r["match_id"])

    # The round record joins on round_id, never round_no, which repeats and
    # steps back; counted=1 leaves out replayed attempts.
    for r in rows(conn,
                  "SELECT LOWER(rp.player_name) AS lname, COUNT(*) AS rounds, "
                  "       SUM(rp.is_winner) AS rounds_won "
                  "  FROM bd_round_players rp "
                  "  JOIN bd_rounds  r ON r.id = rp.round_id "
                  "  JOIN bd_matches m ON m.id = rp.match_id "
                  " WHERE r.counted = 1 AND %s "
                  " GROUP BY LOWER(rp.player_name)" % frag, params):
        c = out.get(r["lname"])
        if c is not None:
            c["rounds"] = r["rounds"] or 0
            c["rounds_won"] = r["rounds_won"] or 0
    return out


def neobot_career_rows(conn):
    """Every row of neobot_career, matches = 0 included: {lname: row}."""
    if not has_table(conn, "neobot_career"):
        return {}
    return {r["lname"]: r for r in rows(conn, "SELECT * FROM neobot_career")}


def neobot_career(row):
    """PubDuelDB._neobot_career: a Neobot career in get_player_career's
    shape, what Neobot did not track as None. None with no decided game."""
    if row is None or not row["matches"]:
        return None
    out = {key: row[key] for key in NEOBOT_SUMS}
    out.update(player_name=row["name"], neobot_matches=row["matches"],
               captained=None, best_streak=None, safe_touches=None,
               streaks=None, streak_ends=None, attaches=None,
               last_team=None, last_match_id=None, rounds=0, rounds_won=0)
    return out


def merge_all(own, old):
    """PubDuelDB.get_player_career with no scope: the pub bot's career with
    Neobot's added in, and neobot_matches saying how many were Neobot's."""
    if old is None:
        return own
    if own is None:
        return dict(old)
    merged = dict(own)
    for key in NEOBOT_SUMS:
        merged[key] = (own[key] or 0) + (old[key] or 0)
    merged["neobot_matches"] = old["matches"]
    return merged


def bot_names(conn):
    """The pub bot's `bot` list (bd_player_flags under arena '*'), folded.
    The bot escapes each name before GLOB, so this is plain equality."""
    if not has_table(conn, "bd_player_flags"):
        return set()
    return {fold(r["player"]) for r in rows(
        conn, "SELECT player FROM bd_player_flags "
              "WHERE flag = 'bot' AND arena = '*'")}


def own_matches(conn):
    """Every bd_matches row, aborted ones too, with get_recent_matches'
    counted rounds and players. Oldest first."""
    return rows(conn,
                "SELECT m.*, "
                "       (SELECT COUNT(*) FROM bd_rounds r "
                "         WHERE r.match_id = m.id AND r.counted = 1) "
                "         AS rounds_counted, "
                "       (SELECT COUNT(*) FROM bd_match_players p "
                "         WHERE p.match_id = m.id) AS players "
                "  FROM bd_matches m ORDER BY m.id")


def own_players(conn):
    """Every bd_match_players row, in get_match's order within a match."""
    return rows(conn,
                "SELECT * FROM bd_match_players "
                " ORDER BY match_id, freq, kills DESC, LOWER(player_name)")


def own_rounds(conn):
    return rows(conn, "SELECT * FROM bd_rounds ORDER BY match_id, seq")


def own_round_players(conn):
    """get_match's round players: r.seq carried through the round_id join."""
    return rows(conn,
                "SELECT rp.*, r.seq AS seq "
                "  FROM bd_round_players rp "
                "  JOIN bd_rounds r ON r.id = rp.round_id "
                " ORDER BY rp.match_id, r.seq, rp.kills DESC")


def neobot_matches(conn):
    if not has_table(conn, "neobot_matches"):
        return []
    return rows(conn, "SELECT * FROM neobot_matches ORDER BY neobot_id")


def neobot_players(conn):
    """get_neobot_match's merged rows, one a player a game."""
    if not has_table(conn, "neobot_players"):
        return []
    return rows(conn,
                "SELECT * FROM neobot_players "
                " ORDER BY match_id, freq, kills DESC, LOWER(player_name)")


def neobot_lines(conn):
    """Every row of every Neobot screen, as written, in game order, one at a
    time: 305,000 of them, so never all in memory at once."""
    if not has_table(conn, "neobot_lines"):
        return iter(())
    return (dict(r) for r in conn.execute(
        "SELECT * FROM neobot_lines ORDER BY match_id, line_no"))
