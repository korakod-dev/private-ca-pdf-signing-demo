// Display helpers for the demo bar.
import type { AdvanceDuration } from '../../contracts/api';

/**
 * "2026-11-12T09:00:00+07:00" -> "2026-11-12 09:00:00 +07:00". Done by string slicing (not Date) so the text never
 * depends on the browser's time zone. Anything unexpected is shown unchanged.
 */
export function formatSimTime(instant: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?([+-]\d{2}:\d{2}|Z)$/.exec(instant);
  return m ? `${m[1]} ${m[2]} ${m[3]}` : instant;
}

/** Button labels for the clock advances (the exact ISO duration is what gets sent to the API). */
export const ADVANCE_LABEL_TH: Record<AdvanceDuration, string> = {
  PT5M: '+5 นาที',
  PT1H: '+1 ชั่วโมง',
  P1D: '+1 วัน',
  P30D: '+30 วัน',
  P1Y: '+1 ปี',
  P5Y: '+5 ปี',
};
