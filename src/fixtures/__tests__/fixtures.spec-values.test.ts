// Pins the key values of the fixtures against spec 7.1-7.5 and plan section 3.2.
// These are the "pinned" values: a change here must be a conscious decision (also the place where persona names
// are pinned, because the real-data detector derives its name allow-list from personas.json itself).
import { describe, expect, it } from 'vitest';
import type { DocumentId, FixtureDocument } from '../../contracts/fixtures';
import { fixtures } from '../index';

const doc = (id: DocumentId): FixtureDocument => {
  const d = fixtures.documents.find((x) => x.id === id);
  if (!d) throw new Error(`missing ${id}`);
  return d;
};
const cert = (serial: string) => {
  const c = fixtures.certs.find((x) => x.serial === serial);
  if (!c) throw new Error(`missing cert ${serial}`);
  return c;
};
const ca = (id: string) => {
  const c = fixtures.pki.find((x) => x.id === id);
  if (!c) throw new Error(`missing CA ${id}`);
  return c;
};
const persona = (id: string) => {
  const p = fixtures.personas.find((x) => x.id === id);
  if (!p) throw new Error(`missing persona ${id}`);
  return p;
};
const sigSummary = (d: FixtureDocument) =>
  d.signatures.map((s) => [s.signer_cert_serial, s.signature_timestamp?.time ?? null, s.level, s.type] as const);

describe('spec 7.1: system constants', () => {
  it('epoch, name, org, host', () => {
    const s = fixtures.system;
    expect(s.epoch).toBe('2026-11-12T09:00:00+07:00');
    expect(s.site_name).toBe('Private CA · ลายมือชื่อดิจิทัล (โหมดสาธิต)');
    expect(s.org).toBe('O=Korakod Lab DEMO, C=TH');
    expect(s.host).toBe('pki-demo.korakod.dev');
  });

  it('limits, lifetimes, schedule, demo credentials, lockout', () => {
    const s = fixtures.system;
    expect(s.limits).toEqual({
      pdf_max_bytes: 20 * 1024 * 1024,
      pdf_max_pages: 200,
      queue_max: 20,
      verify_rate_per_min: 10,
      archive_quota_bytes_user: 500 * 1024 * 1024,
      archive_quota_bytes_total: 10 * 1024 * 1024 * 1024,
    });
    expect(s.lifetimes).toEqual({ user_cert_days: 365, request_days: 14, archive_years: 5, ocsp_signer_days: 30, ocsp_rotate_days: 14 });
    expect(s.schedule).toEqual({ crl_hour: 6, crl_next_update_days: 7, retimestamp_hour: 3, backup_hour: 2 });
    expect([s.demo_mfa, s.demo_password, s.demo_p12_password]).toEqual(['246810', 'demo-password', 'demo-p12-password']);
    expect(s.lockout).toEqual({ max_failures: 3, minutes: 5 });
  });
});

describe('spec 7.2: personas', () => {
  it('ids, names, e-mails, roles in table order', () => {
    expect(fixtures.personas.map((p) => [p.id, p.display_name, p.email, p.role])).toEqual([
      ['u-somchai', 'สมชาย ใจดี', 'somchai@lab.korakod.dev', 'signer'],
      ['u-wipawan', 'วิภาวรรณ ศรีสุข', 'wipawan@lab.korakod.dev', 'signer'],
      ['u-nattapon', 'ณัฐพล ทองดี', 'nattapon@lab.korakod.dev', 'new_user'],
      ['u-aree', 'อารีย์ มีสุข', 'aree@lab.korakod.dev', 'signer'],
      ['u-manop', 'มานพ รักงาน', 'manop@lab.korakod.dev', 'user'],
      ['u-guest', 'ผู้ตรวจทั่วไป', 'guest@lab.korakod.dev', 'verifier'],
      ['a-admin-a', 'ผู้ดูแล A', 'admin-a@lab.korakod.dev', 'admin-a'],
      ['a-admin-b', 'ผู้ดูแล B', 'admin-b@lab.korakod.dev', 'admin-b'],
    ]);
  });

  it('last in-person proofing dates (plan 3.2)', () => {
    expect(persona('u-somchai').last_in_person_proofing).toBe('2026-10-06T09:00:00+07:00');
    expect(persona('u-wipawan').last_in_person_proofing).toBe('2026-09-11T09:00:00+07:00');
    expect(persona('u-aree').last_in_person_proofing).toBe('2025-12-02T09:00:00+07:00');
    for (const id of ['u-nattapon', 'u-manop', 'u-guest', 'a-admin-a', 'a-admin-b']) expect(persona(id).last_in_person_proofing).toBeNull();
  });
});

