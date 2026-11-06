// The leaderboards: BaseduelDB.get_leaderboard and PubDuelDB.get_leaderboard
// (PyCore baseduel/db.py, pubduel/db.py), done in the browser over the facts
// file and the earlier matches' careers. Pure, so tools/cells.mjs can hold it
// against PyCore's own SQL for every stat and every scope the bot has.

import type { Table } from "./data";
import { rows } from "./data";
import { pySum } from "./format";

export type Stat = "kills" | "deaths" | "tk" | "touches" | "streak" | "matches" |
  "wins" | "dmg" | "kd" | "kpm" | "dpm" | "winpct";

/** _TOP_STATS: each board's minimum matches, and the volume floor that keeps
 * a player with 1 kill and 0 deaths off the top of the K/D board. */
export const STATS: Record<Stat, { label: string; min: number; floor?: [string, number] }> = {
  kills: { label: "Kills", min: 1 },
  deaths: { label: "Deaths", min: 1 },
  kd: { label: "K/D", min: 2, floor: ["kills + deaths", 50] },
  kpm: { label: "KPM", min: 2, floor: ["seconds on the field", 300] },
  dmg: { label: "Damage", min: 1 },
  dpm: { label: "Dmg/min", min: 2, floor: ["seconds on the field", 300] },
  winpct: { label: "Win%", min: 3, floor: ["decided matches", 3] },
  wins: { label: "Wins", min: 1 },
  matches: { label: "Played", min: 1 },
  touches: { label: "Touches", min: 1 },
  streak: { label: "Streak", min: 1 },
  tk: { label: "TK", min: 1 },
};

/** Boards the earlier matches have nothing for (NEOBOT_UNTRACKED_STATS):
 * with no narrowing, they count only the recent matches. */
export const RECENT_ONLY: Stat[] = ["touches", "streak"];

/** A scope: which matches. `earlier` adds the earlier matches' careers. */
export interface Scope {
  mode?: string;
  gameMode?: string;
  earlier: boolean;
  recent: boolean;
}

/** The bot's scopes, plus the site's combined pub ("pub_all"). */
export const SCOPES: Record<string, Scope> = {
  all: { earlier: true, recent: true },
  pub_all: { mode: "pub", earlier: true, recent: true },
  pub: { mode: "pub", earlier: false, recent: true },
  private: { mode: "private", earlier: false, recent: true },
  hard: { mode: "pub", gameMode: "hard", earlier: false, recent: true },
  neobot: { earlier: true, recent: false },
  league: { mode: "match", earlier: false, recent: true },
  scrim: { mode: "scrim", earlier: false, recent: true },
  pickup: { mode: "pickup", earlier: false, recent: true },
};

export interface LbRow {
  key: string;
  matches: number;
  wins: number;
  noResults: number;
  kills: number;
  deaths: number;
  teamkills: number | null;
  value: number;
}

export interface Board {
  rows: LbRow[];
  min: number;
  /** The earlier matches were left out because this board's stat is one
   * they never recorded. */
  recentOnly: boolean;
}

interface FactMatch { id: number; mode: string; game_mode: string | null; winner_freq: number | null; started_at: number | null }
interface FactPlayer {
  match_id: number; key: string; is_winner: number; no_result: number; kills: number;
  deaths: number; teamkills: number; safe_touches: number; best_streak: number;
  dmg_given: number; active_time: number;
}
interface EarlierCareer {
  key: string; matches: number; wins: number; no_results: number; kills: number;
  deaths: number; teamkills: number | null; dmg_given: number; active_time: number;
}

interface Acc {
  key: string; n: number; wins: number; nr: number; kills: number; deaths: number;
  tk: number | null; st: number | null; ks: number | null; dmg: number; act: number[];
}

// SQL's SUM and MAX skip NULL, and are NULL when everything was.
const add = (a: number | null, b: number | null) => (b == null ? a : (a ?? 0) + b);
const max = (a: number | null, b: number | null) => (b == null ? a : a == null ? b : Math.max(a, b));

