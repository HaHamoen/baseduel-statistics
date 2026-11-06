"""
The exporter's rules, on small databases with the bots' real schema.

    python3 tests/test_export.py
"""
import json
import os
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.dont_write_bytecode = True

from exporter import export as ex  # noqa: E402
from exporter.rules import (  # noqa: E402
    fold, glob_match, parse_exclude_list, player_key, rating, result,
)
from exporter.snapshot import open_snapshot, snapshot  # noqa: E402
from tests.fixtures import FixtureDB  # noqa: E402


def rows(t):
    return [dict(zip(t["cols"], r)) for r in t["rows"]]


class ExportCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.pub = FixtureDB(os.path.join(self.tmp, "pub.db"), "pub")
        self.league = FixtureDB(os.path.join(self.tmp, "league.db"), "league")
        self.out = os.path.join(self.tmp, "data")

    def tearDown(self):
        self.pub.close()
        self.league.close()
        shutil.rmtree(self.tmp)

    def run_export(self, **kw):
        pub = open_snapshot(self.pub.path)
        league = open_snapshot(self.league.path)
        try:
            return ex.export(pub, league, self.out, **kw)
        finally:
            pub.close()
            league.close()

    def load(self, rel):
        with open(os.path.join(self.out, rel), encoding="utf-8") as f:
            return json.load(f)

    def player(self, name):
        return self.load("p/%s.json" % player_key(name))

    def all_text(self):
        text = []
        for folder, _d, files in os.walk(self.out):
            for f in files:
                with open(os.path.join(folder, f), encoding="utf-8") as fh:
                    text.append(fh.read())
        return "\n".join(text)