describe('spec 7.3: PKI', () => {
  it('subjects, serials, validity', () => {
    expect(fixtures.pki.map((c) => [c.id, c.subject, c.serial, c.not_before, c.not_after, c.usage_until])).toEqual([
      ['root-2026', 'CN=Korakod Lab DEMO Root CA 2026', 'DE:M0:00:00:00:01', '2026-10-01T09:00:00+07:00', '2041-10-01T09:00:00+07:00', null],
      ['doc-signing-2026', 'CN=Korakod Lab DEMO Document Signing CA 2026', 'DE:M0:00:00:00:02', '2026-10-01T09:00:00+07:00', '2032-10-01T09:00:00+07:00', '2030-10-01T09:00:00+07:00'],
      ['tsa-2026', 'CN=Korakod Lab DEMO TSA 2026, C=TH', 'DE:M0:00:00:00:03', '2026-10-01T09:00:00+07:00', '2033-10-01T09:00:00+07:00', '2028-10-01T09:00:00+07:00'],
      ['ocsp-signer', 'CN=Korakod Lab DEMO OCSP Signer', 'DE:M0:0C:SP:01', '2026-11-12T09:00:00+07:00', '2026-12-12T09:00:00+07:00', null],
      ['validation-2026', 'CN=Korakod Lab DEMO Validation Service', 'DE:M0:00:00:00:05', '2026-10-01T09:00:00+07:00', '2027-10-01T09:00:00+07:00', null],
      ['tsa-2028', 'CN=Korakod Lab DEMO TSA 2028, C=TH', 'DE:M0:00:00:00:13', '2028-09-01T09:00:00+07:00', '2035-09-01T09:00:00+07:00', '2030-09-01T09:00:00+07:00'],
      ['tsa-2030', 'CN=Korakod Lab DEMO TSA 2030, C=TH', 'DE:M0:00:00:00:23', '2030-08-01T09:00:00+07:00', '2037-08-01T09:00:00+07:00', '2032-08-01T09:00:00+07:00'],
    ]);
  });

  it('root fingerprint starts DE:M0:7A:C3 and ends 19:BE; every fingerprint has 32 pairs', () => {
    const root = ca('root-2026').fingerprint_sha256;
    expect(root.startsWith('DE:M0:7A:C3')).toBe(true);
    expect(root.endsWith('19:BE')).toBe(true);
    for (const c of fixtures.pki) expect(c.fingerprint_sha256.split(':')).toHaveLength(32);
  });
});

describe('plan 3.2: certificates', () => {
  it('serial, holder, validity, state', () => {
    expect(fixtures.certs.map((c) => [c.serial, c.holder, c.not_before.slice(0, 10), c.not_after.slice(0, 10), c.state])).toEqual([
      ['DE:M0:4F:2A:91:01', 'u-somchai', '2026-10-07', '2027-10-07', 'Active'],
      ['DE:M0:6B:D0:22:02', 'u-wipawan', '2026-09-12', '2027-09-12', 'Active'],
      ['DE:M0:22:91:AF:03', 'u-aree', '2025-12-03', '2026-12-03', 'Active'],
      ['DE:M0:6B:D0:22:01', 'u-wipawan', '2026-03-01', '2027-03-01', 'Revoked'],
      ['DE:M0:4F:2A:91:00', 'u-somchai', '2025-10-07', '2026-10-07', 'Revoked'],
      ['DE:M0:22:91:AF:02', 'u-aree', '2024-12-03', '2025-12-03', 'Expired'],
      ['DE:M0:6B:D0:22:00', 'u-wipawan', '2024-09-12', '2025-09-12', 'Expired'],
      ['01', null, '2026-01-01', '2036-01-01', 'Active'],
    ]);
  });

  it('revocations and the supersede chain', () => {
    expect(cert('DE:M0:6B:D0:22:01')).toMatchObject({ revoked_at: '2026-09-10T10:00:00+07:00', revocation_reason: 'keyCompromise', superseded_by: 'DE:M0:6B:D0:22:02' });
    expect(cert('DE:M0:4F:2A:91:00')).toMatchObject({ revoked_at: '2026-10-05T10:00:00+07:00', revocation_reason: 'superseded', superseded_by: 'DE:M0:4F:2A:91:01' });
  });

  it('the D06 self-signed cert is marked untrusted_fixture and has no issuer', () => {
    expect(cert('01')).toMatchObject({ subject: 'CN=Wipawan S. (self-signed)', untrusted_fixture: true, issuer_ca: null });
    expect(fixtures.certs.filter((c) => c.untrusted_fixture)).toHaveLength(1);
  });

  it('Aree has 21 days left at the epoch', () => {
    const days = (Date.parse(cert('DE:M0:22:91:AF:03').not_after) - Date.parse(fixtures.system.epoch)) / 86_400_000;
    expect(days).toBe(21);
  });
});

