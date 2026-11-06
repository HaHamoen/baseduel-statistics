import { useMemo, useRef, useState } from "preact/hooks";
import { ChartNote, LineChart, niceRange, niceTicks } from "../charts";
import {
  getMeta, getPlayer, getPlayers, type Career, type MateRow, type PlayerIndex, type PlayerRating,
  type PlayerSection, type Section,
} from "../data";
import { rowKpm } from "../board";
import { careerFigures } from "../career";
import { big, date, duration, fold, hours, num, plural, pyFixed, pyRound, rating, shortDate } from "../format";
import { earlierThan } from "../matchinfo";
import {
  IN_SCOPE, latestSection, LEAGUE_SCOPES, played, PUB_SCOPES, SCOPE_WORDS, SECTION_NAMES, type Played,
} from "../played";
import { compareHref, matchHref, navigate, playerHref } from "../router";
import { Loading, Pager, Pills, PlayerSearch, Problem, Result, useLoad, useTitle } from "../ui";

// pubduel/board.py's notes, with "Neobot's" said as when they were played.
const TOUCH_NOTE = "Touches count only rounds won by reaching the safe; a round won by a wipe has no scorer.";
const UNTRACKED = "no safe touches, kill streaks, attaches or rounds";
const earlierNote = (earlier: string) => `Matches ${earlier} recorded ${UNTRACKED}.`;
const mixedNote = (earlier: string, old: number, matches: number) =>
  `${num(old)} of these matches are from ${earlier}, which recorded ${UNTRACKED}: ` +
  `those count only the other ${num(matches - old)}.`;

/** A player: one section at a time, chosen by the switch at the top, with
 * that section's scope under it (the user, 2026-11-05: Pub arena · League,
 * never the two added together). Both choices live in the address, so a
 * link opens the same view. */
export function Player({ name, query }: { name: string; query: URLSearchParams }) {
  const [meta] = useLoad(getMeta, []);
  const [players, perr] = useLoad(getPlayers, []);
  const entry = players?.byFold.get(fold(name));
  const [doc, derr] = useLoad(() => (entry ? getPlayer(entry.key) : Promise.resolve(null)), [entry?.key]);
  useTitle(entry ? entry.name : name);
  if (perr || derr) return <Problem error={(perr || derr)!} />;
  if (!players) return <Loading />;
  if (!entry) {
    return (
      <section class="card">
        <h1>No player named “{name}”</h1>
        <p class="muted">Names are matched without case. Try the search:</p>
        <PlayerSearch autofocus />
      </section>
    );
  }
  if (!doc) return <Loading what={`Loading ${entry.name}`} />;

  const sections = (["pub", "league"] as Section[]).filter((s) => doc[s]);
  const asked = query.get("s") as Section;
  const section = sections.includes(asked) ? asked : latestSection(doc);
  const sec = doc[section]!;
  const scopes = section === "pub" ? PUB_SCOPES : LEAGUE_SCOPES;
  const scope = scopes.some(([v]) => v === query.get("scope")) ? query.get("scope")! : "all";
  // Stays on this page's own address (whatever casing it was typed in),
  // replacing the history entry: a switch is a view, not a new page.
  const show = (s: Section, sc: string) => {
    const q = new URLSearchParams({ s, ...(sc !== "all" ? { scope: sc } : {}) });
    navigate(`${location.pathname}?${q}`, true);
  };
  return (
    <>
      <header class="page-head">
        <h1>{doc.name}</h1>
        <p class="muted">
          {(entry.pub_bot || entry.league_bot) && <span class="tag" title="On the bots' bot list: left off the leaderboards">bot</span>}
          {entry.last_seen ? <>Last played {date(entry.last_seen)}</> : <>Played only in earlier matches, which have no dates</>}
          {" · "}<a href={compareHref(doc.name)}>Compare</a>
        </p>
        <div class="level-switch">
          {sections.length > 1 && (
            <Pills large label="Section" value={section} onChange={(s) => s !== section && show(s, "all")}
                   options={sections.map((s) => [s, SECTION_NAMES[s]] as [Section, string])} />
          )}
          <Pills label="Which matches" value={scope} onChange={(sc) => show(section, sc)}
                 options={scopes.map(([v, t]) => [v, t, !sec.careers[v]] as [string, string, boolean])} />
        </div>
      </header>
      <SectionView key={section} section={section} sec={sec} scope={scope} earlier={earlierThan(meta)}
                   players={players} />
    </>
  );
}

