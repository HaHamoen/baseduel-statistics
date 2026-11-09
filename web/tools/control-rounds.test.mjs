// The round join of tools/control.mjs, on markers made up for it: rounds
// restarted (attempt 2 repeats its round number, so seq and round part ways),
// one restarted within a second of starting (so only the attempt tells the two
// tries apart), a round never closed, a round the bot has no row for. Real
// league data cannot show a wrong join: every round recorded so far has
// seq = round.
//   node tools/control-rounds.test.mjs
import assert from "node:assert/strict";
import { docRounds, findRounds, seqOf } from "./control-rounds.mjs";

const start = (t, round, attempt, base) => ({ kind: "roundStart", t, freq: null, detail: { round, attempt, base } });
const end = (t, kind, round, attempt) => ({ kind, t, freq: kind === "point" ? 0 : null, detail: { round, attempt } });
const doc = {
  markers: [
    start(100, 1, 1, 3), end(5000, "point", 1, 1),
    start(6000, 2, 1, 4), end(7000, "roundEnd", 2, 1),     // R2 restarted
    start(7100, 2, 2, 5), end(9000, "point", 2, 2),
    start(9500, 3, 1, 6), end(9580, "roundEnd", 3, 1),     // R3 restarted at once
    start(9650, 3, 2, 6),                                   // never closed
  ],
  botStats: { rounds: [
    { seq: 1, round: 1, attempt: 1, t0: 120, t1: 5000 },
    { seq: 2, round: 2, attempt: 1, t0: 6010, t1: 7000 },
    { seq: 3, round: 2, attempt: 2, t0: 7105, t1: 9000 },
    { seq: 4, round: 3, attempt: 1, t0: 9505, t1: 9580 },
    { seq: 5, round: 3, attempt: 2, t0: 9655, t1: null },
  ] },
};

assert.deepEqual(docRounds(doc).map((r) => [r.seq, r.round, r.attempt, r.base, r.start, r.end]), [
  [1, 1, 1, 3, 100, 5000], [2, 2, 1, 4, 6000, 7000], [3, 2, 2, 5, 7100, 9000],
  [4, 3, 1, 6, 9500, 9580], [5, 3, 2, 6, 9650, null],
]);
// the bot's row must start near the marker: a round it has none for has no seq
assert.equal(seqOf(doc, { round: 3, attempt: 1, start: 20000 }), null);
assert.deepEqual(docRounds({ markers: doc.markers }).map((r) => r.seq), [null, null, null, null, null]);
// a marker of another round does not close the open one
assert.deepEqual(findRounds([start(0, 1, 1, 2), end(50, "roundEnd", 2, 1), end(90, "point", 1, 1)])
  .map((r) => r.end), [90]);
console.log("control rounds: ok");
