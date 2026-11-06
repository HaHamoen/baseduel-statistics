"""
Ratings (Phase 4; the user's choice, 2026-11-06: Weng-Lin, people only).

Every match somebody won is replayed in the order played, and after each one
the players' ratings move: up for a win, down for a loss, by more when the
other team was stronger. tools/ratings-study/ is how the method was chosen:
each candidate predicted every match before seeing it.

THE RULES:
- People only. The section's bot list is never rated and never counts in a
  team's strength: rating bots too made the predictions worse than always
  guessing freq 0. A team of bots alone is a fixed yardstick, skill 0.
- A match counts only if somebody won it, and a player in it only with a
  win or a loss: a no result neither moves a rating nor counts in a team.
- Each player moves by their own result, as their record has it: one who
  left a team that went on to win has a loss, and moves as a loser.
- The order is the order played: the earlier games by number, then the
  bot's own. The pub arena and the league are rated apart.
- Someone listed twice in one match (league #22, a recording fault: the same
  row on both teams) counts for neither team in it.

The model is Weng and Lin's (2011) Bradley-Terry update for two teams, as
OpenSkill has it: each player a skill MU and an uncertainty SIGMA, a team the
average of its players'. What is shown is a cautious figure, the skill less
twice the uncertainty, on a scale where everyone starts at START: a few lucky
wins cannot put a newcomer at the top, and no minimum of matches is needed.
"""
import math

from exporter.rules import fold, freqs_of

MU, SIGMA = 25.0, 25.0 / 3
# How much one match says: the pub is noisy, and of 25/6 (OpenSkill's) to 50
# the study's best was 25.
BETA = 25.0
# A skill can change: each match widens the uncertainty this much first.
TAU = 25.0 / 300
KAPPA = 1e-4
# The number on the site: START for a newcomer, STEP points a unit of the
# cautious skill. Display only: neither moves anyone's place. At 1000 and 10
# the pub's weakest went below zero (-748); at 1500 and 5 it runs from about
# 600 to 2200 and nobody does.
START = 1500
STEP = 5


def shown(mu, sigma):
    return round(START + STEP * ((mu - 2 * sigma) - (MU - 2 * SIGMA)))


def decided_games(section):
    """(match id, [(lname, side, won)]) for every match somebody won, in the
    order played; people with a win or a loss only. Side "a" is the lower
    freq: 0, or 100 in a private match. Each player moves by their own
    result, so which side won is not needed here."""
    earlier = {}
    for p in section.neobot_players:
        earlier.setdefault(p["match_id"], []).append(p)

    def people(rows, fa, fb):
        out = []
        for p in rows:
            lname = fold(p["player_name"])
            if p["no_result"] or section.is_bot(lname) or p["freq"] not in (fa, fb):
                continue
            out.append((lname, "a" if p["freq"] == fa else "b", bool(p["is_winner"])))
        twice = {l for l in (o[0] for o in out) if sum(1 for o in out if o[0] == l) > 1}
        return [o for o in out if o[0] not in twice]

    for g in section.neobot_matches:
        if g["winner_freq"] is not None:
            yield g["neobot_id"], people(earlier.get(g["neobot_id"], ()), 0, 1)
    for m in section.matches:
        if m["winner_freq"] is not None:
            rows = section.players_by_match.get(m["id"], [])
            yield m["id"], people(rows, *freqs_of(m["mode"], rows))


def rate(section):
    """{lname: {"mu", "sigma", "matches", "wins", "history": [[id, shown]]}}."""
    mu, var, out = {}, {}, {}
    for mid, ps in decided_games(section):
        if not ps:
            continue
        for lname, _side, _won in ps:
            mu.setdefault(lname, MU)
            var[lname] = var.get(lname, SIGMA * SIGMA) + TAU * TAU
        team = {}
        for side in "ab":
            mem = [p for p in ps if p[1] == side]
            k = max(1, len(mem))
            team[side] = (sum(mu[p[0]] for p in mem) / k,
                          sum(var[p[0]] for p in mem) / k)
        c = math.sqrt(team["a"][1] + team["b"][1] + 2 * BETA * BETA)
        p_a = 1.0 / (1.0 + math.exp(-(team["a"][0] - team["b"][0]) / c))
        for lname, side, won in ps:
            var_t = team[side][1]
            p = p_a if side == "a" else 1.0 - p_a
            gamma = math.sqrt(var_t) / c
            delta = gamma * var_t / (c * c) * p * (1.0 - p)
            share = var[lname] / var_t
            mu[lname] += share * var_t / c * ((1.0 if won else 0.0) - p)
            var[lname] *= max(1.0 - share * delta, KAPPA)
        # Shown only once the whole match has moved everyone.
        for lname, _side, won in ps:
            r = out.setdefault(lname, {"matches": 0, "wins": 0, "history": []})
            r["matches"] += 1
            r["wins"] += won
            r["history"].append([mid, shown(mu[lname], math.sqrt(var[lname]))])
    for lname, r in out.items():
        r["mu"], r["sigma"] = mu[lname], math.sqrt(var[lname])
        r["rating"] = r["history"][-1][1]
    return out


def ranked(rated):
    """lnames best first: the shown rating, then the skill, then the name."""
    return sorted(rated, key=lambda l: (-rated[l]["rating"], -rated[l]["mu"], l))


def board(rated, keys):
    """ratings/<section>.json: everyone rated, best first."""
    rows = [[keys[l], rated[l]["rating"], rated[l]["matches"], rated[l]["wins"],
             round(rated[l]["mu"], 3), round(rated[l]["sigma"], 3)]
            for l in ranked(rated) if l in keys]
    return {"cols": ["key", "rating", "matches", "wins", "mu", "sigma"], "rows": rows,
            "start": START}


def player(rated, order, lname):
    """A player's rating for their page, or None if they have none."""
    r = rated.get(lname)
    if r is None:
        return None
    return {"rating": r["rating"], "rank": order[lname], "of": len(order),
            "matches": r["matches"], "wins": r["wins"], "start": START,
            "history": r["history"]}
