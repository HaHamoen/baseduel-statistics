"""
Which rating predicts the next match best? Replays every decided match in
play order; before each, a method gives P(side a wins); after it, ratings
move. Scored on later matches only (the first part warms the ratings up).

    python3 compare.py PUBDB LEAGUEDB
"""
import math
import sqlite3
import sys
from collections import defaultdict


def load(pub_path, league_path):
    pub = sqlite3.connect("file:%s?mode=ro&immutable=1" % pub_path, uri=True)
    bots = {r[0].lower() for r in pub.execute(
        "SELECT player FROM bd_player_flags WHERE flag='bot' AND arena='*'")}
    games = []   # (era, id, winner side, [(name, side, result, seconds)])

    def add(era, rows, winners, low_of):
        by = defaultdict(list)
        for mid, name, freq, win, nr, secs in rows:
            by[mid].append((name.lower(), freq, win, nr, secs or 0.0))
        for mid in sorted(by):
            w = winners.get(mid)
            if w is None:
                continue
            low = low_of(mid)
            ps = [(n, "a" if f == low else "b", None if nr else ("W" if win else "L"), s)
                  for n, f, win, nr, s in by[mid]]
            games.append((era, mid, "a" if w == low else "b", ps))

    win = dict(pub.execute("SELECT neobot_id, winner_freq FROM neobot_matches"))
    add("earlier", pub.execute("SELECT match_id, player_name, freq, is_winner, no_result, active_time FROM neobot_players"),
        win, lambda m: 0)
    modes = dict(pub.execute("SELECT id, mode FROM bd_matches"))
    win = dict(pub.execute("SELECT id, winner_freq FROM bd_matches"))
    add("pub", pub.execute("SELECT match_id, player_name, freq, is_winner, no_result, active_time FROM bd_match_players"),
        win, lambda m: 100 if modes[m] == "private" else 0)
    lg = sqlite3.connect("file:%s?mode=ro&immutable=1" % league_path, uri=True)
    league = []
    win = dict(lg.execute("SELECT id, winner_freq FROM bd_matches"))
    rows = lg.execute("SELECT match_id, player_name, freq, is_winner, no_result, active_time FROM bd_match_players")
    keep = games
    games = league
    add("league", rows, win, lambda m: 0)
    games = keep
    return games, league, bots


# ---- methods: predict(ps) -> P(a wins); update(ps, winner) ----

class Constant:
    """Always the running share of side a's wins: the bar to beat."""
    name = "baseline: freq 0's usual rate"

    def __init__(self):
        self.a, self.n = 1, 2

    def predict(self, ps):
        return self.a / self.n

    def update(self, ps, w):
        self.a += w == "a"
        self.n += 1


class Elo:
    def __init__(self, k, team="mean", scale=400.0):
        self.k, self.team, self.scale = k, team, scale
        self.r = defaultdict(lambda: 1500.0)
        self.name = "Elo, K=%g, team %s" % (k, team)

    def strength(self, ps, side):
        rs = [self.r[n] - 1500.0 for n, s, res, _ in ps if s == side and res]
        if not rs:
            return 0.0
        return sum(rs) / len(rs) if self.team == "mean" else sum(rs)

    def predict(self, ps):
        d = self.strength(ps, "a") - self.strength(ps, "b")
        return 1.0 / (1.0 + 10 ** (-d / self.scale))

    def update(self, ps, w):
        pa = self.predict(ps)
        for n, s, res, _ in ps:
            if res is None:
                continue
            e = pa if s == "a" else 1.0 - pa
            self.r[n] += self.k * ((res == "W") - e)


