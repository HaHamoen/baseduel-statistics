# bd-stats

Player profiles and match boards for the zone's base duel bots — the pub
arena (with Neobot's games before it) and the league — as a static site.

The exporter (`exporter/`, Python standard library) reads snapshots of the
bots' SQLite databases and writes JSON; the site (`web/`, Vite + TypeScript +
Preact) draws it. Every number matches what the bots print in game, and
`tools/check.sh` proves it against the bots' own code.

```
python3 -m exporter export --pub PUB.db --league LEAGUE.db --out web/public/data
cd web && npm ci && npx vite
```
