"""Does it cost accuracy to let freq 0's edge and the people gap shape the
rating update too (a team expected to win, by numbers, gains less)?"""
import math, sys
from collections import defaultdict
from compare import load, run, Constant

class WLFair:
    def __init__(self, bots, beta=25.0, tau=25/300, ctx_in_update=True, lr=0.01, scale_gap=True):
        self.bots, self.beta, self.tau, self.ctx, self.lr = bots, beta, tau, ctx_in_update, lr
        self.mu = defaultdict(lambda: 25.0); self.var = defaultdict(lambda: (25/3) ** 2)
        self.h = self.g = 0.0
        self.name = "WL people-only, side+gap %s" % ("IN the update" if ctx_in_update else "in prediction only")
    def teams(self, ps):
        t = {}
        for side in "ab":
            mem = [n for n, s, r, _ in ps if s == side and r and n not in self.bots]
            k = max(1, len(mem))
            t[side] = (sum(self.mu[n] for n in mem) / k, sum(self.var[n] for n in mem) / k, mem)
        return t
    def parts(self, ps):
        t = self.teams(ps)
        c = math.sqrt(t["a"][1] + t["b"][1] + 2 * self.beta ** 2)
        gap = len(t["a"][2]) - len(t["b"][2])
        base = (t["a"][0] - t["b"][0]) / c
        return t, c, gap, base
    def predict(self, ps):
        t, c, gap, base = self.parts(ps)
        return 1 / (1 + math.exp(-(base + self.h + self.g * gap)))
    def update(self, ps, w):
        for n, s, r, _ in ps:
            if r and n not in self.bots: self.var[n] += self.tau ** 2
        t, c, gap, base = self.parts(ps)
        full = 1 / (1 + math.exp(-(base + self.h + self.g * gap)))
        pa = full if self.ctx else 1 / (1 + math.exp(-base))
        y = 1.0 if w == "a" else 0.0
        self.h += self.lr * (y - full); self.g += self.lr * (y - full) * gap
        res = {n: r for n, s, r, _ in ps}
        for side, p in (("a", pa), ("b", 1 - pa)):
            mu_t, var_t, mem = t[side]
            if not mem: continue
            gamma = math.sqrt(var_t) / c
            delta = gamma * var_t / (c * c) * p * (1 - p)
            for n in mem:
                share = self.var[n] / var_t
                self.mu[n] += share * var_t / c * ((res[n] == "W") - p)
                self.var[n] *= max(1 - share * delta, 1e-4)

if __name__ == "__main__":
    pub, league, bots = load(sys.argv[1], sys.argv[2])
    half = len([g for g in pub if g[0] == "earlier"]) // 2
    lbots = {n for g in league for n, *_ in g[3] if n.startswith("zero-eg-")}
    for label, games, b, scored in (
            ("earlier 2nd half", pub, bots, lambda i, era, mid: era == "earlier" and i >= half),
            ("today's pub", pub, bots, lambda i, era, mid: era == "pub"),
            ("league 2nd half", league, lbots, lambda i, era, mid: i >= len(league) // 2)):
        res = run(games, [Constant(), WLFair(b, ctx_in_update=False), WLFair(b, ctx_in_update=True)], scored)
        print("==", label)
        for name, (ll, br, acc, n) in sorted(res.items(), key=lambda x: x[1][0]):
            print("  %-48s log-loss %.4f right %.1f%% (%d)" % (name, ll, 100 * acc, n))
