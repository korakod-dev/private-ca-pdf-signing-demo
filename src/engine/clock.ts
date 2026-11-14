// Simulated-clock arithmetic (fixed +07:00 offset, no DST, forward-only).
// Everything here is pure: instants are ISO strings, durations are a small ISO-8601 subset.
import type { Instant } from '../contracts/fixtures';
import type { AdvanceDuration } from '../contracts/api';
import { ADVANCE_DURATIONS } from '../contracts/api';
import type { Clock, ClockState } from '../contracts/engine';

export const OFFSET_MS = 7 * 3600 * 1000;
export const MS_SECOND = 1000;
export const MS_MINUTE = 60 * MS_SECOND;
export const MS_HOUR = 60 * MS_MINUTE;
export const MS_DAY = 24 * MS_HOUR;

const INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\+07:00$/;

/** True when `v` is an ISO instant with the fixed +07:00 offset that also denotes a real calendar moment. */
export function isInstant(v: unknown): v is Instant {
  return typeof v === 'string' && INSTANT_RE.test(v) && Number.isFinite(Date.parse(v));
}

/** Instant -> epoch milliseconds (UTC). Throws on malformed input so bugs surface early. */
export function toMs(i: Instant): number {
  const ms = Date.parse(i);
  if (!INSTANT_RE.test(i) || !Number.isFinite(ms)) throw new Error(`invalid instant: ${i}`);
  return ms;
}

/** Epoch milliseconds -> "YYYY-MM-DDTHH:mm:ss+07:00" (truncated to whole seconds). */
export function fromMs(ms: number): Instant {
  const local = new Date(Math.floor(ms / MS_SECOND) * MS_SECOND + OFFSET_MS);
  return `${local.toISOString().slice(0, 19)}+07:00`;
}

/** Normalises any accepted instant spelling (e.g. with milliseconds) to the canonical form. */
export function normalize(i: Instant): Instant {
  return fromMs(toMs(i));
}

export function addMs(i: Instant, ms: number): Instant {
  return fromMs(toMs(i) + ms);
}
export function addDays(i: Instant, days: number): Instant {
  return addMs(i, days * MS_DAY);
}

/** Calendar-aware year addition in local time (Feb 29 clamps to Feb 28). */
export function addYears(i: Instant, years: number): Instant {
  const d = new Date(toMs(i) + OFFSET_MS);
  const y = d.getUTCFullYear() + years;
  const m = d.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const day = Math.min(d.getUTCDate(), lastDay);
  const local = Date.UTC(y, m, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
  return fromMs(local - OFFSET_MS);
}

const DURATION_RE = /^P(?:(\d+)Y)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/**
 * Adds an ISO-8601 duration (years, days, hours, minutes, seconds; no months/weeks, no negatives = forward-only).
 * Years are calendar years, the rest are fixed lengths.
 */
export function addDuration(i: Instant, duration: string): Instant {
  const m = DURATION_RE.exec(duration);
  if (!m || duration === 'P' || duration.endsWith('T')) throw new Error(`invalid duration: ${duration}`);
  const [, y, d, h, min, s] = m;
  let out = i;
  if (y) out = addYears(out, Number(y));
  const ms =
    Number(d ?? 0) * MS_DAY + Number(h ?? 0) * MS_HOUR + Number(min ?? 0) * MS_MINUTE + Number(s ?? 0) * MS_SECOND;
  return ms ? addMs(out, ms) : out;
}

/** The only durations the demo clock route accepts (demo bar buttons). */
export function isAdvanceDuration(v: unknown): v is AdvanceDuration {
  return typeof v === 'string' && (ADVANCE_DURATIONS as readonly string[]).includes(v);
}

/** Epoch ms of local midnight of the day containing `ms`. */
function localMidnight(ms: number): number {
  return Math.floor((ms + OFFSET_MS) / MS_DAY) * MS_DAY - OFFSET_MS;
}

/** Same local date as `i`, at `hour`:00:00. */
export function atHour(i: Instant, hour: number): Instant {
  return fromMs(localMidnight(toMs(i)) + hour * MS_HOUR);
}

/** All daily trigger times (epoch ms) at local `hour`:00 within the half-open window (from, to]. */
export function dailyTriggers(from: Instant, to: Instant, hour: number): number[] {
  const f = toMs(from);
  const t = toMs(to);
  const out: number[] = [];
  for (let day = localMidnight(f); day + hour * MS_HOUR <= t; day += MS_DAY) {
    const at = day + hour * MS_HOUR;
    if (at > f) out.push(at);
  }
  return out;
}

export function isBefore(a: Instant, b: Instant): boolean {
  return toMs(a) < toMs(b);
}
export function isOnOrBefore(a: Instant, b: Instant): boolean {
  return toMs(a) <= toMs(b);
}
export function diffMs(a: Instant, b: Instant): number {
  return toMs(a) - toMs(b);
}

/**
 * Current simulated clock. 'running': sim_base + elapsed wall time; 'frozen': sim_base only.
 * Forward-only: never earlier than `floor` (the engine's last processed tick), so a wall clock that jumps back
 * (another tab, system clock change) cannot move the simulation backwards.
 */
export function clockAt(clock: ClockState, wallMs: number, floor: Instant): Clock {
  const base = toMs(clock.sim_base);
  const computed = clock.mode === 'frozen' ? base : base + Math.max(0, wallMs - clock.wall_base);
  const now = fromMs(Math.max(computed, toMs(floor)));
  return { now, wallMs };
}
