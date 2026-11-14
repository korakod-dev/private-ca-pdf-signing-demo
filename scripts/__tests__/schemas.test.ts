// @vitest-environment node
// JSON Schema + referential-integrity checks, run in-process (the child-process variants are in
// check-fixtures.mutation.test.ts). Also pins the pattern rules from the plan: DE:M0 serials/fingerprints,
// de00 document hashes and +07:00 instants, plus the allow-listed untrusted cert.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FixtureBundle } from '../../src/contracts/fixtures';
import { fixtures } from '../../src/fixtures';
import { checkIntegrity, FIXTURE_NAMES, runFixtureChecks, defaultPaths, validateSchemas } from '../lib/fixture-checks';
import type { FixtureFiles } from '../lib/real-data-detector';
import { APP_ROOT, loadRealFixtures } from './helpers';

const SCHEMA_DIR = join(APP_ROOT, 'src', 'fixtures', 'schema');
type Loose = FixtureFiles & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** "file pointer [rule]" for each schema finding after `edit`. */
function schemaFindings(edit: (f: Loose) => void): string[] {
  const files = loadRealFixtures() as Loose;
  edit(files);
  return validateSchemas(files, SCHEMA_DIR).map((f) => `${f.file} ${f.pointer} [${f.rule}]`);
}

describe('schemas', () => {
  it('accept the real fixtures, and the whole pipeline passes on the default paths', () => {
    expect(validateSchemas(loadRealFixtures(), SCHEMA_DIR)).toEqual([]);
    expect(runFixtureChecks(defaultPaths(APP_ROOT))).toEqual([]);
  });

  it('the loaded `fixtures` bundle is the same data the schemas validate', () => {
    const files = loadRealFixtures();
    for (const name of FIXTURE_NAMES) expect(fixtures[name]).toEqual(files[name]);
  });

  it('serial / fingerprint pattern: DE:M0 + pairs of 0-9A-Z (the OCSP signer uses SP)', () => {
    expect(schemaFindings((f) => { f.pki[3].serial = 'DE:M0:0C:SP:01'; })).toEqual([]);
    expect(schemaFindings((f) => { f.pki[0].serial = 'DE:M0:0c:sp'; })).toContain('pki.json /0/serial [schema/pattern]');
    expect(schemaFindings((f) => { f.pki[0].serial = 'DE:M1:00:01'; })).toContain('pki.json /0/serial [schema/pattern]');
    expect(schemaFindings((f) => { f.pki[0].serial = 'DE:M0'; })).toContain('pki.json /0/serial [schema/pattern]');
  });

  it('fingerprint has exactly 32 pairs', () => {
    const fp = (pairs: number): string => ['DE', 'M0', ...Array.from({ length: pairs - 2 }, () => 'AB')].join(':');
    expect(schemaFindings((f) => { f.pki[0].fingerprint_sha256 = fp(32); })).toEqual([]);
    expect(schemaFindings((f) => { f.pki[0].fingerprint_sha256 = fp(31); })).toContain('pki.json /0/fingerprint_sha256 [schema/pattern]');
    expect(schemaFindings((f) => { f.pki[0].fingerprint_sha256 = fp(33); })).toContain('pki.json /0/fingerprint_sha256 [schema/pattern]');
  });

  it('document sha256: de00 + 60 lowercase hex characters', () => {
    const ok = `de00${'0123456789abcdef'.repeat(4).slice(0, 60)}`;
    expect(schemaFindings((f) => { f.documents[0].sha256 = ok; })).toEqual([]);
    for (const bad of [ok.slice(0, 63), `${ok}0`, ok.toUpperCase(), `ab${ok.slice(2)}`, `de01${ok.slice(4)}`]) {
      expect(schemaFindings((f) => { f.documents[0].sha256 = bad; })).toContain('documents.json /0/sha256 [schema/pattern]');
    }
  });

  it('instants must be ISO 8601 with +07:00', () => {
    expect(schemaFindings((f) => { f.certs[0].not_before = '2026-10-07T09:00:00+07:00'; })).toEqual([]);
    for (const bad of ['2026-10-07T09:00:00Z', '2026-10-07T09:00:00+00:00', '2026-10-07', '2026-10-07 09:00:00+07:00', '2026-13-07T09:00:00+07:00']) {
      expect(schemaFindings((f) => { f.certs[0].not_before = bad; })).toContain('certs.json /0/not_before [schema/pattern]');
    }
  });

  it('serial 01 is legal only for the untrusted_fixture cert without holder/issuer; other certs may not carry the marker', () => {
    expect(schemaFindings((f) => { f.certs[0].serial = '01'; f.certs[0].holder = null; f.certs[0].issuer_ca = null; })).toContain(
      'certs.json /0/untrusted_fixture [schema/required]',
    );
    expect(schemaFindings((f) => { f.certs[0].untrusted_fixture = true; })).not.toEqual([]);
    expect(schemaFindings((f) => { f.certs[7].holder = 'u-somchai'; })).not.toEqual([]);
    expect(schemaFindings((f) => { f.certs[7].serial = '02'; })).not.toEqual([]);
  });

  it('rejects missing required properties, wrong types and extra properties', () => {
    expect(schemaFindings((f) => { delete f.personas[0].email; })).toContain('personas.json /0/email [schema/required]');
    expect(schemaFindings((f) => { f.system.limits.queue_max = '20'; })).toContain('system.json /limits/queue_max [schema/type]');
    expect(schemaFindings((f) => { f.mail[0].extra = 1; })).toContain('mail.json /0/extra [schema/additionalProperties]');
  });

  it('personas: e-mail must be @lab.korakod.dev; previews 1-3 pages named after the document', () => {
    expect(schemaFindings((f) => { f.personas[0].email = 'a@example.com'; })).toContain('personas.json /0/email [schema/pattern]');
    expect(schemaFindings((f) => { f.documents[0].previews = []; })).toContain('documents.json /0/previews [schema/minItems]');
    expect(schemaFindings((f) => { f.documents[10].previews.push('/previews/D11-p4.svg'); })).not.toEqual([]);
  });
});

