// `npm run check:content`: checks every src/content/**/*.md (see scripts/lib/content-rules.ts for the rules).
// Passes vacuously when there is no Markdown yet. Exit 1 with one line per problem: file + line + rule.
//
// Optional override (used by tests): --content-dir <dir>
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { checkContentFile } from './lib/content-rules';
import { formatFinding, type Finding } from './lib/types';

/** Recursively lists *.md files (sorted, so output is stable). */
function listMarkdown(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMarkdown(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const { values } = parseArgs({ options: { 'content-dir': { type: 'string' } } });
const contentDir = resolve(values['content-dir'] ?? join(import.meta.dirname, '..', 'src', 'content'));

const files = existsSync(contentDir) ? listMarkdown(contentDir) : [];
const findings: Finding[] = files.flatMap((f) => checkContentFile(relative(contentDir, f), readFileSync(f, 'utf8')));

if (findings.length > 0) {
  console.error(`check-content: FAILED with ${findings.length} problem(s):`);
  for (const f of findings) console.error(formatFinding(f));
  process.exit(1);
}
console.log(`check-content: OK (${files.length} Markdown file(s) checked)`);
