import { useEffect, useRef, useState } from "preact/hooks";
import type { ChatRound, PlayerRow } from "./data";
import { fold, num, pyFixed } from "./format";
import { loadKills, playerKills, type Kill, type Versus } from "./killlog";
import { playerHref } from "./router";
import { Pills, Team, useLoad } from "./ui";

const sortedWeapons = (w: Record<string, number>) => Object.entries(w).sort((a, b) => b[1] - a[1]);

function Weapons({ label, weapons }: { label: string; weapons: Record<string, number> }) {
  const list = sortedWeapons(weapons);
  if (list.length === 0) return null;
  return (
    <p class="vs-weapons"><span class="muted">{label}</span>{" "}
      {list.map(([w, n]) => <span class="chip">{w} <b>{num(n)}</b></span>)}
    </p>
  );
}

function VersusList({ title, empty, list, fa, onPick }: {
  title: string; empty: string; list: Versus[]; fa: number; onPick: (name: string) => void;
}) {
  const max = list.reduce((m, v) => Math.max(m, v.n), 0);
  return (
    <section class="vs-col">
      <h3>{title} <span class="muted">{num(list.reduce((s, v) => s + v.n, 0))}</span></h3>
      {list.length === 0 ? <p class="muted">{empty}</p> : (
        <ol class="vs-list">
          {list.map((v) => (
            <li title={sortedWeapons(v.weapons).map(([w, n]) => `${w} ${n}`).join(", ")}>
              <Team side={v.freq === fa ? "a" : "b"}>
                <button class="vs-name" onClick={() => onPick(v.name)}>{v.name}</button>
              </Team>
              <span class="vs-bar" aria-hidden="true"><span style={{ width: `${(100 * v.n) / max}%` }} /></span>
              <b class="n">{num(v.n)}</b>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function TeamKills({ label, list }: { label: string; list: Versus[] }) {
  if (list.length === 0) return null;
  return (
    <p class="vs-weapons"><span class="muted">{label}</span>{" "}
      {list.map((v) => <span class="chip">{v.name} <b>{num(v.n)}</b></span>)}
    </p>
  );
}

const roundLabel = (r: ChatRound) => `R${r.round}${r.attempt > 1 ? `.${r.attempt}` : ""}`;

/** One player's night in one league match: who they killed and who killed
 * them, from the replay's kill log, for the whole match or a single round. */
export function MatchPlayerModal({ name, replay, rounds, fa, row, onPick, onClose }: {
  name: string; replay: string; rounds: ChatRound[] | undefined; fa: number; row?: PlayerRow;
  onPick: (name: string) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [round, setRound] = useState("all");
  const [kills, error, loading] = useLoad<Kill[]>(() => loadKills(replay), [replay]);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => { if (d?.open) d.close(); };
  }, []);
  // another player picked inside the modal: back to the whole match
  useEffect(() => setRound("all"), [name]);

  const picked = round === "all" ? undefined : rounds?.[Number(round)];
  const window: [number, number] | undefined = picked ? [picked.start, picked.end ?? Infinity] : undefined;
  const mine = kills ? playerKills(kills, name, window) : null;
  const freq = row?.freq ?? kills?.find((k) => fold(k.killer) === fold(name))?.killerFreq;
  const label = row?.player_name ?? name;
  const sum = (l: Versus[]) => l.reduce((n, v) => n + v.n, 0);
  const tkOut = mine ? sum(mine.teamKilled) : 0;
  const tkIn = mine ? sum(mine.teamKilledBy) : 0;

  return (
    <dialog ref={ref} class="vs-modal" aria-labelledby="vs-title" onClose={onClose}
            onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
      <div class="vs-body">
        <header class="vs-head">
          <h2 id="vs-title">
            {freq != null ? <Team side={freq === fa ? "a" : "b"}>{label}</Team> : label}
          </h2>
          <button class="vs-close" onClick={() => ref.current?.close()} aria-label="Close">×</button>
        </header>
        <p class="muted vs-sub">
          {row && <>Scoreboard: {num(row.kills)} K · {num(row.deaths)} D · </>}
          <a href={playerHref(label)}>Career stats →</a>
        </p>
        {rounds && rounds.length > 0 && (
          <div class="scroll">
            <Pills label="Round" value={round} onChange={setRound}
                   options={[["all", "Whole match"], ...rounds.map((r, i): [string, string] => [String(i), roundLabel(r)])]} />
          </div>
        )}
        {loading && <p class="muted">Loading the replay's kill log…</p>}
        {error && <p class="warn">{error.message}. The replay's site may be down; the career page still works.</p>}
        {mine && (
          <>
            <p class="vs-totals">
              <b>{num(mine.kills + tkOut)}</b> kills · <b>{num(mine.deaths + tkIn)}</b> deaths
              {mine.deaths + tkIn > 0 && <> · K/D <b>{pyFixed((mine.kills + tkOut) / (mine.deaths + tkIn), 2)}</b></>}
            </p>
            <div class="vs-grid">
              <VersusList title="Killed" empty="Nobody." list={mine.killed} fa={fa} onPick={onPick} />
              <VersusList title="Killed by" empty="Nobody." list={mine.killedBy} fa={fa} onPick={onPick} />
            </div>
            <Weapons label="Killed with" weapons={mine.weaponsOut} />
            <Weapons label="Killed by" weapons={mine.weaponsIn} />
            <TeamKills label="Team kills" list={mine.teamKilled} />
            <TeamKills label="Killed by teammates" list={mine.teamKilledBy} />
            <p class="chart-note">From the replay's kill log, as the scoreboard counts: kills and deaths include
              team kills, which the lists leave out. Over the whole recording, so a round's numbers can include
              a kill between rounds.</p>
          </>
        )}
      </div>
    </dialog>
  );
}
