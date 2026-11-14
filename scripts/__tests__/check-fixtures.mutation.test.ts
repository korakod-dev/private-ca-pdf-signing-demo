// @vitest-environment node
// Mutation test for scripts/check-fixtures.ts: copy the fixtures to a temp dir, inject ONE violation per rule,
// run the real script as a child process and expect exit code 1 with file + JSON pointer + rule in the output.
// The unmodified copy must exit 0 (otherwise the mutations prove nothing).
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatThaiId, makeSandbox, randomMobile, randomValidThaiId, runScript, type Sandbox } from './helpers';

interface Mutation {
  name: string;
  /** Expected output substrings: file, JSON pointer, rule. */
  expect: { file: string; pointer: string; rule: string };
  apply: (sb: Sandbox) => void;
}

// Sample ID / phone are generated per run: no valid-looking ID or dialable number is stored in the repo.
const SAMPLE_ID = formatThaiId(randomValidThaiId(), '-');
const SAMPLE_PHONE = randomMobile().replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');

const FP_NOT_DEMO = Array.from({ length: 32 }, (_, i) => (i + 16).toString(16).toUpperCase()).join(':');

const MUTATIONS: Mutation[] = [
  {
    name: 'Thai national ID in free text',
    expect: { file: 'mail.json', pointer: '/0/body_th', rule: 'real-data/thai-id' },
    apply: (sb) => sb.mutate('mail', (d) => { d[0].body_th += ` ${SAMPLE_ID}`; }),
  },
  {
    name: 'Thai phone number in free text',
    expect: { file: 'mail.json', pointer: '/0/body_th', rule: 'real-data/phone' },
    apply: (sb) => sb.mutate('mail', (d) => { d[0].body_th += ` โทร ${SAMPLE_PHONE}`; }),
  },
  {
    name: 'fingerprint not starting with DE:M0',
    expect: { file: 'pki.json', pointer: '/1/fingerprint_sha256', rule: 'real-data/fingerprint-prefix' },
    apply: (sb) => sb.mutate('pki', (d) => { d[1].fingerprint_sha256 = FP_NOT_DEMO; }),
  },
  {
    name: 'e-mail outside lab.korakod.dev',
    expect: { file: 'personas.json', pointer: '/0/email', rule: 'real-data/email' },
    apply: (sb) => sb.mutate('personas', (d) => { d[0].email = 'somchai@gmail.com'; }),
  },
  {
    name: 'person name that is not a persona',
    expect: { file: 'requests.json', pointer: '/requests/0/csr/subject_cn', rule: 'real-data/person-name' },
    apply: (sb) => sb.mutate('requests', (d) => { d.requests[0].csr.subject_cn = 'John Smith'; }),
  },
  {
    name: 'CA subject without DEMO',
    expect: { file: 'pki.json', pointer: '/0/subject', rule: 'real-data/ca-subject-demo' },
    apply: (sb) => sb.mutate('pki', (d) => { d[0].subject = 'CN=Some Real Root CA'; }),
  },
  {
    name: 'URL outside the allow-list',
    expect: { file: 'mail.json', pointer: '/1/body_th', rule: 'real-data/url' },
    apply: (sb) => sb.mutate('mail', (d) => { d[1].body_th += ' https://example.com/renew'; }),
  },
  {
    name: 'schema: document sha256 without the de00 marker',
    expect: { file: 'documents.json', pointer: '/0/sha256', rule: 'schema/pattern' },
    apply: (sb) => sb.mutate('documents', (d) => { d[0].sha256 = 'ab'.repeat(32); }),
  },
  {
    name: 'schema: instant without the +07:00 offset',
    expect: { file: 'certs.json', pointer: '/0/not_before', rule: 'schema/pattern' },
    apply: (sb) => sb.mutate('certs', (d) => { d[0].not_before = '2026-10-07T09:00:00Z'; }),
  },
  {
    name: 'schema: serial 01 on a cert without untrusted_fixture',
    expect: { file: 'certs.json', pointer: '/0/untrusted_fixture', rule: 'schema/required' },
    apply: (sb) => sb.mutate('certs', (d) => { d[0].serial = '01'; d[0].holder = null; d[0].issuer_ca = null; }),
  },
  {
    name: 'schema: unknown extra property',
    expect: { file: 'system.json', pointer: '/surprise', rule: 'schema/additionalProperties' },
    apply: (sb) => sb.mutate('system', (d) => { d.surprise = true; }),
  },
  {
    name: 'schema: unknown enum value',
    expect: { file: 'certs.json', pointer: '/0/state', rule: 'schema/enum' },
    apply: (sb) => sb.mutate('certs', (d) => { d[0].state = 'Valid'; }),
  },
  {
    name: 'integrity: dangling superseded_by',
    expect: { file: 'certs.json', pointer: '/3/superseded_by', rule: 'integrity/unknown-ref' },
    apply: (sb) => sb.mutate('certs', (d) => { d[3].superseded_by = 'DE:M0:AA:AA:AA:AA'; }),
  },
  {
    name: 'preview file missing',
    expect: { file: 'documents.json', pointer: '/0/previews/0', rule: 'preview/missing' },
    apply: (sb) => rmSync(join(sb.publicDir, 'previews', 'D01-p1.svg')),
  },
  {
    name: 'preview without the DEMO watermark',
    expect: { file: 'documents.json', pointer: '/0/previews/1', rule: 'preview/no-demo-watermark' },
    apply: (sb) => writeFileSync(join(sb.publicDir, 'previews', 'D01-p2.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
  },
  {
    name: 'unknown extra JSON file in the fixtures folder',
    expect: { file: 'extra.json', pointer: '/', rule: 'fixtures/unknown-file' },
    apply: (sb) => writeFileSync(join(sb.fixturesDir, 'extra.json'), '{}'),
  },
  {
    name: 'fixture file that is not valid JSON',
    expect: { file: 'mail.json', pointer: '/', rule: 'fixtures/invalid-json' },
    apply: (sb) => writeFileSync(join(sb.fixturesDir, 'mail.json'), '[ not json'),
  },
];

describe('check-fixtures.ts as a child process', () => {
  it('exits 0 on an unmodified copy of the fixtures', async () => {
    const sb = makeSandbox();
    try {
      const r = await runScript('check-fixtures.ts', sb.args());
      expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
      expect(r.stdout).toContain('check-fixtures: OK');
    } finally {
      sb.cleanup();
    }
  }, 60_000);

  it('exits 0 with the default paths (the real fixtures)', async () => {
    const r = await runScript('check-fixtures.ts', []);
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
  }, 60_000);

  it.concurrent.each(MUTATIONS)('exits 1 and reports file + pointer + rule: $name', async (m) => {
    const sb = makeSandbox();
    try {
      m.apply(sb);
      const r = await runScript('check-fixtures.ts', sb.args());
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(`${m.expect.file} ${m.expect.pointer} [${m.expect.rule}]`);
    } finally {
      sb.cleanup();
    }
  }, 60_000);
});
