/**
 * Unit conversion and formatting.
 *
 * Internal storage is always metric: kg, cm, meters, seconds, kcal.
 * Conversion happens only at the UI boundary through these helpers.
 */

export type UnitSystem = 'metric' | 'imperial';
export type DistanceUnit = 'km' | 'mi';
export type PoolLengthUnit = 'm' | 'yd';

export const KG_PER_LB = 0.45359237;
export const METERS_PER_MILE = 1609.344;
export const METERS_PER_YARD = 0.9144;
export const CM_PER_INCH = 2.54;

export const kgToLb = (kg: number) => kg / KG_PER_LB;
export const lbToKg = (lb: number) => lb * KG_PER_LB;
export const cmToIn = (cm: number) => cm / CM_PER_INCH;
export const inToCm = (inches: number) => inches * CM_PER_INCH;

export function distanceUnitFor(system: UnitSystem): DistanceUnit {
  return system === 'imperial' ? 'mi' : 'km';
}

export function toMeters(value: number, unit: DistanceUnit | 'm' | 'yd'): number {
  switch (unit) {
    case 'km':
      return value * 1000;
    case 'mi':
      return value * METERS_PER_MILE;
    case 'yd':
      return value * METERS_PER_YARD;
    case 'm':
      return value;
  }
}

export function fromMeters(meters: number, unit: DistanceUnit | 'm' | 'yd'): number {
  switch (unit) {
    case 'km':
      return meters / 1000;
    case 'mi':
      return meters / METERS_PER_MILE;
    case 'yd':
      return meters / METERS_PER_YARD;
    case 'm':
      return meters;
  }
}

/** Body mass for display. */
export function displayWeight(kg: number, system: UnitSystem): { value: number; unit: 'kg' | 'lb' } {
  return system === 'imperial' ? { value: kgToLb(kg), unit: 'lb' } : { value: kg, unit: 'kg' };
}

/** Body mass from user input in the user's unit system. */
export function weightInputToKg(value: number, system: UnitSystem): number {
  return system === 'imperial' ? lbToKg(value) : value;
}

export function round(value: number, decimals = 1): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** 3725 -> "1:02:05", 305 -> "5:05". */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '–';
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Pace in seconds per unit -> "m:ss". Rounds to whole seconds and carries correctly (e.g. 359.6 -> "6:00"). */
export function formatPace(secondsPerUnit: number | null | undefined): string {
  if (secondsPerUnit == null || !Number.isFinite(secondsPerUnit) || secondsPerUnit <= 0) return '–';
  const s = Math.round(secondsPerUnit);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Parses "ss", "mm:ss" or "h:mm:ss" into seconds. Returns null for malformed input.
 * Minutes/seconds components after the first must be < 60.
 */
export function parseDuration(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+(:\d{1,2}){0,2}$/.test(trimmed)) return null;
  const parts = trimmed.split(':').map(Number);
  if (parts.slice(1).some((p) => p >= 60)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** Parses a decimal number accepting both "." and "," separators. */
export function parseDecimal(input: string): number | null {
  const normalized = input.trim().replace(',', '.');
  if (normalized === '' || !/^-?\d*\.?\d+$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