class TestCareers(ExportCase):
    def test_a_neobot_only_career_says_not_tracked_never_zero(self):
        self.pub.neobot_career("Oldie", matches=4, wins=3, kills=40,
                               deaths=10, teamkills=None, attached_to=None,
                               active_time=3600.0)
        self.run_export()
        for scope in ("all", "neobot"):
            c = self.player("Oldie")["pub"]["careers"][scope]
            self.assertEqual(c["matches"], 4)
            self.assertEqual(c["neobot_matches"], 4)
            for untracked in ("teamkills", "attached_to", "safe_touches",
                              "best_streak", "streaks", "attaches",
                              "captained"):
                self.assertIsNone(c[untracked], (scope, untracked))
        self.assertIsNone(self.player("Oldie")["pub"]["careers"]["pub"])

    def test_no_scope_adds_neobot_to_the_pub_bot(self):
        m = self.pub.match()
        self.pub.player(m, "Both", 0, True, kills=7, deaths=2, teamkills=1,
                        safe_touches=2, active_time=500.0)
        self.pub.neobot_career("Both", matches=10, wins=4, kills=30,
                               deaths=20, teamkills=None, active_time=900.0)
        self.run_export()
        careers = self.player("Both")["pub"]["careers"]
        self.assertEqual(careers["all"]["matches"], 11)
        self.assertEqual(careers["all"]["kills"], 37)
        # A Neobot NULL adds as 0 to a merged career, as the bot sums it.
        self.assertEqual(careers["all"]["teamkills"], 1)
        self.assertEqual(careers["all"]["safe_touches"], 2)
        self.assertEqual(careers["all"]["neobot_matches"], 10)
        self.assertEqual(careers["pub"]["matches"], 1)
        self.assertIsNone(careers["pub"]["neobot_matches"])
        # Every pub match, earlier and recent, together.
        self.assertEqual(careers["pub_all"]["matches"], 11)
        self.assertEqual(careers["pub_all"]["kills"], 37)
        self.assertEqual(careers["pub_all"]["neobot_matches"], 10)

    def test_the_combined_pub_career_leaves_out_private_matches(self):
        pub = self.pub.match()
        priv = self.pub.match(mode="private", score=(5, 1), winner=100)
        self.pub.player(pub, "Kim", 0, True, kills=2)
        self.pub.player(priv, "Kim", 100, True, kills=50)
        self.pub.neobot_career("Kim", matches=3, wins=1, kills=6)
        self.run_export()
        c = self.player("Kim")["pub"]["careers"]
        self.assertEqual((c["pub_all"]["matches"], c["pub_all"]["kills"]), (4, 8))
        self.assertEqual((c["all"]["matches"], c["all"]["kills"]), (5, 58))

    def test_an_aborted_match_counts_in_no_career_but_is_in_the_history(self):
        m = self.pub.match(score=(0, 0), winner=None, outcome="aborted")
        self.pub.player(m, "Ann", 0, False, kills=3)
        self.run_export()
        doc = self.player("Ann")
        self.assertIsNone(doc["pub"]["careers"]["all"])
        hist = rows(doc["pub"]["matches"])
        self.assertEqual([(h["id"], h["result"]) for h in hist], [(m, "-")])

    def test_a_no_result_row_is_neither_a_win_nor_a_loss(self):
        m = self.pub.match()
        self.pub.player(m, "Late", 1, False, no_result=1)
        self.run_export()
        doc = self.player("Late")
        self.assertEqual(doc["pub"]["careers"]["all"]["no_results"], 1)
        self.assertEqual(rows(doc["pub"]["matches"])[0]["result"], "N")

    def test_the_scopes_narrow_as_the_bot_does(self):
        hard = self.pub.match(game_mode="hard", game_mode_freq=0)
        priv = self.pub.match(mode="private", score=(2, 5), winner=200)
        self.pub.player(hard, "Kim", 0, True)
        self.pub.player(priv, "Kim", 200, True)
        self.run_export()
        c = self.player("Kim")["pub"]["careers"]
        self.assertEqual((c["all"]["matches"], c["pub"]["matches"],
                          c["hard"]["matches"], c["private"]["matches"]),
                         (2, 1, 1, 1))
        self.assertIsNone(c["neobot"])

    def test_counted_rounds_only_joined_on_round_id(self):
        m = self.pub.match()
        self.pub.player(m, "Ann", 0, True)
        r1 = self.pub.round(m, 1, 0)
        skipped = self.pub.round(m, 2, None, counted=0, ended_by="nextbase",
                                 round_no=2)
        r2 = self.pub.round(m, 3, 0, round_no=2, attempt=2)
        for rid in (r1, skipped, r2):
            self.pub.round_player(rid, m, "Ann", 0, rid != skipped)
        self.run_export()
        c = self.player("Ann")["pub"]["careers"]["all"]
        self.assertEqual((c["rounds"], c["rounds_won"]), (2, 2))

    def test_a_league_section_is_never_added_to_the_pub_one(self):
        pm = self.pub.match()
        self.pub.player(pm, "Dual", 0, True, kills=5)
        lm = self.league.match(mode="scrim", team_a="Lions", team_b="Hyenas")
        self.league.player(lm, "Dual", 1, False, team="Hyenas", kills=9)
        self.run_export()
        doc = self.player("Dual")
        self.assertEqual(doc["pub"]["careers"]["all"]["kills"], 5)
        self.assertEqual(doc["league"]["careers"]["all"]["kills"], 9)
        self.assertEqual(doc["league"]["careers"]["scrim"]["last_team"],
                         "Hyenas")
        self.assertIsNone(doc["league"]["careers"]["league"])


class TestHistory(ExportCase):
    def test_a_private_players_score_is_their_own_freqs(self):
        m = self.pub.match(mode="private", score=(2, 5), winner=200)
        self.pub.player(m, "Cap", 200, True)
        self.run_export()
        h = rows(self.player("Cap")["pub"]["matches"])[0]
        self.assertEqual((h["result"], h["score_for"], h["score_against"]),
                         ("W", 5, 2))

    def test_newest_first_with_neobot_games_kept_apart(self):
        for start in (1.0, 2.0):
            m = self.pub.match(started=1760000000.0 + start)
            self.pub.player(m, "Ann", 1, False)
        self.pub.neobot_game(300, score=(1, 5), winner=1)
        self.pub.neobot_player(300, "Ann", 1, True, teamkills=None)
        self.pub.neobot_career("Ann", matches=1, wins=1)
        self.run_export()
        doc = self.player("Ann")["pub"]
        self.assertEqual([h["id"] for h in rows(doc["matches"])], [2, 1])
        old = rows(doc["neobot"])
        self.assertEqual((old[0]["id"], old[0]["result"],
                          old[0]["score_for"], old[0]["teamkills"]),
                         (300, "W", 5, None))

    def test_the_index_has_each_sections_first_match_earlier_games_included(self):
        m = self.pub.match()
        self.pub.player(m, "Ann", 0, True)
        self.pub.player(m, "Bob", 1, False)
        self.pub.neobot_game(300, score=(1, 5), winner=1)
        self.pub.neobot_player(300, "Ann", 1, True)
        self.pub.neobot_career("Ann", matches=1, wins=1)
        lm = self.league.match()
        self.league.player(lm, "Bob", 0, True)
        self.run_export()
        got = {p["name"]: (p["pub_first"], p["league_first"])
               for p in rows(self.load("players.json"))}
        self.assertEqual(got, {"Ann": (300, None), "Bob": (m, lm)})