describe('referential integrity', () => {
  const bundle = (): FixtureBundle => structuredClone(loadRealFixtures()) as unknown as FixtureBundle;
  const found = (edit: (b: FixtureBundle) => void): string[] => {
    const b = bundle();
    edit(b);
    return checkIntegrity(b).map((f) => `${f.file} ${f.pointer} [${f.rule}]`);
  };

  it('passes on the real fixtures', () => {
    expect(checkIntegrity(bundle())).toEqual([]);
  });

  it('flags dangling references', () => {
    expect(found((b) => { b.certs[0]!.holder = 'u-guest'; b.personas = b.personas.filter((p) => p.id !== 'u-guest'); })).toContain('certs.json /0/holder [integrity/unknown-ref]');
    expect(found((b) => { b.documents[0]!.signatures[0]!.signer_cert_serial = 'DE:M0:00:00'; })).toContain('documents.json /0/signatures/0/signer_cert_serial [integrity/unknown-ref]');
    expect(found((b) => { b.documents[0]!.doc_timestamps[0]!.tsa_serial = 'DE:M0:00:00'; })).toContain('documents.json /0/doc_timestamps/0/tsa_serial [integrity/unknown-ref]');
    expect(found((b) => { b.requests.requests[0]!.appointment_id = 'slot-none'; })).toContain('requests.json /requests/0/appointment_id [integrity/unknown-ref]');
    expect(found((b) => { b.mail[0]!.to = 'u-guest'; b.personas = b.personas.filter((p) => p.id !== 'u-guest'); })).toContain('mail.json /0/to [integrity/unknown-ref]');
  });

  it('flags duplicates and badly named previews', () => {
    expect(found((b) => { b.certs[1]!.serial = b.certs[0]!.serial; })).toContain('certs.json /1 [integrity/duplicate]');
    expect(found((b) => { b.documents[1]!.id = 'D01'; })).toContain('documents.json /1 [integrity/duplicate]');
    expect(found((b) => { b.documents[0]!.previews = ['/previews/D02-p1.svg', '/previews/D01-p2.svg']; })).toContain('documents.json /0/previews/0 [integrity/preview-name]');
  });
});
