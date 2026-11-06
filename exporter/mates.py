"""
Teammates and rivals on a player's page: the people they played most with
(on the same freq) and against (on the other), and their record in those
matches, worked out here because the earlier games' rosters never reach the
browser.

For each of the page's buttons, so the lists follow the one pressed:
  pub     all (every pub arena match), pub_all (pub matches, earlier ones
          too), private, hard
  league  all, league, scrim, pickup
Only matches somebody won count, as in a career; the record is the player's
own result (W, L, and N for no result, which is in the count but neither).
People only: the section's bot list is left out, or every pub page would list
the same Marvs. A player who changed freq in an earlier game is on the freq
of their merged row, the one they played longest, as everywhere.
"""
import heapq

from exporter.rules import fold, result

TOP = 10


def own_scopes(section, m):
    """The page's buttons a match of the bot's own counts under."""
    if section.name == "league":
        return ("all", {"match": "league", "scrim": "scrim",
                        "pickup": "pickup"}.get(m["mode"]))
    out = ["all"]
    if m["mode"] == "pub":
        out.append("pub_all")
        if m.get("game_mode") == "hard":
            out.append("hard")
    elif m["mode"] == "private":
        out.append("private")
    return out


EARLIER_SCOPES = ("all", "pub_all")


def mates(section, lname, keys, earlier_rows=(), earlier_rosters=None):
    """{scope: {"with": [[key, matches, wins, losses], ...], "against": [...]}}
    for one player, the TOP of each, most matches first, then by name."""
    tally = {}

    def add(scopes, mine, res, roster):
        for q in roster:
            other = fold(q["player_name"])
            if other == lname or section.is_bot(other):
                continue
            side = "with" if q["freq"] == mine else "against"
            for sc in scopes:
                if sc is None:
                    continue
                t = tally.setdefault(sc, {"with": {}, "against": {}})[side]
                n = t.setdefault(other, [0, 0, 0])
                n[0] += 1
                n[1] += res == "W"
                n[2] += res == "L"

    for p in section.players_by_lname.get(lname, ()):
        m = section.match_by_id[p["match_id"]]
        if m["winner_freq"] is None:
            continue
        add(own_scopes(section, m), p["freq"],
            result(m["winner_freq"], p["is_winner"], p["no_result"]),
            section.players_by_match[m["id"]])
    for h in earlier_rows:
        if h["result"] != "-":
            add(EARLIER_SCOPES, h["freq"], h["result"], earlier_rosters[h["id"]])

    return {sc: {side: [[keys[q], n, w, l] for q, (n, w, l) in heapq.nsmallest(
                TOP, d.items(), key=lambda kv: (-kv[1][0], kv[0]))]
                 for side, d in sides.items()}
            for sc, sides in tally.items()}