class TestPrivacy(ExportCase):
    def test_only_the_bot_list_leaves_the_database(self):
        m = self.pub.match()
        self.pub.player(m, "Marv1", 0, True)
        self.pub.player(m, "Human", 1, False)
        for player, flag in (("Marv1", "bot"), ("Allowed", "allow"),
                             ("Human", "allow"),
                             ("Follower", "follow_private"),
                             ("Notified", "notify_private")):
            self.pub.add("bd_player_flags", arena="*", player=player,
                         flag=flag, set_by="SecretOp")
        self.pub.add("bd_settings", arena="bdeg", key="game_mode",
                     value="SecretSetting", updated_by="SecretOp")
        self.run_export()
        self.assertTrue(self.player("Marv1")["pub"]["bot"])
        self.assertFalse(self.player("Human")["pub"]["bot"])
        text = self.all_text()
        for secret in ("Allowed", "Follower", "Notified", "SecretOp",
                       "SecretSetting"):
            self.assertNotIn(secret, text)

    def test_the_league_excludes_by_pattern(self):
        m = self.league.match(mode="scrim")
        self.league.player(m, "Zero-EG-3", 0, True)
        self.league.player(m, "ZeroCool", 1, False)
        self.run_export(league_exclude=parse_exclude_list("Zero-EG-*"))
        self.assertTrue(self.player("Zero-EG-3")["league"]["bot"])
        self.assertFalse(self.player("ZeroCool")["league"]["bot"])


class TestMatches(ExportCase):
    def test_a_replay_link_only_when_it_is_published(self):
        a = self.league.match(mode="match", arena="bdl",
                              recording="bd202611011900")
        b = self.league.match(mode="match", arena="bdl",
                              recording="bd202611012000")
        for mid in (a, b):
            self.league.player(mid, "Ann", 0, True)
        self.run_export(replays={"bdl-bd202611011900": "bdl-bd202611011900"},
                        replay_site="https://example.test/")
        shard = self.load("m/league/0.json")
        self.assertEqual(shard[str(a)]["match"]["replay"],
                         "https://example.test/r/bdl-bd202611011900")
        self.assertIsNone(shard[str(b)]["match"]["replay"])

    def test_play_time_leaves_out_holds_and_gaps(self):
        m = self.pub.match(length=1000.0, held_seconds=100.0,
                           dead_seconds=50.0)
        self.pub.player(m, "Ann", 0, True)
        self.run_export()
        doc = self.load("m/pub/0.json")[str(m)]
        self.assertEqual(doc["match"]["played_seconds"], 850.0)

    def test_a_neobot_game_keeps_its_screen(self):
        self.pub.neobot_game(250)
        self.pub.neobot_player(250, "Ann", 0, True, kills=3)
        self.pub.neobot_career("Ann", matches=1, wins=1, kills=3)
        self.run_export()
        game = self.load("m/neobot/2.json")["250"]
        self.assertEqual(rows(game["lines"])[0]["player_name"], "Ann")
        self.assertEqual(self.load("meta.json")["neobot"]["first_id"], 250)


