// Sanity checks: the contracts are internally consistent and the fixtures match the spec's value tables.
// (Sub-task A adds the schema/real-data checks and a fuller spec-values test; this file only guards the foundation.)
import { describe, expect, it } from 'vitest';
import { fixtures } from '../../fixtures';
import { API_ROUTES, PAGE_ROUTES, ROUTES, ROLE_HOME } from '../routes';
import { TID } from '../testids';
import { MISSIONS } from '../missions';
import { STORAGE_KEYS } from '../runtime';
import { SESSION_STORAGE_KEY } from '../store';
import { ADVANCE_DURATIONS } from '../api';

const FP = /^DE:M0(:[0-9A-Z]{2})+$/;
const byId = <T extends { id: string }>(xs: T[], id: string): T => {
  const x = xs.find((v) => v.id === id);
  if (!x) throw new Error(`missing ${id}`);
  return x;
};

describe('routes contract', () => {
  it('has 17 spec pages + NotFound, with unique keys and patterns', () => {
    expect(PAGE_ROUTES).toHaveLength(18);
    expect(new Set(PAGE_ROUTES.map((r) => r.key)).size).toBe(18);
    expect(new Set(PAGE_ROUTES.map((r) => r.pattern)).size).toBe(18);
  });

  it('API route keys are unique per (method, path) and demo-only routes are only demo/* and sign*', () => {
    const entries = Object.entries(API_ROUTES);
    expect(new Set(entries.map(([, d]) => `${d.method} ${d.path}`)).size).toBe(entries.length);
    for (const [key, def] of entries) {
      expect(def.demoOnly).toBe(key.startsWith('demo.') || key.startsWith('sign.'));
      expect(def.demoOnly).toBe(def.path.startsWith('/api/v1/demo/') || def.path.startsWith('/api/v1/sign'));
    }
  });

  it('role homes match the persona fixtures', () => {
    for (const p of fixtures.personas) expect(p.home_route).toBe(ROLE_HOME[p.role]);
    expect(ROUTES.verifyResult('job-1')).toBe('/verify/job-1');
  });

  it('storage keys share one session key', () => {
    expect(STORAGE_KEYS.session).toBe(SESSION_STORAGE_KEY);
    expect(STORAGE_KEYS.state.startsWith(STORAGE_KEYS.prefix)).toBe(true);
    expect(ADVANCE_DURATIONS).toHaveLength(6);
  });
});

