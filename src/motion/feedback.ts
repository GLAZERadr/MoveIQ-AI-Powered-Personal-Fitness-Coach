import { QualityLevel } from './types';

export interface CueCandidate {
  id: string;
  message: string;
  /** Higher wins when several cues are eligible at once. */
  priority: number;
  /** Bypass the "seen in multiple recent reps" requirement (e.g. a rep that was not counted). */
  immediate?: boolean;
}

export interface Cue extends CueCandidate {
  atMs: number;
}

export interface FeedbackConfig {
  /** Minimum time between any two cues. */
  globalMinIntervalMs: number;
  /** Minimum time before the same cue repeats. */
  perCueCooldownMs: number;
  /** A cue must be observed in `required` of the last `window` reps before it is shown. */
  persistenceWindow: number;
  persistenceRequired: number;
}

export const DEFAULT_FEEDBACK_CONFIG: FeedbackConfig = {
  globalMinIntervalMs: 3500,
  perCueCooldownMs: 12000,
  persistenceWindow: 3,
  persistenceRequired: 2,
};

/**
 * Chooses at most one short cue per rep, rate-limited, and only when tracking quality is good.
 * One-off deviations (likely noise) are suppressed by requiring persistence across reps.
 */
export class TechniqueFeedbackEngine {
  private history: Set<string>[] = [];
  private lastAnyMs = -Infinity;
  private lastById = new Map<string, number>();
  readonly issued: Cue[] = [];

  constructor(private readonly config: FeedbackConfig = DEFAULT_FEEDBACK_CONFIG) {}

  onRep(candidates: CueCandidate[], atMs: number, quality: QualityLevel): Cue | null {
    const c = this.config;
    this.history.push(new Set(candidates.map((x) => x.id)));
    if (this.history.length > c.persistenceWindow) this.history.shift();

    if (quality !== 'good') return null;
    if (atMs - this.lastAnyMs < c.globalMinIntervalMs) return null;

    const eligible = candidates
      .filter((cand) => {
        const seen = this.history.filter((h) => h.has(cand.id)).length;
        if (!cand.immediate && seen < c.persistenceRequired) return false;
        const last = this.lastById.get(cand.id) ?? -Infinity;
        return atMs - last >= c.perCueCooldownMs;
      })
      .sort((a, b) => b.priority - a.priority);

    const chosen = eligible[0];
    if (!chosen) return null;
    const cue: Cue = { ...chosen, atMs };
    this.lastAnyMs = atMs;
    this.lastById.set(chosen.id, atMs);
    this.issued.push(cue);
    return cue;
  }

  reset(): void {
    this.history = [];
    this.lastAnyMs = -Infinity;
    this.lastById.clear();
  }
}