describe('plan 3.2: requests and mail', () => {
  it('Manop request fails CSR checks 2 (name) and 4 (key)', () => {
    expect(fixtures.requests.requests).toHaveLength(1);
    expect(fixtures.requests.requests[0]).toMatchObject({
      id: 'req-manop-01',
      requester: 'u-manop',
      state: 'awaitingInPerson',
      created_at: '2026-11-10T10:00:00+07:00',
      csr: { subject_cn: 'สมชาย ใจดี', email: 'manop@lab.korakod.dev', key_alg: 'RSA', key_size: 1024, pop_valid: true, extra_extensions: [], key_previously_used: false },
    });
    expect(fixtures.requests.appointment_slots.map((s) => s.at)).toEqual(['2026-11-13T10:00:00+07:00', '2026-11-14T10:00:00+07:00', '2026-11-16T10:00:00+07:00']);
  });

  it('mail seed: Nattapon e-mail verification (2026-11-10), Aree 30-day expiry notice (2026-11-03)', () => {
    expect(fixtures.mail.map((m) => [m.to, m.kind, m.at.slice(0, 10)])).toEqual([
      ['u-nattapon', 'email_verify', '2026-11-10'],
      ['u-aree', 'expiry_notice', '2026-11-03'],
    ]);
  });
});

