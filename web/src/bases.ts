// The bases page's numbers, from rounds/<section>.json: one line a base of
// an arena (base 5 in bdeg is not base 5 in bdl). test_site_parity holds every
// line against SQL.

export interface RoundFact {
  match: number;
  arena: string | null;
  mode: string;
  base: number;
  counted: number;
  ended_by: string;
  /** Who won it: "a" the lower freq (0, or 100 in a private match), "b" the
   * higher, null for no point. */
  side: "a" | "b" | null;
  seconds: number;
}

export interface BaseLine {
  arena: string;
  base: number;
  /** Counted rounds, as a match's own round count has them. */
  rounds: number;
  /** Rounds somebody won, and by which side, and how. */
  decided: number;
  a: number;
  b: number;
  touch: number;
  wipe: number;
  /** Counted rounds nobody won: time ran out, a timeout was called, an
   * official set the score, or the match ended. */
  none: number;
  /** Rounds moved off this base by !nextbase (never counted). */
  skipped: number;
  /** The middle length of the rounds somebody won, in seconds. */
  median: number | null;
}

export function baseLines(facts: RoundFact[]): BaseLine[] {
  const lines = new Map<string, BaseLine & { lengths: number[] }>();
  for (const f of facts) {
    const arena = f.arena || "?";
    const k = `${arena}\u0000${f.base}`;
    if (!lines.has(k)) {
      lines.set(k, { arena, base: f.base, rounds: 0, decided: 0, a: 0, b: 0, touch: 0, wipe: 0,
        none: 0, skipped: 0, median: null, lengths: [] });
    }
    const l = lines.get(k)!;
    if (f.ended_by === "nextbase") { l.skipped++; continue; }
    if (!f.counted) continue;
    l.rounds++;
    if (!f.side) { l.none++; continue; }
    l.decided++;
    if (f.side === "a") l.a++; else l.b++;
    if (f.ended_by === "touch") l.touch++;
    if (f.ended_by === "wipe") l.wipe++;
    l.lengths.push(f.seconds);
  }
  return [...lines.values()].map(({ lengths, ...l }) => {
    const s = [...lengths].sort((x, y) => x - y);
    const m = s.length >> 1;
    return { ...l, median: s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null };
  }).sort((x, y) => (x.arena < y.arena ? -1 : x.arena > y.arena ? 1 : x.base - y.base));
}
