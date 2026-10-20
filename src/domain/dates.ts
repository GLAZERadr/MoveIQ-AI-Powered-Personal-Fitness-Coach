/**
 * Calendar-date helpers.
 *
 * Activities and entries store a `local_date` (YYYY-MM-DD in the user's local calendar at the time
 * of the activity) next to a full ISO timestamp. Weekly and daily aggregation uses `local_date`, so
 * a 23:30 run stays on the day the user experienced it even if they later travel across time zones.
 */

export type LocalDate = string; // YYYY-MM-DD

const pad = (n: number) => String(n).padStart(2, '0');

export function toLocalDate(d: Date): LocalDate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayLocal(now: Date = new Date()): LocalDate {
  return toLocalDate(now);
}

export function isLocalDate(s: string): s is LocalDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseLocalDate(s);
  return toLocalDate(d) === s;
}

/** Parses as local midnight (not UTC) so the calendar day is preserved. */
export function parseLocalDate(s: LocalDate): Date {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/** Calendar-day arithmetic that is immune to DST transitions. */
export function addDays(date: LocalDate, days: number): LocalDate {
  const d = parseLocalDate(date);
  d.setDate(d.getDate() + days);
  return toLocalDate(d);
}

/** Whole calendar days from a to b (b - a). */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  const [ay, am, ad] = a.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Monday of the week containing `date` (ISO weeks start on Monday). */
export function weekStart(date: LocalDate): LocalDate {
  const d = parseLocalDate(date);
  const dow = (d.getDay() + 6) % 7; // Mon=0 ... Sun=6
  return addDays(date, -dow);
}

/** Inclusive list of dates from start to end. */
export function dateRange(start: LocalDate, end: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function formatShortDate(date: LocalDate): string {
  const d = parseLocalDate(date);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