class TestRecords(ExportCase):
    def recs(self, section="pub"):
        return self.load("records/%s.json" % section)

    def test_a_tie_goes_to_whoever_set_it_first_and_bots_leave_people_lists(self):
        self.pub.add("bd_player_flags", arena="*", player="Marv1", flag="bot",
                     set_by="Op")
        for kills in (9, 12, 12):
            m = self.pub.match()
            self.pub.player(m, "Ann", 0, True, kills=kills)
        m = self.pub.match()
        self.pub.player(m, "Marv1", 1, False, kills=40)
        self.pub.player(m, "Bo", 0, True)          # a person: the match counts
        self.run_export()
        kills = self.recs()["kills"]
        self.assertEqual([(e["value"], e["match"]) for e in kills["all"]],
                         [(40, 4), (12, 2), (12, 3), (9, 1)])
        self.assertEqual([e["value"] for e in kills["people"]], [12, 12, 9])

    def test_only_a_match_somebody_won_and_not_a_marathon_holds_a_record(self):
        # The 0-0 game left running: no winner, no record.
        m = self.pub.match(score=(0, 0), winner=None, outcome="aborted", length=900)
        self.pub.player(m, "Ann", 0, False, kills=500)
        self.pub.round(m, 1, None, ended_by="abort", duration_s=880.0)
        # A won match of over two hours of play: its totals hold none.
        m = self.pub.match(length=3 * 3600)
        self.pub.player(m, "Bo", 0, True, kills=400)
        self.pub.neobot_game(300, seconds=4 * 3600)
        self.pub.neobot_player(300, "Old", 0, True, kills=300)
        self.pub.neobot_career("Old", matches=1, wins=1, kills=300)
        m = self.pub.match(length=600)
        self.pub.player(m, "Cy", 0, True, kills=20)
        self.run_export()
        r = self.recs()
        self.assertEqual([e["value"] for e in r["kills"]["all"]], [20])
        # Match records want a winner, but no cap on length.
        self.assertEqual([e["match"] for e in r["longest_match"]], [2, 3])
        self.assertEqual(r["longest_round"], [])

    def test_a_match_of_bots_alone_holds_no_record(self):
        self.pub.add("bd_player_flags", arena="*", player="Marv1", flag="bot", set_by="Op")
        self.pub.add("bd_player_flags", arena="*", player="Marv2", flag="bot", set_by="Op")
        m = self.pub.match(length=5000)                      # bots alone
        self.pub.player(m, "Marv1", 0, True, kills=90)
        self.pub.player(m, "Marv2", 1, False, kills=80)
        self.pub.round(m, 1, 1, score_a=0, score_b=3, duration_s=900.0)
        self.pub.round(m, 2, 0, score_a=5, score_b=3, duration_s=900.0)
        m2 = self.pub.match(winner=1)                        # a person there
        self.pub.player(m2, "Marv1", 0, False, kills=7)
        self.pub.player(m2, "Ann", 1, True, kills=5)
        m3 = self.pub.match()                                # bots alone again
        self.pub.player(m3, "Marv1", 0, True, kills=3)
        self.pub.player(m3, "Marv2", 1, False)
        m4 = self.pub.match()
        self.pub.player(m4, "Marv1", 0, True, kills=1)
        self.pub.player(m4, "Ann", 1, False)
        self.run_export()
        r = self.recs()
        self.assertEqual([(e["value"], e["match"]) for e in r["kills"]["all"]],
                         [(7, m2), (5, m2), (1, m4)])
        self.assertEqual([e["match"] for e in r["longest_match"]], [m2, m4])
        self.assertEqual(r["comeback"], [])
        # Marv1 lost m2 and won m4: m3, bots alone, is as if never played.
        runs = {e["key"]: (e["value"], e["from"]) for e in r["winning_run"]["all"]}
        self.assertEqual(runs[player_key("Marv1")], (1, m4))

    def test_what_the_earlier_matches_never_kept_comes_from_recent_ones(self):
        self.pub.neobot_game(300)
        self.pub.neobot_player(300, "Old", 0, True, kills=99)
        self.pub.neobot_career("Old", matches=1, wins=1, kills=99)
        m = self.pub.match()
        self.pub.player(m, "Ann", 0, True, kills=5, best_streak=4)
        self.run_export()
        r = self.recs()
        self.assertEqual([(e["value"], e["earlier"]) for e in r["kills"]["all"]],
                         [(99, True), (5, False)])
        self.assertEqual([e["key"] for e in r["best_streak"]["all"]],
                         [player_key("Ann")])
        self.assertEqual(r["safe_touches"]["all"], [])

    def test_a_no_result_neither_adds_to_a_winning_run_nor_ends_it(self):
        # As on the real database, the bot's matches are numbered after the
        # earlier games: play order is number order.
        self.pub.neobot_game(1, winner=0)
        self.pub.neobot_player(1, "Ann", 0, True)
        self.pub.neobot_career("Ann", matches=1, wins=1)
        for mid, winner, won, extra in ((11, 0, True, {"no_result": 1}),
                                        (12, None, False, {}),
                                        (13, 0, True, {}),
                                        (14, 1, False, {}),
                                        (15, 0, True, {})):
            m = self.pub.match(id=mid, winner=winner,
                               outcome="abandoned" if winner is None else "completed")
            self.pub.player(m, "Ann", 0, won, **extra)
        self.run_export()
        run = self.recs()["winning_run"]["all"]
        self.assertEqual([(e["value"], e["from"], e["to"]) for e in run],
                         [(2, 1, 13)])

    def test_a_comeback_is_the_furthest_the_winner_trailed(self):
        m = self.pub.match(score=(5, 3), winner=0)
        self.pub.player(m, "Ann", 0, True)
        for seq, (a, b) in enumerate([(0, 1), (0, 2), (1, 3), (2, 3), (5, 3)], 1):
            self.pub.round(m, seq, 0 if a > (b if seq == 1 else 0) else 1,
                           score_a=a, score_b=b)
        self.pub.round(m, 6, None, counted=0, ended_by="nextbase",
                       score_a=0, score_b=9)
        # An official's score is not play: this match is no comeback.
        m2 = self.pub.match(score=(5, 4), winner=0)
        self.pub.player(m2, "Ann", 0, True)
        self.pub.round(m2, 1, None, ended_by="setscore", score_a=0, score_b=4)
        self.pub.round(m2, 2, 0, score_a=5, score_b=4)
        self.run_export()
        c = self.recs()["comeback"]
        self.assertEqual([(e["value"], e["match"], e["low"], e["final"]) for e in c],
                         [(2, m, [1, 3], [5, 3])])
        self.assertEqual(c[0]["winner"], "Freq 0")

    def test_the_league_keeps_its_own_records_with_team_names(self):
        m = self.league.match(mode="match", team_a="Aliens", team_b="Bigfoot",
                              score=(3, 5), winner=1)
        self.league.player(m, "Ann", 0, False, kills=7)
        self.league.player(m, "Bo", 1, True, kills=3)
        self.pub.player(self.pub.match(), "Cy", 0, True, kills=50)
        self.run_export()
        self.assertEqual([e["value"] for e in self.recs("league")["kills"]["all"]], [7, 3])
        self.assertEqual(self.recs("league")["longest_match"][0]["winner"], "Bigfoot")


