// Shared types for the fixture/content checkers (sub-task A).

/** One problem found by a checker. Never carries the offending value (it may be real data). */
export interface Finding {
  /** File the problem is in, relative to its folder (e.g. "personas.json" or "guide/intro.md"). */
  file: string;
  /** JSON Pointer (RFC 6901) for fixtures; "line:N" for Markdown content. */
  pointer: string;
  /** Stable rule id, e.g. "real-data/thai-id" or "schema/pattern". */
  rule: string;
  /** Human-readable explanation WITHOUT the matched value. */
  message: string;
}

/** Formats a finding as one log line: file + pointer + rule (the contract of the checkers). */
export function formatFinding(f: Finding): string {
  return `  ${f.file} ${f.pointer || '/'} [${f.rule}] ${f.message}`;
}
