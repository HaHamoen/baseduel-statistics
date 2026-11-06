"""
The records page: the best single performances on record, worked out here
once, so the browser never loads 23,772 earlier games to find them.

Each list is the best TOP of one kind, best first; a tie goes to whoever set
it first (the lower match number). The lists about players come twice:
everyone, and people only (the section's bot list left out), as the
leaderboards' bot switch has it.

No record is a figure the bots print. Each is the largest of a stored
number, by the rule written beside it, and nothing is made up: a figure the
earlier matches never recorded (streaks, touches, rounds, dates) comes from
the bot's own matches only, and the page says so.

Only a match somebody won holds a record, as only such a match counts in a
career (the user, 2026-11-05: the most kills had come from a 0-0 game left
running for five and a half hours). A player's figure in one match also
needs the match to have lasted no more than LONGEST: the earlier era has
marathons (a 100-62 game of nearly eleven hours) and broken lengths (one of
sixteen days), and a total grows with the time played.

And a match counts only if a person played in it (the user, 2026-11-05): one
of bots alone (the section's bot list) holds no record of any kind, and to a
bot's winning run it is as if it was never played.
"""
import heapq

from exporter.rules import fold, freqs_of, match_seconds, result

TOP = 10

# The longest match a player's figure in one match counts from, in seconds
# of play: about the bots' longest match today. 65 of the 23,097 earlier
# games with a winner ran longer.
LONGEST = 2 * 3600

# One player in one match, by the stored figure. True: the earlier matches
# recorded it too (their merged row, the player's whole game).
PLAYER_RECORDS = (
    ("kills", True),
    ("dmg_given", True),
    ("best_streak", False),
    ("safe_touches", False),
)


def best(entries, value="value", order="match"):
    """The TOP highest, a tie to the earlier one."""
    return heapq.nsmallest(TOP, entries, key=lambda e: (-e[value], e[order]))


def winner_label(section, m, fa):
    """The winning team as the match page names it: the league's team names,
    else the freq."""
    if m["winner_freq"] is None:
        return None
    if section.name == "league":
        return m["team_a"] if m["winner_freq"] == fa else m["team_b"]
    return "Freq %d" % m["winner_freq"]


def with_people(section):
    """(the bot's match ids, the earlier games' ids) that a person played in."""
    own = {p["match_id"] for p in section.players
           if not section.is_bot(fold(p["player_name"]))}
    earlier = {p["match_id"] for p in section.neobot_players
               if not section.is_bot(fold(p["player_name"]))}
    return own, earlier


def player_rows(section):
    """(lname, match id, started_at or None, earlier?, row, winner freq,
    seconds of play) for every player in every match a person played in:
    the bot's rows, then the earlier games' merged rows."""
    own, earlier = with_people(section)
    games = {g["neobot_id"]: g for g in section.neobot_matches}
    for p in section.players:
        m = section.match_by_id[p["match_id"]]
        if m["id"] in own:
            yield (fold(p["player_name"]), m["id"], m.get("started_at"), False,
                   p, m["winner_freq"], match_seconds(m))
    for p in section.neobot_players:
        if p["match_id"] in earlier:
            g = games[p["match_id"]]
            yield (fold(p["player_name"]), p["match_id"], None, True, p,
                   g["winner_freq"], g["active_seconds"] or 0)


def player_records(section, keys):
    out = {}
    for stat, earlier_too in PLAYER_RECORDS:
        def entries(people_only):
            for lname, mid, at, earlier, p, winner, secs in player_rows(section):
                if earlier and not earlier_too:
                    continue
                if winner is None or secs > LONGEST:
                    continue
                if people_only and section.is_bot(lname):
                    continue
                v = p.get(stat)
                if v:
                    yield {"key": keys[lname], "value": v, "match": mid,
                           "at": at, "earlier": earlier}
        out[stat] = {"all": best(entries(False)), "people": best(entries(True))}
    return out