describe('spec 7.5 / plan 3.2: documents', () => {
  it('file names and refs', () => {
    expect(fixtures.documents.map((d) => [d.id, d.file_name, d.refs])).toEqual([
      ['D01', 'memo-118.signed.pdf', ['V3']],
      ['D02', 'memo-118-tampered.pdf', ['V5', '5']],
      ['D03', 'memo-118-formfill.pdf', ['V5']],
      ['D04', 'memo-121.signed.pdf', ['R15']],
      ['D05', 'memo-122.signed.pdf', ['Q3']],
      ['D06', 'memo-123-selfsigned.pdf', ['V6', 'E7']],
      ['D07', 'memo-090.signed.pdf', ['V4']],
      ['D08', 'memo-091-nots.pdf', ['V4']],
      ['D09', 'notice-doc-timestamp-only.pdf', ['V13']],
      ['D10', 'encrypted.pdf', ['V10', 'V11']],
      ['D11', 'huge-250-pages.pdf', ['V10']],
      ['D12', 'memo-130-unsigned.pdf', ['S1']],
    ]);
  });

  it('signatures: signer cert, timestamp, level, type', () => {
    const D01 = [
      ['DE:M0:4F:2A:91:01', '2026-10-20T10:00:00+07:00', 'B-LTA', 'certification'],
      ['DE:M0:6B:D0:22:02', '2026-10-21T14:00:00+07:00', 'B-LTA', 'approval'],
    ];
    expect(sigSummary(doc('D01'))).toEqual(D01);
    expect(sigSummary(doc('D02'))).toEqual(D01);
    expect(sigSummary(doc('D03'))).toEqual(D01);
    expect(sigSummary(doc('D04'))).toEqual([
      ['DE:M0:4F:2A:91:00', '2026-09-11T10:00:00+07:00', 'B-LT', 'certification'],
      ['DE:M0:6B:D0:22:01', '2026-09-11T11:00:00+07:00', 'B-LT', 'approval'],
    ]);
    expect(sigSummary(doc('D05'))).toEqual([['DE:M0:4F:2A:91:00', '2026-09-20T10:00:00+07:00', 'B-LTA', 'certification']]);
    expect(sigSummary(doc('D06'))).toEqual([
      ['DE:M0:4F:2A:91:01', '2026-10-25T10:00:00+07:00', 'B-T', 'certification'],
      ['01', null, 'B-B', 'approval'],
    ]);
    expect(sigSummary(doc('D07'))).toEqual([['DE:M0:22:91:AF:02', '2025-06-10T10:00:00+07:00', 'B-LTA', 'certification']]);
    expect(doc('D08').signatures).toHaveLength(1);
    expect(doc('D08').signatures[0]).toMatchObject({ signer_cert_serial: 'DE:M0:6B:D0:22:00', claimed_signing_time: '2025-05-15T10:00:00+07:00', signature_timestamp: null, level: 'B-B' });
    for (const id of ['D09', 'D10', 'D11', 'D12'] as const) expect(doc(id).signatures).toEqual([]);
  });

  it('timestamps are issued by the TSA 2026 (DE:M0:00:00:00:03); doc timestamps as in the plan', () => {
    for (const d of fixtures.documents) {
      for (const s of d.signatures) if (s.signature_timestamp) expect(s.signature_timestamp.tsa_serial).toBe('DE:M0:00:00:00:03');
    }
    expect(doc('D01').doc_timestamps.map((t) => t.time)).toEqual(['2026-10-21T14:05:00+07:00']);
    expect(doc('D05').doc_timestamps.map((t) => t.time)).toEqual(['2026-09-20T10:05:00+07:00']);
    expect(doc('D07').doc_timestamps.map((t) => t.time)).toEqual(['2025-06-10T10:05:00+07:00']);
    expect(doc('D09').doc_timestamps.map((t) => t.time)).toEqual(['2026-11-01T08:00:00+07:00']);
    for (const id of ['D04', 'D06', 'D08'] as const) expect(doc(id).doc_timestamps).toEqual([]);
  });

  it('modification after the last signature', () => {
    expect(doc('D01').modification_after_last_signature).toBeNull();
    expect(doc('D02').modification_after_last_signature).toEqual({ kind: 'content_stream', docmdp_permitted: false });
    expect(doc('D03').modification_after_last_signature).toEqual({ kind: 'form_fill', docmdp_permitted: true });
    for (const id of ['D04', 'D05', 'D06', 'D07', 'D08', 'D09'] as const) expect(doc(id).modification_after_last_signature).toBeNull();
  });

  it('expected results (spec 7.5 table)', () => {
    const e = (id: DocumentId) => doc(id).expected;
    expect(e('D01')).toEqual({ http_status: 200, indication: 'TOTAL-PASSED', sub_indication: null, code: 'VALID', problem_code: null, warnings: [] });
    expect(e('D02')).toMatchObject({ http_status: 200, indication: 'TOTAL-FAILED', sub_indication: null, code: 'MODIFIED' });
    expect(e('D03')).toMatchObject({ http_status: 200, indication: 'TOTAL-FAILED', sub_indication: null, code: 'MODIFIED' });
    expect(e('D04')).toMatchObject({ indication: 'TOTAL-FAILED', sub_indication: 'REVOKED', code: 'REVOKED' });
    expect(e('D05')).toMatchObject({ indication: 'TOTAL-PASSED', sub_indication: null, code: 'VALID', warnings: [] });
    expect(e('D06')).toMatchObject({ indication: 'TOTAL-FAILED', sub_indication: 'NO_CERTIFICATE_CHAIN_FOUND', code: 'UNTRUSTED', warnings: ['MIXED_TRUST'] });
    expect(e('D07')).toMatchObject({ indication: 'TOTAL-PASSED', sub_indication: null, code: 'VALID' });
    expect(e('D08')).toMatchObject({ indication: 'INDETERMINATE', sub_indication: 'NO_POE', code: 'NO_POE' });
    expect(e('D09')).toMatchObject({ indication: 'TOTAL-PASSED', sub_indication: null, code: 'VALID', warnings: ['NO_SIGNER'] });
    expect(e('D10')).toMatchObject({ http_status: 422, problem_code: 'ENCRYPTED_PDF', indication: null });
    expect(e('D11')).toMatchObject({ http_status: 413, problem_code: 'PDF_TOO_LARGE', indication: null });
    expect(e('D12')).toMatchObject({ http_status: 422, problem_code: 'NOT_SIGNED', indication: null });
  });

  it('D10 is encrypted, D11 has 250 pages, D12 has two empty signature fields', () => {
    expect(doc('D10').encrypted).toBe(true);
    expect(fixtures.documents.filter((d) => d.encrypted)).toHaveLength(1);
    expect(doc('D11').pages).toBe(250);
    expect(doc('D12')).toMatchObject({ pages: 2, signature_fields: ['approver-1', 'approver-2'] });
  });

  it('every hash uses the de00 marker and is unique; previews are 1-3 per document', () => {
    const hashes = fixtures.documents.map((d) => d.sha256);
    for (const h of hashes) expect(h).toMatch(/^de00[0-9a-f]{60}$/);
    expect(new Set(hashes).size).toBe(hashes.length);
    for (const d of fixtures.documents) {
      expect(d.previews.length).toBeGreaterThanOrEqual(1);
      expect(d.previews.length).toBeLessThanOrEqual(3);
    }
  });
});
