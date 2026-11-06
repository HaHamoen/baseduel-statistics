"""
Small databases with the bots' real schema (taken from live snapshots, in
schema_pub.sql and schema_league.sql), for tests that need a few rows of
their own rather than a whole season.
"""
import os
import sqlite3

HERE = os.path.dirname(os.path.abspath(__file__))


class FixtureDB:
    """A database built from one of the schema files. `add` fills every
    NOT NULL column a test leaves out, so a test names only what it means."""

    def __init__(self, path, schema):
        self.path = path
        self.conn = sqlite3.connect(path)
        self.conn.row_factory = sqlite3.Row
        with open(os.path.join(HERE, "schema_%s.sql" % schema)) as f:
            self.conn.executescript(f.read())
        self._cols = {}

    def _columns(self, table):
        if table not in self._cols:
            self._cols[table] = self.conn.execute(
                "PRAGMA table_info(%s)" % table).fetchall()
        return self._cols[table]

    def add(self, table, **values):
        for col in self._columns(table):
            name = col["name"]
            if (name in values or not col["notnull"] or col["pk"]
                    or col["dflt_value"] is not None):
                continue
            values[name] = "" if "TEXT" in (col["type"] or "") else 0
        cols = list(values)
        cur = self.conn.execute(
            "INSERT INTO %s(%s) VALUES(%s)" % (table, ",".join(cols),
                                               ",".join("?" for _ in cols)),
            [values[c] for c in cols])
        self.conn.commit()
        return cur.lastrowid

    def match(self, mode="pub", score=(5, 3), winner=0, outcome="completed",
              started=1760000000.0, length=600.0, **extra):
        values = dict(team_a="Freq 0", team_b="Freq 1", target=5, winby=2,
                      team_size=2, score_a=score[0], score_b=score[1],
                      winner_freq=winner, outcome=outcome, mode=mode,
                      arena="bdeg", started_at=started,
                      ended_at=started + length)
        values.update(extra)
        return self.add("bd_matches", **values)

    def player(self, match_id, name, freq, won, **stats):
        values = dict(match_id=match_id, player_name=name,
                      team="Freq %d" % freq, freq=freq, is_winner=int(won),
                      active_time=300.0)
        values.update(stats)
        return self.add("bd_match_players", **values)

    def round(self, match_id, seq, winner, counted=1, ended_by="touch",
              **extra):
        values = dict(match_id=match_id, seq=seq, round_no=seq, attempt=1,
                      counted=counted, base_num=3, winner_freq=winner,
                      ended_by=ended_by, score_a=0, score_b=0,
                      duration_s=60.0)
        values.update(extra)
        return self.add("bd_rounds", **values)

    def round_player(self, round_id, match_id, name, freq, won, **stats):
        values = dict(round_id=round_id, match_id=match_id, round_no=1,
                      player_name=name, team="Freq %d" % freq, freq=freq,
                      is_winner=int(won))
        values.update(stats)
        return self.add("bd_round_players", **values)

    def neobot_game(self, gid, score=(5, 2), winner=0, outcome="completed",
                    seconds=900):
        return self.add("neobot_matches", neobot_id=gid,
                        history_id=str(gid), score_a=score[0],
                        score_b=score[1], winner_freq=winner,
                        outcome=outcome, active_seconds=seconds)

    def neobot_player(self, gid, name, freq, won, **stats):
        values = dict(match_id=gid, player_name=name, freq=freq,
                      is_winner=int(won), kills=0, deaths=0, dmg_given=0,
                      dmg_taken=0, reps=0, bursts=0, active_time=600.0)
        values.update(stats)
        self.add("neobot_players", **values)
        line = {k: v for k, v in values.items()
                if k not in ("is_winner", "no_result", "exit_kind",
                             "freqs_played")}
        line["line_no"] = self.conn.execute(
            "SELECT COUNT(*) FROM neobot_lines").fetchone()[0] + 1
        self.add("neobot_lines", **line)

    def neobot_career(self, name, **totals):
        values = dict(lname=name.lower(), name=name)
        values.update(totals)
        self.add("neobot_career", **values)

    def close(self):
        self.conn.close()