class WengLin:
    """Weng & Lin (2011), Bradley-Terry, two teams, as OpenSkill does it:
    each player a skill mu and an uncertainty sigma; a team is the sum."""

    def __init__(self, mu=25.0, sigma=25.0 / 3, beta=25.0 / 6, tau=25.0 / 300, kappa=1e-4, team="sum"):
        self.mu0, self.s0, self.beta, self.tau, self.kappa, self.team = mu, sigma, beta, tau, kappa, team
        self.mu = defaultdict(lambda: mu)
        self.var = defaultdict(lambda: sigma * sigma)
        self.name = "Weng-Lin, tau=%.3g, team %s" % (tau, team)

    def sides(self, ps):
        out = {}
        for side in "ab":
            mem = [n for n, s, res, _ in ps if s == side and res]
            if self.team == "sum":
                out[side] = (sum(self.mu[n] for n in mem), sum(self.var[n] for n in mem), mem)
            else:
                k = max(1, len(mem))
                out[side] = (sum(self.mu[n] for n in mem) / k, sum(self.var[n] for n in mem) / k, mem)
        return out

    def predict(self, ps):
        t = self.sides(ps)
        c = math.sqrt(t["a"][1] + t["b"][1] + 2 * self.beta ** 2)
        return 1.0 / (1.0 + math.exp(-(t["a"][0] - t["b"][0]) / c))

    def update(self, ps, w):
        for n, s, res, _ in ps:
            if res:
                self.var[n] = self.var[n] + self.tau ** 2
        t = self.sides(ps)
        c = math.sqrt(t["a"][1] + t["b"][1] + 2 * self.beta ** 2)
        pa = 1.0 / (1.0 + math.exp(-(t["a"][0] - t["b"][0]) / c))
        res_of = {n: res for n, s, res, _ in ps}
        for side, p in (("a", pa), ("b", 1.0 - pa)):
            mu_t, var_t, mem = t[side]
            if not mem or var_t <= 0:
                continue
            gamma = math.sqrt(var_t) / c
            delta = gamma * var_t / (c * c) * p * (1.0 - p)
            for n in mem:
                share = self.var[n] / var_t
                score = 1.0 if res_of[n] == "W" else 0.0
                self.mu[n] += share * var_t / c * (score - p)
                self.var[n] *= max(1.0 - share * delta, self.kappa)


def run(games, methods, scored):
    """Log-loss, Brier and accuracy over the scored matches."""
    out = {}
    for m in methods:
        ll = br = hit = n = 0.0
        for i, (era, mid, w, ps) in enumerate(games):
            p = min(max(m.predict(ps), 1e-6), 1 - 1e-6)
            if scored(i, era, mid):
                y = 1.0 if w == "a" else 0.0
                ll += -(y * math.log(p) + (1 - y) * math.log(1 - p))
                br += (p - y) ** 2
                hit += (p > 0.5) == (y == 1.0)
                n += 1
            m.update(ps, w)
        out[m.name] = (ll / n, br / n, hit / n, int(n))
    return out


def methods():
    return ([Constant()]
            + [Elo(k, t) for t in ("mean", "sum") for k in (8, 16, 32)]
            + [WengLin(tau=t, team=team) for team in ("sum", "mean") for t in (25.0 / 300, 25.0 / 100)])


if __name__ == "__main__":
    pub, league, bots = load(sys.argv[1], sys.argv[2])
    print("pub decided matches:", len(pub), "| league:", len(league))
    half = len([g for g in pub if g[0] == "earlier"]) // 2
    for label, scored in (
            ("EARLIER matches, second half", lambda i, era, mid: era == "earlier" and i >= half),
            ("TODAY's pub matches (after all the earlier ones)", lambda i, era, mid: era == "pub")):
        print("\n== pub, scored on", label)
        res = run(pub, methods(), scored)
        for name, (ll, br, acc, n) in sorted(res.items(), key=lambda x: x[1][0]):
            print("  %-36s log-loss %.4f  Brier %.4f  right %.1f%%  (%d)" % (name, ll, br, 100 * acc, n))
    print("\n== league, scored on its second half")
    res = run(league, methods(), lambda i, era, mid: i >= len(league) // 2)
    for name, (ll, br, acc, n) in sorted(res.items(), key=lambda x: x[1][0]):
        print("  %-36s log-loss %.4f  Brier %.4f  right %.1f%%  (%d)" % (name, ll, br, 100 * acc, n))
