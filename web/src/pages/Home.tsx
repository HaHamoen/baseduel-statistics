import { getMeta, rows, type MatchRow, type Section } from "../data";
import { dateTime, duration, num, shortDate } from "../format";
import { freqsOf, kindLabel, teamNames } from "../matchinfo";
import { matchHref } from "../router";
import { Loading, PlayerSearch, Problem, Team, useLoad, useTitle } from "../ui";

export function Home() {
  useTitle("");
  const [meta, error] = useLoad(getMeta, []);
  if (error) return <Problem error={error} />;
  if (!meta) return <Loading />;
  const neobot = meta.neobot?.games || 0;
  return (
    <>
      <section class="hero">
        <h1>Base Duel Stats</h1>
        <p class="lede">
          Every recorded base duel match: the pub arena's, {num(neobot + meta.sections.pub.matches)} of
          them, and the league's. The numbers are the bots' own, the same as{" "}
          <code>!bdstats</code> and <code>!bdmatch</code> give in game.
        </p>
        <PlayerSearch autofocus />
      </section>

      <section class="tiles" aria-label="On record">
        <div class="tile"><span class="tile-n">{num(meta.players)}</span><span class="tile-l">players</span></div>
        <div class="tile"><span class="tile-n">{num(neobot + meta.sections.pub.matches)}</span><span class="tile-l">pub arena matches</span></div>
        <div class="tile"><span class="tile-n">{num(meta.sections.league.matches)}</span><span class="tile-l">league matches</span></div>
      </section>

      <div class="columns">
        <Recent section="pub" title="Latest pub and private matches" list={rows<MatchRow>(meta.sections.pub.recent)} />
        <Recent section="league" title="Latest league matches" list={rows<MatchRow>(meta.sections.league.recent)} />
      </div>
      <p class="muted small updated">Updated {dateTime(meta.built)}.</p>
    </>
  );
}

function Recent({ section, title, list }: { section: Section; title: string; list: MatchRow[] }) {
  return (
    <section class="card">
      <h2>{title}</h2>
      {list.length === 0 ? <p class="muted">None yet.</p> : (
        <ul class="match-list">
          {list.map((m) => <MatchLine section={section} m={m} />)}
        </ul>
      )}
      <p><a href={`/matches?s=${section}`}>All {section === "pub" ? "pub and private" : "league"} matches →</a></p>
    </section>
  );
}

export function MatchLine({ section, m }: { section: Section; m: MatchRow }) {
  const names = teamNames(section, m);
  const [fa, fb] = freqsOf(m.mode);
  const won = (f: number) => m.winner_freq === f;
  return (
    <li>
      <a class="match-line" href={matchHref(section, m.id)}>
        <span class="ml-score">
          <Team side="a"><span class={won(fa) ? "won" : ""}>{names.get(fa)}</span></Team>
          <span class="ml-num">{m.score_a}–{m.score_b}</span>
          <Team side="b"><span class={won(fb) ? "won" : ""}>{names.get(fb)}</span></Team>
        </span>
        <span class="ml-meta muted small">
          {kindLabel(m.mode, m.game_mode)}
          {m.winner_freq == null ? " · no result" : ""}
          {" · "}{duration(m.played_seconds)}{" · "}{shortDate(m.started_at)}
        </span>
      </a>
    </li>
  );
}
