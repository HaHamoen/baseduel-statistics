// Who killed whom in a league match, from the kill log of its published
// replay (ss-replay's <id>.stats.json). The log covers the whole recording,
// so its totals can differ by a few from the bot's scoreboard, which counts
// the match's rounds; the match page says so.

import { highlightLeaders, type Highlight, type HighlightGroup } from "./board";
import { fold } from "./format";

interface RawKill {
  t: number;
  killer: number;
  killed: number;
  weapon: string | null;
  teamKill: boolean;
  killerFreq: number;
  killedFreq: number;
}

interface RawStats {
  source: { endTick: number };
  players: { player: number; name: string; shots: Record<string, number> }[];
  killLog: RawKill[];
}

export interface ReplayStats {
  end: number;
  players: RawStats["players"];
  kills: Kill[];
}

export interface Kill {
  t: number;
  killer: string;
  killed: string;
  weapon: string;
  teamKill: boolean;
  killerFreq: number;
  killedFreq: number;
}

export interface Versus {
  name: string;
  freq: number;
  n: number;
  weapons: Record<string, number>;
}

export interface PlayerKills {
  /** Enemies this player killed, most first. */
  killed: Versus[];
  /** Enemies who killed this player, most first. */
  killedBy: Versus[];
  /** Teammates this player killed / who killed this player. */
  teamKilled: Versus[];
  teamKilledBy: Versus[];
  kills: number;
  deaths: number;
  weaponsOut: Record<string, number>;
  weaponsIn: Record<string, number>;
}

const cache = new Map<string, Promise<ReplayStats>>();

/** The replay's id from the match's replay link (https://host/r/<id>). */
export function replayParts(replay: string | null): { origin: string; id: string } | null {
  if (!replay) return null;
  try {
    const u = new URL(replay);
    const id = u.pathname.split("/").filter(Boolean).pop();
    return id ? { origin: u.origin, id } : null;
  } catch {
    return null;
  }
}

