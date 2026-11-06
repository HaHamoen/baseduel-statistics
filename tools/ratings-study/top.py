import sys, math
from collections import Counter
from compare import load, run, Constant, Elo, WengLin
from bots import Ctx, PeopleOnly
pub, league, bots = load(sys.argv[1], sys.argv[2])
lex = lambda n: n.startswith("zero-eg-")
# league: bots there are Zero-EG-* only
import bots as B
for label, games in (("LEAGUE 2nd half", league),):
    B.bots = {n for g in league for n, *_ in g[3] if lex(n)}
    ms = [Constant(), Ctx(WengLin(beta=25.0, team="mean"), True), Ctx(Elo(16, "mean", 800), True), Ctx(Elo(32, "sum", 400), True),
          PeopleOnly(WengLin(beta=25.0, team="mean")), PeopleOnly(Elo(32, "sum", 400))]
    res = run(games, ms, lambda i, era, mid: i >= len(league) // 2)
    print("==", label)
    for name, (ll, br, acc, n) in sorted(res.items(), key=lambda x: x[1][0]):
        print("  %-52s log-loss %.4f right %.1f%%" % (name, ll, 100*acc))
B.bots = bots
# who is on top in the pub, all eras, people only
wl = Ctx(WengLin(beta=25.0, team="mean"), True); el = Ctx(Elo(16, "mean", 800), True)
games_n = Counter()
for era, mid, w, ps in pub:
    for m in (wl, el):
        m.update(ps, w)
    for n, s, r, _ in ps:
        if r and n not in bots: games_n[n] += 1
print("\nlearned: side a edge h=%.2f, per extra person g=%.2f (logit units)" % (wl.h, wl.g))
w = wl.b; e = el.b.r
cons = {n: w.mu[n] - 2 * math.sqrt(w.var[n]) for n in games_n}
print("\nPUB top 12, Weng-Lin shown as skill - 2 x uncertainty (no games floor):")
for n in sorted(cons, key=lambda n: -cons[n])[:12]:
    print("  %-22s %6.1f  (skill %.1f ± %.1f, %d matches)" % (n, cons[n], w.mu[n], 2*math.sqrt(w.var[n]), games_n[n]))
print("\nPUB top 12, Elo (no games floor):")
for n in sorted(games_n, key=lambda n: -e[n])[:12]:
    print("  %-22s %6.0f  (%d matches)" % (n, e[n], games_n[n]))
print("\nPUB top 12, Elo, 50+ matches:")
for n in sorted([n for n in games_n if games_n[n] >= 50], key=lambda n: -e[n])[:12]:
    print("  %-22s %6.0f  (%d matches)" % (n, e[n], games_n[n]))
print("\npeople rated:", len(games_n), "| with <10 matches:", sum(1 for n in games_n if games_n[n] < 10))
