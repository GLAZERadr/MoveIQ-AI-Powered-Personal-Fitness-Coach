/**
 * Exercise-agnostic repetition state machine driven by a smoothed scalar signal (a joint angle that
 * decreases toward the bottom of the movement, e.g. elbow angle for push-ups, knee angle for squats).
 *
 *   NOT_READY ──(at top for readyHoldMs)──▶ READY ──(drops below top − hysteresis)──▶ DESCENDING
 *   DESCENDING ──(≤ bottom)──▶ BOTTOM ──(> bottom + hysteresis)──▶ ASCENDING ──(≥ top)──▶ rep ✓ → READY
 *   DESCENDING ──(back to top without reaching bottom)──▶ partial (insufficient depth) → READY
 *   any state ──(no valid frame for maxGapMs)──▶ NOT_READY (a rep in progress becomes a partial)
 *
 * A rep is counted only after the full sequence, so crossing one threshold never counts by itself,
 * and a rep cannot be counted twice because counting requires returning through READY.
 */

export type CounterState = 'not_ready' | 'ready' | 'descending' | 'bottom' | 'ascending';

export interface RepCounterConfig {
  /** Signal at/above which the body is at the top (start/end) position, degrees. */
  topThreshold: number;
  /** Signal at/below which the bottom position counts as reached, degrees. */
  bottomThreshold: number;
  /** Dead band applied to phase transitions, degrees. */
  hysteresis: number;
  /** Time the user must hold the top position before counting starts. */
  readyHoldMs: number;
  /** Reps faster than this are rejected as jitter/noise. */
  minRepMs: number;
  /** Reps slower than this (e.g. the user sat down) are rejected. */
  maxRepMs: number;
  /** Tolerated gap in valid frames before tracking is considered lost. */
  maxGapMs: number;
}

export interface CountedRep {
  index: number;
  startMs: number;
  bottomMs: number;
  endMs: number;
  /** Lowest signal value reached. */
  minSignal: number;
  /** Highest signal value in the top position just before this rep (lockout). */
  topPeakSignal: number;
  descentMs: number;
  ascentMs: number;
}

export type PartialReason = 'insufficient_depth' | 'too_fast' | 'too_slow' | 'tracking_lost';

export interface PartialRep {
  startMs: number;
  endMs: number;
  minSignal: number;
  reason: PartialReason;
}

export type CounterEvent =
  | { type: 'rep'; rep: CountedRep }
  | { type: 'partial'; partial: PartialRep }
  | { type: 'state'; from: CounterState; to: CounterState };

export class RepCounter {
  state: CounterState = 'not_ready';
  reps: CountedRep[] = [];
  partials: PartialRep[] = [];

  private readySince: number | null = null;
  private lastValidMs: number | null = null;
  private repStartMs = 0;
  private bottomMs = 0;
  private lastAtBottomMs = 0;
  private minSignal = Infinity;
  private topPeak = -Infinity;
  private repTopPeak = -Infinity;

  constructor(readonly config: RepCounterConfig) {}

  /** Feed one smoothed signal sample, or null when the frame was unusable. */
  update(t: number, signal: number | null): CounterEvent[] {
    const events: CounterEvent[] = [];
    const c = this.config;

    if (signal == null || !Number.isFinite(signal)) {
      if (this.lastValidMs != null && t - this.lastValidMs > c.maxGapMs && this.state !== 'not_ready') {
        if (this.inRep()) {
          this.pushPartial(events, t, 'tracking_lost');
        }
        this.transition(events, 'not_ready');
        this.readySince = null;
      }
      return events;
    }
    // A long silence followed by a valid frame (e.g. detection paused, phone locked) is also a tracking
    // loss: never continue a rep across it.
    if (this.lastValidMs != null && t - this.lastValidMs > c.maxGapMs && this.state !== 'not_ready') {
      if (this.inRep()) this.pushPartial(events, t, 'tracking_lost');
      this.transition(events, 'not_ready');
      this.readySince = null;
      this.topPeak = -Infinity;
    }
    this.lastValidMs = t;

    switch (this.state) {
      case 'not_ready':
        if (signal >= c.topThreshold) {
          this.readySince ??= t;
          this.topPeak = Math.max(this.topPeak, signal);
          if (t - this.readySince >= c.readyHoldMs) this.transition(events, 'ready');
        } else {
          this.readySince = null;
          this.topPeak = -Infinity;
        }
        break;

      case 'ready':
        if (signal >= c.topThreshold) this.topPeak = Math.max(this.topPeak, signal);
        if (signal < c.topThreshold - c.hysteresis) {
          this.repStartMs = t;
          this.minSignal = signal;
          this.repTopPeak = this.topPeak;
          this.transition(events, 'descending');
        }
        break;

      case 'descending':
        this.minSignal = Math.min(this.minSignal, signal);
        if (signal <= c.bottomThreshold) {
          this.bottomMs = t;
          this.lastAtBottomMs = t;
          this.transition(events, 'bottom');
        } else if (signal >= c.topThreshold) {
          this.pushPartial(events, t, 'insufficient_depth');
          this.resetTop(signal);
          this.transition(events, 'ready');
        }
        break;

      case 'bottom':
        this.minSignal = Math.min(this.minSignal, signal);
        if (signal <= c.bottomThreshold) this.lastAtBottomMs = t;
        if (signal > c.bottomThreshold + c.hysteresis) this.transition(events, 'ascending');
        break;

      case 'ascending':
        this.minSignal = Math.min(this.minSignal, signal);
        if (signal <= c.bottomThreshold) {
          this.lastAtBottomMs = t;
          this.transition(events, 'bottom');
        } else if (signal >= c.topThreshold) {
          const duration = t - this.repStartMs;
          if (duration < c.minRepMs) {
            this.pushPartial(events, t, 'too_fast');
          } else if (duration > c.maxRepMs) {
            this.pushPartial(events, t, 'too_slow');
          } else {
            const rep: CountedRep = {
              index: this.reps.length + 1,
              startMs: this.repStartMs,
              bottomMs: this.bottomMs,
              endMs: t,
              minSignal: this.minSignal,
              topPeakSignal: this.repTopPeak,
              descentMs: this.bottomMs - this.repStartMs,
              ascentMs: t - this.lastAtBottomMs,
            };
            this.reps.push(rep);
            events.push({ type: 'rep', rep });
          }
          this.resetTop(signal);
          this.transition(events, 'ready');
        }
        break;
    }
    return events;
  }

  /** Full reset, e.g. when starting a new set or recalibrating. */
  reset(): void {
    this.state = 'not_ready';
    this.reps = [];
    this.partials = [];
    this.readySince = null;
    this.lastValidMs = null;
    this.minSignal = Infinity;
    this.topPeak = -Infinity;
  }

  private inRep(): boolean {
    return this.state === 'descending' || this.state === 'bottom' || this.state === 'ascending';
  }

  private resetTop(signal: number): void {
    this.topPeak = signal;
    this.minSignal = Infinity;
  }

  private pushPartial(events: CounterEvent[], t: number, reason: PartialReason): void {
    const partial: PartialRep = { startMs: this.repStartMs, endMs: t, minSignal: this.minSignal, reason };
    this.partials.push(partial);
    events.push({ type: 'partial', partial });
  }

  private transition(events: CounterEvent[], to: CounterState): void {
    if (to === this.state) return;
    events.push({ type: 'state', from: this.state, to });
    this.state = to;
  }
}
