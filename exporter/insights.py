"""
The insights page: what the matches say about the game as a whole. Worked out
here, as the records are, because the earlier games' 290,000 player rows never
reach the browser.

The rules, as everywhere on the site:
- a match counts only if a person played in it (the section's bot list);
- a share of wins is of the matches somebody won;
- the people on a freq are its rows that are not bots, one a player: someone
  who changed freq counts for the one they played longest, as on every board.

The pub arena's numbers are its pub matches, freqs 0 and 1: the earlier games,
then the bot's own. A private match's 100 and 200 are a line of their own,
and the league's freq 0 and 1 another.
"""
from exporter.records import with_people
from exporter.rules import fold

# Earlier games a point on the sides chart, by match number.
BLOCK = 1000
# The people gap runs -GAP..GAP; the ends take anything past them.
GAP = 3


def pub_games(section):
    """(id, era, winner freq, people on freq 0, people on freq 1) for every
    pub match a person played in, in the order played: the earlier games,
    then the bot's own pub matches."""
    own, earlier = with_people(section)

    def people(rows, ids):
        count = {}
        for p in rows:
            if p["match_id"] in ids and not section.is_bot(fold(p["player_name"])):
                c = count.setdefault(p["match_id"], [0, 0])
                if p["freq"] in (0, 1):
                    c[p["freq"]] += 1
        return count

    old = people(section.neobot_players, earlier)
    for g in section.neobot_matches:
        if g["neobot_id"] in earlier:
            yield (g["neobot_id"], "earlier", g["winner_freq"]) + tuple(old[g["neobot_id"]])
    new = people(section.players, own)
    for m in section.matches:
        if m["id"] in own and m["mode"] == "pub":
            yield (m["id"], "pub", m["winner_freq"]) + tuple(new[m["id"]])


def sides(decided):
    """[matches somebody won, of them won by the lower freq]."""
    return [len(decided), sum(1 for w in decided if w == "low")]


def eras_chart(games):
    """Freq 0's wins over time: a point per BLOCK earlier games by number,
    then the bot's own pub matches as one. [first id, last id, decided,
    freq 0 won]."""
    points = {}
    for gid, era, w, _c0, _c1 in games:
        if w is None:
            continue
        key = ("earlier", gid // BLOCK) if era == "earlier" else ("pub", 0)
        p = points.setdefault(key, [gid, gid, 0, 0])
        p[0], p[1] = min(p[0], gid), max(p[1], gid)
        p[2] += 1
        p[3] += w == 0
    return [points[k] for k in sorted(points, key=lambda k: (k[0] != "earlier", k[1]))]


def insights(pub, league):
    games = list(pub_games(pub))
    by_era = {"earlier": [g for g in games if g[1] == "earlier"],
              "pub": [g for g in games if g[1] == "pub"]}
    out = {"eras": eras_chart(games), "block": BLOCK, "gap_max": GAP}

    # ---- freq 0 against freq 1 ----
    def low_high(section, modes, low):
        own, _earlier = with_people(section)
        return sides(["low" if m["winner_freq"] == low else "high" for m in section.matches
                      if m["id"] in own and (modes is None or m["mode"] in modes)
                      and m["winner_freq"] is not None])
    out["sides"] = {
        era: sides(["low" if g[2] == 0 else "high" for g in by_era[era] if g[2] is not None])
        for era in by_era}
    out["sides"]["private"] = low_high(pub, ("private",), 100)
    out["sides"]["league"] = low_high(league, None, 0)

    # ---- the people on each team ----
    # gap: [gap, decided, freq 0 won]; more: [decided, freq 0 had more
    # people, freq 1 had more].
    out["gap"], out["more"] = {}, {}
    for era, gs in by_era.items():
        decided = [g for g in gs if g[2] is not None]
        lines = {k: [k, 0, 0] for k in range(-GAP, GAP + 1)}
        for _gid, _era, w, c0, c1 in decided:
            line = lines[max(-GAP, min(GAP, c0 - c1))]
            line[1] += 1
            line[2] += w == 0
        out["gap"][era] = [lines[k] for k in sorted(lines)]
        out["more"][era] = [len(decided), sum(1 for g in decided if g[3] > g[4]),
                            sum(1 for g in decided if g[3] < g[4])]

    # ---- people against a team of bots alone: [decided, people won] ----
    out["vs_bots"] = {}
    for era, gs in by_era.items():
        lone = [g for g in gs if g[2] is not None and (g[3] == 0) != (g[4] == 0)]
        out["vs_bots"][era] = [len(lone), sum(1 for g in lone if (g[2] == 0) == (g[3] > 0))]

    # ---- how bots and people play: kills, deaths, field time ----
    out["play"] = {}
    for era, rows in (("earlier", pub.neobot_players), ("pub", pub.players)):
        ids = {g[0] for g in by_era[era]}
        tally = {"people": [0, 0, 0.0], "bots": [0, 0, 0.0]}
        for p in rows:
            if p["match_id"] in ids:
                t = tally["bots" if pub.is_bot(fold(p["player_name"])) else "people"]
                t[0] += p["kills"] or 0
                t[1] += p["deaths"] or 0
                t[2] += p["active_time"] or 0.0
        out["play"][era] = tally

    # ---- hard mode: the starter's team against the other ----
    own, _earlier = with_people(pub)
    hard = [m for m in pub.matches
            if m.get("game_mode") == "hard" and m["mode"] == "pub" and m["id"] in own]
    won = [m for m in hard if m["winner_freq"] is not None]
    team = lambda m: m["score_a"] if m["game_mode_freq"] == 0 else m["score_b"]
    other = lambda m: m["score_b"] if m["game_mode_freq"] == 0 else m["score_a"]
    out["hard"] = {
        "matches": len(hard), "decided": len(won),
        "team_won": sum(1 for m in won if m["winner_freq"] == m["game_mode_freq"]),
        "ended_early": sum(1 for m in hard if m.get("game_mode_until") is not None),
        "team_points": sum(team(m) for m in hard), "other_points": sum(other(m) for m in hard),
        "first": hard[0]["started_at"] if hard else None,
    }
    return out