/** get_leaderboard(stat, scope, exclude) with no limit: everyone ranked, in
 * order. `since` (epoch seconds) keeps only matches played from then on, and
 * with it the earlier matches, which have no date. */
export function leaderboard(stat: Stat, scope: Scope, facts: { matches: Table; players: Table },
                            earlier: Table | null, excluded: (key: string) => boolean,
                            name: (key: string) => string, since?: number): Board {
  const recentOnly = scope.earlier && scope.recent && RECENT_ONLY.includes(stat);
  const useEarlier = scope.earlier && !recentOnly && since == null;
  const groups = new Map<string, Acc>();
  const group = (key: string) => {
    let g = groups.get(key);
    if (!g) {
      g = { key, n: 0, wins: 0, nr: 0, kills: 0, deaths: 0, tk: null, st: null, ks: null, dmg: 0, act: [] };
      groups.set(key, g);
    }
    return g;
  };
  if (scope.recent) {
    const ok = new Set<number>();
    for (const m of rows<FactMatch>(facts.matches)) {
      if (m.winner_freq == null) continue;
      if (scope.mode && m.mode !== scope.mode) continue;
      if (scope.gameMode && m.game_mode !== scope.gameMode) continue;
      if (since != null && (m.started_at ?? 0) < since) continue;
      ok.add(m.id);
    }
    for (const p of rows<FactPlayer>(facts.players)) {
      if (!ok.has(p.match_id)) continue;
      const g = group(p.key);
      g.n += 1; g.wins += p.is_winner; g.nr += p.no_result || 0;
      g.kills += p.kills; g.deaths += p.deaths;
      g.tk = add(g.tk, p.teamkills); g.st = add(g.st, p.safe_touches);
      g.ks = max(g.ks, p.best_streak); g.dmg += p.dmg_given; g.act.push(p.active_time);
    }
  }
  if (useEarlier && earlier) {
    for (const c of rows<EarlierCareer>(earlier)) {
      if (!c.matches) continue;
      const g = group(c.key);
      g.n += c.matches; g.wins += c.wins; g.nr += c.no_results;
      g.kills += c.kills; g.deaths += c.deaths;
      // The tk board counts only the team kills recorded; every other
      // board reads a missing count as 0 (_NEOBOT_ROWS' COALESCE).
      g.tk = add(g.tk, stat === "tk" ? c.teamkills : c.teamkills ?? 0);
      g.dmg += c.dmg_given; g.act.push(c.active_time);
    }
  }
  const { min, floor } = STATS[stat];
  const out: LbRow[] = [];
  for (const g of groups.values()) {
    if (excluded(g.key)) continue;
    const act = pySum(g.act);
    const tk = g.tk ?? 0;
    const value: number | null = {
      kills: g.kills, deaths: g.deaths, tk: g.tk, touches: g.st, streak: g.ks,
      matches: g.n, wins: g.wins, dmg: g.dmg,
      kd: ((g.kills - tk) * 1.0) / (g.deaths + 1),
      kpm: act ? (g.kills * 60.0) / act : null,
      dpm: act ? (g.dmg * 60.0) / act : null,
      winpct: g.n - g.nr ? (g.wins * 100.0) / (g.n - g.nr) : null,
    }[stat];
    if (g.n < min || value == null) continue;
    if (floor) {
      const vol = stat === "kd" ? g.kills + g.deaths : stat === "winpct" ? g.n - g.nr : act;
      if (vol < floor[1]) continue;
    }
    out.push({ key: g.key, matches: g.n, wins: g.wins, noResults: g.nr, kills: g.kills,
      deaths: g.deaths, teamkills: g.tk, value });
  }
  // ORDER BY value DESC, matches DESC, LOWER(name) ASC
  const lower = (k: string) => name(k).replace(/[A-Z]/g, (c) => c.toLowerCase());
  out.sort((a, b) => b.value - a.value || b.matches - a.matches ||
    (lower(a.key) < lower(b.key) ? -1 : lower(a.key) > lower(b.key) ? 1 : 0));
  return { rows: out, min, recentOnly };
}
