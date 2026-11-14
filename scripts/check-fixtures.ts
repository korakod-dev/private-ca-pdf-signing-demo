// `npm run check:fixtures` (also the first step of `npm run build`).
// Validates src/fixtures/*.json against the JSON Schemas, runs the "looks-like-real-data" detector, checks
// cross references and the preview files. Exit 1 with one line per problem: file + JSON pointer + rule.
// Findings never print the offending value (it may be real data).
//
// Optional overrides (used by the mutation tests; defaults are the app folders):
//   --fixtures-dir <dir>   --schema-dir <dir>   --public-dir <dir>
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { defaultPaths, runFixtureChecks } from './lib/fixture-checks';
import { formatFinding } from './lib/types';

const { values } = parseArgs({
  options: {
    'fixtures-dir': { type: 'string' },
    'schema-dir': { type: 'string' },
    'public-dir': { type: 'string' },
  },
});

const defaults = defaultPaths(resolve(import.meta.dirname, '..'));
const findings = runFixtureChecks({
  fixturesDir: values['fixtures-dir'] ? resolve(values['fixtures-dir']) : defaults.fixturesDir,
  schemaDir: values['schema-dir'] ? resolve(values['schema-dir']) : defaults.schemaDir,
  publicDir: values['public-dir'] ? resolve(values['public-dir']) : defaults.publicDir,
});

if (findings.length > 0) {
  console.error(`check-fixtures: FAILED with ${findings.length} problem(s):`);
  for (const f of findings) console.error(formatFinding(f));
  process.exit(1);
}
console.log('check-fixtures: OK (schemas, real-data detector, references, previews)');
