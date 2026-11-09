// A league match's chat in the order it was said, between the rounds as they
// were played: a heading as each round starts, a line for how it ended (the
// point and the score after it), and the talk between rounds under its own
// label. Pure, so tests/test_site_parity.py holds it (through cells.mjs)
// against a reading of the replay written apart from it.
import { roundHow } from "./board";
import type { ChatDoc, RoundRow } from "./data";

export type ChatItem =
  /** a round starts: the replay's own round, attempt and base */
  | { kind: "round"; t: number; round: number; attempt: number; base: number }
  /** over the lines said between two rounds, or before the first */
  | { kind: "gap"; label: string }
  | { kind: "line"; t: number; name: string | null; spec: boolean; cmd: boolean; text: string }
  /** a round ends: its bd_rounds row (by seq), the score after it fa first */
  | { kind: "end"; t: number; seq: number; winner: number | null; score: [number, number]; how: string };

/** A bot or server command (!score, .gi, ?go, .?go bdl2), shown dimmed. One
 * or two marks then a letter, so "...yeah", "?" and "!!" stay talk. */
export function isCommand(text: string): boolean {
  return /^[!.?*]{1,2}[A-Za-z]/.test(text);
}

/** The label over what was said after a round, before the next one. */
function gapAfter(r: RoundRow | undefined, last: boolean): string {
  if (last) return "After the whistle";
  return r?.ended_by === "hold" ? "Timeout" : "Between rounds";
}

/** Every item in order. A line is in a round from its start up to (not
 * including) its end: one said on the tick the point was scored comes after
 * the point. A round the database has no row for keeps its heading and has
 * no end line; one that never closed runs to the next round's start, or to
 * the end. A gap label shows only over lines. */
export function chatTimeline(chat: ChatDoc, rounds: RoundRow[]): ChatItem[] {
  const bySeq = new Map(rounds.map((r) => [r.seq, r]));
  const out: ChatItem[] = [];
  const lines = chat.lines;
  let i = 0;
  const said = (until: number | null, label?: string) => {
    let fresh = true;
    for (; i < lines.length && (until === null || lines[i][0] < until); i++) {
      const [t, name, spec, text] = lines[i];
      if (fresh && label) out.push({ kind: "gap", label });
      fresh = false;
      out.push({ kind: "line", t, name, spec: spec === 1, cmd: isCommand(text), text });
    }
  };
  const first = chat.rounds[0];
  // before the first round: within a second of round 1's GO, or, when the
  // recording began during a round (match 117), that round's talk
  said(first ? first.start : null, first && first.round > 1 ? `Before round ${first.round}` : undefined);
  chat.rounds.forEach((r, k) => {
    const next = chat.rounds[k + 1];
    out.push({ kind: "round", t: r.start, round: r.round, attempt: r.attempt, base: r.base });
    said(r.end ?? (next ? next.start : null));
    if (r.end === null) return;
    const row = r.seq === null ? undefined : bySeq.get(r.seq);
    if (row) {
      out.push({ kind: "end", t: r.end, seq: row.seq, winner: row.winner_freq,
        score: [row.score_a, row.score_b], how: roundHow(row) });
    }
    said(next ? next.start : null, gapAfter(row, !next));
  });
  return out;
}

/** "Chat · 65 lines (21 public, 44 from spectators)". */
export function chatCounts(chat: ChatDoc): { total: number; spec: number; pub: number } {
  const spec = chat.lines.filter((l) => l[2] === 1).length;
  return { total: chat.lines.length, spec, pub: chat.lines.length - spec };
}
