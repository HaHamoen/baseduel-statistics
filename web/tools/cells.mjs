// What the site draws, for every match and career, as plain JSON, so
// tests/test_site_parity.py can hold it against PyCore's own board code.
// Runs the site's real modules (board.ts, career.ts, matchinfo.ts),
// bundled with esbuild.
//   node tools/cells.mjs <data-dir> <out.json>
import { build } from "esbuild";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [data, out] = process.argv.slice(2);
const here = new URL("..", import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), "bd-cells-"));
const entry = join(tmp, "entry.ts");
writeFileSync(entry, `
export * from ${JSON.stringify(join(here, "src/board.ts"))};
export * from ${JSON.stringify(join(here, "src/career.ts"))};
export * from ${JSON.stringify(join(here, "src/matchinfo.ts"))};
export * from ${JSON.stringify(join(here, "src/leaderboard.ts"))};
export { rows } from ${JSON.stringify(join(here, "src/data.ts"))};
export * from ${JSON.stringify(join(here, "src/played.ts"))};
export * from ${JSON.stringify(join(here, "src/compare.ts"))};
export * from ${JSON.stringify(join(here, "src/bases.ts"))};
export * from ${JSON.stringify(join(here, "src/activity.ts"))};
`);
await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node",
  outfile: join(tmp, "site.mjs"), logLevel: "error" });
const site = await import(pathToFileURL(join(tmp, "site.mjs")).href);
rmSync(tmp, { recursive: true });

const load = (rel) => JSON.parse(readFileSync(join(data, rel), "utf8"));
// Each team's heading as the bot's "line" item reads, then its rows.
const flat = (groups) => groups.flatMap((g) => [
  ["#line", (g.verdict ? `${g.verdict}: ` : "") + g.label + (g.captain ? `, captain ${g.captain}` : "")],
  ...g.rows.map((r) => [(r.leftEarly ? `(${r.name})` : r.name) + (r.marker ? ` *${r.marker}` : ""), ...r.cells]),
  ...(g.team ? [["Team", ...g.team.cells]] : []),
]);
const hl = (records) => site.highlights(records).map((h) => [h.label, h.names, h.more, h.value]);

// history: each player's match list as its KPM column reads, by match.
const result = { careers: {}, boards: {}, history: {} };
const listed = (key, name, h) => (result.history[key] ??= []).push([name, site.rowKpm(h)]);
for (const p of site.rows(load("players.json"))) {
  const doc = load(`p/${p.key}.json`);
  for (const section of ["pub", "league"]) {
    if (!doc[section]) continue;
    for (const [scope, c] of Object.entries(doc[section].careers)) {
      if (c) result.careers[`${p.key}:${section}:${scope}`] = site.careerFigures(c);
    }
    for (const h of site.rows(doc[section].matches)) listed(`${section}:${h.id}`, p.name, h);
    for (const h of site.rows(doc[section].neobot)) listed(`neobot:${h.id}`, p.name, h);
  }
}
for (const section of ["pub", "league"]) {
  for (const f of readdirSync(join(data, "m", section))) {
    for (const [id, doc] of Object.entries(load(`m/${section}/${f}`))) {
      const players = site.rows(doc.players);
      const names = site.teamNames(section, doc.match, players.map((r) => r.freq));
      result.boards[`${section}:${id}`] = {
        rows: flat(site.ownBoard(players, doc.match.winner_freq, doc.match.played_seconds, names)),
        highlights: hl(players),
      };
    }
  }
}
for (const f of readdirSync(join(data, "m", "neobot"))) {
  for (const [id, doc] of Object.entries(load(`m/neobot/${f}`))) {
    const players = site.rows(doc.players);
    result.boards[`neobot:${id}`] = {
      rows: flat(site.neobotBoard(site.rows(doc.lines), players, doc.match.winner_freq, doc.match.active_seconds)),
      highlights: hl(players),
    };
  }
}
// The bases page, every line of both sections.
result.bases = {};
for (const section of ["pub", "league"]) {
  result.bases[section] = site.baseLines(site.rows(load(`rounds/${section}.json`)));
}

// The compare page's head to head for every teammates and rivals line on a
// sample of pages (each section's 20 busiest, and every key starting "0"):
// two ways to the same counts, held together by test_site_parity.
result.compare = {};
{
  const index = site.rows(load("players.json"));
  const sample = new Set(index.filter((p) => p.key.startsWith("0")).map((p) => p.key));
  for (const col of ["pub_played", "league_played"]) {
    [...index].sort((x, y) => y[col] - x[col]).slice(0, 20).forEach((p) => sample.add(p.key));
  }
  const lists = new Map();
  const listOf = (key, section) => {
    const k = key + ":" + section;
    if (!lists.has(k)) {
      const doc = load(`p/${key}.json`);
      lists.set(k, doc[section] ? site.played(section, doc[section]) : []);
    }
    return lists.get(k);
  };
  for (const key of sample) {
    const doc = load(`p/${key}.json`);
    for (const section of ["pub", "league"]) {
      for (const [scope, sides] of Object.entries(doc[section]?.mates || {})) {
        for (const [side, entries] of Object.entries(sides)) {
          for (const [other] of entries) {
            const t = site.tally(site.sharedMatches(listOf(key, section), listOf(other, section), scope), side === "with");
            result.compare[`${key}:${section}:${scope}:${side}:${other}`] = [t.matches, t.wins, t.losses];
          }
        }
      }
    }
  }
}
// Every leaderboard, everyone ranked, bots left off as the bots leave them.
result.leaderboards = {};
const index = new Map(site.rows(load("players.json")).map((p) => [p.key, p]));
const LB_SCOPES = { pub: ["all", "pub", "private", "hard", "neobot", "pub_all"], league: ["all", "league", "scrim", "pickup"] };
for (const section of ["pub", "league"]) {
  const facts = load(`facts/${section}.json`);
  const earlier = section === "pub" ? load("neobot/careers.json") : null;
  const flag = section === "pub" ? "pub_bot" : "league_bot";
  for (const scope of LB_SCOPES[section]) {
    for (const stat of Object.keys(site.STATS)) {
      const board = site.leaderboard(stat, site.SCOPES[scope], facts, earlier,
        (k) => !!index.get(k)?.[flag], (k) => index.get(k)?.name || k);
      result.leaderboards[`${section}:${scope}:${stat}`] =
        board.rows.map((r) => [r.key, r.value, r.matches, r.wins]);
    }
  }
}
// The activity page, both sections, with the clock in UTC: every day and
// week up to the export, the hour-of-the-week grid, and the last 7 days.
result.activity = {};
{
  const built = load("meta.json").built;
  for (const section of ["pub", "league"]) {
    const flag = section === "pub" ? "pub_bot" : "league_bot";
    const col = section === "pub" ? "pub_first" : "league_first";
    const ms = site.peopleMatches(load(`facts/${section}.json`), (k) => !!index.get(k)?.[flag]);
    const first = (k) => index.get(k)?.[col] ?? null;
    const now = Math.max(built, ms[ms.length - 1].at);
    result.activity[section] = {
      now, days: site.perDay(ms, site.utcClock, first, now), weeks: site.perWeek(ms, site.utcClock, first, now),
      heat: site.heat(ms, site.utcClock), last7: site.between(ms, now - 7 * 86400, now, first),
    };
  }
}
writeFileSync(out, JSON.stringify(result));
console.log(`${Object.keys(result.careers).length} careers, ${Object.keys(result.boards).length} boards, ` +
  `${Object.keys(result.leaderboards).length} leaderboards`);
