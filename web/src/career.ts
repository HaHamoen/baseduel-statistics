// A career's figures as !bdstats prints them (pubduel/board.py career_lines;
// the league bot's cmd_bdstats is the same with no no-results). Pure, so
// tools/cells.mjs can check them against PyCore's own.

import type { Career } from "./data";
import { pyFixed, pyRound } from "./format";

export interface CareerFigures {
  losses: number;
  decided: number;
  /** Win% over decided matches: a no-result counts for neither side. */
  pct: number;
  /** (kills - team kills) / (deaths + 1). */
  kd: string;
  /** Kills per minute on the field, "-" with under a second of it. */
  kpm: string;
}

export function careerFigures(c: Career): CareerFigures {
  const noResults = c.no_results || 0;
  const losses = c.matches - c.wins - noResults;
  const decided = c.wins + losses;
  const tk = c.teamkills || 0;
  const act = c.active_time || 0;
  return {
    losses,
    decided,
    pct: decided ? pyRound((c.wins * 100.0) / decided) : 0,
    kd: pyFixed(((c.kills - tk) * 1.0) / (c.deaths + 1), 2),
    kpm: act >= 1.0 ? pyFixed((c.kills * 60.0) / act, 2) : "-",
  };
}
