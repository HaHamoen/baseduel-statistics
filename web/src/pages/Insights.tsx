import { LineChart } from "../charts";
import { getInsights, getMeta, type InsightsDoc } from "../data";
import { date, num, plural, pyFixed } from "../format";
import { Loading, Problem, useLoad, useTitle } from "../ui";

/** Too few matches to read a share from: greyed, not hidden. */
const THIN = 20;
const pct = (n: number, of: number) => (of ? Math.round((n * 100) / of) : 0);
const GAP_WORDS: Record<number, string> = { 0: "The same number" };
const gapWord = (g: number, max: number) =>
  GAP_WORDS[g] ?? `${Math.abs(g)}${Math.abs(g) === max ? "+" : ""} ${g < 0 ? "fewer" : "more"}`;

/** What every pub match says about the game: freq 0 against freq 1 over the
 * years, the people on each team, people against bots, and hard mode.
 * exporter/insights.py works it out; test_parity holds it against SQL. */
export function Insights() {
  useTitle("Insights");
  const [got, error] = useLoad(() => Promise.all([getInsights(), getMeta()]), []);
  const head = (
    <header class="page-head">
      <h1>Insights</h1>
      <p class="muted">What the pub arena's matches say, the earlier ones included. Only matches a person played in count, and a share of wins is of the matches somebody won.</p>
    </header>
  );
  if (error) return <Problem error={error} />;
  if (!got) return <>{head}<Loading /></>;
  const [doc, meta] = got;
  if (!doc) return <>{head}<section class="card"><p class="muted">Nothing here yet.</p></section></>;
  const since = meta?.sections.pub.first_started;
  return (
    <>
      {head}
      <Sides doc={doc} since={since} />
      <People doc={doc} />
      <Bots doc={doc} />
      <Hard doc={doc} />
      <p class="note">People and bots are told apart by the zone's bot list as it is today, in every match.
        A player who changed freq counts for the one they played longest, as on every board.
        {since ? ` Today's matches: the bot's own, from ${date(since)}.` : ""}</p>
    </>
  );
}

function Share({ label, won, of, what }: { label: string; won: number; of: number; what: string }) {
  return (
    <div class="stat">
      <span class="stat-l">{label}</span>
      <span class="stat-v">{of ? `${pct(won, of)}%` : "–"}</span>
      <span class="stat-s">{what} {plural(of, "match", "matches")}</span>
    </div>
  );
}

/** A share of wins over its matches: "77%", "of 8,393" under it; greyed
 * when too few to read much into. */
function ShareCell({ won, of }: { won: number; of: number }) {
  return (
    <td class={of < THIN ? "n thin" : "n"}>
      {of ? <><strong>{pct(won, of)}%</strong><span class="share-of">of {num(of)}</span></> : "–"}
    </td>
  );
}

function Sides({ doc, since }: { doc: InsightsDoc; since: number | null | undefined }) {
  const { eras, sides } = doc;
  const last = eras.length - 1;
  // The last point is today's matches, when there are any with a winner.
  const today = sides.pub[0] > 0;
  const label = (i: number) => (today && i === last ? "Today" : `#${num(Math.floor(eras[i][0] / doc.block) * doc.block || eras[i][0])}`);
  const ticks = eras.flatMap((e, i) => (i === 0 || i === last || Math.floor(e[0] / doc.block) % 5 === 0 ? [i] : []));
  return (
    <section class="card">
      <h2>Freq 0 against freq 1</h2>
      <div class="stats">
        <Share label="Earlier matches" won={sides.earlier[1]} of={sides.earlier[0]} what="freq 0 won, of" />
        <Share label="Today" won={sides.pub[1]} of={sides.pub[0]} what="freq 0 won, of" />
        <Share label="Private" won={sides.private[1]} of={sides.private[0]} what="freq 100 won, of" />
        <Share label="League" won={sides.league[1]} of={sides.league[0]} what="freq 0 won, of" />
      </div>
      <LineChart label="Freq 0's share of the wins, by match number"
                 xs={eras.length}
                 series={[{ id: "f0", label: "Freq 0 won", cls: "viz-a", values: eras.map((e) => (e[2] ? (e[3] * 100) / e[2] : null)) }]}
                 yMax={100} yTicks={[0, 25, 50, 75, 100]} yFmt={(v) => `${v}%`}
                 xTicks={ticks} xFmt={label}
                 reference={{ y: 50, label: "50%" }}
                 tip={(i) => ({
                   head: today && i === last ? `Today, #${num(eras[i][0])}–#${num(eras[i][1])}` : `#${num(eras[i][0])}–#${num(eras[i][1])}`,
                   rows: [{ cls: "viz-a", label: "freq 0 won", value: `${pct(eras[i][3], eras[i][2])}%` },
                          { label: "matches with a winner", value: num(eras[i][2]) }],
                 })} />
      <p class="note">Each point is {num(doc.block)} earlier matches in the order played, by match number; the last is
        all of today's{since ? `, from ${date(since)}` : ""}. Private matches and the league are not on the line.</p>
    </section>
  );
}

