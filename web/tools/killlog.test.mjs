// Exercise the real TypeScript without a second implementation or test runtime.
import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: 'export * from "./killlog"; export { highlights, highlightLeaders, sortBoardRows } from "./board";',
    resolveDir: new URL("../src", import.meta.url).pathname, loader: "ts",
  },
  bundle: true, write: false, format: "esm", platform: "node", logLevel: "error",
});
const { playerKills, playerStreaks, minuteKills, loadReplayStats, playerReplayPeaks, replayHighlights,
  highlights, highlightLeaders, sortBoardRows } =
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

// Rolling windows cross fixed-minute boundaries. Exactly 60 seconds apart
// is outside the same half-open window; input order and letter case vary.
const rolling = [11900, 5900, 6100, 11899].map((t) => kill(t, "ANN", "Bob"));
assert.deepEqual(playerReplayPeaks(rolling, "ann"), {
  killsMinute: 3, deathsMinute: 0, killsBeforeDying: 4, deathsBeforeKill: 0,
  killsMinuteWithoutDying: 3, deathsMinuteWithoutKilling: 0,
});
assert.equal(playerReplayPeaks(rolling, "BOB").deathsMinute, 3);
assert.equal(playerReplayPeaks([kill(0, "Ann", "Bob"), kill(6000, "Ann", "Bob")], "Ann").killsMinute, 1);
assert.equal(playerReplayPeaks([kill(0, "Ann", "Bob"), kill(6000, "Ann", "Bob")], "Ann").killsMinuteWithoutDying, 1);
assert.equal(playerReplayPeaks([kill(0, "Ann", "Bob"), kill(6000, "Ann", "Bob")], "Bob").deathsMinuteWithoutKilling, 1);
assert.equal(playerReplayPeaks([kill(5, "Ann", "Bob"), kill(5, "Ann", "Cy")], "Ann").killsMinute, 2);

// Team kills count in minute peaks. They reset a kill-free minute run, but
// not the existing enemy-kill-free death counter. Suicides count as deaths.
const deathRun = [
  kill(100, "Ann", "Bob"),
  kill(200, "Bob", "Ann"),
  kill(300, "Cy", "ANN", true),
  kill(400, "Ann", "Ann", true),
  kill(500, "ANN", "Cy", true),
  kill(600, "Bob", "Ann"),
  kill(700, "Ann", "Bob"),
  kill(800, "Bob", "Ann"),
];
assert.deepEqual(playerReplayPeaks(deathRun, "Ann"), {
  killsMinute: 3, deathsMinute: 5, killsBeforeDying: 1, deathsBeforeKill: 4,
  killsMinuteWithoutDying: 1, deathsMinuteWithoutKilling: 3,
});
assert.equal(playerReplayPeaks([...deathRun,
  ...[900, 1000, 1100, 1200, 1300].map((t) => kill(t, "Bob", "Ann")),
], "Ann").deathsBeforeKill, 6);
assert.deepEqual(playerReplayPeaks([], "Ann"), {
  killsMinute: 0, deathsMinute: 0, killsBeforeDying: 0, deathsBeforeKill: 0,
  killsMinuteWithoutDying: 0, deathsMinuteWithoutKilling: 0,
});
const splitLives = playerReplayPeaks([
  kill(0, "Ann", "Bob"), kill(100, "ANN", "Cy", true),
  kill(200, "Cy", "Ann", true),
  kill(300, "Ann", "Bob"), kill(400, "Ann", "Cy"),
], "ann");
assert.equal(splitLives.killsMinute, 4);
assert.equal(splitLives.killsMinuteWithoutDying, 2);

// Only scoreboard players qualify. Shared leaders keep the existing
// alphabetical order and three-name limit; absent metrics are not zeroes.
const names = ["Zoe", "Cy", "Bob", "Ann"];
const tied = replayHighlights(names.map((name) => kill(100, name, "Spectator")),
  names.map((player_name) => ({ player_name })));
