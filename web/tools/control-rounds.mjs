// The replay dashboard's rounds and their seq, copied from ss-replay main's
// web/src/dash.ts (findRounds, roundDamage): that file draws on a page and
// cannot be bundled for Node. tools/control.mjs uses them; tools/
// control-rounds.test.mjs holds them, a restarted round included, since every
// league round recorded so far has seq equal to its round number.

/** dash.ts roundDamage: the bot's round starts this near the marker. */
export const SEQ_TICKS = 300;

/** dash.ts findRounds: a roundStart opens a round, the next marker of the same
 * round and attempt closes it (end null: never closed, it runs to the end). */
export function findRounds(markers) {
  const out = [];
  let open = null;
  for (const k of markers) {
    if (k.kind === "roundStart") {
      open = { round: k.detail.round, attempt: k.detail.attempt, base: k.detail.base, start: k.t, end: null };
      out.push(open);
    } else if (open && open.end === null && k.detail.round === open.round && k.detail.attempt === open.attempt) {
      open.end = k.t;
    }
  }
  return out;
}

/** dash.ts roundDamage: the bot's own round, whose seq keys bd_rounds. Never
 * the round number alone: a restarted round repeats it. */
export function seqOf(doc, r) {
  const x = doc.botStats?.rounds.find((b) => b.t0 !== null && Math.abs(b.t0 - r.start) < SEQ_TICKS
    && b.round === r.round && b.attempt === r.attempt);
  return x ? x.seq : null;
}

/** A replay's rounds in the order played, each with its seq (null when the
 * bot has no row for it). */
export function docRounds(doc) {
  return findRounds(doc.markers ?? []).map((r) => ({ ...r, seq: seqOf(doc, r) }));
}
