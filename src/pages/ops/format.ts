// Display helpers for the ops pages (sub-task G). Pure functions, no Date objects: the text must not depend on the
// browser's time zone (all times are simulated +07:00 instants).

/** "2026-11-12T09:00:00+07:00" -> "2026-11-12 09:00:00 +07:00". Anything unexpected is returned unchanged. */
export function formatTime(instant: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?([+-]\d{2}:\d{2}|Z)$/.exec(instant);
  return m ? `${m[1]} ${m[2]} ${m[3]}` : instant;
}

/** Bytes -> "123 KB" / "1.2 MB" (binary units, one decimal for MB). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Milliseconds -> "1.4 วินาที (1400 ms)". */
export function formatOffset(ms: number): string {
  return `${(ms / 1000).toFixed(1)} วินาที (${ms} ms)`;
}
