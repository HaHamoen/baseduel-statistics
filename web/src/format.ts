// Numbers as the bots print them. The bots are Python: '%.2f' and round()
// send an exact half to the even neighbour, where JavaScript's toFixed sends
// it up. R = 1/8 is 0.125 exactly, and the game says 0.12, so the site must
// too.

/** Python's '%.<digits>f' % x. */
export function pyFixed(x: number, digits: number): string {
  if (!Number.isFinite(x)) return String(x);
  const away = x.toFixed(digits);
  // Enough digits to see whether x sits exactly on a half.
  const exact = x.toFixed(Math.min(100, digits + 25));
  const dot = exact.indexOf(".");
  if (!/^50*$/.test(exact.slice(dot + 1 + digits))) return away;
  const toward = digits ? exact.slice(0, dot + 1 + digits) : exact.slice(0, dot);
  const last = Number(toward[toward.length - 1]);
  return last % 2 === 0 ? (toward === "-0" ? "0" : toward) : away;
}

/** Python's round(x) for a float: an int, halves to even. */
export function pyRound(x: number): number {
  return Number(pyFixed(x, 0));
}

/** Python 3.12's sum() of floats: Neumaier's compensated summation
 * (CPython bltinmodule.c builtin_sum_impl). Adding plainly lands a hair
 * low, and a field time truncated to whole seconds then reads 147:30 where
 * the bot says 147:31. */
export function pySum(values: number[]): number {
  let f = 0;
  let c = 0;
  for (const x of values) {
    const t = f + x;
    c += Math.abs(f) >= Math.abs(x) ? (f - t) + x : (x - t) + f;
    f = t;
  }
  return c && Number.isFinite(c) ? f + c : f;
}

/** m:ss, truncated, as the bots' fmt_duration. */
export function duration(seconds: number | null | undefined): string {
  const s = Math.floor(Math.max(0, seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Long field times: "41h 07m". */
export function hours(seconds: number | null | undefined): string {
  const s = Math.floor(Math.max(0, seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

/** pubduel/board.py fmt_time_share: "4:55 (82%)", "-" with nothing to share. */
export function timeShare(seconds: number, denom: number): string {
  if (denom < 1.0) return "-";
  const pct = Math.min(100, pyRound((Math.max(0, seconds) / denom) * 100.0));
  return `${duration(seconds)} (${pct}%)`;
}

const NUM = new Intl.NumberFormat("en-US");
/** A count with separators: 422,455. */
export function num(n: number | null | undefined): string {
  return n == null ? "–" : NUM.format(n);
}

/** A total that can run to ten figures, short: 51.94M, 4.05B. */
export function big(n: number | null | undefined): string {
  if (n == null) return "–";
  if (n >= 1e9) return `${pyFixed(n / 1e9, 2)}B`;
  return n >= 1e6 ? `${pyFixed(n / 1e6, 2)}M` : num(n);
}

/** (kills - teamkills) / (deaths + 1): the board's R and !bdtop's K/D. */
export function rating(kills: number, teamkills: number | null, deaths: number): number {
  return (kills - (teamkills || 0)) / (deaths + 1);
}

const DATE = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });
const DATE_TIME = new Intl.DateTimeFormat(undefined, {
  year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
const SHORT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/** A bot's epoch seconds in the viewer's own time. */
export function date(epoch: number | null | undefined): string {
  return epoch ? DATE.format(new Date(epoch * 1000)) : "–";
}
export function dateTime(epoch: number | null | undefined): string {
  return epoch ? DATE_TIME.format(new Date(epoch * 1000)) : "–";
}
/** "Nov 3", with the year when it is not this one. */
export function shortDate(epoch: number | null | undefined): string {
  if (!epoch) return "–";
  const d = new Date(epoch * 1000);
  return d.getFullYear() === new Date().getFullYear() ? SHORT.format(d) : DATE.format(d);
}

export function plural(n: number, one: string, many = one + "s"): string {
  return `${num(n)} ${n === 1 ? one : many}`;
}

/** SQLite's LOWER(): ASCII letters only, as the bots compare names. */
export function fold(name: string): string {
  return name.replace(/[A-Z]/g, (c) => c.toLowerCase());
}