function People({ doc }: { doc: InsightsDoc }) {
  const { gap, more, gap_max: max } = doc;
  const today = new Map(gap.pub.map((l) => [l[0], l]));
  return (
    <section class="card">
      <h2>People on each team</h2>
      <p>Freq 0 had more people than freq 1 in <strong>{pct(more.earlier[1], more.earlier[0])}%</strong> of the earlier
        matches and <strong>{pct(more.pub[1], more.pub[0])}%</strong> of today's; freq 1 had more in {pct(more.earlier[2], more.earlier[0])}% and {pct(more.pub[2], more.pub[0])}%.</p>
      <p class="note">How often freq 0 won, by how many more people it had than freq 1, in the earlier matches and today's:</p>
      <table class="data gap-table">
        <thead><tr>
          <th scope="col">Freq 0 had</th><th scope="col" class="n">Earlier</th><th scope="col" class="n">Today</th>
        </tr></thead>
        <tbody>
          {gap.earlier.map(([g, n, w]) => {
            const t = today.get(g) || [g, 0, 0];
            return (
              <tr>
                <th scope="row" class="nowrap">{gapWord(g, max)}</th>
                <ShareCell won={w} of={n} />
                <ShareCell won={t[2]} of={t[1]} />
              </tr>
            );
          })}
        </tbody>
      </table>
      <p class="note">"2 more": two more people on freq 0 than on freq 1. Greyed: fewer than {THIN} matches.</p>
    </section>
  );
}

function Bots({ doc }: { doc: InsightsDoc }) {
  const { vs_bots: vs, play } = doc;
  const kpm = ([k, , t]: [number, number, number]) => (t >= 1 ? pyFixed((k * 60) / t, 2) : "–");
  const kpd = ([k, d]: [number, number, number]) => (d ? pyFixed(k / d, 2) : "–");
  return (
    <section class="card">
      <h2>People against bots</h2>
      <div class="stats">
        <Share label="Earlier matches" won={vs.earlier[1]} of={vs.earlier[0]} what="people won, of" />
        <Share label="Today" won={vs.pub[1]} of={vs.pub[0]} what="people won, of" />
      </div>
      <p class="note">Matches where one team was bots alone and the other had people on it.</p>
      <table class="data bots-table">
        <thead><tr>
          <th scope="col"><span class="sr-only">Figure</span></th><th scope="col" class="n">People</th><th scope="col" class="n">Bots</th>
        </tr></thead>
        {(["earlier", "pub"] as const).map((era) => (
          <tbody>
            <tr class="group"><th scope="colgroup" colSpan={3}>{era === "earlier" ? "Earlier matches" : "Today"}</th></tr>
            <tr><th scope="row">Kills a minute</th><td class="n">{kpm(play[era].people)}</td><td class="n">{kpm(play[era].bots)}</td></tr>
            <tr><th scope="row">Kills a death</th><td class="n">{kpd(play[era].people)}</td><td class="n">{kpd(play[era].bots)}</td></tr>
          </tbody>
        ))}
      </table>
      <p class="note">Every kill and death, by everyone, in the matches above; minutes are time on the field.</p>
    </section>
  );
}

function Hard({ doc }: { doc: InsightsDoc }) {
  const h = doc.hard;
  if (!h.matches) return null;
  return (
    <section class="card">
      <h2>Hard mode</h2>
      <div class="stats">
        <div class="stat">
          <span class="stat-l">Matches</span>
          <span class="stat-v">{num(h.matches)}</span>
          <span class="stat-s">{h.first ? `since ${date(h.first)}` : ""}</span>
        </div>
        <div class="stat">
          <span class="stat-l">Hard-mode team won</span>
          <span class="stat-v">{num(h.team_won)}</span>
          <span class="stat-s">of {plural(h.decided, "match", "matches")} with a winner</span>
        </div>
        <div class="stat">
          <span class="stat-l">Points</span>
          <span class="stat-v">{num(h.team_points)}–{num(h.other_points)}</span>
          <span class="stat-s">the hard-mode team's, then the other team's</span>
        </div>
      </div>
      <p class="note">In hard mode every bot on the starter's team anchors, and its people get 500 bounty at the start of each round.
        {h.ended_early ? ` ${plural(h.ended_early, "match", "matches")} went back to normal play before the end.` : ""}</p>
    </section>
  );
}
