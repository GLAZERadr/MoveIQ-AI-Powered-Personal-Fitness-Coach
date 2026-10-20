import { addDays, daysBetween, isLocalDate, weekStart } from '../dates';
import {
  bmi,
  checkCutTargets,
  computeAutoTargets,
  projectGoalDate,
  dailyWeights,
  estimateBmr,
  progressToTarget,
  rollingAverage,
  scaleNutrition,
  sumNutrition,
  weeklyAdherence,
  weeklyRate,
} from '../cutting';
import { paceSecPerKm, pacePerUnit, runPersonalRecords, splitConsistency, splitTotalsMismatch, weeklyTotals, RunActivity } from '../running';
import { checkPoolDistance, pacePer100m, swimPersonalRecords, SwimActivity } from '../swimming';
import { autoSwimDistance, parseRunForm, parseSwimForm, RunForm, SwimForm } from '../validation';
import { formatDuration, formatPace, fromMeters, kgToLb, lbToKg, parseDecimal, parseDuration, toMeters } from '../units';

describe('units', () => {
  it('converts weight both ways exactly', () => {
    expect(lbToKg(1)).toBeCloseTo(0.45359237, 8);
    expect(kgToLb(lbToKg(180))).toBeCloseTo(180, 10);
  });
  it('converts distance', () => {
    expect(toMeters(1, 'mi')).toBeCloseTo(1609.344);
    expect(fromMeters(5000, 'km')).toBe(5);
    expect(toMeters(25, 'yd')).toBeCloseTo(22.86);
  });
  it('formats durations and paces with correct carry', () => {
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(305)).toBe('5:05');
    expect(formatPace(359.6)).toBe('6:00');
    expect(formatPace(null)).toBe('–');
  });
  it('parses durations and decimals strictly', () => {
    expect(parseDuration('32:18')).toBe(1938);
    expect(parseDuration('1:02:05')).toBe(3725);
    expect(parseDuration('5:75')).toBeNull();
    expect(parseDuration('abc')).toBeNull();
    expect(parseDecimal('72,4')).toBe(72.4);
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('1.2.3')).toBeNull();
  });
});

describe('dates', () => {
  it('handles calendar math', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-01-01', '2026-01-08')).toBe(7);
    expect(weekStart('2026-10-25')).toBe('2026-10-19'); // Sunday -> Monday
    expect(weekStart('2026-10-19')).toBe('2026-10-19');
    expect(isLocalDate('2026-02-30')).toBe(false);
  });
});

const run = (p: Partial<RunActivity>): RunActivity => ({
  id: 'r', localDate: '2026-04-20', startedAt: null, distanceM: 5000, durationSec: 1500, kind: 'outdoor',
  avgHr: null, maxHr: null, cadenceSpm: null, elevationGainM: null, rpe: null, notes: null, splits: [], ...p,
});

describe('running', () => {
  it('calculates pace = duration_s / distance_km', () => {
    expect(paceSecPerKm(1938, 5200)).toBeCloseTo(372.69, 2); // 32:18 for 5.2 km = 6:13 /km
    expect(formatPace(paceSecPerKm(1938, 5200))).toBe('6:13');
    expect(pacePerUnit(1500, 5000, 'mi')).toBeCloseTo(482.8, 1);
  });
  it('rejects zero or invalid distance/duration', () => {
    expect(paceSecPerKm(1500, 0)).toBeNull();
    expect(paceSecPerKm(0, 5000)).toBeNull();
    expect(paceSecPerKm(NaN, 5000)).toBeNull();
    expect(paceSecPerKm(-1, 5000)).toBeNull();
  });
  it('split consistency needs supplied splits and never invents them', () => {
    expect(splitConsistency([])).toBeNull();
    expect(splitConsistency([{ distanceM: 1000, durationSec: 360 }])).toBeNull();
    const c = splitConsistency([
      { distanceM: 1000, durationSec: 358 },
      { distanceM: 1000, durationSec: 365 },
      { distanceM: 1000, durationSec: 370 },
      { distanceM: 1000, durationSec: 362 },
    ])!;
    expect(c.meanPaceSecPerKm).toBeCloseTo(363.75);
    expect(c.fastestIndex).toBe(0);
    expect(c.slowestIndex).toBe(2);
    expect(c.halfDeltaSecPerKm).toBeCloseTo(4.5);
  });
  it('flags splits that disagree with totals', () => {
    expect(splitTotalsMismatch({ distanceM: 2000, durationSec: 720 }, [{ distanceM: 1000, durationSec: 360 }, { distanceM: 1000, durationSec: 360 }])).toBeNull();
    expect(splitTotalsMismatch({ distanceM: 3000, durationSec: 720 }, [{ distanceM: 1000, durationSec: 360 }, { distanceM: 1000, durationSec: 360 }])).not.toBeNull();
  });
  it('sums weekly totals by ISO week of local date', () => {
    const w = weeklyTotals([
      { localDate: '2026-10-19', distanceM: 5000, durationSec: 1500 },
      { localDate: '2026-10-25', distanceM: 8000, durationSec: 2900 },
      { localDate: '2026-10-26', distanceM: 3000, durationSec: 1000 },
    ]);
    expect(w).toEqual([
      { weekStart: '2026-10-19', distanceM: 13000, durationSec: 4400, count: 2 },
      { weekStart: '2026-10-26', distanceM: 3000, durationSec: 1000, count: 1 },
    ]);
  });
  it('keeps treadmill and outdoor records separate', () => {
    const recs = runPersonalRecords([
      run({ id: 'a', kind: 'outdoor', distanceM: 5000, durationSec: 1500 }),
      run({ id: 'b', kind: 'treadmill', distanceM: 5000, durationSec: 1200 }),
      run({ id: 'c', kind: 'outdoor', distanceM: 10000, durationSec: 3100 }),
    ]);
    const outdoor5k = recs.find((r) => r.kind === 'outdoor' && r.label.includes('5 km'))!;
    expect(outdoor5k.activityId).toBe('a');
    expect(recs.find((r) => r.kind === 'outdoor' && r.label === 'Longest run')!.activityId).toBe('c');
    expect(recs.find((r) => r.kind === 'treadmill' && r.label.includes('10 km'))).toBeUndefined();
  });
});

