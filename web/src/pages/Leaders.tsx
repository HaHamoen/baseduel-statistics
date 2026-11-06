import { useMemo, useState } from "preact/hooks";
import { getFacts, getMeta, getPlayers, getRatings, load, rows, type Section, type Table } from "../data";
import { leaderboard, SCOPES, STATS, type Stat } from "../leaderboard";
import { date, num, pyFixed, pyRound } from "../format";
import { navigate, playerHref } from "../router";
import { Loading, Pager, Pills, Problem, useLoad, useTitle } from "../ui";

const PAGE = 50;

const SCOPE_OPTIONS: Record<Section, [string, string][]> = {
  pub: [["all", "All"], ["pub_all", "Pub"], ["private", "Private"], ["hard", "Hard mode"]],
  league: [["all", "All"], ["league", "League"], ["scrim", "Scrim"], ["pickup", "Pickup"]],
};
/** A rating is not a !bdtop board: one number over every match, worked out
 * by the exporter (ratings.py), so none of the filters apply to it. */
type Board = Stat | "rating";
const STAT_ORDER: Board[] = ["rating", "kills", "kd", "kpm", "dmg", "dpm", "winpct", "wins", "matches",
  "deaths", "touches", "streak", "tk"];
const BOARD_LABEL = (b: Board) => (b === "rating" ? "Rating" : STATS[b].label);
const TIMES: [string, string][] = [["all", "All time"], ["30", "Last 30 days"], ["7", "Last 7 days"]];
/** A higher bar than the bot's own minimum, for a board without the
 * two-match players at the top. The bot's is the default. */
const MINIMUMS = [10, 50, 100, 500];

/** pubduel/board.py TOP_STAT_DISPLAY: how each board prints its value. */
function show(stat: Stat, v: number): string {
  switch (stat) {
    case "kd": case "kpm": return pyFixed(v, 2);
    case "dpm": return pyFixed(v, 0);
    case "winpct": return `${pyFixed(v, 0)}%`;
    default: return num(v);
  }
}

/** The leaderboards, every one !bdtop has, with its minimums and the bots
 * left off. The settings live in the address, so a board can be shared. */