class TestMates(ExportCase):
    def test_teammates_and_rivals_by_button_people_only(self):
        self.pub.add("bd_player_flags", arena="*", player="Marv1", flag="bot", set_by="Op")
        k = player_key
        m = self.pub.match(winner=0)                     # Ann + Bo beat Cy (+ a bot)
        for name, freq, won in (("Ann", 0, True), ("Bo", 0, True), ("Cy", 1, False), ("Marv1", 1, False)):
            self.pub.player(m, name, freq, won)
        m = self.pub.match(mode="private", winner=200)   # Ann with Cy, lost to Bo
        for name, freq, won in (("Ann", 100, False), ("Cy", 100, False), ("Bo", 200, True)):
            self.pub.player(m, name, freq, won)
        m = self.pub.match(winner=None, outcome="aborted")   # nobody won: not counted
        self.pub.player(m, "Ann", 0, False)
        self.pub.player(m, "Bo", 0, False)
        self.pub.neobot_game(300, winner=1)              # earlier: Ann lost with Bo
        self.pub.neobot_player(300, "Ann", 0, False)
        self.pub.neobot_player(300, "Bo", 0, False)
        self.pub.neobot_career("Ann", matches=1)
        self.pub.neobot_career("Bo", matches=1)
        self.run_export()
        got = self.player("Ann")["pub"]["mates"]
        self.assertEqual(got["all"]["with"], [[k("Bo"), 2, 1, 1], [k("Cy"), 1, 0, 1]])
        self.assertEqual(got["all"]["against"], [[k("Bo"), 1, 0, 1], [k("Cy"), 1, 1, 0]])
        self.assertEqual(got["pub_all"]["with"], [[k("Bo"), 2, 1, 1]])
        self.assertEqual(got["private"], {"with": [[k("Cy"), 1, 0, 1]],
                                          "against": [[k("Bo"), 1, 0, 1]]})
        self.assertNotIn("hard", got)


