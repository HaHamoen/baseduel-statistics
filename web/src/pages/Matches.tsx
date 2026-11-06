import { useMemo, useState } from "preact/hooks";
import {
  getFacts, getMeta, getNeobotIndex, getPlayer, getPlayers, rows, type MatchRow,
  type NeobotMatchRow, type Section,
} from "../data";
import { date, duration, fold, num } from "../format";
import { earlierThan, freqsOf, kindLabel, outcomeWord, teamNames } from "../matchinfo";
import { matchHref, navigate } from "../router";
import { Loading, Pager, Pills, Problem, Team, useLoad, useTitle } from "../ui";

const PAGE = 50;

export function Matches({ tab }: { tab: Section }) {
  useTitle("Matches");
  return (
    <>
      <header class="page-head">
        <h1>Matches</h1>
        <Pills label="Which matches" value={tab} onChange={(t) => navigate(`/matches?s=${t}`, true)}
               options={[["pub", "Pub arena"], ["league", "League"]]} />
      </header>
      <MatchList key={tab} section={tab} />
    </>
  );
}

/** A match in the list, whichever bot recorded it. */
interface Listed {
  id: number;
  started_at: number | null;
  mode: string;
  game_mode: string | null;
  earlier: boolean;
  names: Map<number, string>;
  fa: number;
  fb: number;
  score_a: number;
  score_b: number;
  winner_freq: number | null;
  outcome: string;
  rounds: number | null;
  players: number | null;
  played: number;
  arena: string | null;
}

/** Every match of a section, newest first. In the pub arena that is the
 * earlier matches and the recent ones in one list (the user, 2026-11-05):
 * its numbers run in the order played, so newest first is by number. */
