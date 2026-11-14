// Fixture checks used by scripts/check-fixtures.ts (the build gate) and by the tests.
// Steps, in order:
//   1. load every fixture JSON file (unknown extra *.json files are rejected so nothing dodges validation)
//   2. JSON Schema validation (draft 2020-12, ajv) against src/fixtures/schema/*.schema.json
//   3. real-data detector (scripts/lib/real-data-detector.ts), always runs
//   4. referential integrity + preview files (only when the schemas passed, so the code can trust the shapes)
// All functions return findings; nothing here calls process.exit.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import _Ajv2020 from 'ajv/dist/2020.js';
import _addFormats from 'ajv-formats';
import type { ErrorObject } from 'ajv';
import type { FixtureBundle } from '../../src/contracts/fixtures';
import { detectRealData, type FixtureFiles } from './real-data-detector';
import type { Finding } from './types';

// ajv and ajv-formats are CommonJS packages; under tsx/ESM the class/function is the default export (or its
// `.default`, depending on the loader). Normalise once so both layouts work.
type AjvCtor = typeof import('ajv/dist/2020.js').default;
type AddFormats = typeof import('ajv-formats').default;
const Ajv2020: AjvCtor = ((_Ajv2020 as unknown as { default?: AjvCtor }).default ?? _Ajv2020) as AjvCtor;
const addFormats: AddFormats = ((_addFormats as unknown as { default?: AddFormats }).default ?? _addFormats) as AddFormats;

/** Fixture files and the schema that validates each (file base name = key in FixtureBundle). */
export const FIXTURE_NAMES = ['system', 'personas', 'pki', 'certs', 'requests', 'documents', 'mail'] as const;

export interface CheckPaths {
  /** Folder with the fixture JSON files (default: src/fixtures). */
  fixturesDir: string;
  /** Folder with the *.schema.json files (default: src/fixtures/schema). */
  schemaDir: string;
  /** Folder that previews are served from (default: public); preview paths are relative to it. */
  publicDir: string;
}

/** Default locations, relative to the app root (the folder holding package.json). */
export function defaultPaths(appRoot: string): CheckPaths {
  return {
    fixturesDir: join(appRoot, 'src', 'fixtures'),
    schemaDir: join(appRoot, 'src', 'fixtures', 'schema'),
    publicDir: join(appRoot, 'public'),
  };
}

// ---- 1. Loading ---------------------------------------------------------------------------------------------------