const swim = (p: Partial<SwimActivity>): SwimActivity => ({
  id: 's', localDate: '2026-04-18', startedAt: null, distanceM: 1500, durationSec: 2304, environment: 'pool',
  poolLengthM: 25, poolLengthUnit: 'm', laps: 60, stroke: 'freestyle', avgHr: null, rpe: null, notes: null, ...p,
});

describe('swimming', () => {
  it('calculates pace per 100 m = duration_s / distance_m × 100', () => {
    expect(pacePer100m(2304, 1500)).toBeCloseTo(153.6); // 38:24 for 1500 m = 2:34 /100m
    expect(formatPace(pacePer100m(2304, 1500))).toBe('2:34');
    expect(pacePer100m(100, 0)).toBeNull();
    expect(pacePer100m(0, 100)).toBeNull();
  });
  it('checks pool distance consistency without overwriting', () => {
    expect(checkPoolDistance(swim({})).status).toBe('consistent');
    const bad = checkPoolDistance(swim({ laps: 58 }));
    expect(bad).toEqual({ status: 'inconsistent', expectedM: 1450, diffM: 50 });
    // 25 yd pool: 22.86 m × 40 = 914.4 m
    expect(checkPoolDistance(swim({ poolLengthM: 22.86, laps: 40, distanceM: 914.4 })).status).toBe('consistent');
  });
  it('accepts open water without pool length', () => {
    expect(checkPoolDistance(swim({ environment: 'open_water', poolLengthM: null, laps: null })).status).toBe('not_applicable');
  });
  it('never mixes pool and open-water records', () => {
    const recs = swimPersonalRecords([
      swim({ id: 'pool', durationSec: 2400 }),
      swim({ id: 'ow', environment: 'open_water', poolLengthM: null, laps: null, durationSec: 2000 }),
    ]);
    const pool1k = recs.find((r) => r.environment === 'pool' && r.label.includes('1000'))!;
    expect(pool1k.activityId).toBe('pool');
  });
});

