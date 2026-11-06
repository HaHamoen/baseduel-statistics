import { useMemo, useState } from "preact/hooks";
import {
  addDays, between, heat, localClock, mondayOf, peopleMatches, perDay, perWeek, type Tally,
} from "../activity";
import { BarChart, niceTicks } from "../charts";
import { getFacts, getMeta, getPlayers, type Section } from "../data";
import { date, hours, num, plural } from "../format";
import { navigate } from "../router";
import { Loading, Pills, Problem, useLoad, useTitle } from "../ui";

const WEEK = 7 * 86400;
const CHART_DAYS = 56;
// Calendar days are "YYYY-MM-DD" on the viewer's calendar; shown at UTC
// midnight so no time zone moves them.
const at = (day: string) => new Date(`${day}T00:00:00Z`);
const DAY = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const SHORT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" });
const WEEKDAYS = new Intl.DateTimeFormat(undefined, { weekday: "long", timeZone: "UTC" });
const HOUR = new Intl.DateTimeFormat(undefined, { hour: "numeric" });
const A_MONDAY = "2026-11-02";
const hourAt = (h: number) => new Date(2026, 10, 2, h);
const hourRange = (h: number) => {
  const f = HOUR as Intl.DateTimeFormat & { formatRange?: (a: Date, b: Date) => string };
  return f.formatRange ? f.formatRange(hourAt(h), hourAt(h + 1)) : `${HOUR.format(hourAt(h))}–${HOUR.format(hourAt(h + 1))}`;
};

/** When matches are played and by how many people: the last 7 days, each
 * day, each hour of the week, each week. Dated matches a person played in. */