export function loadFixtureFiles(fixturesDir: string): { files: FixtureFiles; findings: Finding[] } {
  const files: FixtureFiles = {};
  const findings: Finding[] = [];
  const known = new Set<string>(FIXTURE_NAMES.map((n) => `${n}.json`));

  for (const name of readdirSync(fixturesDir).filter((f) => f.endsWith('.json')).sort()) {
    if (!known.has(name)) {
      findings.push({ file: name, pointer: '', rule: 'fixtures/unknown-file', message: 'JSON file has no schema; add it to FIXTURE_NAMES and write a schema' });
    }
  }
  for (const base of FIXTURE_NAMES) {
    const path = join(fixturesDir, `${base}.json`);
    if (!existsSync(path)) {
      findings.push({ file: `${base}.json`, pointer: '', rule: 'fixtures/missing-file', message: 'fixture file is missing' });
      continue;
    }
    try {
      files[base] = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch (err) {
      // JSON.parse messages can quote a piece of the input; keep only the error class to avoid echoing data.
      findings.push({ file: `${base}.json`, pointer: '', rule: 'fixtures/invalid-json', message: `not valid JSON (${(err as Error).name})` });
    }
  }
  return { files, findings };
}

// ---- 2. Schema validation -----------------------------------------------------------------------------------------

function readJson(path: string): object {
  return JSON.parse(readFileSync(path, 'utf8')) as object;
}

/** ajv error -> pointer of the offending value (missing/extra properties point at the property itself). */
function errorPointer(e: ErrorObject): string {
  const p = e.params as { missingProperty?: string; additionalProperty?: string };
  const extra = p.missingProperty ?? p.additionalProperty;
  return extra === undefined ? e.instancePath : `${e.instancePath}/${extra.replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

export function validateSchemas(files: FixtureFiles, schemaDir: string): Finding[] {
  // strictRequired is off: the if/then/else in certs.schema.json requires a property defined in the parent scope.
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
  addFormats(ajv);
  ajv.addSchema(readJson(join(schemaDir, 'common.schema.json')));

  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const base of FIXTURE_NAMES) {
    if (!(base in files)) continue; // already reported by loadFixtureFiles
    const validate = ajv.compile(readJson(join(schemaDir, `${base}.schema.json`)));
    if (validate(files[base])) continue;
    for (const e of validate.errors ?? []) {
      // anyOf/if wrappers repeat the same pointer; one finding per (file, pointer, keyword) is enough.
      const f: Finding = { file: `${base}.json`, pointer: errorPointer(e), rule: `schema/${e.keyword}`, message: e.message ?? 'schema violation' };
      const id = `${f.file}|${f.pointer}|${f.rule}`;
      if (seen.has(id)) continue;
      seen.add(id);
      findings.push(f);
    }
  }
  return findings;
}

// ---- 4a. Referential integrity ------------------------------------------------------------------------------------

/** Cross-file references and uniqueness. Call only with schema-valid data. */
export function checkIntegrity(bundle: FixtureBundle): Finding[] {
  const findings: Finding[] = [];
  const add = (file: string, pointer: string, rule: string, message: string): void => {
    findings.push({ file: `${file}.json`, pointer, rule, message });
  };
  const unique = (file: string, label: string, values: string[]): void => {
    const seen = new Set<string>();
    values.forEach((v, i) => {
      if (seen.has(v)) add(file, `/${i}`, 'integrity/duplicate', `duplicate ${label}`);
      seen.add(v);
    });
  };

  const personaIds = new Set<string>(bundle.personas.map((p) => p.id));
  const caIds = new Set<string>(bundle.pki.map((c) => c.id));
  const caSerials = new Set<string>(bundle.pki.map((c) => c.serial));
  const certSerials = new Set<string>(bundle.certs.map((c) => c.serial));
  const slotIds = new Set<string>(bundle.requests.appointment_slots.map((s) => s.id));

  unique('personas', 'persona id', bundle.personas.map((p) => p.id));
  unique('pki', 'CA id', bundle.pki.map((c) => c.id));
  unique('pki', 'CA serial', bundle.pki.map((c) => c.serial));
  unique('certs', 'cert serial', bundle.certs.map((c) => c.serial));
  unique('documents', 'document id', bundle.documents.map((d) => d.id));
  unique('mail', 'mail id', bundle.mail.map((m) => m.id));

  bundle.certs.forEach((c, i) => {
    if (c.holder !== null && !personaIds.has(c.holder)) add('certs', `/${i}/holder`, 'integrity/unknown-ref', 'holder is not a persona id');
    if (c.issuer_ca !== null && !caIds.has(c.issuer_ca)) add('certs', `/${i}/issuer_ca`, 'integrity/unknown-ref', 'issuer_ca is not a CA id');
    if (c.superseded_by !== null && !certSerials.has(c.superseded_by)) add('certs', `/${i}/superseded_by`, 'integrity/unknown-ref', 'superseded_by is not a cert serial');
  });
  bundle.requests.requests.forEach((r, i) => {
    if (!personaIds.has(r.requester)) add('requests', `/requests/${i}/requester`, 'integrity/unknown-ref', 'requester is not a persona id');
    if (r.appointment_id !== null && !slotIds.has(r.appointment_id)) add('requests', `/requests/${i}/appointment_id`, 'integrity/unknown-ref', 'appointment_id is not a slot id');
  });
  bundle.mail.forEach((m, i) => {
    if (!personaIds.has(m.to)) add('mail', `/${i}/to`, 'integrity/unknown-ref', 'recipient is not a persona id');
  });
  bundle.documents.forEach((d, i) => {
    d.signatures.forEach((s, j) => {
      const at = `/${i}/signatures/${j}`;
      if (!certSerials.has(s.signer_cert_serial)) add('documents', `${at}/signer_cert_serial`, 'integrity/unknown-ref', 'signer cert is not in certs.json');
      if (s.signature_timestamp && !caSerials.has(s.signature_timestamp.tsa_serial)) add('documents', `${at}/signature_timestamp/tsa_serial`, 'integrity/unknown-ref', 'TSA serial is not in pki.json');
      if (!d.signature_fields.includes(s.field)) add('documents', `${at}/field`, 'integrity/unknown-ref', 'signature field is not in signature_fields');
    });
    d.doc_timestamps.forEach((t, j) => {
      if (!caSerials.has(t.tsa_serial)) add('documents', `/${i}/doc_timestamps/${j}/tsa_serial`, 'integrity/unknown-ref', 'TSA serial is not in pki.json');
    });
    // Preview names must be /previews/<ID>-p1.svg ... -pN.svg in order, so gen-previews and the UI agree.
    d.previews.forEach((p, j) => {
      if (p !== `/previews/${d.id}-p${j + 1}.svg`) add('documents', `/${i}/previews/${j}`, 'integrity/preview-name', 'preview must be named /previews/<ID>-p<n>.svg in order');
    });
  });
  return findings;
}

// ---- 4b. Preview files --------------------------------------------------------------------------------------------

/** Every documents[].previews[] entry must exist under publicDir, be an SVG and contain the text DEMO. */
export function checkPreviews(bundle: FixtureBundle, publicDir: string): Finding[] {
  const findings: Finding[] = [];
  const root = resolve(publicDir);
  bundle.documents.forEach((d, i) => {
    d.previews.forEach((p, j) => {
      const pointer = `/${i}/previews/${j}`;
      const full = resolve(root, `.${p}`); // p starts with "/" (schema); "." keeps it inside root
      if (!full.startsWith(root + sep)) {
        findings.push({ file: 'documents.json', pointer, rule: 'preview/outside-public', message: 'preview path escapes the public folder' });
      } else if (!existsSync(full)) {
        findings.push({ file: 'documents.json', pointer, rule: 'preview/missing', message: 'preview file does not exist (run `npx tsx scripts/gen-previews.ts`)' });
      } else {
        const svg = readFileSync(full, 'utf8');
        if (!svg.includes('<svg')) findings.push({ file: 'documents.json', pointer, rule: 'preview/not-svg', message: 'preview is not an SVG' });
        if (!svg.includes('DEMO')) findings.push({ file: 'documents.json', pointer, rule: 'preview/no-demo-watermark', message: 'preview has no DEMO watermark' });
      }
    });
  });
  return findings;
}

// ---- Orchestration ------------------------------------------------------------------------------------------------

/** Runs all steps and returns every finding (empty array = pass). */
export function runFixtureChecks(paths: CheckPaths): Finding[] {
  const { files, findings } = loadFixtureFiles(paths.fixturesDir);
  findings.push(...validateSchemas(files, paths.schemaDir));
  const structurallySound = findings.length === 0; // loaded + schema-valid
  findings.push(...detectRealData(files));
  if (structurallySound) {
    // Everything loaded and every schema passed: the cast is justified by the schemas.
    const bundle = files as unknown as FixtureBundle;
    findings.push(...checkIntegrity(bundle), ...checkPreviews(bundle, paths.publicDir));
  }
  return findings;
}
