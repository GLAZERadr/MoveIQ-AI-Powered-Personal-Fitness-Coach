/**
 * Automatic progression (progressive overload), deterministic and explainable:
 *  - hit the target in every set last time → target +1 rep (or +5 s for holds), capped at +10%;
 *  - missed the target clearly (any set under 80%) → keep last time's target;
 *  - otherwise keep it. No history → the plan's or default target.
 */
export interface LastPerformance {
  target: number | null;
  results: number[];
}

export interface Suggestion {
  target: number;
  reason: string | null;
}

export function suggestNextTarget(last: LastPerformance | null, fallback: number, unit: 'reps' | 'seconds'): Suggestion {
  if (!last || last.results.length === 0 || !last.target) return { target: fallback, reason: null };
  const t = last.target;
  const fmt = (xs: number[]) => xs.join(' / ') + (unit === 'seconds' ? ' s' : '');
  if (last.results.every((r) => r >= t)) {
    const step = unit === 'seconds' ? 5 : 1;
    const next = Math.min(t + step, Math.max(t + step, Math.round(t * 1.1)));
    return { target: next, reason: `Last time ${fmt(last.results)}: target met in every set → ${next}` };
  }
  if (last.results.some((r) => r < t * 0.8)) {
    return { target: t, reason: `Last time ${fmt(last.results)}: keeping ${t} until every set reaches it` };
  }
  return { target: t, reason: `Last time ${fmt(last.results)}: almost there, staying at ${t}` };
}