function SectionView({ section, sec, scope, earlier, players }: {
  section: Section; sec: PlayerSection; scope: string; earlier: string; players: PlayerIndex;
}) {
  const c = sec.careers[scope];
  const all = useMemo(() => played(section, sec), [section, sec]);
  // The switch scopes everything below it: the career, the chart and the
  // list agree on which matches they are about.
  const list = useMemo(() => all.filter(IN_SCOPE[scope]), [all, scope]);
  // The heading names the slice too, so it still says what the figures are
  // once the switch has scrolled away.
  const slice = (section === "pub" ? PUB_SCOPES : LEAGUE_SCOPES).find(([v]) => v === scope)?.[1];
  // One measure for the tiles, the chart and the list (Claude Design's
  // "tile -> chart -> table" link): its tile is pressed, the chart draws it,
  // and the list lights the columns it comes from.
  const [want, setWant] = useState<Metric>("winpct");
  const rating = sec.rating || null;
  // A rating covers the whole section, whichever button is chosen, so its
  // chart needs only two points of its own.
  const chartable = useMemo(() => !c ? [] : METRICS.map(([m]) => m)
    .filter((m) => m === "rating" ? (rating?.history.length || 0) >= 2
      : list.filter((r) => charted(r, m)).length >= MIN_FOR_TREND), [list, c, rating]);
  const metric = chartable.includes(want) ? want : chartable[0] ?? null;
  const chart = useRef<HTMLDivElement>(null);
  // A tile far above the chart (a phone) brings the chart into view; one
  // already in view does not move the page.
  const pick = (m: Metric) => {
    setWant(m);
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    chart.current?.scrollIntoView({ block: "nearest", behavior: still ? "auto" : "smooth" });
  };
  return (
    <section class="card">
      <h2>{SECTION_NAMES[section]}{scope !== "all" && slice ? ` · ${slice}` : ""}</h2>
      <CareerView c={c} scope={scope} earlier={earlier} metric={metric} chartable={chartable} onPick={pick}
                  rating={rating} section={section} />
      <div ref={chart}>
        {metric === "rating" && rating
          ? <RatingChart rating={rating} all={all} section={section} chartable={chartable} onMetric={setWant} />
          : metric && <FormChart list={list} career={c!} metric={metric} chartable={chartable} onMetric={setWant} />}
      </div>
      <Mates key={scope} name={sec.name} mates={sec.mates?.[scope]} players={players}
             compare={(other) => compareHref(sec.name, other, new URLSearchParams({ s: section, ...(scope !== "all" ? { scope } : {}) }))} />
      <History key={scope} section={section} list={list} lit={metric ? LIT[metric] : []} />
    </section>
  );
}

function Stat({ label, value, sub, untracked = false, help, chart }: {
  label: string; value: string; sub?: string; untracked?: boolean; help?: string;
  /** A tile the Form chart can draw: a button that puts it on the chart. */
  chart?: { on: boolean; pick: () => void };
}) {
  const body = (
    <>
      <span class="stat-l">{label}</span>
      <span class={`stat-v ${value.length > 9 ? "long" : ""}`}>{untracked ? "not tracked" : value}</span>
      {sub && !untracked && <span class="stat-s">{sub}</span>}
    </>
  );
  if (!chart || untracked) return <div class={`stat ${untracked ? "untracked" : ""}`} title={help}>{body}</div>;
  // The corner mark is a radio's ring, filled on the measure the chart
  // shows: a choice, never a picture of a trend (the user, 2026-11-05: a
  // rising line read as the player trending up).
  return (
    <button type="button" class="stat stat-pick" aria-pressed={chart.on} onClick={chart.pick}
            title={(help ? help + "\n" : "") + "Show on the Form chart"}>
      {body}
      <span class="stat-pick-mark" aria-hidden="true" />
    </button>
  );
}

