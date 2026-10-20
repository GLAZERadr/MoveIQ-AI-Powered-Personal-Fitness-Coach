# Metric definitions

Every number in MoveIQ is one of four things, and the UI labels it accordingly:

| Badge | Meaning |
| --- | --- |
| **Entered** | Typed in by the user |
| **Calculated** | Deterministically computed from entered values |
| **Estimate** | From a formula with known error (energy) or a 2D camera (joint angles) |
| **Camera-derived** | From on-device pose landmarks |
| **Suggestion** | From a deterministic recommendation rule |

Storage is always metric (kg, cm, m, s, kcal). Conversion happens only in the UI. Activities store a `local_date` (the user's calendar day) for daily and weekly grouping, plus an ISO timestamp.

## Running (`src/domain/running.ts`)

- **Average pace (s/km)** = duration_s ÷ (distance_m ÷ 1000). Per mile: × 1.609344. Null for distance ≤ 0 or duration ≤ 0.
- **Weekly distance**: sum by ISO week (Monday start) of `local_date`.
- **Split consistency**: needs ≥ 2 user-supplied splits. Reports the pace SD, the coefficient of variation, the fastest and slowest split, and second-half minus first-half mean pace (negative = negative split). Splits are never inferred from totals.
- **Split/total mismatch**: flagged (not corrected) if split sum differs by > 1% distance or > 2 s.
- **Personal records**: *fastest whole-activity average pace among runs ≥ D* for D ∈ {1 km, 5 km, 10 km, half, marathon}, plus longest distance and longest duration. Computed separately for outdoor, trail and treadmill runs.
- **Pace vs HR**: only runs with average HR. Metric = (m/min) ÷ bpm ("meters per beat"). No training zones are inferred.

## Swimming (`src/domain/swimming.ts`)

- **Pace per 100 m** = duration_s ÷ distance_m × 100.
- **Pool consistency**: lengths × pool length vs entered distance, with 0.5 m tolerance. Mismatches are flagged, never overwritten. A "lap" is one pool length. Yards are converted at 0.9144 m.
- **Records**: pool and open water are never mixed. Pace records are grouped by stroke (unknown stroke is its own group).
- **Stroke comparison**: distance-weighted average pace per recorded stroke, pool only.

## Cutting (`src/domain/cutting.ts`)

- **Daily weight**: mean of that day's weigh-ins.
- **7-day rolling average**: mean of the weigh-in days within [d − 6, d]. Shown only with ≥ 3 weigh-in days in the window. Missing days are not interpolated.
- **Weekly rate**: mean(last 7 days) − mean(previous 7 days). Each window needs ≥ 3 weigh-in days, otherwise "not enough data".
- **Progress to target**: (smoothed current − start) ÷ (target − start), clamped to 0–1.
- **Nutrition totals**: kcal and protein are required per entry. For carbs, fat, fiber and sodium, missing values are counted and shown, never treated as 0.
- **Adherence**: calories ≤ target × 1.05, and protein ≥ target × 0.9. Unlogged days are "unlogged", not zero.
- **Energy estimate (labelled Estimate)**: Mifflin-St Jeor, 10·kg + 6.25·cm − 5·age + s (s = +5 male, −161 female). If sex isn't given, the range spanned by both constants is shown. TDEE = BMR × activity factor (1.2 / 1.375 / 1.55 / 1.725 / 1.9). Typical error is about ±10%.
- **Exercise calories are never added to the intake target**, to avoid double-counting.
- **Target warnings** (warnings only, never more aggressive suggestions): target < 1,200 kcal; target < estimated BMR; goal pace > 1% of body weight per week; target BMI < 18.5.

## Bodyweight motion analysis (`src/motion/`)

| | Push-up | Squat |
| --- | --- | --- |
| Camera | Side view, floor level, ~2 m | Side view, hip height, 2.5–3 m |
| Required landmarks (facing side) | shoulder, elbow, wrist, hip, ankle | shoulder, hip, knee, ankle |
| Signal | Elbow angle (shoulder–elbow–wrist) | Knee angle (hip–knee–ankle) |
| Top / bottom thresholds | ≥ 150° / ≤ 100° | ≥ 160° / ≤ 105° |
| Possible deviations | hip sag (hip offset from shoulder–ankle line > 7% of its length), hips rising (< −8%), incomplete lockout (top peak < 158°), rushed reps (< 0.9 s) | forward lean (trunk > 55° from vertical in the bottom third), left-right imbalance (> 15° knee difference, only when both legs have visibility ≥ 0.75), rushed reps (< 1.1 s) |

- **Quality gate**: required landmarks must have visibility ≥ 0.5 and be inside the frame, and the body axis must match the camera setup. Mean visibility ≥ 0.7 is "good"; only good frames feed form features.
- **Counted rep**: READY (top held ≥ 300 ms) → below top − 8° → ≤ bottom → above bottom + 8° → ≥ top, with total duration within [min, max].
- **Not counted**: insufficient depth, too fast, too slow, or tracking lost (> 1 s without valid frames).
- **ROM** = top peak before the rep − lowest angle. **Tempo**: descent = start → first bottom; ascent = last bottom → top.
- **Cue policy**: a deviation must appear in ≥ 2 of the last 3 reps. At most one cue, ≥ 3.5 s apart, and the same cue ≥ 12 s apart. Uncounted depth attempts give an immediate cue.
- **Re-analysis**: retained frames (15 fps, 3-decimal) are run through the same engine. Counts and deviations match live analysis. ROM may differ by a few degrees because of quantization and frame rate.

These are approximate 2D estimates. They do not measure joint loading, muscle activation or injury risk.

## Recommendations (`src/domain/recommendations.ts`)

| Rule | Fires only when |
| --- | --- |
| Review intensity | ≥ 2 sessions with RPE ≥ 8 in 7 days, and the latest session has RPE ≥ 8 |
| Weight dropping quickly | Goal is cut, weekly rate is computable, and loss > 1% of body weight per week |
| Protein below target | A protein target is set, ≥ 3 logged days in 7, and the average is < 90% of target |
| Improve camera setup | Last camera workout (≤ 14 days ago) had < 60% good frames |
| No weigh-ins this week | Goal is cut, weigh-ins exist, none in 7 days |
| Time for a session? | Training records exist, none in 7 days |

Each recommendation lists its evidence and can be dismissed for the day.
