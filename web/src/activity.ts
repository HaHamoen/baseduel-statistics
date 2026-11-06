// The activity page's numbers, from facts/<section>.json: when matches are
// played, and by how many people. Dated matches only (the earlier pub games
// recorded no dates), and only matches a person played in (records' rule).
// Days and hours are the viewer's own; test_site_parity holds every number
// against SQL with the clock in UTC.

import { rows, type Facts } from "./data";

/** Where a moment falls on a calendar. Monday is weekday 0. */
export interface Moment {
  day: string;
  weekday: number;
  hour: number;
}
export type Clock = (epoch: number) => Moment;

const pad = (n: number) => String(n).padStart(2, "0");
export const localClock: Clock = (t) => {
  const d = new Date(t * 1000);
  return { day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
           weekday: (d.getDay() + 6) % 7, hour: d.getHours() };
};
export const utcClock: Clock = (t) => {
  const d = new Date(t * 1000);
  return { day: d.toISOString().slice(0, 10), weekday: (d.getUTCDay() + 6) % 7, hour: d.getUTCHours() };
};

/** Calendar days, stepped as dates (a day is never 23 or 25 hours here). */
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
export const addDays = (day: string, n: number) =>
  new Date(asDate(day).getTime() + n * 86400000).toISOString().slice(0, 10);
export const mondayOf = (day: string) => addDays(day, -((asDate(day).getUTCDay() + 6) % 7));

export interface ActMatch {
  id: number;
  at: number;
  seconds: number;
  /** The people in it, bots left out. */
  people: string[];
}

/** Every dated match a person played in, oldest first. With `unfinished`
 * false (the league), only matches somebody won. */
export function peopleMatches(facts: Facts, isBot: (key: string) => boolean, unfinished = true): ActMatch[] {
  const people = new Map<number, Set<string>>();
  for (const p of rows<{ match_id: number; key: string }>(facts.players)) {
    if (isBot(p.key)) continue;
    if (!people.has(p.match_id)) people.set(p.match_id, new Set());
    people.get(p.match_id)!.add(p.key);
  }
  return rows<{ id: number; started_at: number | null; played_seconds: number; winner_freq: number | null }>(facts.matches)
    .filter((m) => m.started_at != null && people.has(m.id) && (unfinished || m.winner_freq != null))
    .map((m) => ({ id: m.id, at: m.started_at!, seconds: m.played_seconds, people: [...people.get(m.id)!] }))
    .sort((a, b) => a.at - b.at || a.id - b.id);
}

export interface Tally {
  matches: number;
  /** Different people who played. */
  people: number;
  /** People whose first match in the section this was. */
  fresh: number;
  /** Time played, as each match's clock has it. */
  seconds: number;
}

/** first(key): the player's first match in the section, earlier games
 * included (players.json `pub_first` / `league_first`). */
function tally(ms: ActMatch[], first: (key: string) => number | null): Tally {
  const people = new Set<string>();
  let fresh = 0;
  let seconds = 0;
  for (const m of ms) {
    seconds += m.seconds;
    for (const k of m.people) {
      people.add(k);
      if (first(k) === m.id) fresh++;
    }
  }
  return { matches: ms.length, people: people.size, fresh, seconds };
}

/** The matches started after `from` and up to `to` (epoch seconds). */
export const between = (ms: ActMatch[], from: number, to: number, first: (key: string) => number | null) =>
  tally(ms.filter((m) => m.at > from && m.at <= to), first);

/** Matches grouped by a calendar key, every key from the first present to
 * `through` (the data's own time, so a quiet spell at the end shows), empty
 * ones too, oldest first. */
function grouped(ms: ActMatch[], keyOf: (m: ActMatch) => string, step: (k: string) => string,
                 first: (key: string) => number | null, through: string): { key: string; t: Tally }[] {
  if (!ms.length) return [];
  const groups = new Map<string, ActMatch[]>();
  for (const m of ms) {
    const k = keyOf(m);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(m);
  }
  const keys = [...groups.keys()].sort();
  const end = keys[keys.length - 1] > through ? keys[keys.length - 1] : through;
  const out: { key: string; t: Tally }[] = [];
  for (let k = keys[0]; k <= end; k = step(k)) out.push({ key: k, t: tally(groups.get(k) || [], first) });
  return out;
}

/** Each day up to the day of `now`. */
export const perDay = (ms: ActMatch[], clock: Clock, first: (key: string) => number | null, now: number) =>
  grouped(ms, (m) => clock(m.at).day, (d) => addDays(d, 1), first, clock(now).day)
    .map(({ key, t }) => ({ day: key, ...t }));

/** Weeks from Monday, up to the week of `now`. */
export const perWeek = (ms: ActMatch[], clock: Clock, first: (key: string) => number | null, now: number) =>
  grouped(ms, (m) => mondayOf(clock(m.at).day), (d) => addDays(d, 7), first, mondayOf(clock(now).day))
    .map(({ key, t }) => ({ week: key, ...t }));

/** Matches started in each hour of each weekday: [weekday][hour]. */
export function heat(ms: ActMatch[], clock: Clock): number[][] {
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const m of ms) {
    const { weekday, hour } = clock(m.at);
    grid[weekday][hour]++;
  }
  return grid;
}
