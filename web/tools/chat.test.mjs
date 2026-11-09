// tools/chat.mjs's chatOf on a replay made up for it: a pid the server gave
// to a second player (the transcoder's player id tells them apart, so the
// name is never the raw pid's), a spectator's line, a line before round 1, a
// line with no sender, and a round never closed.
//   node tools/chat.test.mjs
import assert from "node:assert/strict";
import { chatOf, PARTS, readParts } from "./chat.mjs";

const doc = {
  source: { endTick: 9000 },
  players: [
    { id: 0, name: "Ann", srcPids: [5] },
    { id: 1, name: "Bob", srcPids: [7] },
    { id: 2, name: "Cy", srcPids: [5] },      // pid 5 again, after Ann left
  ],
  markers: [
    { kind: "roundStart", t: 100, freq: null, detail: { round: 1, attempt: 1, base: 3 } },
    { kind: "point", t: 5000, freq: 0, detail: { round: 1, attempt: 1 } },
    { kind: "roundStart", t: 6000, freq: null, detail: { round: 2, attempt: 1, base: 4 } },
  ],
  botStats: { rounds: [
    { seq: 1, round: 1, attempt: 1, t0: 110, t1: 5000 },
    { seq: 2, round: 2, attempt: 1, t0: 6010, t1: null },
  ] },
  events: [
    { t: 40, type: "chat", player: 0, chatType: 2, sound: 0, text: "gl" },
    { t: 120, type: "enter", player: 1 },
    { t: 300, type: "chat", player: 1, chatType: 3, sound: 0, text: "how did they choke that" },
    { t: 5000, type: "chat", player: 2, chatType: 2, sound: 0, text: "!score" },
    { t: 7000, type: "chat", player: null, chatType: 0, sound: 0, text: "no sender" },
  ],
};

assert.deepEqual(chatOf(doc), {
  end: 9000,
  rounds: [
    { seq: 1, round: 1, attempt: 1, base: 3, start: 100, end: 5000 },
    { seq: 2, round: 2, attempt: 1, base: 4, start: 6000, end: null },
  ],
  lines: [
    [40, "Ann", 0, "gl"],
    [300, "Bob", 1, "how did they choke that"],
    [5000, "Cy", 0, "!score"],
    [7000, null, 0, "no sender"],
  ],
});
// a replay with no chat and no markers still has a file's worth
assert.deepEqual(chatOf({ source: { endTick: 50 }, players: [], events: [] }), { end: 50, rounds: [], lines: [] });

// readParts: the keys asked for, exactly as JSON.parse reads them, the rest
// stepped over. Brackets, quotes and backslashes inside strings, a key that
// is itself escaped, characters outside ASCII, scalars of every kind (the
// last one ending on the object's close), and both compact and indented JSON.
const tricky = {
  format: "ssreplay-json", version: 2, ratio: -1.5e-3, ok: true, none: null,
  tracks: [{ t: [1, 2, 3], name: "a]b}c{d[" }, { q: "she said \"hi\" \\ [" }],
  "we\"ird": { "x": "\\\"" },
  players: [{ id: 0, name: "Ünïcødé ☃ \u0001" }],
  events: [{ t: 5, type: "chat", player: 0, chatType: 2, text: "}]},{[\"" }],
  fires: [],
  last: 7,
};
const bytes = (o, sp) => Buffer.from(JSON.stringify(o, null, sp), "utf8");
for (const sp of [undefined, 2, "\t"]) {
  const b = bytes(tricky, sp);
  assert.deepEqual(readParts(b, Object.keys(tricky)), tricky);
  assert.deepEqual(readParts(b, ["players", "events", "missing"]), { players: tricky.players, events: tricky.events });
  assert.deepEqual(readParts(b, ["we\"ird", "last", "ratio", "none", "ok"]),
    { "we\"ird": tricky["we\"ird"], last: 7, ratio: -1.5e-3, none: null, ok: true });
}
assert.deepEqual(readParts(Buffer.from(" { } "), PARTS), {});
assert.deepEqual(readParts(bytes({ a: "only" }), ["a"]), { a: "only" });
assert.throws(() => readParts(Buffer.from('{"a": [1, 2'), ["a"]));
assert.throws(() => readParts(Buffer.from('{"a": "open'), ["a"]));
assert.throws(() => readParts(Buffer.from('[1, 2]'), ["a"]));
// what main reads is what chatOf needs: the same chat as from the whole doc
assert.deepEqual(chatOf(readParts(bytes(doc), PARTS)), chatOf(doc));
console.log("chat lines: ok");