def winning_runs(section, keys):
    """Each player's longest run of wins in the order played (match numbers
    run in that order, the earlier matches first). A no result, or a match
    nobody won, neither adds to a run nor ends it: it counts for nobody."""
    played = {}
    for lname, mid, at, _earlier, p, winner, _secs in player_rows(section):
        played.setdefault(lname, []).append(
            (mid, at, result(winner, p["is_winner"], p.get("no_result"))))
    runs = []
    for lname, rows in played.items():
        rows.sort(key=lambda t: t[0])
        top, cur, start = None, 0, None
        for mid, at, r in rows:
            if r == "W":
                cur, start = cur + 1, start if cur else mid
                if top is None or cur > top["value"]:
                    top = {"key": keys[lname], "lname": lname, "value": cur,
                           "from": start, "to": mid, "at": at}
            elif r == "L":
                cur = 0
        if top:
            runs.append(top)
    strip = lambda rs: [{k: v for k, v in r.items() if k != "lname"} for r in rs]
    return {"all": strip(best(runs, order="to")),
            "people": strip(best((r for r in runs
                                  if not section.is_bot(r["lname"])), order="to"))}


def match_records(section):
    """Records of whole matches and rounds, from the bot's own matches with
    a winner: the earlier ones recorded no length, no rounds and no round
    scores."""
    longest, most_rounds, comebacks, long_rounds = [], [], [], []
    people, _earlier = with_people(section)
    for m in section.matches:
        mid = m["id"]
        if m["winner_freq"] is None or mid not in people:
            continue
        fa, _fb = freqs_of(m["mode"], section.players_by_match.get(mid, []))
        winner = winner_label(section, m, fa)
        won_a = m["winner_freq"] == fa
        # The final score, the winner's first ("won 10-8"): a league team's
        # name does not say which side of "3-5" it was.
        final = ([m["score_b"], m["score_a"]] if m["winner_freq"] is not None
                 and not won_a else [m["score_a"], m["score_b"]])
        base = {"match": mid, "at": m.get("started_at"), "winner": winner,
                "final": final}
        secs = match_seconds(m)
        if secs > 0:
            longest.append(dict(base, value=round(secs)))
        if m["rounds_counted"]:
            most_rounds.append(dict(base, value=m["rounds_counted"]))
        counted = [r for r in section.rounds_by_match.get(mid, [])
                   if r["counted"]]
        for r in counted:
            if r.get("duration_s"):
                long_rounds.append(dict(
                    base, value=round(r["duration_s"]),
                    round="R%d%s" % (r["round_no"], "" if r["attempt"] == 1
                                     else ".%d" % r["attempt"]),
                    base_num=r.get("base_num"),
                    won_by=(None if r["winner_freq"] is None else
                            winner_label(section, dict(m, winner_freq=r["winner_freq"]), fa)),
                    seq=r["seq"]))
        # The furthest behind the eventual winner ever was, by the score
        # after each counted round, and the latest such score (the pub bot's
        # final card tells its story the same way). A score an official set
        # is not play, so a match with one is left out.
        if any(r["ended_by"] == "setscore" for r in section.rounds_by_match.get(mid, [])):
            continue
        worst, low = 0, None
        for r in counted:
            mine, theirs = ((r["score_a"], r["score_b"]) if won_a
                            else (r["score_b"], r["score_a"]))
            if theirs - mine > 0 and theirs - mine >= worst:
                worst, low = theirs - mine, [mine, theirs]
        if worst:
            comebacks.append(dict(base, value=worst, low=low))
    return {"longest_match": best(longest), "most_rounds": best(most_rounds),
            "comeback": best(comebacks),
            "longest_round": [{k: v for k, v in e.items() if k != "seq"}
                              for e in heapq.nsmallest(
                                  TOP, long_rounds,
                                  key=lambda e: (-e["value"], e["match"], e["seq"]))]}


def section_records(section, keys):
    """records/<section>.json."""
    out = player_records(section, keys)
    out["winning_run"] = winning_runs(section, keys)
    out.update(match_records(section))
    return {"top": TOP, **out}
