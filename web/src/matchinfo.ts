// What a match is, in words, the same way on every page.

import type { MatchRow, Meta, Section } from "./data";
import { date, duration } from "./format";

const KINDS: Record<string, string> = {
  pub: "Pub", private: "Private",
  match: "League", scrim: "Scrim", pickup: "Pickup",
};

export function kindLabel(mode: string, gameMode?: string | null): string {
  const base = KINDS[mode] || mode;
  return gameMode ? `${base} · ${title(gameMode)} mode` : base;
}

export const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** pubduel/board.py freqs_of: the two freqs, lower first. score_a is the
 * lower freq's score. */
export function freqsOf(mode: string, freqs: number[] = []): [number, number] {
  if (mode === "private") return [100, 200];
  if (mode === "pub") return [0, 1];
  const seen = [...new Set(freqs)].sort((a, b) => a - b);
  return seen.length === 2 ? [seen[0], seen[1]] : [0, 1];
}

/** Each freq's name: "Freq 0" in the pub arena, the team's own in the league
 * (freq 0 is team_a there, freq 1 team_b). */
export function teamNames(section: Section, m: MatchRow, freqs: number[] = []): Map<number, string> {
  const [fa, fb] = freqsOf(m.mode, freqs);
  if (section === "league") return new Map([[fa, m.team_a], [fb, m.team_b]]);
  return new Map([[fa, `Freq ${fa}`], [fb, `Freq ${fb}`]]);
}

/** pubduel/board.py mode_line, as !bdmatch and the Discord card say it. */
export function modeLine(m: Pick<MatchRow, "game_mode" | "game_mode_freq" | "game_mode_until" | "game_mode_end">): string | null {
  if (!m.game_mode) return null;
  const team = m.game_mode_freq != null ? `Freq ${m.game_mode_freq}` : "one team";
  let text = `${title(m.game_mode)} mode for ${team}`;
  if (m.game_mode_until != null) {
    const how = m.game_mode_end === "vote" ? `${team} voted to end it`
      : m.game_mode_end === "official" ? "an official ended it"
        : "no human was left on it";
    text += ` until ${duration(m.game_mode_until)}: ${how}`;
  }
  return text;
}

/** The pub arena's old games are "earlier matches", never a bot's name (the
 * user, 2026-11-05: which bot recorded them does not matter). They all come
 * before the current bot's first match, which is the one date they have. */
export function earlierThan(meta: Meta | null | undefined): string {
  const first = meta?.sections.pub.first_started;
  return first ? `before ${date(first)}` : "from before this record began";
}

export function outcomeWord(outcome: string): string {
  return { completed: "completed", aborted: "abandoned", forfeit: "forfeit" }[outcome] || outcome;
}
