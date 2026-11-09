// The chat of every league replay, as the recording kept it, for the Chat
// section of a league match page.
//   node tools/chat.mjs <ss-replay data dir> <out dir>
//
// ss-replay's transcoder keeps every chat event of the .rec in the replay
// (events[], type "chat"): public chat and the spectators' team chat, since
// record.c keeps team chat only on the spec freq. No private messages, no
// team chat from the playing teams, none of the bot's own announcements.
// Each line's t is in ticks (1/100 s) from the recording's start; so are the
// replay's markers, from which docRounds (control-rounds.mjs, the dashboard's
// own rounds) gives each round's start, end and seq.
//
// One file a replay, <out>/<replay id>.json:
//   {key, id, match, end, rounds: [{seq, round, attempt, base, start, end}],
//    lines: [[t, name, spec, text]]}
// rewritten only when the replay or this code changed (it reads no ss-replay
// code, so an ss-replay change parses nothing again). A replay that fails is
// a WARN and has no file. Prints one JSON line.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { docRounds } from "./control-rounds.mjs";

/** chatType 3 is team chat on the spectator freq (the replay shows it
 * yellow); 0 arena and 2 public are both said to everyone. */
export const CHAT_SPEC_TEAM = 3;

/** A replay document's chat and rounds, as the file holds them. */
export function chatOf(doc) {
  const names = new Map((doc.players ?? []).map((p) => [p.id, p.name]));
  const lines = [];
  for (const e of doc.events ?? []) {
    if (e.type !== "chat") continue;
    lines.push([e.t, e.player == null ? null : (names.get(e.player) ?? null),
      e.chatType === CHAT_SPEC_TEAM ? 1 : 0, e.text]);
  }
  const rounds = docRounds(doc).map((r) => ({
    seq: r.seq, round: r.round, attempt: r.attempt, base: r.base, start: r.start, end: r.end,
  }));
  return { end: doc.source?.endTick ?? null, rounds, lines };
}

/** What chatOf reads. Everything else (tracks and fires: 99% of a replay,
 * 130 of the 144-minute bdl2 match's 131 MB) is stepped over, not parsed. */
export const PARTS = ["source", "players", "events", "markers", "botStats"];

const QUOTE = 0x22, BACKSLASH = 0x5c, COLON = 0x3a, COMMA = 0x2c;
const OPEN_OBJ = 0x7b, CLOSE_OBJ = 0x7d, OPEN_ARR = 0x5b, CLOSE_ARR = 0x5d;
const isSpace = (b) => b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09;

/** The given top-level keys of a JSON object held as UTF-8 bytes, each value
 * parsed on its own, the rest stepped over. Parsing a whole replay to read its
 * chat took 770 MB for that match; this needs about the bytes themselves. Safe
 * on raw UTF-8: every byte of a multi-byte character is 0x80 or above, so none
 * is a quote, a bracket or a backslash. Malformed input throws. */
export function readParts(buf, keys) {
  const want = new Set(keys);
  const out = {};
  let i = 0;
  const skipSpace = () => { while (i < buf.length && isSpace(buf[i])) i++; };
  const expect = (b) => {
    skipSpace();
    if (buf[i] !== b) throw new Error(`replay JSON: ${String.fromCharCode(b)} expected at byte ${i}`);
    i++;
  };
  // i at an opening quote; returns past the closing one
  const skipString = () => {
    for (i++; i < buf.length; i++) {
      if (buf[i] === BACKSLASH) i++;
      else if (buf[i] === QUOTE) return ++i;
    }
    throw new Error("replay JSON: unterminated string");
  };
  // one value, nested or not: returns where it ends
  const skipValue = () => {
    skipSpace();
    if (buf[i] === QUOTE) return skipString();
    let depth = 0;
    while (i < buf.length) {
      const b = buf[i];
      if (b === QUOTE) { skipString(); continue; }
      if (b === OPEN_OBJ || b === OPEN_ARR) depth++;
      else if (b === CLOSE_OBJ || b === CLOSE_ARR) {
        if (depth === 0) return i;                 // a number, true, false or null, last in the object
        if (--depth === 0) return ++i;
      } else if (depth === 0 && (b === COMMA || isSpace(b))) return i;
      i++;
    }
    if (depth === 0) return i;
    throw new Error("replay JSON: unterminated value");
  };
  expect(OPEN_OBJ);
  skipSpace();
  if (buf[i] === CLOSE_OBJ) return out;
  for (;;) {
    skipSpace();
    if (buf[i] !== QUOTE) throw new Error(`replay JSON: key expected at byte ${i}`);
    const k0 = i;
    skipString();
    const key = JSON.parse(buf.subarray(k0, i).toString("utf8"));
    expect(COLON);
    skipSpace();
    const v0 = i;
    const v1 = skipValue();
    if (want.has(key)) out[key] = JSON.parse(buf.subarray(v0, v1).toString("utf8"));
    skipSpace();
    if (buf[i] === COMMA) { i++; continue; }
    expect(CLOSE_OBJ);
    return out;
  }
}

async function main() {
  const [data, out] = process.argv.slice(2);
  if (!data || !out) {
    console.error("usage: node tools/chat.mjs <ss-replay data dir> <out dir>");
    process.exit(2);
  }
  const codeHash = createHash("sha1").update(readFileSync(new URL(import.meta.url)))
    .update(readFileSync(new URL("./control-rounds.mjs", import.meta.url))).digest("hex");
  mkdirSync(out, { recursive: true });
  const index = JSON.parse(readFileSync(join(data, "index.json"), "utf8"));
  const tally = { read: 0, cached: 0, failed: 0, removed: 0, skipped: 0 };
  const keep = new Set();
  for (const e of index) {
    if (!e.match || !e.replay) { tally.skipped++; continue; }     // not a bot's match
    const file = join(out, `${e.id}.json`);
    keep.add(`${e.id}.json`);
    try {
      const rp = join(data, e.replay);
      const rs = statSync(rp);
      const key = createHash("sha1").update([codeHash, e.replay, rs.size, rs.mtimeMs].join("|")).digest("hex");
      if (existsSync(file)) {
        try {
          if (JSON.parse(readFileSync(file, "utf8")).key === key) { tally.cached++; continue; }
        } catch { /* unreadable: read it again */ }
      }
      const doc = readParts(gunzipSync(readFileSync(rp)), PARTS);
      writeFileSync(file + ".tmp", JSON.stringify({ key, id: e.id, match: e.match.id, ...chatOf(doc) }));
      renameSync(file + ".tmp", file);
      tally.read++;
    } catch (err) {
      console.error(`WARN ${e.id}: ${err?.message ?? err}`);
      rmSync(file, { force: true });      // never a chat from a replay that has changed since
      tally.failed++;
    }
  }
  // a replay taken down takes its chat with it
  for (const f of readdirSync(out)) {
    if (f.endsWith(".json") && !keep.has(f)) { rmSync(join(out, f)); tally.removed++; }
  }
  console.log(JSON.stringify({ chat: tally }));
}

// run as a script; imported (chat.test.mjs), it only lends chatOf
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