assert.deepEqual(tied.map(({ ranking, ...summary }) => summary), [
  { group: "Kills", label: "Most kills in a minute", names: ["Ann", "Bob", "Cy"], more: 1, value: "1" },
  { group: "Kills", label: "Most enemy kills before dying", names: ["Ann", "Bob", "Cy"], more: 1, value: "1" },
  { group: "Kills", label: "Most kills in a minute without dying", names: ["Ann", "Bob", "Cy"], more: 1, value: "1" },
]);
assert.deepEqual(tied[0].ranking, ["Ann", "Bob", "Cy", "Zoe"].map((name) => ({ name, value: "1" })));
for (const h of replayHighlights(rolling, ["Ann", "Bob", "Cy"].map((player_name) => ({ player_name })))) {
  assert.equal(h.ranking.length, 3);
  assert.equal(h.ranking.at(-1).value, "0");
}
assert.deepEqual(replayHighlights([], [{ player_name: "Ann" }]), []);
assert.deepEqual(replayHighlights(rolling, []), []);

// Rankings are numeric (10 before 2), retain every tied player, and put
// unknown values after genuine zeroes without turning them into zeroes.
const ranked = highlightLeaders("Kills", "Numeric", [
  { player_name: "Zoe", score: 10 }, { player_name: "Bob", score: 2 },
  { player_name: "Ann", score: 10 }, { player_name: "Zero", score: 0 },
  { player_name: "Unknown", score: null },
], (r) => r.score);
assert.deepEqual(ranked.ranking, [
  { name: "Ann", value: "10" }, { name: "Zoe", value: "10" },
  { name: "Bob", value: "2" }, { name: "Zero", value: "0" },
  { name: "Unknown", value: null },
]);
const boardHighlights = highlights([
  { player_name: "Zoe", kills: 20, deaths: 1, teamkills: 0, active_time: 6000, attached_to: null },
  { player_name: "Ann", kills: 4, deaths: 1, teamkills: 0, active_time: 599, attached_to: 4 },
  { player_name: "Zero", kills: 0, deaths: 0, active_time: 0, attached_to: 0 },
  { player_name: "Missing" },
]);
assert.deepEqual(boardHighlights.find((h) => h.label === "Highest rated").ranking, [
  { name: "Zoe", value: "10.00" }, { name: "Ann", value: "2.00" },
  { name: "Missing", value: "0.00" }, { name: "Zero", value: "0.00" },
]);
assert.deepEqual(boardHighlights.find((h) => h.label === "Most attached to").ranking, [
  { name: "Ann", value: "4" }, { name: "Zero", value: "0" },
  { name: "Missing", value: null }, { name: "Zoe", value: null },
]);
assert.equal(boardHighlights.find((h) => h.label === "Most field time").ranking[0].value, "100m 00s");

// Sorting compares displayed numbers and elapsed time numerically, not
// lexically; it preserves the board and leaves untracked cells last.
const boardRows = [
  { name: "Ann", marker: null, cells: [2, "10.00", "10:00 (80%)", "-"] },
  { name: "Bob", marker: "S", cells: [10, "2.00", "9:59 (100%)", 0] },
  { name: "Cy", marker: null, cells: [0, "-", "1:00 (100%)", 12] },
];
const sortedNames = (column, direction) => sortBoardRows(boardRows, column, direction).map((r) => r.name);
assert.deepEqual(sortedNames(0, "descending"), ["Bob", "Ann", "Cy"]);
assert.deepEqual(sortedNames(0, "ascending"), ["Cy", "Ann", "Bob"]);
assert.deepEqual(sortedNames(1, "descending"), ["Ann", "Bob", "Cy"]);
assert.deepEqual(sortedNames(1, "ascending"), ["Bob", "Ann", "Cy"]);
assert.deepEqual(sortedNames(2, "descending"), ["Ann", "Bob", "Cy"]);
assert.deepEqual(sortedNames(2, "ascending"), ["Cy", "Bob", "Ann"]);
assert.deepEqual(sortedNames(3, "descending"), ["Cy", "Bob", "Ann"]);
assert.deepEqual(sortedNames(3, "ascending"), ["Bob", "Cy", "Ann"]);
const mixedNames = ["zed", "Ann", "BOB"].map((name) => ({ name, marker: null, cells: [1] }));
assert.deepEqual(sortBoardRows(mixedNames, -1, "ascending").map((r) => r.name), ["Ann", "BOB", "zed"]);
assert.deepEqual(sortBoardRows(mixedNames, -1, "descending").map((r) => r.name), ["zed", "BOB", "Ann"]);
assert.deepEqual(boardRows.map((r) => r.name), ["Ann", "Bob", "Cy"]);
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