function CareerView({ c, scope, earlier, metric, chartable, onPick, rating, section }: {
  c: Career | null; scope: string; earlier: string;
  metric: Metric | null; chartable: Metric[]; onPick: (m: Metric) => void;
  rating: PlayerRating | null; section: Section;
}) {
  if (!c) {
    const w = SCOPE_WORDS[scope];
    return <p class="muted">No {w ? w + " " : ""}matches with a result on record.</p>;
  }
  const noResults = c.no_results || 0;
  const { losses, decided, pct, kd, kpm } = careerFigures(c);
  const act = c.active_time || 0;
  const neobot = c.neobot_matches || 0;
  const onlyNeobot = neobot > 0 && neobot === c.matches;
  const chart = (m: Metric) => chartable.includes(m) ? { on: m === metric, pick: () => onPick(m) } : undefined;
  return (
    <>
      <div class="stats">
        {rating && (
          <Stat label="Rating" value={num(rating.rating)} sub={`#${num(rating.rank)} of ${num(rating.of)}`}
                help={`Over every ${section === "pub" ? "pub and private" : "league"} match with a win or a loss, ` +
                      `whichever button is chosen; bots are not rated. Everyone starts at ${num(rating.start)}.`}
                chart={chart("rating")} />
        )}
        <Stat label="Record" value={`${num(c.wins)}–${num(losses)}`}
              sub={`${pct}% of ${plural(decided, "decided match", "decided matches")}`} chart={chart("winpct")} />
        <Stat label="Matches" value={num(c.matches)}
              sub={noResults ? `${plural(noResults, "no result")}` : undefined} />
        <Stat label="K/D" value={kd} help="(kills − team kills) / (deaths + 1)" sub="rating" chart={chart("kd")} />
        <Stat label="KPM" value={kpm === "-" ? "–" : kpm} help="Kills per minute on the field" chart={chart("kpm")} />
        <Stat label="Kills" value={num(c.kills)} />
        <Stat label="Deaths" value={num(c.deaths)} />
        <Stat label="Team kills" value={num(c.teamkills)} untracked={c.teamkills == null} />
        <Stat label="Damage given" value={big(c.dmg_given)} help={num(c.dmg_given)}
              sub={c.kills ? `${num(Math.round(c.dmg_given / c.kills))} a kill` : undefined} />
        <Stat label="Damage taken" value={big(c.dmg_taken)} help={num(c.dmg_taken)} />
        <Stat label="Safe touches" value={num(c.safe_touches)} untracked={onlyNeobot || c.safe_touches == null} />
        <Stat label="Best streak" value={num(c.best_streak)} untracked={onlyNeobot || c.best_streak == null}
              sub={`${plural(c.streaks || 0, "streak")} · ${num(c.streak_ends)} ended`} />
        <Stat label="Attaches" value={num(c.attaches)} untracked={onlyNeobot || c.attaches == null}
              sub={c.attached_to != null ? `attached to ${num(c.attached_to)}×` : undefined} />
        {onlyNeobot && <Stat label="Attached to" value={num(c.attached_to)} untracked={c.attached_to == null} />}
        <Stat label="Repels" value={num(c.reps)} />
        <Stat label="Bursts" value={num(c.bursts)} />
        <Stat label="Field time" value={hours(act)} />
        <Stat label="Rounds" value={c.rounds ? `${num(c.rounds_won)}–${num(c.rounds - c.rounds_won)}` : "–"}
              untracked={onlyNeobot} sub={c.rounds ? "won–lost" : undefined} />
        {!!c.captained && <Stat label="Captained" value={num(c.captained)} />}
      </div>
      <p class="note">
        {onlyNeobot ? earlierNote(earlier)
          : neobot ? mixedNote(earlier, neobot, c.matches) + " " + TOUCH_NOTE : TOUCH_NOTE}
      </p>
    </>
  );
}

const PAGE = 25;