class TestRoundFacts(ExportCase):
    def test_rounds_by_base_with_the_side_that_won_and_no_bots_alone(self):
        self.pub.add("bd_player_flags", arena="*", player="Marv1", flag="bot", set_by="Op")
        m = self.pub.match(mode="private", score=(1, 1), winner=None, outcome="aborted")
        self.pub.player(m, "Ann", 100, False)
        self.pub.round(m, 1, 200, base_num=7, ended_by="wipe", duration_s=90.0)
        self.pub.round(m, 2, None, counted=0, base_num=4, ended_by="nextbase")
        self.pub.round(m, 3, 100, base_num=4, ended_by="touch")
        m2 = self.pub.match()                          # bots alone: left out
        self.pub.player(m2, "Marv1", 0, True)
        self.pub.round(m2, 1, 0, base_num=7)
        self.run_export()
        got = rows(self.load("rounds/pub.json"))
        self.assertEqual([(r["match"], r["base"], r["side"], r["ended_by"], r["counted"]) for r in got],
                         [(m, 7, "b", "wipe", 1), (m, 4, None, "nextbase", 0), (m, 4, "a", "touch", 1)])


class TestInsights(ExportCase):
    def test_sides_people_and_bots_from_matches_a_person_played(self):
        self.pub.add("bd_player_flags", arena="*", player="Marv1", flag="bot", set_by="Op")
        self.pub.add("bd_player_flags", arena="*", player="Marv2", flag="bot", set_by="Op")
        # Earlier: Ann alone on freq 0 against a bot, won by freq 0 (gap +1,
        # people beat a team of bots); a game of bots alone, left out.
        self.pub.neobot_game(300, winner=0)
        self.pub.neobot_player(300, "Ann", 0, True, kills=6, deaths=2, active_time=600.0)
        self.pub.neobot_player(300, "Marv1", 1, False, kills=2, deaths=6, active_time=600.0)
        self.pub.neobot_game(1400, winner=1)
        self.pub.neobot_player(1400, "Marv1", 0, False)
        self.pub.neobot_player(1400, "Marv2", 1, True)
        # Today: a person each side, freq 1 wins (gap 0); a hard-mode match
        # on freq 0 lost 1-5; a private match won by 100.
        m = self.pub.match(winner=1, score=(2, 5))
        self.pub.player(m, "Ann", 0, False)
        self.pub.player(m, "Bob", 1, True)
        h = self.pub.match(winner=1, score=(1, 5), game_mode="hard", game_mode_freq=0)
        self.pub.player(h, "Ann", 0, False)
        self.pub.player(h, "Marv1", 0, False)
        self.pub.player(h, "Marv2", 1, True)
        p = self.pub.match(mode="private", winner=100, score=(5, 0))
        self.pub.player(p, "Ann", 100, True)
        self.pub.player(p, "Bob", 200, False)
        self.run_export()
        got = self.load("insights.json")
        self.assertEqual(got["sides"], {"earlier": [1, 1], "pub": [2, 0], "private": [1, 1],
                                        "league": [0, 0]})
        self.assertEqual(got["eras"], [[300, 300, 1, 1], [m, h, 2, 0]])
        self.assertEqual(dict((g, (n, w)) for g, n, w in got["gap"]["earlier"] if n), {1: (1, 1)})
        self.assertEqual(dict((g, (n, w)) for g, n, w in got["gap"]["pub"] if n), {0: (1, 0), 1: (1, 0)})
        self.assertEqual(got["more"], {"earlier": [1, 1, 0], "pub": [2, 1, 0]})
        self.assertEqual(got["vs_bots"], {"earlier": [1, 1], "pub": [1, 0]})
        self.assertEqual(got["play"]["earlier"], {"people": [6, 2, 600.0], "bots": [2, 6, 600.0]})
        self.assertEqual({k: got["hard"][k] for k in ("matches", "decided", "team_won", "team_points", "other_points")},
                         {"matches": 1, "decided": 1, "team_won": 0, "team_points": 1, "other_points": 5})


