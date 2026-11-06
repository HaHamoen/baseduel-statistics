import type { ComponentChildren } from "preact";
import { useMemo, useState } from "preact/hooks";
import { baseLines, type BaseLine, type RoundFact } from "../bases";
import { getMeta, load, rows, type Section, type Table } from "../data";
import { date, duration, num } from "../format";
import { navigate } from "../router";
import { Loading, Pills, Problem, Team, useLoad, useTitle } from "../ui";

/** Too few rounds to read much into: greyed, not hidden. */
const THIN = 20;

type SortKey = "base" | "rounds" | "a" | "b" | "touch" | "wipe" | "none" | "median" | "skipped";
const pct = (n: number, of: number) => (of ? Math.round((n * 100) / of) : 0);
const SORTS: Record<SortKey, (l: BaseLine) => number> = {
  base: (l) => -l.base,
  rounds: (l) => l.rounds,
  a: (l) => (l.decided ? l.a / l.decided : -1),
  b: (l) => (l.decided ? l.b / l.decided : -1),
  touch: (l) => (l.decided ? l.touch / l.decided : -1),
  wipe: (l) => (l.decided ? l.wipe / l.decided : -1),
  none: (l) => l.none,
  median: (l) => l.median ?? -1,
  skipped: (l) => l.skipped,
};

/** Every base of every arena: how often it is played, which side wins it,
 * how, and how long it takes. From the bots' own matches: the earlier ones
 * recorded no bases. */
export function Bases({ query }: { query: URLSearchParams }) {
  useTitle("Bases");
  const section: Section = query.get("s") === "league" ? "league" : "pub";
  const [got, error] = useLoad(() => Promise.all([load<Table>(`rounds/${section}.json`), getMeta()]), [section]);
  const [sort, setSort] = useState<SortKey>("base");
  const lines = useMemo(() => (got?.[0] ? baseLines(rows<RoundFact>(got[0])) : []), [got]);
  // Arenas busiest first; the busiest is the default.
  const arenas = useMemo(() => {
    const n = new Map<string, number>();
    for (const l of lines) n.set(l.arena, (n.get(l.arena) || 0) + l.rounds);
    return [...n].sort((x, y) => y[1] - x[1]).map(([a]) => a);
  }, [lines]);
  const arena = arenas.includes(query.get("a") || "") ? query.get("a")! : arenas[0];
  const set = (s: Section, a?: string) =>
    navigate(`/bases?${new URLSearchParams({ ...(s === "league" ? { s } : {}), ...(a ? { a } : {}) })}`, true);

  const head = (
    <header class="page-head">
      <h1>Bases</h1>
      <div class="filters">
        <Pills label="Section" value={section} onChange={(s) => set(s)}
               options={[["pub", "Pub arena"], ["league", "League"]]} />
        {arenas.length > 1 && (
          <Pills label="Arena" value={arena} onChange={(a) => set(section, a)}
                 options={arenas.map((a) => [a, a] as [string, string])} />
        )}
      </div>
    </header>
  );
  if (error) return <Problem error={error} />;
  if (!got) return <>{head}<Loading /></>;
  const meta = got[1];
  const shown = lines.filter((l) => l.arena === arena)
    .sort((x, y) => SORTS[sort](y) - SORTS[sort](x) || x.base - y.base);
  const total = shown.reduce((n, l) => n + l.rounds, 0);
  const th = (key: SortKey, label: ComponentChildren, title: string, cls = "n") => (
    <th scope="col" class={cls} title={title} aria-sort={sort === key ? (key === "base" ? "ascending" : "descending") : undefined}>
      <button type="button" class="sort" onClick={() => setSort(key)}>{label}</button>
    </th>
  );
  const first = section === "pub" ? meta?.sections.pub.first_started : null;
  return (
    <>
      {head}
      <section class="card">
        <p class="muted small">{num(shown.length)} bases · {num(total)} rounds in {arena}</p>
        {shown.length === 0 ? <p class="muted">No rounds recorded here.</p> : (
          <div class="scroll">
            <table class="data bases-table">
              <thead><tr>
                {th("base", "Base", "The base number in this arena", "")}
                {th("rounds", "Rounds", "Counted rounds played here")}
                {th("a", <Team side="a">Freq 0 won</Team>, "Share of the rounds somebody won here")}
                {th("b", <Team side="b">Freq 1 won</Team>, "Share of the rounds somebody won here")}
                {th("touch", "Touch", "Won by reaching the enemy safe")}
                {th("wipe", "Wipe", "Won by clearing the other team out")}
                {th("none", "No point", "Rounds nobody won: time ran out, a timeout, a score set, or the match ended")}
                {th("median", "Typical length", "The middle length of the rounds somebody won")}
                {section === "pub" && th("skipped", "Skipped", "Times !nextbase moved a round off this base")}
              </tr></thead>
              <tbody>
                {shown.map((l) => (
                  <tr class={l.decided < THIN ? "thin" : undefined}>
                    <th scope="row">{l.base}</th>
                    <td class="n">{num(l.rounds)}</td>
                    <td class="n">{l.decided ? <Team side="a">{pct(l.a, l.decided)}%</Team> : "–"}</td>
                    <td class="n">{l.decided ? <Team side="b">{pct(l.b, l.decided)}%</Team> : "–"}</td>
                    <td class="n">{l.decided ? `${pct(l.touch, l.decided)}%` : "–"}</td>
                    <td class="n">{l.decided ? `${pct(l.wipe, l.decided)}%` : "–"}</td>
                    <td class="n">{l.none ? num(l.none) : <span class="muted">0</span>}</td>
                    <td class="n">{l.median == null ? "–" : duration(l.median)}</td>
                    {section === "pub" && <td class="n">{l.skipped ? num(l.skipped) : <span class="muted">0</span>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p class="note">Every round of the bots' matches that a person played in; matches of bots alone are left out.
          {first ? ` Matches before ${date(first)} recorded no bases.` : ""}</p>
        <p class="note">Shares are of the rounds somebody won. {section === "pub" ? "A private match's 100 and 200 count as Freq 0 and Freq 1. " : ""}
          Greyed: fewer than {THIN} such rounds, too few to read much into. A column heading sorts by it.</p>
      </section>
    </>
  );
}
