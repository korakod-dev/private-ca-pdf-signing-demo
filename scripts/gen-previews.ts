// Generates public/previews/<DOCID>-p<n>.svg for every documents[].previews[] entry (fictional memo + DEMO watermark).
// The generated files are committed; run this after changing documents.json / certs.json / the layout.
//
//   npx tsx scripts/gen-previews.ts            write the files
//   npx tsx scripts/gen-previews.ts --check    exit 1 if the committed files differ from a fresh run (no writes)
//   --fixtures-dir <dir>  --public-dir <dir>   overrides (used by tests)
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import type { FixtureBundle } from '../src/contracts/fixtures';
import { defaultPaths, FIXTURE_NAMES, loadFixtureFiles } from './lib/fixture-checks';
import { renderAllPreviews } from './lib/previews';

const { values } = parseArgs({
  options: {
    check: { type: 'boolean', default: false },
    'fixtures-dir': { type: 'string' },
    'public-dir': { type: 'string' },
  },
});

const defaults = defaultPaths(resolve(import.meta.dirname, '..'));
const fixturesDir = values['fixtures-dir'] ? resolve(values['fixtures-dir']) : defaults.fixturesDir;
const publicDir = resolve(values['public-dir'] ?? defaults.publicDir);

const { files, findings } = loadFixtureFiles(fixturesDir);
if (findings.length > 0 || FIXTURE_NAMES.some((n) => !(n in files))) {
  console.error('gen-previews: fixtures are not loadable; run `npm run check:fixtures` first.');
  process.exit(1);
}

const previews = renderAllPreviews(files as unknown as FixtureBundle);
let drift = 0;
for (const [path, svg] of previews) {
  const full = resolve(publicDir, `.${path}`);
  if (!full.startsWith(publicDir + sep)) throw new Error(`preview path escapes the public folder: ${path}`);
  if (values.check) {
    if (!existsSync(full) || readFileSync(full, 'utf8') !== svg) {
      drift += 1;
      console.error(`gen-previews: ${path} is missing or out of date`);
    }
  } else {
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, svg, 'utf8');
  }
}

if (values.check) {
  if (drift > 0) process.exit(1);
  console.log(`gen-previews: OK (${previews.size} previews up to date)`);
} else {
  console.log(`gen-previews: wrote ${previews.size} previews to ${join(publicDir, 'previews')}`);
}
