// Two players' head to head, from their own match lists: the matches both
// played, on the same freq (together) or not (against). The counts follow
// exporter/mates.py's rules, so a teammates or rivals line and the compare
// page always agree (test_site_parity holds them together): only matches
// somebody won, the record the first player's own (N in the count, in
// neither W nor L).

import { IN_SCOPE, type Played } from "./played";

export interface Shared {
  mine: Played;
  theirs: Played;
  together: boolean;
}

export interface Tally {
  matches: number;
  wins: number;
  losses: number;
}

/** Every match both played in the scope, newest first, the first player's
 * row beside the second's, from their `played()` lists. A player rowed twice
 * in one match (league #22) counts twice, as the bots count it. */
export function sharedMatches(a: Played[], b: Played[], scope: string): Shared[] {
  const theirs = new Map<number, Played[]>();
  for (const r of b) {
    if (!theirs.has(r.id)) theirs.set(r.id, []);
    theirs.get(r.id)!.push(r);
  }
  const out: Shared[] = [];
  for (const mine of a.filter(IN_SCOPE[scope])) {
    for (const t of theirs.get(mine.id) || []) out.push({ mine, theirs: t, together: mine.freq === t.freq });
  }
  return out;
}

export function tally(shared: Shared[], together: boolean): Tally {
  const t = { matches: 0, wins: 0, losses: 0 };
  for (const s of shared) {
    if (s.together !== together || s.mine.result === "-") continue;
    t.matches++;
    if (s.mine.result === "W") t.wins++;
    if (s.mine.result === "L") t.losses++;
  }
  return t;
}
