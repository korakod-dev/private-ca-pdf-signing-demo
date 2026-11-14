// Rules for the explanation Markdown under src/content/** (spec section 5: do not invent standard text,
// cite the main spec; no external references). Pure function over one file's text.
//
// Rules:
//   content/refs-header     first line must be `<!-- refs: A, B, ... -->` with at least one non-empty ref
//   content/clause-citation a clause-level citation (ข้อ N, clause N, §, N.N.N) needs `[verified]` on the same line
//   content/external-url    no absolute URLs / protocol-relative URLs / bare www. hosts (relative links are fine)
// The refs header line itself is exempt from the clause rule (refs such as "7.6.1" belong there).
import { normalizeDigits } from './real-data-detector';
import type { Finding } from './types';

const REFS_HEADER = /^<!--\s*refs:\s*([^>]*?)\s*-->\s*$/;
const CLAUSE_CITATION = [/ข้อ\s*\d/, /\bclauses?\s*\d/i, /§/, /\b\d+\.\d+\.\d+\b/];
const VERIFIED_MARK = '[verified]';
const EXTERNAL_URL = [/\b[A-Za-z][A-Za-z0-9+.-]*:\/\/\S/, /(?:^|[\s"'(=<])\/\/[A-Za-z0-9]/, /(?<![A-Za-z0-9.@-])www\.[A-Za-z0-9-]+\.[A-Za-z]{2,}/i];

/** Parses the refs header; returns the ref list or null when the header is absent/empty. */
export function parseRefs(firstLine: string): string[] | null {
  const m = REFS_HEADER.exec(firstLine.replace(/^\uFEFF/, ''));
  if (!m) return null;
  const refs = (m[1] ?? '').split(',').map((r) => r.trim());
  return refs.length > 0 && refs.every((r) => r.length > 0) ? refs : null;
}

/** Checks one Markdown file. `file` is only used to label the findings (pointer is "line:N", 1-based). */
export function checkContentFile(file: string, markdown: string): Finding[] {
  const findings: Finding[] = [];
  const lines = markdown.split(/\r?\n/);

  if (parseRefs(lines[0] ?? '') === null) {
    findings.push({
      file,
      pointer: 'line:1',
      rule: 'content/refs-header',
      message: 'first line must be `<!-- refs: <comma separated refs> -->` with at least one ref',
    });
  }

  lines.forEach((raw, i) => {
    if (i === 0) return; // header (valid or already reported)
    const line = normalizeDigits(raw);
    const pointer = `line:${i + 1}`;
    if (CLAUSE_CITATION.some((re) => re.test(line)) && !line.includes(VERIFIED_MARK)) {
      findings.push({
        file,
        pointer,
        rule: 'content/clause-citation',
        message: `clause-level citation without ${VERIFIED_MARK} on the same line (cite the ref id from the header instead)`,
      });
    }
    if (EXTERNAL_URL.some((re) => re.test(line))) {
      findings.push({ file, pointer, rule: 'content/external-url', message: 'external URL is not allowed in content (use relative links)' });
    }
  });
  return findings;
}
