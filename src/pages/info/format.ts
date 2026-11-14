// Display helpers shared by the E pages. Pure string work: nothing here depends on the browser's time zone.
import type { ApiError } from '../../contracts/api-client';

export { formatSimTime } from '../../app/DemoBar/format';

/** "ลองใหม่ได้ในอีก N วินาที" for 429/503 answers; empty string when the server gave no Retry-After. */
export function retryAfterText(error: Pick<ApiError, 'retry_after_s'>): string {
  const s = error.retry_after_s;
  if (s === undefined || s === null || !Number.isFinite(s)) return '';
  return `ลองใหม่ได้ในอีก ${Math.max(0, Math.ceil(s))} วินาที (นับตามเวลาจำลอง)`;
}