export function Activity({ query }: { query: URLSearchParams }) {
  useTitle("Activity");
  const section: Section = query.get("s") === "league" ? "league" : "pub";
  const [got, error] = useLoad(() => Promise.all([getFacts(section), getPlayers(), getMeta()]), [section]);
  const data = useMemo(() => {
    if (!got || !got[0]) return null;
    const [facts, players, meta] = got;
    const flag = section === "pub" ? "pub_bot" : "league_bot";
    const firstCol = section === "pub" ? "pub_first" : "league_first";
    const ms = peopleMatches(facts, (k) => !!players.byKey.get(k)?.[flag], meta?.sections[section].unfinished ?? true);
    if (!ms.length) return null;
    const first = (k: string) => players.byKey.get(k)?.[firstCol] ?? null;
    // "Now" is when the data was exported: the last 7 days, and the days
    // and weeks run up to it.
    const now = Math.max(meta?.built ?? 0, ms[ms.length - 1].at);
    return { ms, first, now, days: perDay(ms, localClock, first, now), weeks: perWeek(ms, localClock, first, now),
             grid: heat(ms, localClock) };
  }, [got]);

  const head = (
    <header class="page-head">
      <h1>Activity</h1>
      <div class="filters">
        <Pills label="Section" value={section} onChange={(s) => navigate(s === "league" ? "/activity?s=league" : "/activity", true)}
               options={[["pub", "Pub arena"], ["league", "League"]]} />
      </div>
    </header>
  );
  if (error) return <Problem error={error} />;
  if (!got) return <>{head}<Loading /></>;
  const meta = got[2];
  if (!data) return <>{head}<section class="card"><p class="muted">No dated matches yet.</p></section></>;
  const { ms, first, now, days, weeks, grid } = data;

  const last = between(ms, now - WEEK, now, first);
  const before = between(ms, now - 2 * WEEK, now - WEEK, first);
  const today = localClock(now).day;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // The last 8 weeks of days: longer, and a phone's bars are hairlines.
  const recent = days.slice(-CHART_DAYS);
  const { max, ticks } = niceTicks(Math.max(...recent.map((d) => d.matches)));
  const began = section === "pub" ? meta?.sections.pub.first_started : ms[0].at;

  return (
    <>
      {head}
      <section class="card">
        <h2>Last 7 days</h2>
        <div class="stats">
          <Tile label="Matches" now={last.matches} then={before.matches} />
          <Tile label="People" now={last.people} then={before.people} />
          <Tile label="New players" now={last.fresh} then={before.fresh} />
          <Tile label="Time played" now={last.seconds} then={before.seconds} fmt={hours} />
        </div>
        <p class="note">Up to {date(now)}, against the 7 days before.</p>
      </section>

      <section class="card">
        <h2>Matches a day</h2>
        <BarChart label={`Matches a day from ${SHORT.format(at(recent[0].day))} to ${SHORT.format(at(recent[recent.length - 1].day))}`}
                  values={recent.map((d) => d.matches)} yMax={max} yTicks={ticks} yFmt={num}
                  xTicks={recent.flatMap((d, i) => (mondayOf(d.day) === d.day ? [i] : []))}
                  xFmt={(i) => SHORT.format(at(recent[i].day))}
                  tip={(i) => ({ head: DAY.format(at(recent[i].day)), rows: tipRows(recent[i]) })} />
        {days.length > CHART_DAYS && <p class="note">The last 8 weeks. Week by week, below, goes back to {date(ms[0].at)}.</p>}
      </section>

      <section class="card">
        <h2>When matches are played</h2>
        <Heat grid={grid} />
        <p class="note">Matches started in each hour of the week, since {date(ms[0].at)}. Days and hours are in your time zone ({tz}).</p>
      </section>

      <section class="card">
        <h2>Week by week</h2>
        <div class="scroll">
          <table class="data weeks-table">
            <thead><tr>
              <th scope="col">Week</th><th scope="col" class="n">Matches</th><th scope="col" class="n">People</th>
              <th scope="col" class="n">New</th><th scope="col" class="n">Played</th>
            </tr></thead>
            <tbody>
              {[...weeks].reverse().map((w) => (
                <tr>
                  <th scope="row" class="nowrap">{SHORT.format(at(w.week))}{addDays(w.week, 7) > today ? <span class="so-far">so far</span> : null}</th>
                  <td class="n">{num(w.matches)}</td>
                  <td class="n">{num(w.people)}</td>
                  <td class="n">{num(w.fresh)}</td>
                  <td class="n">{w.matches ? hours(w.seconds) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p class="note">Weeks start on Monday. New: people playing their first {section === "pub" ? "pub" : "league"} match. Played: time played, as each match's clock has it.
          {section === "league" ? ` The league began on ${date(began)}, so everyone in its first week is new.` : ""}</p>
      </section>
      <p class="note">Every match a person played in; matches of bots alone are left out{section === "league" ? ", and so are league matches nobody won" : ""}.
        {section === "pub" && began ? ` Matches before ${date(began)} recorded no dates, so they are not here, and a player who played one is not new.` : ""}</p>
    </>
  );
}

function tipRows(t: Tally) {
  return [
    { label: t.matches === 1 ? "match" : "matches", value: num(t.matches) },
    { label: t.people === 1 ? "person" : "people", value: num(t.people) },
    { label: "new", value: num(t.fresh) },
    { label: "played", value: hours(t.seconds) },
  ];
}

function Tile({ label, now, then, fmt = num }: { label: string; now: number; then: number; fmt?: (n: number) => string }) {
  return (
    <div class="stat">
      <span class="stat-l">{label}</span>
      <span class="stat-v">{fmt(now)}</span>
      <span class="stat-s">{fmt(then)} the week before</span>
    </div>
  );
}

/** Weekdays down, hours across; one hue, darker for more matches, in four
 * steps of the busiest hour. Hover, or focus and the arrow keys, reads an
 * hour in the line below; with none picked it names the busiest. */
function Heat({ grid }: { grid: number[][] }) {
  const [on, setOn] = useState<[number, number] | null>(null);
  const max = Math.max(1, ...grid.flat());
  let busiest: [number, number] = [0, 0];
  grid.forEach((row, w) => row.forEach((v, h) => { if (v > grid[busiest[0]][busiest[1]]) busiest = [w, h]; }));
  const level = (v: number) => (v === 0 ? 0 : Math.ceil((v / max) * 4));
  const [w, h] = on ?? busiest;
  const said = `${WEEKDAYS.format(at(addDays(A_MONDAY, w)))}s, ${hourRange(h)}: ${plural(grid[w][h], "match", "matches")}`;
  const move = (dw: number, dh: number) => {
    const [cw, ch] = on ?? busiest;
    setOn([(cw + dw + 7) % 7, (ch + dh + 24) % 24]);
  };
  return (
    <div class="heat-wrap">
      <div class="heat" tabIndex={0} role="img" aria-label={`Matches by hour of the week. Busiest: ${said}`}
           onPointerLeave={() => setOn(null)} onBlur={() => setOn(null)}
           onKeyDown={(e) => {
             const d = ({ ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] } as Record<string, number[]>)[e.key];
             if (!d) return;
             move(d[0], d[1]);
             e.preventDefault();
           }}>
        {grid.map((row, wd) => (
          <>
            <span class="heat-day" style={{ gridRow: wd + 1 }}>{WEEKDAY.format(at(addDays(A_MONDAY, wd)))}</span>
            {row.map((v, hr) => (
              <span class={`heat-cell l${level(v)}${on && on[0] === wd && on[1] === hr ? " on" : ""}`}
                    style={{ gridRow: wd + 1, gridColumn: hr + 2 }}
                    onPointerEnter={() => setOn([wd, hr])} onPointerDown={() => setOn([wd, hr])} />
            ))}
          </>
        ))}
        {[0, 3, 6, 9, 12, 15, 18, 21].map((hr) => (
          <span class={`heat-hour${hr % 6 ? " minor" : ""}`} style={{ gridRow: 8, gridColumn: `${hr + 2} / span 3` }}>
            {HOUR.format(hourAt(hr))}
          </span>
        ))}
      </div>
      <div class="heat-foot">
        <p class="heat-said" aria-live="polite">{on ? said : `Busiest: ${said}`}</p>
        <span class="heat-key" aria-hidden="true">
          Fewer {[0, 1, 2, 3, 4].map((l) => <span class={`heat-cell l${l}`} />)} More
        </span>
      </div>
    </div>
  );
}