describe('cutting', () => {
  const entries = (pairs: [string, number][]) => pairs.map(([localDate, weightKg]) => ({ localDate, weightKg }));

  it('averages multiple weigh-ins per day', () => {
    expect(dailyWeights(entries([['2026-04-01', 80], ['2026-04-01', 81]]))).toEqual([{ localDate: '2026-04-01', weightKg: 80.5 }]);
  });

  it('rolling average uses only observed days and requires a minimum count', () => {
    const d = dailyWeights(entries([['2026-04-01', 80], ['2026-04-02', 79], ['2026-04-05', 78], ['2026-04-10', 77]]));
    const r = rollingAverage(d, 7, 3);
    expect(r[0]!.averageKg).toBeNull(); // 1 observation
    expect(r[1]!.averageKg).toBeNull(); // 2 observations
    expect(r[2]!.averageKg).toBeCloseTo(79); // 80,79,78
    expect(r[3]!.observations).toBe(2); // 04-04..04-10 has 78,77 only
    expect(r[3]!.averageKg).toBeNull();
  });

  it('weekly rate needs data in both windows', () => {
    const sparse = dailyWeights(entries([['2026-04-10', 80], ['2026-04-12', 79.6]]));
    expect(weeklyRate(sparse, '2026-04-14').status).toBe('insufficient_data');
    const dense = dailyWeights(
      entries([
        ['2026-04-01', 80.0], ['2026-04-03', 80.2], ['2026-04-05', 79.8],
        ['2026-04-08', 79.5], ['2026-04-10', 79.4], ['2026-04-14', 79.3],
      ]),
    );
    const r = weeklyRate(dense, '2026-04-14');
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.kgPerWeek).toBeCloseTo(79.4 - 80.0);
  });

  it('progress toward target works for loss and clamps', () => {
    expect(progressToTarget(80, 77, 74)).toBeCloseTo(0.5);
    expect(progressToTarget(80, 82, 74)).toBe(0);
    expect(progressToTarget(80, 70, 74)).toBe(1);
    expect(progressToTarget(80, 80, 80)).toBeNull();
  });

  it('sums nutrition and reports missing optional fields', () => {
    const t = sumNutrition([
      { kcal: 420, proteinG: 30, carbsG: 50, fatG: 10, fiberG: null, sodiumMg: null },
      { kcal: 560, proteinG: 40, carbsG: null, fatG: 20, fiberG: 5, sodiumMg: null },
    ]);
    expect(t.kcal).toBe(980);
    expect(t.proteinG).toBe(70);
    expect(t.carbsG).toBe(50);
    expect(t.missing).toEqual({ carbsG: 1, fatG: 0, fiberG: 1, sodiumMg: 2 });
    expect(scaleNutrition({ kcal: 100, proteinG: 10, carbsG: null, fatG: 2, fiberG: null, sodiumMg: null }, 1.5).fatG).toBe(3);
  });

  it('adherence treats unlogged days as unlogged, not as zero intake', () => {
    const a = weeklyAdherence(
      [
        { localDate: '2026-04-01', meal: 'breakfast', kcal: 2000, proteinG: 150, carbsG: null, fatG: null, fiberG: null, sodiumMg: null },
        { localDate: '2026-04-02', meal: 'lunch', kcal: 2500, proteinG: 100, carbsG: null, fatG: null, fiberG: null, sodiumMg: null },
      ],
      '2026-04-01',
      '2026-04-03',
      { kcal: 2200, proteinG: 150 },
    );
    expect(a.loggedDays).toBe(2);
    expect(a.days[0]).toMatchObject({ withinCalorieTarget: true, metProteinTarget: true });
    expect(a.days[1]).toMatchObject({ withinCalorieTarget: false, metProteinTarget: false });
    expect(a.days[2]).toMatchObject({ logged: false, withinCalorieTarget: null });
  });

  it('BMR does not assume sex when not provided', () => {
    const male = estimateBmr({ weightKg: 72, heightCm: 175, age: 30, sex: 'male' })!;
    expect(male.low).toBeCloseTo(10 * 72 + 6.25 * 175 - 5 * 30 + 5);
    const unknown = estimateBmr({ weightKg: 72, heightCm: 175, age: 30, sex: null })!;
    expect(unknown.high - unknown.low).toBeCloseTo(166);
    expect(estimateBmr({ weightKg: 0, heightCm: 175, age: 30, sex: null })).toBeNull();
  });

  it('warns about unsafe targets without suggesting extreme ones', () => {
    const w = checkCutTargets({ calorieTargetKcal: 1000, bmrLow: 1500, currentKg: 80, targetKg: 70, heightCm: 175, weeksToGoal: 4 });
    expect(w.map((x) => x.code).sort()).toEqual(['calories_below_floor', 'rate_too_fast']);
    expect(checkCutTargets({ calorieTargetKcal: 2000, bmrLow: 1600, currentKg: 80, targetKg: 76, heightCm: 175, weeksToGoal: 12 })).toEqual([]);
  });
});