describe('test id contract', () => {
  it('builders produce distinct ids', () => {
    expect(TID.demoBar.clockAdvance('P1D')).not.toBe(TID.demoBar.clockAdvance('P30D'));
    expect(TID.certs.row('DE:M0:4F:2A:91:01')).toBe('certs-row-DE:M0:4F:2A:91:01');
    expect(TID.page('verifyResult')).toBe('page-verifyResult');
  });

  it('has 11 missions M1..M11 in order', () => {
    expect(MISSIONS.map((m) => m.id)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10', 'M11']);
    for (const m of MISSIONS) expect(TID.missions.item(m.id)).toBe(`missions-item-${m.id}`);
  });
});

describe('fixture values (spec 7.1-7.5)', () => {
  it('system constants', () => {
    const s = fixtures.system;
    expect(s.epoch).toBe('2026-11-12T09:00:00+07:00');
    expect(s.demo_mfa).toBe('246810');
    expect(s.limits.queue_max).toBe(20);
    expect(s.limits.pdf_max_bytes).toBe(20 * 1024 * 1024);
  });

  it('personas: 8, with the proofing dates from the plan', () => {
    expect(fixtures.personas).toHaveLength(8);
    const p = (id: string) => byId(fixtures.personas, id);
    expect(p('u-somchai').last_in_person_proofing).toBe('2026-10-06T09:00:00+07:00');
    expect(p('u-wipawan').last_in_person_proofing).toBe('2026-09-11T09:00:00+07:00');
    expect(p('u-aree').last_in_person_proofing).toBe('2025-12-02T09:00:00+07:00');
    expect(p('u-nattapon').last_in_person_proofing).toBeNull();
    for (const x of fixtures.personas) expect(x.email.endsWith('@lab.korakod.dev')).toBe(true);
  });

  it('PKI: 7 CAs, DE:M0 fingerprints of 32 pairs, root fingerprint ends and starts as specified', () => {
    expect(fixtures.pki).toHaveLength(7);
    for (const ca of fixtures.pki) {
      expect(ca.fingerprint_sha256).toMatch(FP);
      expect(ca.fingerprint_sha256.split(':')).toHaveLength(32);
      expect(ca.serial).toMatch(FP);
      expect(ca.subject).toContain('DEMO');
    }
    const root = byId(fixtures.pki, 'root-2026');
    expect(root.fingerprint_sha256.startsWith('DE:M0:7A:C3')).toBe(true);
    expect(root.fingerprint_sha256.endsWith('19:BE')).toBe(true);
    expect(byId(fixtures.pki, 'ocsp-signer').serial).toBe('DE:M0:0C:SP:01');
    expect(byId(fixtures.pki, 'tsa-2028').serial).toBe('DE:M0:00:00:00:13');
    expect(byId(fixtures.pki, 'tsa-2030').serial).toBe('DE:M0:00:00:00:23');
  });

  it('certs: 8, only the D06 self-signed cert is non-DE:M0 and it is marked untrusted_fixture', () => {
    expect(fixtures.certs).toHaveLength(8);
    for (const c of fixtures.certs) {
      if (c.serial === '01') expect(c.untrusted_fixture).toBe(true);
      else expect(c.serial).toMatch(FP);
    }
    const aree = fixtures.certs.find((c) => c.serial === 'DE:M0:22:91:AF:03');
    expect(aree?.not_after).toBe('2026-12-03T09:00:00+07:00'); // 21 days after the epoch
    const old = fixtures.certs.find((c) => c.serial === 'DE:M0:6B:D0:22:01');
    expect(old).toMatchObject({ state: 'Revoked', revocation_reason: 'keyCompromise', superseded_by: 'DE:M0:6B:D0:22:02' });
  });

  it('requests: manop CSR fails checks 2 (name) and 4 (RSA 1024); 3 appointment slots', () => {
    const r = fixtures.requests.requests[0];
    expect(r).toMatchObject({ id: 'req-manop-01', requester: 'u-manop', state: 'awaitingInPerson' });
    expect(r?.csr).toMatchObject({ key_alg: 'RSA', key_size: 1024, subject_cn: 'สมชาย ใจดี' });
    expect(fixtures.requests.appointment_slots.map((s) => s.at.slice(0, 10))).toEqual(['2026-11-13', '2026-11-14', '2026-11-16']);
  });

  it('documents: D01-D12 with expected results from spec 7.5', () => {
    expect(fixtures.documents.map((d) => d.id)).toEqual(['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D10', 'D11', 'D12']);
    const e = (id: string) => byId(fixtures.documents, id).expected;
    expect(e('D01')).toMatchObject({ http_status: 200, indication: 'TOTAL-PASSED', sub_indication: null, code: 'VALID' });
    expect(e('D02')).toMatchObject({ indication: 'TOTAL-FAILED', code: 'MODIFIED' });
    expect(e('D03')).toMatchObject({ indication: 'TOTAL-FAILED', code: 'MODIFIED' });
    expect(e('D04')).toMatchObject({ indication: 'TOTAL-FAILED', sub_indication: 'REVOKED', code: 'REVOKED' });
    expect(e('D05')).toMatchObject({ indication: 'TOTAL-PASSED', code: 'VALID' });
    expect(e('D06')).toMatchObject({ sub_indication: 'NO_CERTIFICATE_CHAIN_FOUND', code: 'UNTRUSTED', warnings: ['MIXED_TRUST'] });
    expect(e('D07')).toMatchObject({ indication: 'TOTAL-PASSED', code: 'VALID' });
    expect(e('D08')).toMatchObject({ indication: 'INDETERMINATE', sub_indication: 'NO_POE', code: 'NO_POE' });
    expect(e('D09')).toMatchObject({ indication: 'TOTAL-PASSED', code: 'VALID', warnings: ['NO_SIGNER'] });
    expect(e('D10')).toMatchObject({ http_status: 422, problem_code: 'ENCRYPTED_PDF' });
    expect(e('D11')).toMatchObject({ http_status: 413, problem_code: 'PDF_TOO_LARGE' });
    expect(e('D12')).toMatchObject({ http_status: 422, problem_code: 'NOT_SIGNED' });
    expect(byId(fixtures.documents, 'D11').pages).toBe(250);
    expect(byId(fixtures.documents, 'D10').encrypted).toBe(true);
    expect(byId(fixtures.documents, 'D12').signature_fields).toEqual(['approver-1', 'approver-2']);
  });

  it('document hashes use the fake de00 marker; every signature references a known cert', () => {
    const serials = new Set(fixtures.certs.map((c) => c.serial));
    for (const d of fixtures.documents) {
      expect(d.sha256).toMatch(/^de00[0-9a-f]{60}$/);
      for (const s of d.signatures) expect(serials.has(s.signer_cert_serial)).toBe(true);
    }
  });

  it('signature ids are unique across documents and prefixed by their document id (F2)', () => {
    const ids = fixtures.documents.flatMap((d) => d.signatures.map((s) => [d.id, s.id] as const));
    expect(new Set(ids.map(([, id]) => id)).size).toBe(ids.length);
    for (const [docId, id] of ids) expect(id.startsWith(`${docId}-sig`)).toBe(true);
  });

  it('unknown/self-signed signatures have purpose null (F3); no 10-digit runs in hex fields (F4)', () => {
    const d06 = byId(fixtures.documents, 'D06');
    expect(d06.signatures[1]?.purpose).toBeNull();
    for (const d of fixtures.documents) expect(d.sha256).not.toMatch(/[0-9]{10}/);
  });

  it('mail seed: nattapon email_verify and aree 30-day expiry notice', () => {
    expect(fixtures.mail.map((m) => [m.to, m.kind])).toEqual([
      ['u-nattapon', 'email_verify'],
      ['u-aree', 'expiry_notice'],
    ]);
  });
});
