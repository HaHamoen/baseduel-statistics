import sys, math
from compare import load, run, Constant, Elo, WengLin
pub, league, bots = load(sys.argv[1], sys.argv[2])
half = len([g for g in pub if g[0] == "earlier"]) // 2
def grid():
    ms = [Constant()]
    for team in ("mean", "sum"):
        for k in (4, 8, 16, 32):
            for scale in (400, 800, 1600, 3200):
                m = Elo(k, team, scale); m.name = "Elo K=%g scale=%g %s" % (k, scale, team); ms.append(m)
        for beta in (25/6, 25/3, 50/3, 25.0, 50.0):
            for tau in (25/300, 25/100):
                m = WengLin(beta=beta, tau=tau, team=team); m.name = "WL beta=%.1f tau=%.2f %s" % (beta, tau, team); ms.append(m)
    return ms
for label, games, scored in (
        ("EARLIER 2nd half", pub, lambda i, era, mid: era == "earlier" and i >= half),
        ("TODAY pub", pub, lambda i, era, mid: era == "pub"),
        ("LEAGUE 2nd half", league, lambda i, era, mid: i >= len(league) // 2)):
    res = run(games, grid(), scored)
    print("\n==", label)
    for name, (ll, br, acc, n) in sorted(res.items(), key=lambda x: x[1][0])[:8]:
        print("  %-34s log-loss %.4f Brier %.4f right %.1f%% (%d)" % (name, ll, br, 100*acc, n))
    print("  baseline log-loss %.4f right %.1f%%" % (res["baseline: freq 0's usual rate"][0], 100*res["baseline: freq 0's usual rate"][2]))