describe('form validation', () => {
  const runForm: RunForm = { date: '2026-04-26', time: '06:30', distance: '5.2', duration: '32:18', kind: 'outdoor', avgHr: '', maxHr: '', cadence: '', elevation: '', rpe: '', notes: '', splits: [] };

  it('parses a valid run into metric units', () => {
    const r = parseRunForm(runForm, 'km');
    expect(r.ok && r.value).toMatchObject({ distanceM: 5200, durationSec: 1938, avgHr: null, splits: [] });
    const mi = parseRunForm({ ...runForm, distance: '1' }, 'mi');
    expect(mi.ok && mi.value.distanceM).toBeCloseTo(1609.344);
  });

  it('rejects zero distance, bad duration and inconsistent HR', () => {
    const r = parseRunForm({ ...runForm, distance: '0', duration: '5:99' }, 'km');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['distance', 'duration']);
    // Cross-field check runs once individual fields are valid.
    const hr = parseRunForm({ ...runForm, avgHr: '180', maxHr: '170' }, 'km');
    expect(!hr.ok && hr.errors.avgHr).toMatch(/exceed/);
  });

  it('validates splits only when supplied', () => {
    expect(parseRunForm({ ...runForm, splits: [{ distance: '1', duration: '6:00' }] }, 'km').ok).toBe(true);
    expect(parseRunForm({ ...runForm, splits: [{ distance: '', duration: '6:00' }] }, 'km').ok).toBe(false);
  });

  const swimForm: SwimForm = { date: '2026-04-18', time: '', distance: '1500', distanceUnit: 'm', duration: '38:24', environment: 'pool', poolLength: '25', poolLengthUnit: 'm', laps: '60', stroke: 'freestyle', avgHr: '', rpe: '', notes: '' };

  it('parses pool and open-water swims', () => {
    const p = parseSwimForm(swimForm);
    expect(p.ok && p.value).toMatchObject({ distanceM: 1500, durationSec: 2304, poolLengthM: 25, laps: 60 });
    const ow = parseSwimForm({ ...swimForm, environment: 'open_water', poolLength: '', laps: '' });
    expect(ow.ok && ow.value).toMatchObject({ environment: 'open_water', poolLengthM: null, laps: null });
    const yd = parseSwimForm({ ...swimForm, distance: '1000', distanceUnit: 'yd', poolLength: '25', poolLengthUnit: 'yd', laps: '40' });
    expect(yd.ok && yd.value.distanceM).toBeCloseTo(914.4);
  });

  it('rejects invalid swim distance', () => {
    expect(parseSwimForm({ ...swimForm, distance: '0' }).ok).toBe(false);
    expect(parseSwimForm({ ...swimForm, distance: 'abc' }).ok).toBe(false);
  });
});


describe('automatic targets', () => {
  const base = { goal: 'cut' as const, weightKg: 80, heightCm: 178, age: 30, sex: 'male' as const, activity: 'moderate' as const };
  it('computes a moderate cut with protein, fat and carbs adding up', () => {
    const r = computeAutoTargets(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = r.targets;
    // BMR = 10*80 + 6.25*178 - 5*30 + 5 = 1767.5; TDEE = ×1.55 ≈ 2740; deficit = min(440, 685, 750) = 440
    expect(t.maintenanceKcal).toBe(2740);
    expect(t.kcal).toBe(2300);
    expect(t.proteinG).toBe(160);
    expect(t.fatG).toBe(65);
    expect(Math.abs(t.proteinG * 4 + t.fatG * 9 + t.carbsG * 4 - t.kcal)).toBeLessThan(25);
  });
  it('maintenance when not cutting', () => {
    const r = computeAutoTargets({ ...base, goal: 'strength' });
    expect(r.ok && r.targets.kcal).toBe(2740);
    expect(r.ok && r.targets.proteinG).toBe(130);
  });
  it('never goes below the safe floor', () => {
    const r = computeAutoTargets({ ...base, weightKg: 45, heightCm: 150, age: 60, sex: 'female', activity: 'sedentary' });
    expect(r.ok && r.targets.kcal).toBeGreaterThanOrEqual(1200);
  });
  it('reports what is missing instead of guessing', () => {
    const r = computeAutoTargets({ ...base, heightCm: null, activity: null });
    expect(r).toEqual({ ok: false, missing: ['height', 'activity level'] });
  });
  it('BMI and goal-date projection', () => {
    expect(bmi(80, 178)!).toBeCloseTo(25.2, 1);
    expect(projectGoalDate(80, 75, -0.5, '2026-01-01')).toBe('2026-03-12');
    expect(projectGoalDate(80, 75, 0.2, '2026-01-01')).toBeNull(); // moving away from target
    expect(projectGoalDate(80, 75, 0, '2026-01-01')).toBeNull();
  });
});

describe('swim auto distance', () => {
  const f = { environment: 'pool' as const, distance: '', poolLength: '25', laps: '40' };
  it('fills distance from pool length × lengths only when blank', () => {
    expect(autoSwimDistance(f)).toBe('1000');
    expect(autoSwimDistance({ ...f, distance: '950' })).toBeNull();
    expect(autoSwimDistance({ ...f, environment: 'open_water' })).toBeNull();
    expect(autoSwimDistance({ ...f, laps: '' })).toBeNull();
  });
  it('parseSwimForm uses the calculated distance', () => {
    const r = parseSwimForm({ date: '2026-04-18', time: '', distance: '', distanceUnit: 'm', duration: '20:00', environment: 'pool', poolLength: '25', poolLengthUnit: 'm', laps: '40', stroke: null, avgHr: '', rpe: '', notes: '' });
    expect(r.ok && r.value.distanceM).toBe(1000);
  });
});