/** One recording's stats, fetched once. */
export function loadReplayStats(replay: string): Promise<ReplayStats> {
  const parts = replayParts(replay);
  if (!parts) return Promise.reject(new Error("No replay for this match"));
  const url = `${parts.origin}/data/${encodeURIComponent(parts.id)}.stats.json`;
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then(async (r) => {
      if (!r.ok) throw new Error(`The replay's kill log is not available (${r.status})`);
      const raw = (await r.json()) as RawStats;
      const names = new Map(raw.players.map((x) => [x.player, x.name]));
      const kills = raw.killLog.map((k) => ({
        t: k.t,
        killer: names.get(k.killer) ?? "?",
        killed: names.get(k.killed) ?? "?",
        weapon: k.weapon ?? "unknown",
        teamKill: k.teamKill,
        killerFreq: k.killerFreq,
        killedFreq: k.killedFreq,
      }));
      return { end: raw.source.endTick, players: raw.players, kills };
    });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

/** One player's side of the kill log, optionally within [from, to) ticks.
 * Names compare as the bot's do (`fold`): the replay may spell them with
 * other letter case than the database. */
export function playerKills(kills: Kill[], name: string, window?: [number, number]): PlayerKills {
  const me = fold(name);
  const out: PlayerKills = {
    killed: [], killedBy: [], teamKilled: [], teamKilledBy: [],
    kills: 0, deaths: 0, weaponsOut: {}, weaponsIn: {},
  };
  const tallies = {
    killed: new Map<string, Versus>(), killedBy: new Map<string, Versus>(),
    teamKilled: new Map<string, Versus>(), teamKilledBy: new Map<string, Versus>(),
  };
  const add = (bucket: Map<string, Versus>, other: string, freq: number, weapon: string) => {
    const key = fold(other);
    let v = bucket.get(key);
    if (!v) bucket.set(key, (v = { name: other, freq, n: 0, weapons: {} }));
    v.n++;
    bump(v.weapons, weapon);
  };
  for (const k of kills) {
    if (window && (k.t < window[0] || k.t >= window[1])) continue;
    const gave = fold(k.killer) === me;
    const took = fold(k.killed) === me;
    if (gave === took) continue; // not this player's, or a suicide
    if (gave) {
      if (k.teamKill) add(tallies.teamKilled, k.killed, k.killedFreq, k.weapon);
      else {
        out.kills++;
        bump(out.weaponsOut, k.weapon);
        add(tallies.killed, k.killed, k.killedFreq, k.weapon);
      }
    } else if (k.teamKill) add(tallies.teamKilledBy, k.killer, k.killerFreq, k.weapon);
    else {
      out.deaths++;
      bump(out.weaponsIn, k.weapon);
      add(tallies.killedBy, k.killer, k.killerFreq, k.weapon);
    }
  }
  const sorted = (m: Map<string, Versus>) =>
    [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  out.killed = sorted(tallies.killed);
  out.killedBy = sorted(tallies.killedBy);
  out.teamKilled = sorted(tallies.teamKilled);
  out.teamKilledBy = sorted(tallies.teamKilledBy);
  return out;
}

export interface Streak {
  kills: Kill[];
  endedBy?: Kill;
}

/** Reconstructed enemy-kill streaks, not the bot's recorded streak counters.
 * Any death resets a streak; team kills do not advance it. */
export function playerStreaks(kills: Kill[], name: string, window?: [number, number]) {
  const active = new Map<string, Kill[]>();
  const streaks: Streak[] = [];
  for (const k of [...kills].sort((a, b) => a.t - b.t)) {
    if (window && (k.t < window[0] || k.t >= window[1])) continue;
    const killer = fold(k.killer), killed = fold(k.killed);
    const ended = active.get(killed);
    if (ended?.length) streaks.push({ kills: ended, endedBy: k });
    active.delete(killed);
    if (killer === killed || k.teamKill) continue;
    const run = active.get(killer) ?? [];
    run.push(k);
    active.set(killer, run);
  }
  for (const run of active.values()) streaks.push({ kills: run });
  const me = fold(name);
  return {
    streaks: streaks.filter((s) => fold(s.kills[0].killer) === me),
    ended: streaks.filter((s) => s.kills.length >= 10 && s.endedBy &&
      !s.endedBy.teamKill && fold(s.endedBy.killer) === me && fold(s.endedBy.killed) !== me),
  };
}

/** Wall-clock recording minutes, including quiet minutes and a partial last
 * minute. These are counts, not the bot's active-field-time KPM. */
export function minuteKills(kills: Kill[], name: string, window: [number, number]) {
  const [start, end] = window;
  const buckets = Array.from({ length: Math.ceil(Math.max(0, end - start) / 6000) }, (_, i) => ({
    start: start + i * 6000, end: Math.min(end, start + (i + 1) * 6000), kills: 0,
  }));
  const me = fold(name);
  for (const k of kills) {
    if (k.t < start || k.t >= end || fold(k.killer) !== me || fold(k.killed) === me) continue;
    buckets[Math.floor((k.t - start) / 6000)].kills++;
  }
  return buckets;
}

/** Counts events within a half-open rolling 60-second window. */
function rollingMinutePeak(ticks: number[]): number {
  let left = 0, best = 0;
  for (let right = 0; right < ticks.length; right++) {
    while (ticks[right] - ticks[left] >= 6000) left++;
    best = Math.max(best, right - left + 1);
  }
  return best;
}

export function playerReplayPeaks(kills: Kill[], name: string) {
  const me = fold(name);
  const killsAt: number[] = [], deathsAt: number[] = [];
  let liveKills: number[] = [], killFreeDeaths: number[] = [];
  let killsMinuteWithoutDying = 0, deathsMinuteWithoutKilling = 0;
  let deaths = 0, deathsBeforeKill = 0;
  for (const k of [...kills].sort((a, b) => a.t - b.t)) {
    const gave = fold(k.killer) === me && fold(k.killed) !== me;
    if (gave) {
      killsAt.push(k.t);
      liveKills.push(k.t);
      deathsMinuteWithoutKilling = Math.max(deathsMinuteWithoutKilling, rollingMinutePeak(killFreeDeaths));
      killFreeDeaths = [];
      if (!k.teamKill) deaths = 0;
    }
    if (fold(k.killed) === me) {
      deathsAt.push(k.t);
      killFreeDeaths.push(k.t);
      killsMinuteWithoutDying = Math.max(killsMinuteWithoutDying, rollingMinutePeak(liveKills));
      liveKills = [];
      deathsBeforeKill = Math.max(deathsBeforeKill, ++deaths);
    }
  }
  const { streaks } = playerStreaks(kills, name);
  return {
    killsMinute: rollingMinutePeak(killsAt),
    deathsMinute: rollingMinutePeak(deathsAt),
    killsBeforeDying: Math.max(0, ...streaks.map((s) => s.kills.length)),
    deathsBeforeKill,
    killsMinuteWithoutDying: Math.max(killsMinuteWithoutDying, rollingMinutePeak(liveKills)),
    deathsMinuteWithoutKilling: Math.max(deathsMinuteWithoutKilling, rollingMinutePeak(killFreeDeaths)),
  };
}

export function replayHighlights(kills: Kill[], players: { player_name: string }[]): Highlight[] {
  const peaks = players.map((p) => ({ ...playerReplayPeaks(kills, p.player_name), player_name: p.player_name }));
  const categories: [HighlightGroup, string, keyof ReturnType<typeof playerReplayPeaks>][] = [
    ["Kills", "Most kills in a minute", "killsMinute"],
    ["Kills", "Most enemy kills before dying", "killsBeforeDying"],
    ["Deaths", "Most deaths in a minute", "deathsMinute"],
    ["Deaths", "Most deaths before a kill", "deathsBeforeKill"],
    ["Kills", "Most kills in a minute without dying", "killsMinuteWithoutDying"],
    ["Deaths", "Most deaths in a minute without killing", "deathsMinuteWithoutKilling"],
  ];
  const out: Highlight[] = [];
  for (const [group, label, key] of categories) {
    const h = highlightLeaders(group, label, peaks, (p) => p[key]);
    if (h) out.push(h);
  }
  return out;
}
