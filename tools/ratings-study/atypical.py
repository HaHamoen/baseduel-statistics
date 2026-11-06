"""Do the earlier games that don't look like base duel move the ratings?
Replays the pub ratings with and without them and compares."""
import math, sqlite3, sys
sys.path.insert(0, "../..")
from compare import load, WengLin, run, Constant
from exporter import ratings as R

pub, league, bots = load(sys.argv[1], sys.argv[2])
db = sqlite3.connect("file:%s?mode=ro&immutable=1" % sys.argv[1], uri=True)
info = {gid: (secs, max(a, b), part) for gid, secs, a, b, part in db.execute(
    "SELECT neobot_id, active_seconds, score_a, score_b, partial_stats FROM neobot_matches")}
variants = {
    "A all decided games": lambda g: True,
    "B without >2h or >25 points": lambda g: g[0] != "earlier" or (info[g[1]][0] <= 7200 and info[g[1]][1] <= 25),
    "C without >1h, >25 points or partial stats": lambda g: g[0] != "earlier" or (
        info[g[1]][0] <= 3600 and info[g[1]][1] <= 25 and not info[g[1]][2]),
}

def replay(games):
    m = WengLin(beta=R.BETA, tau=R.TAU, team="mean")
    n = {}
    for era, mid, w, ps in games:
        people = [p for p in ps if p[0] not in bots]
        m.update(people, w)
        for p in people:
            if p[2]: n[p[0]] = n.get(p[0], 0) + 1
    return {k: R.shown(m.mu[k], math.sqrt(m.var[k])) for k in n}, n

res = {}
for name, keep in variants.items():
    games = [g for g in pub if keep(g)]
    res[name] = replay(games) + (len(pub) - len(games),)
base, base_n, _ = res["A all decided games"]

def ranks(r, who):
    order = sorted(who, key=lambda k: -r[k])
    return {k: i for i, k in enumerate(order)}

for name, (r, n, dropped) in res.items():
    if name.startswith("A"):
        print("A: %d decided pub matches, %d rated people" % (len(pub), len(r)))
        continue
    both = [k for k in base if k in r]
    diffs = sorted((abs(r[k] - base[k]), k) for k in both)
    regular = [k for k in both if base_n[k] >= 50]
    ra, rb = ranks(base, regular), ranks(r, regular)
    nn = len(regular)
    rho = 1 - 6 * sum((ra[k] - rb[k]) ** 2 for k in regular) / (nn * (nn * nn - 1))
    moved = [d for d, k in diffs if d > 0]
    print("\n%s: %d matches left out" % (name, dropped))
    print("  players whose rating changes at all: %d of %d" % (len(moved), len(both)))
    print("  change: median %d, 90%% %d, 99%% %d, largest %d (%s)" % (
        sorted(d for d, k in diffs)[len(diffs) // 2], sorted(d for d, k in diffs)[int(len(diffs) * .9)],
        sorted(d for d, k in diffs)[int(len(diffs) * .99)], diffs[-1][0], diffs[-1][1]))
    print("  order of the %d people with 50+ matches: Spearman %.4f" % (nn, rho))
    top_a = sorted(regular, key=lambda k: -base[k])[:15]
    top_b = sorted(regular, key=lambda k: -r[k])[:15]
    print("  top 15 same set: %s; same order: %s" % (set(top_a) == set(top_b), top_a == top_b))
    for k in top_a[:15]:
        if ra[k] != rb[k] or abs(r[k] - base[k]) >= 10:
            print("    %-20s #%d -> #%d, %d -> %d" % (k, ra[k] + 1, rb[k] + 1, base[k], r[k]))
