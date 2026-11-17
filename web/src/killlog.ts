// Who killed whom in a league match, from the kill log of its published
// replay (ss-replay's <id>.stats.json). The log covers the whole recording,
// so its totals can differ by a few from the bot's scoreboard, which counts
// the match's rounds; the match page says so.

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
  players: { player: number; name: string }[];
  killLog: RawKill[];
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

const cache = new Map<string, Promise<Kill[]>>();

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

/** One match's kills, fetched once. */
export function loadKills(replay: string): Promise<Kill[]> {
  const parts = replayParts(replay);
  if (!parts) return Promise.reject(new Error("No replay for this match"));
  const url = `${parts.origin}/data/${encodeURIComponent(parts.id)}.stats.json`;
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then(async (r) => {
      if (!r.ok) throw new Error(`The replay's kill log is not available (${r.status})`);
      const raw = (await r.json()) as RawStats;
      const names = new Map(raw.players.map((x) => [x.player, x.name]));
      return raw.killLog.map((k) => ({
        t: k.t,
        killer: names.get(k.killer) ?? "?",
        killed: names.get(k.killed) ?? "?",
        weapon: k.weapon ?? "unknown",
        teamKill: k.teamKill,
        killerFreq: k.killerFreq,
        killedFreq: k.killedFreq,
      }));
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
