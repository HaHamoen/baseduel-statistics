// A player's matches in one section, as their page and the compare page list
// them, and the buttons that narrow them.

import {
  rows, type HistoryRow, type NeobotHistoryRow, type PlayerDoc, type PlayerSection, type Section,
} from "./data";
import { kindLabel } from "./matchinfo";

export const SECTION_NAMES: Record<Section, string> = { pub: "Pub arena", league: "League" };

// The old bot's games are earlier pub matches, never named, and counted with
// the rest (the user, 2026-11-05): "Pub" is every pub match, earlier and
// recent ("pub_all"), and there is no separate button for the earlier ones.
export const PUB_SCOPES: [string, string][] = [
  ["all", "All"], ["pub_all", "Pub"], ["private", "Private"], ["hard", "Hard mode"],
];
export const LEAGUE_SCOPES: [string, string][] = [
  ["all", "All"], ["league", "League"], ["scrim", "Scrim"], ["pickup", "Pickup"],
];
export const SCOPE_WORDS: Record<string, string> = {
  all: "", pub_all: "pub", private: "private", hard: "hard-mode",
  league: "league", scrim: "scrim", pickup: "pickup",
};
export const scopesOf = (section: Section) => (section === "pub" ? PUB_SCOPES : LEAGUE_SCOPES);

/** The section a plain link opens on: the one of the player's latest dated
 * match. Earlier pub matches have no date, so with none dated, Pub arena. */
export function latestSection(doc: PlayerDoc): Section {
  const last = (sec?: PlayerSection) =>
    Math.max(0, ...rows<HistoryRow>(sec?.matches).map((h) => h.started_at || 0));
  if (!doc.pub) return "league";
  if (!doc.league) return "pub";
  return last(doc.league) > last(doc.pub) ? "league" : "pub";
}

/** One row of the history, whichever bot recorded the match. */
export interface Played {
  id: number;
  started_at: number | null;
  mode: string;
  game_mode: string | null;
  earlier: boolean;
  kind: string;
  team: string | null;
  /** The freq of the row: for an earlier game, the one played longest. */
  freq: number;
  result: string;
  score_for: number;
  score_against: number;
  kills: number;
  deaths: number;
  teamkills: number | null;
  dmg_given: number;
  safe_touches: number | null;
  active_time: number;
}

/** Every match, earlier and recent, in one list, newest first (the user,
 * 2026-11-05). The pub arena's numbers run in the order played, earlier
 * matches first, so newest first is by number. An earlier match has no date
 * and no safe touches. */
export function played(section: Section, sec: PlayerSection): Played[] {
  return [
    ...rows<HistoryRow>(sec.matches).map((h) => ({
      ...h, earlier: false, kind: kindLabel(h.mode, h.game_mode),
      team: section === "league" ? h.team : null,
    })),
    ...rows<NeobotHistoryRow>(sec.neobot).map((h) => ({
      ...h, started_at: null, mode: "pub", game_mode: null, earlier: true, kind: "Pub",
      team: null, safe_touches: null,
    })),
  ].sort((a, b) => b.id - a.id);
}

/** Which matches each button means, as its career counts them. */
export const IN_SCOPE: Record<string, (r: Played) => boolean> = {
  all: () => true,
  pub_all: (r) => r.mode === "pub",
  private: (r) => r.mode === "private",
  hard: (r) => r.game_mode === "hard",
  league: (r) => r.mode === "match",
  scrim: (r) => r.mode === "scrim",
  pickup: (r) => r.mode === "pickup",
};