function MatchList({ section }: { section: Section }) {
  const [got, error] = useLoad(() => Promise.all([
    getFacts(section), section === "pub" ? getNeobotIndex() : Promise.resolve(null), getMeta(),
  ]), [section]);
  const [players] = useLoad(getPlayers, []);
  const [kind, setKind] = useState("all");
  const [arena, setArena] = useState("all");
  const [who, setWho] = useState("");
  const [showAborted, setShowAborted] = useState(true);
  const [page, setPage] = useState(0);

  const all = useMemo<Listed[]>(() => {
    if (!got) return [];
    const [facts, earlier] = got;
    const recent: Listed[] = rows<MatchRow>(facts?.matches).map((m) => {
      const [fa, fb] = freqsOf(m.mode);
      return {
        ...m, earlier: false, names: teamNames(section, m), fa, fb,
        rounds: m.rounds_counted, players: m.players ?? null, played: m.played_seconds,
      };
    });
    const old: Listed[] = rows<NeobotMatchRow>(earlier).map((g) => ({
      id: g.neobot_id, started_at: null, mode: "pub", game_mode: null, earlier: true,
      names: new Map([[0, "Freq 0"], [1, "Freq 1"]]), fa: 0, fb: 1,
      score_a: g.score_a, score_b: g.score_b, winner_freq: g.winner_freq, outcome: g.outcome,
      rounds: null, players: g.players ?? null, played: g.active_seconds, arena: null,
    }));
    return [...recent, ...old].sort((a, b) => b.id - a.id);
  }, [got, section]);

  // Only one player's matches: the ids in their own file, both eras.
  const whoKey = who.trim() ? players?.byFold.get(fold(who.trim()))?.key : undefined;
  const [whoDoc] = useLoad(() => (whoKey ? getPlayer(whoKey) : Promise.resolve(null)), [whoKey]);
  const whoIds = useMemo(() => {
    const sec = whoDoc?.[section];
    if (!sec) return new Set<number>();
    return new Set([...rows<{ id: number }>(sec.matches), ...rows<{ id: number }>(sec.neobot)].map((r) => r.id));
  }, [whoDoc, section]);

  const arenas = useMemo(() => [...new Set(all.filter((m) => m.arena).map((m) => m.arena!))].sort(), [all]);
  const list = useMemo(() => all.filter((m) => {
    if (kind === "hard" ? m.game_mode !== "hard" : kind !== "all" && m.mode !== kind) return false;
    if (arena !== "all" && m.arena !== arena) return false;
    if (!showAborted && m.winner_freq == null) return false;
    if (who.trim()) return whoIds.has(m.id);
    return true;
  }), [all, kind, arena, showAborted, who, whoIds]);

  if (error) return <Problem error={error} />;
  if (!got) return <Loading />;
  const kinds: [string, string][] = section === "pub"
    ? [["all", "All"], ["pub", "Pub"], ["private", "Private"], ["hard", "Hard mode"]]
    : [["all", "All"], ["match", "League"], ["scrim", "Scrim"], ["pickup", "Pickup"]];
  const pages = Math.ceil(list.length / PAGE);
  const shown = list.slice(page * PAGE, page * PAGE + PAGE);
  const reset = () => setPage(0);
  return (
    <section class="card">
      <div class="filters">
        <Pills label="Kind" value={kind} onChange={(v) => { setKind(v); reset(); }} options={kinds} />
        <label>Arena{" "}
          <select value={arena} onChange={(e) => { setArena((e.target as HTMLSelectElement).value); reset(); }}>
            <option value="all">All</option>
            {arenas.map((a) => <option value={a}>{a}</option>)}
          </select>
        </label>
        <label>Player{" "}
          <input type="search" value={who} placeholder="Any" aria-label="Only matches with this player"
                 onInput={(e) => { setWho((e.target as HTMLInputElement).value); reset(); }} />
        </label>
        <label class="check">
          <input type="checkbox" checked={showAborted}
                 onChange={(e) => { setShowAborted((e.target as HTMLInputElement).checked); reset(); }} />
          {" "}Matches with no result
        </label>
      </div>
      <p class="muted small">
        {num(list.length)} of {num(all.length)} matches
        {who.trim() && !whoKey ? " · no player by that name" : ""}
        {section === "pub" && list.some((m) => m.earlier) &&
          ` · matches ${earlierThan(got[2])} have no date, arena or rounds on record`}
      </p>
      <div class="scroll">
        <table class="data">
          <thead><tr>
            <th scope="col">Match</th><th scope="col">Date</th><th scope="col">Kind</th>
            <th scope="col">Teams</th><th scope="col" class="c">Score</th>
            <th scope="col" class="n">Rounds</th><th scope="col" class="n">Players</th>
            <th scope="col" class="n">Played</th><th scope="col">Arena</th>
          </tr></thead>
          <tbody>
            {shown.map((m) => (
              <tr>
                <td><a href={matchHref(section, m.id)}>#{m.id}</a></td>
                <td class="nowrap">{m.started_at ? date(m.started_at) : <span class="muted">–</span>}</td>
                <td class="nowrap">{kindLabel(m.mode, m.game_mode)}</td>
                <td class="nowrap">
                  <Team side="a"><span class={m.winner_freq === m.fa ? "won" : ""}>{m.names.get(m.fa)}</span></Team>
                  <span class="muted"> v </span>
                  <Team side="b"><span class={m.winner_freq === m.fb ? "won" : ""}>{m.names.get(m.fb)}</span></Team>
                </td>
                <td class="c nowrap">{m.score_a}–{m.score_b}
                  {m.winner_freq == null && <span class="muted small"> {outcomeWord(m.outcome)}</span>}
                  {m.outcome === "forfeit" && <span class="muted small"> ff</span>}
                </td>
                <td class="n">{m.rounds ?? <span class="muted">–</span>}</td>
                <td class="n">{m.players ?? "–"}</td>
                <td class="n">{duration(m.played)}</td>
                <td class="muted">{m.arena || "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} pages={pages} onPage={setPage} />
    </section>
  );
}
