import { paceSecPerKm } from '../domain/running';
import { pacePer100m } from '../domain/swimming';
import { METERS_PER_MILE, UnitSystem, displayWeight, formatPace, fromMeters, round } from '../domain/units';

/** UI-boundary formatting in the user's unit system. Storage stays metric. */

export function fmtWeight(kg: number | null | undefined, sys: UnitSystem, decimals = 1): { value: string; unit: string } {
  if (kg == null || !Number.isFinite(kg)) return { value: '–', unit: sys === 'imperial' ? 'lb' : 'kg' };
  const d = displayWeight(kg, sys);
  return { value: round(d.value, decimals).toFixed(decimals), unit: d.unit };
}

export function fmtWeightDelta(kg: number, sys: UnitSystem): string {
  const d = displayWeight(Math.abs(kg), sys);
  const sign = kg > 0 ? '+' : kg < 0 ? '−' : '±';
  return `${sign}${d.value.toFixed(1)} ${d.unit}`;
}

export function fmtDistance(m: number, sys: UnitSystem, decimals = 2): { value: string; unit: string } {
  const unit = sys === 'imperial' ? 'mi' : 'km';
  return { value: fromMeters(m, unit).toFixed(decimals), unit };
}

export function fmtRunPace(durationSec: number, distanceM: number, sys: UnitSystem): { value: string; unit: string } {
  const perKm = paceSecPerKm(durationSec, distanceM);
  const per = perKm == null ? null : sys === 'imperial' ? perKm * (METERS_PER_MILE / 1000) : perKm;
  return { value: formatPace(per), unit: sys === 'imperial' ? '/mi' : '/km' };
}

export function fmtRunPaceFromSecPerKm(secPerKm: number, sys: UnitSystem): string {
  return `${formatPace(sys === 'imperial' ? secPerKm * (METERS_PER_MILE / 1000) : secPerKm)} ${sys === 'imperial' ? '/mi' : '/km'}`;
}

export function fmtSwimPace(durationSec: number, distanceM: number): string {
  return `${formatPace(pacePer100m(durationSec, distanceM))} /100m`;
}

export function fmtSwimDistance(m: number): string {
  return m >= 10000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m).toLocaleString()} m`;
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString();
}