/** The run each point averages: the largest of these that is no more than
 * an eighth of the matches, so a short career is not one flat line and a
 * 5,000-match one is not all noise. */
const WINDOWS = [10, 20, 50, 100, 200, 500];
const MIN_FOR_TREND = 20;
const MAX_POINTS = 800;

type Metric = "rating" | "winpct" | "kd" | "kpm";
const METRICS: [Metric, string][] = [["rating", "Rating"], ["winpct", "Win%"], ["kd", "K/D"], ["kpm", "KPM"]];
/** Whether a match is in a measure's run: Win% counts decided matches, K/D
 * and KPM every match with a result, as a career does. */
const charted = (r: Played, m: Metric) => m === "winpct" ? r.result === "W" || r.result === "L" : r.result !== "-";
/** The list's column for each measure. */
type Col = "result" | "r" | "kpm";
const LIT: Record<Metric, Col[]> = { rating: ["result"], winpct: ["result"], kd: ["r"], kpm: ["kpm"] };

/** Form: one measure at a time over a run of matches, oldest on the left.
 * One line, so no legend: the buttons name it. Win% counts the run's decided
 * matches; K/D and KPM the run's matches with a result, as a career does.
 * The hairline is the career figure for the same matches. */
function FormChart({ list, career, metric, chartable, onMetric }: {
  list: Played[]; career: Career; metric: Metric; chartable: Metric[]; onMetric: (m: Metric) => void;
}) {
  const eligible = useMemo(() => [...list].reverse().filter((r) => charted(r, metric)), [list, metric]);
  // Too few matches for a trend: no chart at all (the section leaves it out),
  // rather than a heading over an apology.
  const head = <ChartHead title="Form" metric={metric} chartable={chartable} onMetric={onMetric} />;
  const window = [...WINDOWS].reverse().find((w) => w <= Math.max(WINDOWS[0], eligible.length / 8))!;
  // Sliding sums, so a 20,000-match career costs one pass.
  const values: number[] = [];
  let w = 0, l = 0, k = 0, tk = 0, d = 0, act = 0;
  eligible.forEach((r, i) => {
    w += r.result === "W" ? 1 : 0; l += r.result === "L" ? 1 : 0;
    k += r.kills; tk += r.teamkills || 0; d += r.deaths; act += r.active_time;
    if (i >= window) {
      const o = eligible[i - window];
      w -= o.result === "W" ? 1 : 0; l -= o.result === "L" ? 1 : 0;
      k -= o.kills; tk -= o.teamkills || 0; d -= o.deaths; act -= o.active_time;
    }
    if (i >= window - 1) {
      values.push(metric === "winpct" ? (w * 100) / (w + l)
        : metric === "kd" ? (k - tk) / (d + 1) : act >= 1 ? (k * 60) / act : 0);
    }
  });
  // A long career draws every stride-th point (the last always): the
  // crosshair still names an exact match.
  const stride = Math.ceil(values.length / MAX_POINTS);
  const picks = values.map((_, i) => i).filter((i) => i % stride === 0 || i === values.length - 1);
  const shown = picks.map((i) => values[i]);
  const f = careerFigures(career);
  const ref = metric === "winpct" ? (f.decided ? (career.wins * 100) / f.decided : 0)
    : metric === "kd" ? Number(f.kd) : f.kpm === "-" ? 0 : Number(f.kpm);
  const fmt = (v: number) => (metric === "winpct" ? `${pyRound(v)}%` : pyFixed(v, 2));
  const scale = metric === "winpct" ? { max: 100, ticks: [0, 25, 50, 75, 100] }
    : niceTicks(Math.max(...values, ref));
  const n = shown.length;
  const at = (j: number) => eligible[picks[j] + window - 1];
  const xTicks = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
  return (
    <>
      {head}
      <LineChart
        label={`${METRICS.find(([m]) => m === metric)![1]} over each run of ${window} matches; career ${fmt(ref)}`}
        xs={n} series={[{ id: metric, label: metric, cls: "viz-1", values: shown }]}
        yMax={scale.max} yTicks={scale.ticks} yFmt={metric === "winpct" ? (v) => `${v}%` : String}
        xTicks={xTicks} xFmt={(j) => num(picks[j] + window)}
        reference={{ y: ref, label: `career ${fmt(ref)}` }}
        tip={(j) => {
          const r = at(j);
          return {
            head: `Match #${r.id}${r.started_at ? " · " + shortDate(r.started_at) : ""}`,
            rows: [{ label: `last ${window} matches`, value: fmt(shown[j]) }],
            note: `${{ W: "Won", L: "Lost", N: "No result" }[r.result] || ""} ${r.score_for}–${r.score_against}`,
          };
        }}
      />
      <ChartNote>Each point is the {window} matches up to it, oldest on the left; the axis counts matches played.</ChartNote>
    </>
  );
}

