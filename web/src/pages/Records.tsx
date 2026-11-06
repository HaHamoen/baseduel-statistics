import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { getMeta, getPlayers, getRecords, type RecordEntry, type RecordLists, type Section } from "../data";
import { date, duration, num, shortDate } from "../format";
import { matchHref, navigate, playerHref } from "../router";
import { Loading, Pills, Problem, useLoad, useTitle } from "../ui";

const SHOWN = 5;

/** The best on record (exporter/records.py works them out): players' best
 * matches and runs, then whole matches and rounds. Pub arena and League
 * apart, as everywhere; bots left off the players' lists unless shown. */
export function Records({ query }: { query: URLSearchParams }) {
  useTitle("Records");
  const section: Section = query.get("s") === "league" ? "league" : "pub";
  const bots = query.get("bots") === "1";
  const set = (s: Section, b: boolean) =>
    navigate(`/records?${new URLSearchParams({ ...(s === "league" ? { s } : {}), ...(b ? { bots: "1" } : {}) })}`, true);
  const [got, error] = useLoad(() => Promise.all([getRecords(section), getPlayers(), getMeta()]), [section]);

  const head = (
    <header class="page-head">
      <h1>Records</h1>
      <p class="muted">Only matches a person played in and somebody won count. A player's best in one match counts from matches of up to 2 hours.</p>
      <div class="filters">
        <Pills label="Section" value={section} onChange={(s) => set(s, bots)}
               options={[["pub", "Pub arena"], ["league", "League"]]} />
        <label class="check">
          <input type="checkbox" checked={bots} onChange={(e) => set(section, (e.target as HTMLInputElement).checked)} />
          {" "}Show bots
        </label>
      </div>
    </header>
  );
  if (error) return <Problem error={error} />;
  if (!got) return <>{head}<Loading /></>;
  const [recs, players, meta] = got;
  if (!recs) return <>{head}<section class="card"><p class="muted">No records yet.</p></section></>;

  const first = section === "pub" ? meta?.sections.pub.first_started : null;
  const since = first ? `From ${date(first)} on: the earlier matches recorded ` : "";
  const pick = (l: RecordLists) => (bots ? l.all : l.people);
  const flag = section === "pub" ? "pub_bot" : "league_bot";
  const who = (e: RecordEntry) => {
    const p = e.key ? players.byKey.get(e.key) : undefined;
    const name = p?.name || e.key || "?";
    return <><a href={playerHref(name)}>{name}</a>{bots && p?.[flag] && <span class="tag">bot</span>}</>;
  };
  const where = (e: RecordEntry, id = e.match!) => (
    <><a href={matchHref(section, id)}>#{id}</a>{" "}
      <span class="muted">{e.earlier ? "earlier" : e.at ? shortDate(e.at) : ""}</span></>
  );
  const score = (e: RecordEntry) => e.winner
    ? <>{e.winner} won {e.final![0]}–{e.final![1]}</>
    : <span class="muted">No winner, {e.final![0]}–{e.final![1]}</span>;

  return (
    <>
      {head}
      <section class="card">
        <h2>Players</h2>
        <div class="records">
          <Card title="Most kills in a match" rows={pick(recs.kills)}
                line={(e) => [who(e), num(e.value), where(e)]} />
          <Card title="Most damage dealt in a match" rows={pick(recs.dmg_given)}
                line={(e) => [who(e), num(e.value), where(e)]} />
          <Card title="Longest kill streak" rows={pick(recs.best_streak)}
                line={(e) => [who(e), num(e.value), where(e)]}
                note={since && `${since}no kill streaks.`} />
          <Card title="Most safe touches in a match" rows={pick(recs.safe_touches)}
                line={(e) => [who(e), num(e.value), where(e)]}
                note={since && `${since}no safe touches.`} />
          <Card title="Longest winning run" rows={pick(recs.winning_run)}
                line={(e) => [who(e), `${num(e.value)} wins`,
                  <><a href={matchHref(section, e.from!)}>#{e.from}</a>–<wbr /><a href={matchHref(section, e.to!)}>#{e.to}</a></>]}
                note="Wins in a row, in the order played. A no result, or a match nobody won, counts for nobody." />
        </div>
      </section>
      <section class="card">
        <h2>Matches</h2>
        {since && <p class="note">{since}no lengths, rounds or round scores.</p>}
        <div class="records">
          <Card title="Longest match" rows={recs.longest_match}
                line={(e) => [score(e), duration(e.value), where(e)]} note="Time played: timeouts and the gaps between rounds left out." />
          <Card title="Most rounds" rows={recs.most_rounds}
                line={(e) => [score(e), num(e.value), where(e)]} />
          <Card title="Biggest comeback" rows={recs.comeback}
                line={(e) => [<>{e.winner}</>, <>{e.low![0]}–{e.low![1]} <span class="muted">→</span> {e.final![0]}–{e.final![1]}</>, where(e)]}
                note="How far behind the winner fell, by the score after each round. A match with a score set by an official is left out." />
          <Card title="Longest round" rows={recs.longest_round}
                line={(e) => [<>{e.round} <span class="muted">· base {e.base_num ?? "?"}</span>{e.won_by ? <span class="muted"> · {e.won_by}</span> : <span class="muted"> · no point</span>}</>,
                  duration(e.value), where(e)]} />
        </div>
      </section>
    </>
  );
}

/** One record: the best few, the rest a tap away. Each line is who or
 * what, the figure, and where it happened. */
function Card({ title, rows, line, note }: {
  title: string; rows: RecordEntry[]; note?: string;
  line: (e: RecordEntry) => [ComponentChildren, ComponentChildren, ComponentChildren];
}) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <div class="record">
      <h3>{title}</h3>
      {rows.length === 0 ? <p class="muted small">None yet.</p> : (
        <table class="data compact record-table">
          <tbody>
            {shown.map((e, i) => {
              const [a, b, c] = line(e);
              return (
                <tr>
                  <td class="n rank">{i + 1}</td>
                  <td class="record-who">{a}</td>
                  <td class="n record-v">{b}</td>
                  <td class="record-where">{c}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {rows.length > SHOWN && (
        <button type="button" class="link small" onClick={() => setAll(!all)}>
          {all ? `Show top ${SHOWN}` : `Show top ${rows.length}`}
        </button>
      )}
      {note && <p class="note">{note}</p>}
    </div>
  );
}
