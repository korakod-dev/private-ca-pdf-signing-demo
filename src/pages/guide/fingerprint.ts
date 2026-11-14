// Fingerprint comparison for the practice box on /guide.
// Lenient on purpose (the exercise teaches comparing, not typing perfectly): case, spaces and ":" / "-" separators are ignored.
// Everything else must match exactly: a single wrong character is a mismatch.

/** Upper-case, without spaces and separators. */
export function normalizeFingerprint(value: string): string {
  return value.replace(/[\s:\-.]/g, '').toUpperCase();
}

/** True when `typed` is the same fingerprint as `expected` (and non-empty). */
export function fingerprintMatches(typed: string, expected: string): boolean {
  const t = normalizeFingerprint(typed);
  return t.length > 0 && t === normalizeFingerprint(expected);
}