function ChartHead({ title, metric, chartable, onMetric }: {
  title: string; metric: Metric; chartable: Metric[]; onMetric: (m: Metric) => void;
}) {
  return (
    <div class="chart-head">
      <h3>{title}</h3>
      <Pills label="Measure" value={metric} onChange={onMetric}
             options={METRICS.map(([m, t]) => [m, t, !chartable.includes(m)] as [Metric, string, boolean])} />
    </div>
  );
}

/** The rating after each match with a win or a loss, oldest on the left,
 * against the line everyone starts on. Every match of the section, whichever
 * button is chosen: a rating is one number for all of them. */
function RatingChart({ rating, all, section, chartable, onMetric }: {
  rating: PlayerRating; all: Played[]; section: Section; chartable: Metric[]; onMetric: (m: Metric) => void;
}) {
  const h = rating.history;
  const byId = useMemo(() => new Map(all.map((r) => [r.id, r])), [all]);
  const stride = Math.ceil(h.length / MAX_POINTS);
  const picks = h.map((_, i) => i).filter((i) => i % stride === 0 || i === h.length - 1);
  const shown = picks.map((i) => h[i][1]);
  const { min, max, ticks } = niceRange(Math.min(...shown, rating.start), Math.max(...shown, rating.start));
  const n = shown.length;
  const change = (i: number) => h[i][1] - (i > 0 ? h[i - 1][1] : rating.start);
  return (
    <>
      <ChartHead title="Rating" metric="rating" chartable={chartable} onMetric={onMetric} />
      <LineChart
        label={`Rating after each of ${num(h.length)} rated matches; now ${num(rating.rating)}`}
        xs={n} series={[{ id: "rating", label: "Rating", cls: "viz-1", values: shown }]}
        yMin={min} yMax={max} yTicks={ticks} yFmt={num}
        xTicks={[...new Set([0, Math.floor((n - 1) / 2), n - 1])]} xFmt={(j) => num(picks[j] + 1)}
        reference={{ y: rating.start, label: `start ${num(rating.start)}` }}
        tip={(j) => {
          const i = picks[j];
          const r = byId.get(h[i][0]);
          const d = change(i);
          return {
            head: `Match #${h[i][0]}${r?.started_at ? " · " + shortDate(r.started_at) : ""}`,
            rows: [{ label: "rating", value: num(h[i][1]) },
                   { label: "this match", value: d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "±0" }],
            note: r ? `${{ W: "Won", L: "Lost" }[r.result] || ""} ${r.score_for}–${r.score_against}` : undefined,
          };
        }}
      />
      <ChartNote>After each match with a win or a loss, oldest on the left; the axis counts them. Every {section === "pub" ? "pub and private" : "league"} match, whichever button is chosen.</ChartNote>
    </>
  );
}

/** Teammates and rivals (exporter/mates.py): the people played most with
 * and against in the matches the buttons pick, and the record in them. */
function Mates({ name, mates, players, compare }: {
  name: string; mates?: { with: MateRow[]; against: MateRow[] }; players: PlayerIndex;
  compare: (other: string) => string;
}) {
  if (!mates || (!mates.with.length && !mates.against.length)) return null;
  return (
    <div class="mates">
      <h3>Teammates and rivals</h3>
      <div class="records">
        <MateList title="Most often with" rows={mates.with} players={players} compare={compare} />
        <MateList title="Most often against" rows={mates.against} players={players} compare={compare} />
      </div>
      <p class="note">People only, in matches somebody won. W–L is {name}'s record in those matches; a count opens the two side by side.</p>
    </div>
  );
}