export function Leaders({ query }: { query: URLSearchParams }) {
  useTitle("Leaderboards");
  const section: Section = query.get("s") === "league" ? "league" : "pub";
  const scopes = SCOPE_OPTIONS[section];
  const scope = scopes.some(([v]) => v === query.get("scope")) ? query.get("scope")! : "all";
  const stat = (STAT_ORDER as string[]).includes(query.get("stat") || "") ? query.get("stat") as Board : "kills";
  const rated = stat === "rating";
  const time = TIMES.some(([v]) => v === query.get("t")) ? query.get("t")! : "all";
  const bots = query.get("bots") === "1";
  const atLeast = MINIMUMS.includes(Number(query.get("min"))) ? Number(query.get("min")) : 0;
  const set = (patch: Record<string, string>) => {
    const q = new URLSearchParams({ s: section, scope, stat, t: time, ...(bots ? { bots: "1" } : {}),
      ...(atLeast ? { min: String(atLeast) } : {}), ...patch });
    if (q.get("bots") !== "1") q.delete("bots");
    if (!Number(q.get("min"))) q.delete("min");
    navigate(`/top?${q}`, true);
  };

  const [got, error] = useLoad(() => Promise.all([
    rated ? Promise.resolve(null) : getFacts(section),
    !rated && section === "pub" ? load<Table>("neobot/careers.json") : Promise.resolve(null),
    getPlayers(), getMeta(),
  ]), [section, rated]);
  const [page, setPage] = useState(0);

  const board = useMemo(() => {
    if (!got || stat === "rating") return null;
    const [facts, earlier, players] = got;
    if (!facts) return null;
    const flag = section === "pub" ? "pub_bot" : "league_bot";
    const since = time === "all" ? undefined : Date.now() / 1000 - Number(time) * 86400;
    return leaderboard(stat, SCOPES[scope], facts, earlier,
      (k) => !bots && !!players.byKey.get(k)?.[flag],
      (k) => players.byKey.get(k)?.name || k, since);
  }, [got, section, scope, stat, time, bots]);

  if (error) return <Problem error={error} />;
  const head = (
    <header class="page-head">
      <h1>Leaderboards</h1>
      <div class="filters">
        <Pills label="Section" value={section} onChange={(s) => { setPage(0); navigate(`/top?s=${s}&stat=${stat}`, true); }}
               options={[["pub", "Pub arena"], ["league", "League"]]} />
        {!rated && <>
        <Pills label="Which matches" value={scope} onChange={(v) => { setPage(0); set({ scope: v }); }} options={scopes} />
        <Pills label="When" value={time} onChange={(v) => { setPage(0); set({ t: v }); }} options={TIMES} />
        <label>At least{" "}
          <select value={String(atLeast)} onChange={(e) => { setPage(0); set({ min: (e.target as HTMLSelectElement).value }); }}>
            <option value="0">the bot's minimum</option>
            {MINIMUMS.map((m) => <option value={String(m)}>{m} matches</option>)}
          </select>
        </label>
        <label class="check">
          <input type="checkbox" checked={bots} onChange={(e) => { setPage(0); set({ bots: (e.target as HTMLInputElement).checked ? "1" : "0" }); }} />
          {" "}Show bots
        </label>
        </>}
      </div>
      <div class="filters">
        <span class="muted small">Rank by</span>
        <Pills label="Rank by" value={stat} onChange={(v) => { setPage(0); set({ stat: v }); }}
               options={STAT_ORDER.map((s) => [s, BOARD_LABEL(s)] as [Board, string])} />
      </div>
    </header>
  );
  if (rated) return <>{head}<RatingBoardView section={section} page={page} setPage={setPage} /></>;
  if (!got || !board) return <>{head}<Loading /></>;
  const [, , players, meta] = got;
  const { label, min, floor } = STATS[stat as Stat];
  const first = meta?.sections.pub.first_started;
  const ranked = atLeast ? board.rows.filter((r) => r.matches >= atLeast) : board.rows;
  const top = ranked[0]?.value || 0;
  const pages = Math.ceil(ranked.length / PAGE);
  // As !bdtop: the board's own stat is not repeated beside it.
  const cols = { matches: stat !== "matches", wins: stat !== "wins", winpct: stat !== "winpct", kd: stat !== "kd" };
  return (
    <>
      {head}
      <section class="card">
        <p class="muted small">
          {num(ranked.length)} ranked · at least {Math.max(min, atLeast)} match{Math.max(min, atLeast) === 1 ? "" : "es"}
          {floor ? ` and ${num(floor[1])} ${floor[0]}` : ""} · bots {bots ? "shown" : "left off"}
        </p>
        {section === "pub" && board.recentOnly && first && (
          <p class="note">{stat === "touches" ? "Safe touches" : "Kill streaks"} were recorded only from {date(first)}, so this board counts only the matches since then.</p>
        )}
        {section === "pub" && time !== "all" && SCOPES[scope].earlier && first && (
          <p class="note">Matches before {date(first)} have no dates, so a time range counts only the matches since then.</p>
        )}
        {ranked.length === 0 ? <p class="muted">Nobody has enough matches for this board yet.</p> : (
          <div class="scroll">
            <table class="data">
              <thead><tr>
                <th scope="col" class="n">#</th><th scope="col">Player</th>
                <th scope="col" class="lb-value">{label}</th>
                {cols.matches && <th scope="col" class="n" title="Matches played">Played</th>}
                {cols.wins && <th scope="col" class="n" title="Matches won">Won</th>}
                {cols.winpct && <th scope="col" class="n" title="Wins over decided matches">Win%</th>}
                {cols.kd && <th scope="col" class="n" title="(kills − team kills) / (deaths + 1)">K/D</th>}
              </tr></thead>
              <tbody>
                {ranked.slice(page * PAGE, page * PAGE + PAGE).map((r, i) => {
                  const p = players.byKey.get(r.key);
                  const decided = r.matches - r.noResults;
                  return (
                    <tr>
                      <td class="n rank">{page * PAGE + i + 1}</td>
                      <td class="nowrap">
                        <a href={playerHref(p?.name || r.key)}>{p?.name || r.key}</a>
                        {bots && p && (section === "pub" ? p.pub_bot : p.league_bot) && <span class="tag" style="margin-left:6px">bot</span>}
                      </td>
                      <td class="lb-value">
                        <strong>{show(stat as Stat, r.value)}</strong>
                        <span class="lb-bar" style={{ width: `${top > 0 ? Math.max(1, (r.value / top) * 100) : 0}%` }} />
                      </td>
                      {cols.matches && <td class="n">{num(r.matches)}</td>}
                      {cols.wins && <td class="n">{num(r.wins)}</td>}
                      {cols.winpct && <td class="n">{decided ? `${pyRound((r.wins * 100.0) / decided)}%` : "–"}</td>}
                      {cols.kd && <td class="n">{pyFixed(((r.kills - (r.teamkills || 0)) * 1.0) / (r.deaths + 1), 2)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} pages={pages} onPage={setPage} />
      </section>
    </>
  );
}

interface RatingRow { key: string; rating: number; matches: number; wins: number }

/** Everyone rated in the section, best first (exporter/ratings.py). */
function RatingBoardView({ section, page, setPage }: { section: Section; page: number; setPage: (p: number) => void }) {
  const [got, error] = useLoad(() => Promise.all([getRatings(section), getPlayers()]), [section]);
  if (error) return <Problem error={error} />;
  if (!got) return <Loading />;
  const [doc, players] = got;
  const list = doc ? rows<RatingRow>(doc) : [];
  const pages = Math.ceil(list.length / PAGE);
  const which = section === "pub" ? "pub and private" : "league";
  return (
    <section class="card">
      <p class="muted small">{num(list.length)} rated · every {which} match with a win or a loss · people only</p>
      {list.length === 0 ? <p class="muted">Nobody is rated yet.</p> : (
        <div class="scroll">
          <table class="data">
            <thead><tr>
              <th scope="col" class="n">#</th><th scope="col">Player</th>
              <th scope="col" class="n">Rating</th>
              <th scope="col" class="n" title="Matches with a win or a loss">Rated</th>
              <th scope="col" class="n" title="Matches won">Won</th>
              <th scope="col" class="n" title="Wins over rated matches">Win%</th>
            </tr></thead>
            <tbody>
              {list.slice(page * PAGE, page * PAGE + PAGE).map((r, i) => {
                const p = players.byKey.get(r.key);
                return (
                  <tr>
                    <td class="n rank">{page * PAGE + i + 1}</td>
                    <td class="nowrap"><a href={playerHref(p?.name || r.key)}>{p?.name || r.key}</a></td>
                    <td class="n"><strong>{num(r.rating)}</strong></td>
                    <td class="n">{num(r.matches)}</td>
                    <td class="n">{num(r.wins)}</td>
                    <td class="n">{pyRound((r.wins * 100.0) / r.matches)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} pages={pages} onPage={setPage} />
      <p class="note">Every {which} match somebody won is replayed in the order played, earlier matches first, and each
        player moves by their own win or loss: more for beating a stronger team. Bots are not rated, and a no result
        moves nobody. Everyone starts at {num(doc?.start ?? 1500)}. The number is a cautious one, so a few lucky
        wins cannot put a newcomer on top; it firms up with every match.</p>
    </section>
  );
}