class TestWriter(ExportCase):
    def test_a_second_run_changes_nothing_and_keeps_the_build_time(self):
        m = self.pub.match()
        self.pub.player(m, "Ann", 0, True)
        first = self.run_export(now=1000)
        second = self.run_export(now=2000)
        self.assertGreater(first["changed"], 0)
        self.assertEqual(second["changed"], 0)
        self.assertEqual(self.load("meta.json")["built"], 1000)
        self.pub.player(m, "Bob", 1, False)
        self.run_export(now=3000)
        self.assertEqual(self.load("meta.json")["built"], 3000)

    def test_a_file_nothing_produced_is_removed(self):
        m = self.pub.match()
        self.pub.player(m, "Ann", 0, True)
        self.run_export()
        stray = os.path.join(self.out, "p", "0000000000.json")
        with open(stray, "w") as f:
            f.write("{}")
        got = self.run_export()
        self.assertEqual(got["removed"], 1)
        self.assertFalse(os.path.exists(stray))

    def test_files_past_the_limits_stop_the_export(self):
        w = ex.Writer(self.out)
        old = ex.MAX_FILE_BYTES
        ex.MAX_FILE_BYTES = 10
        try:
            with self.assertRaises(ex.ExportError):
                w.json("big.json", {"x": "y" * 20})
        finally:
            ex.MAX_FILE_BYTES = old
        old = ex.MAX_FILES
        ex.MAX_FILES = 1
        try:
            w.json("a.json", 1)
            w.json("b.json", 2)
            with self.assertRaises(ex.ExportError):
                w.finish()
        finally:
            ex.MAX_FILES = old


class TestRules(unittest.TestCase):
    def test_names_fold_as_sqlite_does(self):
        self.assertEqual(fold("GoLdEn Knight"), "golden knight")
        self.assertEqual(fold("ÉLAN"), "Élan")
        self.assertEqual(player_key("Ann"), player_key("ANN"))

    def test_glob_is_sqlite_glob(self):
        self.assertTrue(glob_match("zero-eg-*", "Zero-EG-12"))
        self.assertFalse(glob_match("zero-eg-?", "Zero-EG-12"))
        self.assertTrue(glob_match("marv[^x]", "Marv1"))
        self.assertFalse(glob_match("marv[^x]", "Marvx"))

    def test_rating_and_result(self):
        self.assertEqual(rating(10, 2, 3), 2.0)
        self.assertEqual(rating(0, None, 0), 0.0)
        self.assertEqual(result(None, 1, 0), "-")
        self.assertEqual(result(0, 1, 1), "N")
        self.assertEqual(result(0, 1, 0), "W")
        self.assertEqual(result(0, 0, 0), "L")


class TestSnapshot(unittest.TestCase):
    def test_a_snapshot_is_one_checked_file(self):
        tmp = tempfile.mkdtemp()
        try:
            src = FixtureDB(os.path.join(tmp, "src.db"), "pub")
            src.conn.execute("PRAGMA journal_mode=WAL")
            src.match()
            dst = snapshot(src.path, os.path.join(tmp, "copy.db"))
            src.close()
            self.assertFalse(os.path.exists(dst + "-wal"))
            conn = open_snapshot(dst)
            self.assertEqual(conn.execute(
                "SELECT COUNT(*) FROM bd_matches").fetchone()[0], 1)
            conn.close()
        finally:
            shutil.rmtree(tmp)


if __name__ == "__main__":
    unittest.main()
