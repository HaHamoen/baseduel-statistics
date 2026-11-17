// Exercise the real TypeScript without a second implementation or test runtime.
import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: [new URL("../src/killlog.ts", import.meta.url).pathname],
  bundle: true, write: false, format: "esm", platform: "node", logLevel: "error",
});
const { playerKills, playerStreaks, minuteKills, loadReplayStats } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const kill = (t, killer, killed, teamKill = false, weapon = "bullet") => ({
  t, killer, killed, teamKill, weapon, killerFreq: 0, killedFreq: teamKill ? 0 : 1,
});
const kills = [
  kill(100, "Ann", "Bob"),
  kill(200, "ANN", "bob", false, "burst"),
  kill(300, "Ann", "Cy", true),
  kill(400, "Bob", "ann"),
  kill(500, "Cy", "Ann", true),
  kill(600, "Ann", "Ann", true),
];
const mine = playerKills(kills, "ann");
assert.deepEqual(mine.killed.map(({ name, n }) => [name, n]), [["Bob", 2]]);
assert.equal(mine.kills + mine.teamKilled.reduce((n, v) => n + v.n, 0), 3);
assert.equal(mine.deaths + mine.teamKilledBy.reduce((n, v) => n + v.n, 0), 2);
assert.deepEqual(mine.killed[0].weapons, { bullet: 1, burst: 1 });
assert.equal(playerKills(kills, "Ann", [200, 300]).kills, 1);
assert.equal(playerKills(kills, "Nobody").kills, 0);

// Team kills do not advance a reconstructed streak, but a team death or
// suicide resets it. A qualifying enemy streak is credited to its ender.
const run = Array.from({ length: 10 }, (_, i) => kill(i + 1, "Bob", `Victim ${i}`));
const streakLog = [
  ...run,
  kill(11, "Bob", "Cy", true),
  kill(12, "Ann", "BOB"),
  kill(13, "Ann", "Cy", true),
  kill(14, "Ann", "Bob"),
  kill(15, "Cy", "Ann", true),
  kill(16, "Ann", "Bob"),
  kill(17, "Ann", "Ann", true),
  kill(18, "Ann", "Bob"),
];
const ann = playerStreaks(streakLog, "ANN");
assert.deepEqual(ann.streaks.map((s) => s.kills.length), [2, 1, 1]);
assert.equal(ann.ended.length, 1);
assert.equal(ann.ended[0].kills.length, 10);
assert.equal(ann.ended[0].endedBy.t, 12);
assert.equal(playerStreaks(streakLog, "Ann", [5, 13]).ended.length, 0);
assert.equal(playerStreaks(streakLog, "Ann", [14, 15]).streaks[0].kills.length, 1);
assert.equal(playerStreaks(streakLog.map((k) => k.t === 12 ? { ...k, teamKill: true } : k), "Ann").ended.length, 0);
assert.deepEqual(playerStreaks([], "Ann"), { streaks: [], ended: [] });

// Quiet minutes must survive; boundary kills belong to the next minute.
// The last bucket is a count for a partial minute, not a fabricated KPM.
const minutes = minuteKills([
  kill(99, "Ann", "Bob"), kill(100, "ANN", "Bob"),
  kill(6099, "Ann", "Cy", true), kill(12100, "Ann", "Bob"),
  kill(12500, "Ann", "Bob"), kill(200, "Bob", "Ann"),
], "ann", [100, 12500]);
assert.deepEqual(minutes, [
  { start: 100, end: 6100, kills: 2 },
  { start: 6100, end: 12100, kills: 0 },
  { start: 12100, end: 12500, kills: 1 },
]);
assert.deepEqual(minuteKills([], "Ann", [100, 100]), []);
assert.deepEqual(minuteKills([kill(6000, "Ann", "Bob")], "Ann", [0, 12000]).map((m) => m.kills), [0, 1]);

// The same response supplies kills and item-use counts. A failed fetch
// must be reported and evicted so the next open can retry.
const originalFetch = globalThis.fetch;
let calls = 0;
const raw = {
  source: { endTick: 18000 },
  players: [{ player: 1, name: "Ann", shots: { repel: 4, burst: 2 } }, { player: 2, name: "Bob", shots: {} }],
  killLog: [{ t: 100, killer: 1, killed: 2, weapon: null, teamKill: false, killerFreq: 0, killedFreq: 1 }],
};
try {
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify(raw));
  };
  const [a, b] = await Promise.all([
    loadReplayStats("https://example.test/r/match"),
    loadReplayStats("https://example.test/r/match"),
  ]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  assert.equal(a.end, 18000);
  assert.equal(a.players[0].shots.repel, 4);
  assert.equal(a.kills[0].killer, "Ann");
  assert.equal(a.kills[0].weapon, "unknown");
  globalThis.fetch = async () => new Response("", { status: 503 });
  await assert.rejects(loadReplayStats("https://example.test/r/retry"), /503/);
  globalThis.fetch = async () => new Response(JSON.stringify(raw));
  assert.equal((await loadReplayStats("https://example.test/r/retry")).kills.length, 1);
} finally {
  globalThis.fetch = originalFetch;
}
console.log("killlog drilldowns: ok");
