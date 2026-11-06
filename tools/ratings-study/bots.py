import sys, math
from collections import defaultdict
from compare import load, run, Constant, Elo, WengLin
pub, league, bots = load(sys.argv[1], sys.argv[2])
half = len([g for g in pub if g[0] == "earlier"]) // 2

class Ctx:
    """A method plus two learned terms: side a's edge and the people gap,
    fitted online (logistic SGD) beside the ratings."""
    def __init__(self, base, people_only=False, lr=0.01):
        self.b, self.po, self.lr, self.h, self.g = base, people_only, lr, 0.0, 0.0
        self.name = base.name + (" people-only" if people_only else "") + " +side+gap"
    def filt(self, ps):
        return [p for p in ps if not (self.po and p[0] in bots)]
    def gap(self, ps):
        a = sum(1 for n, s, r, _ in ps if s == "a" and r and n not in bots)
        b = sum(1 for n, s, r, _ in ps if s == "b" and r and n not in bots)
        return a - b
    def logit(self, ps):
        p = min(max(self.b.predict(self.filt(ps)), 1e-9), 1 - 1e-9)
        return math.log(p / (1 - p)) + self.h + self.g * self.gap(ps)
    def predict(self, ps):
        return 1 / (1 + math.exp(-self.logit(ps)))
    def update(self, ps, w):
        y = 1.0 if w == "a" else 0.0
        err = y - self.predict(ps)
        self.h += self.lr * err
        self.g += self.lr * err * self.gap(ps)
        self.b.update(self.filt(ps), w)

class PeopleOnly:
    def __init__(self, base):
        self.b = base; self.name = base.name + " people-only"
    def filt(self, ps): return [p for p in ps if p[0] not in bots]
    def predict(self, ps): return self.b.predict(self.filt(ps))
    def update(self, ps, w): self.b.update(self.filt(ps), w)

def mk():
    ms = [Constant()]
    for k, sc in ((4, 3200), (8, 1600), (16, 800), (8, 800), (16, 400)):
        for team in ("mean", "sum"):
            e = lambda: Elo(k, team, sc)
            for wrap in (lambda b: b, PeopleOnly, lambda b: Ctx(b), lambda b: Ctx(b, True)):
                m = wrap(e()); 
                if not hasattr(m, "name") or m.name.startswith("Elo, K"): pass
                m.name = m.name.replace("Elo, K=%g, team %s" % (k, team), "Elo K=%g s=%g %s" % (k, sc, team))
                ms.append(m)
    for beta in (25/6, 25/3, 25.0):
        for team in ("mean", "sum"):
            for wrap in (lambda b: b, PeopleOnly, lambda b: Ctx(b), lambda b: Ctx(b, True)):
                m = wrap(WengLin(beta=beta, team=team))
                m.name = m.name.replace("Weng-Lin, tau=0.0833, team %s" % team, "WL beta=%.1f %s" % (beta, team))
                ms.append(m)
    return ms
for label, games, scored in (
        ("EARLIER 2nd half", pub, lambda i, era, mid: era == "earlier" and i >= half),
        ("TODAY pub", pub, lambda i, era, mid: era == "pub")):
    res = run(games, mk(), scored)
    print("\n==", label, "| baseline log-loss %.4f right %.1f%%" % (res["baseline: freq 0's usual rate"][0], 100*res["baseline: freq 0's usual rate"][2]))
    for name, (ll, br, acc, n) in sorted(res.items(), key=lambda x: x[1][0])[:10]:
        print("  %-52s log-loss %.4f right %.1f%%" % (name, ll, 100*acc))
