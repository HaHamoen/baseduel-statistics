import type { ComponentChildren } from "preact";
import { useMemo, useState } from "preact/hooks";
import { careerFigures } from "../career";
import { sharedMatches, tally } from "../compare";
import { getMeta, getPlayer, getPlayers, type Career, type PlayerDoc, type Section } from "../data";
import { big, fold, hours, num, plural, shortDate, date } from "../format";
import { earlierThan } from "../matchinfo";
import { played, SCOPE_WORDS, scopesOf, SECTION_NAMES } from "../played";
import { compareHref, matchHref, navigate, playerHref } from "../router";
import { Loading, Pager, Pills, PlayerSearch, Problem, Result, useLoad, useTitle } from "../ui";

const PAGE = 25;

/** Two players side by side (/compare/<a>/<b>): their record together and
 * against each other, the matches both played, and their careers. One
 * section and one button at a time, as on a player's page. */
export function Compare({ a, b, query }: { a: string; b: string | null; query: URLSearchParams }) {
  const [players, perr] = useLoad(getPlayers, []);
  const ea = players?.byFold.get(fold(a));
  const eb = b ? players?.byFold.get(fold(b)) : undefined;
  const [docs, derr] = useLoad(() => Promise.all([
    ea ? getPlayer(ea.key) : Promise.resolve(null), eb ? getPlayer(eb.key) : Promise.resolve(null),
  ]), [ea?.key, eb?.key]);
  useTitle(ea && eb ? `${ea.name} vs ${eb.name}` : `Compare ${ea?.name || a}`);
  if (perr || derr) return <Problem error={(perr || derr)!} />;
  if (!players) return <Loading />;
  const pick = (first: string, why: string) => (
    <section class="card">
      <h1>{why}</h1>
      <PlayerSearch autofocus placeholder="Find a player to compare with"
                    onPick={(p) => navigate(compareHref(first, p.name))} />
    </section>
  );
  if (!ea) {
    return (
      <section class="card">
        <h1>No player named “{a}”</h1>
        <PlayerSearch autofocus onPick={(p) => navigate(compareHref(p.name))} />
      </section>
    );
  }
  if (!b) return pick(ea.name, `Compare ${ea.name} with…`);
  if (!eb) return pick(ea.name, `No player named “${b}”`);
  if (!docs || !docs[0] || !docs[1]) return <Loading what={`Loading ${ea.name} and ${eb.name}`} />;
  return <CompareView key={ea.key + eb.key} da={docs[0]} db={docs[1]} query={query} />;
}