function MateList({ title, rows, players, compare }: {
  title: string; rows: MateRow[]; players: PlayerIndex; compare: (other: string) => string;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, MATES_SHOWN);
  return (
    <div class="record">
      <h3>{title}</h3>
      {rows.length === 0 ? <p class="muted small">Nobody.</p> : (
        <table class="data compact record-table">
          <thead><tr>
            <th scope="col">Player</th><th scope="col" class="n">Matches</th><th scope="col" class="n">W–L</th>
          </tr></thead>
          <tbody>
            {shown.map(([key, n, w, l]) => {
              const who = players.byKey.get(key)?.name || key;
              return (
                <tr>
                  <td class="record-who"><a href={playerHref(who)}>{who}</a></td>
                  <td class="n"><a href={compare(who)} title="The two side by side">{num(n)}</a></td>
                  <td class="n nowrap">{num(w)}–{num(l)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {rows.length > MATES_SHOWN && (
        <button type="button" class="link small" onClick={() => setAll(!all)}>
          {all ? `Show top ${MATES_SHOWN}` : `Show top ${rows.length}`}
        </button>
      )}
    </div>
  );
}
const MATES_SHOWN = 5;

/** The board's KPM, "-" with no field time, as the list draws a blank. */
const dashed = (v: string) => (v === "-" ? <span class="muted">–</span> : v);

function History({ section, list, lit }: { section: Section; list: Played[]; lit: Col[] }) {
  const hl = (col: Col, cls: string) => (lit.includes(col) ? `${cls} hl` : cls);
  const [page, setPage] = useState(0);
  const pages = Math.ceil(list.length / PAGE);
  return (
    <div class="history">
      <div class="card-head">
        <h3>Matches</h3>
        <span class="muted small">{num(list.length)} played</span>
      </div>
      {list.length === 0 ? <p class="muted">None.</p> : (
        <div class="scroll">
          <table class="data">
            <thead><tr>
              <th scope="col">Date</th><th scope="col">Match</th><th scope="col">Kind</th>
              <th scope="col" class={hl("result", "c")}>Result</th><th scope="col" class="c">Score</th>
              <th scope="col" class="n" title="Kills">K</th><th scope="col" class="n" title="Deaths">D</th>
              <th scope="col" class={hl("r", "n")} title="Rating">R</th>
              <th scope="col" class={hl("kpm", "n")} title="Kills per minute on the field">KPM</th>
              <th scope="col" class="n" title="Damage given">DG</th>
              <th scope="col" class="n" title="Safe touches that scored">ST</th>
              <th scope="col" class="n" title="Time on the field">Time</th>
            </tr></thead>
            <tbody>
              {list.slice(page * PAGE, page * PAGE + PAGE).map((h) => (
                <tr>
                  <td class="nowrap" title={h.started_at ? date(h.started_at) : "No date was recorded"}>
                    {h.started_at ? shortDate(h.started_at) : <span class="muted">–</span>}
                  </td>
                  <td><a href={matchHref(section, h.id)}>#{h.id}</a></td>
                  <td class="nowrap">{h.kind}{h.team && <span class="muted"> · {h.team}</span>}</td>
                  <td class={hl("result", "c")}><Result r={h.result} /></td>
                  <td class="c nowrap">{h.score_for}–{h.score_against}</td>
                  <td class="n">{h.kills}</td><td class="n">{h.deaths}</td>
                  <td class={hl("r", "n")}>{pyFixed(rating(h.kills, h.teamkills, h.deaths), 2)}</td>
                  <td class={hl("kpm", "n")}>{dashed(rowKpm(h))}</td>
                  <td class="n">{num(h.dmg_given)}</td>
                  <td class="n">{h.safe_touches ?? <span class="muted">–</span>}</td>
                  <td class="n">{duration(h.active_time)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} pages={pages} onPage={setPage} />
    </div>
  );
}