function CompareView({ da, db, query }: { da: PlayerDoc; db: PlayerDoc; query: URLSearchParams }) {
  const [meta] = useLoad(getMeta, []);
  const sections = (["pub", "league"] as Section[]).filter((s) => da[s] && db[s]);
  const lists = useMemo(() => Object.fromEntries(sections.map((s) =>
    [s, [played(s, da[s]!), played(s, db[s]!)]])) as Record<Section, ReturnType<typeof played>[]>, [da, db]);
  // Opens on the section they shared the most matches in.
  const most = [...sections].sort((x, y) =>
    sharedMatches(lists[y][0], lists[y][1], "all").length - sharedMatches(lists[x][0], lists[x][1], "all").length)[0];
  const asked = query.get("s") as Section;
  const section = sections.includes(asked) ? asked : most;
  const scopes = section ? scopesOf(section) : [];
  const scope = scopes.some(([v]) => v === query.get("scope")) ? query.get("scope")! : "all";
  const [side, setSide] = useState<"all" | "with" | "against">("all");
  const [page, setPage] = useState(0);
  const shared = useMemo(() => (section ? sharedMatches(lists[section][0], lists[section][1], scope) : []),
    [section, scope, lists]);
  const show = (s: Section, sc: string) => {
    setPage(0);
    const q = new URLSearchParams({ s, ...(sc !== "all" ? { scope: sc } : {}) });
    navigate(compareHref(da.name, db.name, q), true);
  };

  const head = (
    <header class="page-head">
      <p class="eyebrow">Compare</p>
      <h1 class="vs"><a href={playerHref(da.name)}>{da.name}</a> <span class="muted">vs</span> <a href={playerHref(db.name)}>{db.name}</a></h1>
      {section && (
        <div class="level-switch">
          {sections.length > 1 && (
            <Pills large label="Section" value={section} onChange={(s) => s !== section && show(s, "all")}
                   options={sections.map((s) => [s, SECTION_NAMES[s]] as [Section, string])} />
          )}
          <Pills label="Which matches" value={scope} onChange={(sc) => show(section, sc)}
                 options={scopes.map(([v, t]) => [v, t, !da[section]!.careers[v] && !db[section]!.careers[v]] as [string, string, boolean])} />
        </div>
      )}
    </header>
  );
  if (!section) {
    const where = (d: PlayerDoc) => (["pub", "league"] as Section[]).filter((s) => d[s]).map((s) => SECTION_NAMES[s]).join(" and ");
    return <>{head}<section class="card"><p class="muted">They never played in the same section: {da.name} in {where(da)}, {db.name} in {where(db)}.</p></section></>;
  }

  const w = tally(shared, true);
  const x = tally(shared, false);
  const word = SCOPE_WORDS[scope];
  const list = shared.filter((s) => side === "all" || s.together === (side === "with"));
  const pages = Math.ceil(list.length / PAGE);
  return (
    <>
      {head}
      <section class="card">
        <h2>Head to head{scope !== "all" ? ` · ${scopes.find(([v]) => v === scope)?.[1]}` : ""}</h2>
        {shared.length === 0 ? <p class="muted">They have never played in the same {word ? word + " " : ""}match.</p> : (
          <>
            <div class="stats">
              <div class="stat">
                <span class="stat-l">Together</span>
                <span class="stat-v">{num(w.wins)}–{num(w.losses)}</span>
                <span class="stat-s">{plural(w.matches, "match", "matches")} on the same team</span>
              </div>
              <div class="stat">
                <span class="stat-l">Against</span>
                <span class="stat-v">{num(x.wins)}–{num(x.losses)}</span>
                <span class="stat-s">{da.name}'s record in {plural(x.matches, "match", "matches")}</span>
              </div>
            </div>
            <p class="note">Only matches somebody won count. Each record is {da.name}'s; a no result counts in the matches, in neither win nor loss.</p>
          </>
        )}
      </section>
      <section class="card">
        <h2>Careers</h2>
        <Careers a={da.name} b={db.name} ca={da[section]!.careers[scope]} cb={db[section]!.careers[scope]}
                 earlier={earlierThan(meta)} />
      </section>
      {shared.length > 0 && (
        <section class="card">
            <div class="card-head">
              <h2>Matches both played</h2>
              <Pills label="Which side" value={side} onChange={(v) => { setSide(v); setPage(0); }}
                     options={[["all", "All"], ["with", "Together"], ["against", "Against"]]} />
            </div>
            <div class="scroll">
              <table class="data">
                <thead><tr>
                  <th scope="col">Date</th><th scope="col">Match</th><th scope="col">Kind</th>
                  <th scope="col">Side</th><th scope="col" class="c">{da.name}</th><th scope="col" class="c">Score</th>
                </tr></thead>
                <tbody>
                  {list.slice(page * PAGE, page * PAGE + PAGE).map(({ mine, together }) => (
                    <tr>
                      <td class="nowrap" title={mine.started_at ? date(mine.started_at) : "No date was recorded"}>
                        {mine.started_at ? shortDate(mine.started_at) : <span class="muted">–</span>}
                      </td>
                      <td><a href={matchHref(section, mine.id)}>#{mine.id}</a></td>
                      <td class="nowrap">{mine.kind}</td>
                      <td>{together ? "Together" : "Against"}</td>
                      <td class="c"><Result r={mine.result} /></td>
                      <td class="c nowrap">{mine.score_for}–{mine.score_against}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pages={pages} onPage={setPage} />
        </section>
      )}
    </>
  );
}

/** Both careers in the same scope, a line a figure, as their pages show them. */
function Careers({ a, b, ca, cb, earlier }: { a: string; b: string; ca: Career | null; cb: Career | null; earlier: string }) {
  const onlyEarlier = (c: Career) => (c.neobot_matches || 0) > 0 && c.neobot_matches === c.matches;
  const untracked = <span class="muted">not tracked</span>;
  const lines: [string, (c: Career) => ComponentChildren][] = [
    ["Matches", (c) => num(c.matches)],
    ["Record", (c) => `${num(c.wins)}–${num(careerFigures(c).losses)}`],
    ["Win%", (c) => `${careerFigures(c).pct}%`],
    ["K/D", (c) => careerFigures(c).kd],
    ["KPM", (c) => { const k = careerFigures(c).kpm; return k === "-" ? "–" : k; }],
    ["Kills", (c) => num(c.kills)],
    ["Deaths", (c) => num(c.deaths)],
    ["Damage given", (c) => big(c.dmg_given)],
    ["Damage taken", (c) => big(c.dmg_taken)],
    ["Safe touches", (c) => (onlyEarlier(c) || c.safe_touches == null ? untracked : num(c.safe_touches))],
    ["Best streak", (c) => (onlyEarlier(c) || c.best_streak == null ? untracked : num(c.best_streak))],
    ["Field time", (c) => hours(c.active_time || 0)],
  ];
  const mixed = [ca, cb].some((c) => c && (c.neobot_matches || 0) > 0 && !onlyEarlier(c));
  return (
    <>
      <div class="scroll">
        <table class="data compare-careers">
          <thead><tr>
            <th scope="col"><span class="sr-only">Figure</span></th>
            <th scope="col" class="n">{a}</th><th scope="col" class="n">{b}</th>
          </tr></thead>
          <tbody>
            {lines.map(([label, f]) => (
              <tr>
                <th scope="row">{label}</th>
                <td class="n">{ca ? f(ca) : <span class="muted">–</span>}</td>
                <td class="n">{cb ? f(cb) : <span class="muted">–</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(!ca || !cb) && <p class="note">A dash: no matches with a result here.</p>}
      {mixed && <p class="note">Matches {earlier} recorded no safe touches or kill streaks: those count only the later matches.</p>}
    </>
  );
}
