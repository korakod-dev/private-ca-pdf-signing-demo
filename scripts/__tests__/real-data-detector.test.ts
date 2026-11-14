// @vitest-environment node
// Unit tests for the "looks-like-real-data" detector: one positive and one negative case per rule,
// the ADR P0-11 hex-field skip, and a guard that the current fixtures are clean.
import { describe, expect, it } from 'vitest';
import { detectRealData, normalizeDigits, type FixtureFiles } from '../lib/real-data-detector';
import {
  formatThaiId,
  loadRealFixtures,
  randomLandline,
  randomMobile,
  randomValidThaiId,
  toThaiDigits,
  withInvalidChecksum,
} from './helpers';

// Sample values are generated at test time (no valid-looking ID or dialable phone number is stored in the repo).
const ID = randomValidThaiId(); // 13 digits, valid checksum
const ID_BAD = withInvalidChecksum(ID); // same digits, wrong checksum
const MOBILE = randomMobile(); // 10 plain digits
const LANDLINE = randomLandline(); // 9 plain digits
/** Splits the plain mobile number as 0XX-XXX-XXXX. */
const mobileWith = (sep: string): string => [MOBILE.slice(0, 3), MOBILE.slice(3, 6), MOBILE.slice(6)].join(sep);
/** Splits the plain landline as 0X-XXX-XXXX. */
const landlineWith = (sep: string): string => [LANDLINE.slice(0, 2), LANDLINE.slice(2, 5), LANDLINE.slice(5)].join(sep);


/** Edits a fresh copy of the real fixtures and returns the detector's rule ids (sorted, unique). */
function rulesAfter(edit: (f: FixtureFiles & Record<string, any>) => void): string[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  const files = loadRealFixtures() as FixtureFiles & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  edit(files);
  return [...new Set(detectRealData(files).map((f) => f.rule))].sort();
}

describe('current fixtures', () => {
  it('are not flagged', () => {
    expect(detectRealData(loadRealFixtures())).toEqual([]);
  });
});

describe('rule: Thai national ID (13 digits, checksum ignored)', () => {
  // The generated ID has a valid checksum and its twin has an invalid one. Both must be caught.
  const cases: Array<[string, string]> = [
    ['plain, valid checksum', ID],
    ['dashed, valid checksum', formatThaiId(ID, '-')],
    ['spaced, invalid checksum', formatThaiId(ID_BAD, ' ')],
    ['Thai digits', `เลขบัตร ${toThaiDigits(ID)}`],
  ];
  it.each(cases)('flags %s', (_label, value) => {
    expect(rulesAfter((f) => { f.mail[0].body_th = `ข้อมูล ${value} จบ`; })).toContain('real-data/thai-id');
  });

  it('flags a bare JSON number with 13 digits', () => {
    expect(rulesAfter((f) => { f.system.limits.queue_max = Number(ID); })).toContain('real-data/thai-id');
  });

  const negatives: Array<[string, string]> = [
    ['12 digits', ID.slice(0, 12)],
    ['14 digits', `${ID}1`],
    ['ISO timestamp', '2026-11-12T09:00:00+07:00'],
  ];
  it.each(negatives)('does not flag %s', (_label, value) => {
    expect(rulesAfter((f) => { f.mail[0].body_th = `ข้อมูล ${value} จบ`; })).toEqual([]);
  });

  it('normalizeDigits maps Thai digits', () => {
    expect(normalizeDigits('๐๑๒๓๔๕๖๗๘๙')).toBe('0123456789');
  });
});

describe('rule: Thai phone numbers', () => {
  const cases: Array<[string, string]> = [
    ['plain mobile', MOBILE],
    ['dashed mobile', mobileWith('-')],
    ['spaced mobile', mobileWith(' ')],
    ['dashed landline', landlineWith('-')],
    ['plain landline', LANDLINE],
    ['+66 mobile', `+66 ${MOBILE.slice(1, 3)} ${MOBILE.slice(3, 6)} ${MOBILE.slice(6)}`],
    ['0066 mobile', `0066${MOBILE.slice(1)}`],
    ['Thai digits', toThaiDigits(mobileWith('-'))],
  ];
  it.each(cases)('flags %s', (_label, value) => {
    expect(rulesAfter((f) => { f.mail[0].body_th = `โทร ${value} ครับ`; })).toContain('real-data/phone');
  });

  it.each(['2026-11-12', '20261114', '1234567', 'slot-20261114'])('does not flag %s', (value) => {
    expect(rulesAfter((f) => { f.mail[0].body_th = `ข้อมูล ${value} จบ`; })).toEqual([]);
  });
});

describe('rule: hex fields are skipped by the text rules (ADR P0-11)', () => {
  // 60 hex chars that contain a phone-like and an ID-like digit run.
  // Letters around the runs keep them as separate digit runs (a phone-like run of 10 and an ID-like run of 13).
  const hexWithDigitRuns = `de00a${MOBILE}b${ID}${'c'.repeat(35)}`;

  it('a document sha256 containing phone/ID-like digit runs is not flagged', () => {
    expect(hexWithDigitRuns).toHaveLength(64);
    expect(rulesAfter((f) => { f.documents[0].sha256 = hexWithDigitRuns; })).toEqual([]);
  });

  it('serial and fingerprint fields with phone-like digit runs are not flagged as phone/ID', () => {
    const rules = rulesAfter((f) => {
      f.pki[0].serial = 'DE:M0:08:12:34:56:78';
      f.pki[0].fingerprint_sha256 = `DE:M0:${Array.from({ length: 30 }, () => '08').join(':')}`;
      f.certs[0].serial = `DE:M0:${ID.slice(0, 2)}:${ID.slice(2, 4)}:${ID.slice(4, 6)}:${ID.slice(6, 8)}:${ID.slice(8, 10)}:${ID.slice(10, 12)}:3${ID[12]}`;
    });
    expect(rules).toEqual([]);
  });

  it('the same digit runs in a normal text field ARE flagged (the skip is by field, not global)', () => {
    const rules = rulesAfter((f) => { f.documents[0].title_th = hexWithDigitRuns; });
    expect(rules).toEqual(expect.arrayContaining(['real-data/phone', 'real-data/thai-id']));
  });
});

describe('rule: e-mail domain', () => {
  it.each(['somchai@gmail.com', 'a@lab.korakod.dev.evil.com', 'a@evil.lab.korakod.dev', 'x@korakod.dev'])('flags %s', (value) => {
    expect(rulesAfter((f) => { f.personas[0].email = value; })).toContain('real-data/email');
  });

  it('allows @lab.korakod.dev (any case)', () => {
    expect(rulesAfter((f) => { f.personas[0].email = 'Somchai@LAB.korakod.dev'; })).toEqual([]);
  });

  it('flags a real-looking e-mail inside free text too', () => {
    expect(rulesAfter((f) => { f.mail[0].body_th = 'ติดต่อ john.smith@company.co.th ได้เลย'; })).toContain('real-data/email');
  });
});

describe('rule: person names must be personas', () => {
  it('flags an unknown CSR subject_cn', () => {
    expect(rulesAfter((f) => { f.requests.requests[0].csr.subject_cn = 'John Smith'; })).toContain('real-data/person-name');
  });

  it('flags a user cert whose CN is not a persona', () => {
    expect(rulesAfter((f) => { f.certs[0].subject = 'CN=John Smith, O=Korakod Lab DEMO, C=TH'; })).toContain('real-data/person-name');
  });

  it('renaming a persona is caught where the old name is still used (the allow-list comes from personas.json)', () => {
    // The pinned persona names themselves live in src/fixtures/__tests__/fixtures.spec-values.test.ts.
    const rules = rulesAfter((f) => { f.personas[0].display_name = 'Someone Else'; });
    expect(rules).toContain('real-data/person-name'); // certs.json / requests.json still use the old name
  });

  it('accepts persona names in CSR and cert subjects', () => {
    expect(rulesAfter((f) => { f.requests.requests[0].csr.subject_cn = 'วิภาวรรณ ศรีสุข'; })).toEqual([]);
  });

  it('flags the same self-signed subject when the untrusted_fixture marker is missing', () => {
    const rules = rulesAfter((f) => {
      const c = f.certs.find((x: { serial: string }) => x.serial === '01');
      delete c.untrusted_fixture;
    });
    expect(rules).toEqual(expect.arrayContaining(['real-data/cert-subject-demo', 'real-data/fingerprint-prefix']));
  });
});

describe('rule: serial / fingerprint must start with DE:M0', () => {
  it('flags a fingerprint that does not start with DE:M0', () => {
    const fp = Array.from({ length: 32 }, (_, i) => (i + 10).toString(16).toUpperCase().padStart(2, '0')).join(':');
    expect(rulesAfter((f) => { f.pki[1].fingerprint_sha256 = fp; })).toContain('real-data/fingerprint-prefix');
  });

  it('flags a fingerprint that starts with DE:M1 or lacks the colon after M0', () => {
    expect(rulesAfter((f) => { f.pki[1].fingerprint_sha256 = 'DE:M1:AA'; })).toContain('real-data/fingerprint-prefix');
    expect(rulesAfter((f) => { f.pki[1].fingerprint_sha256 = 'DE:M0AA:BB'; })).toContain('real-data/fingerprint-prefix');
  });

  it('flags non-DE:M0 serials in every serial-like field', () => {
    expect(rulesAfter((f) => { f.certs[0].serial = '4F2A9101'; })).toContain('real-data/fingerprint-prefix');
    expect(rulesAfter((f) => { f.documents[0].signatures[0].signer_cert_serial = '4F:2A'; })).toContain('real-data/fingerprint-prefix');
    expect(rulesAfter((f) => { f.documents[0].doc_timestamps[0].tsa_serial = '12'; })).toContain('real-data/fingerprint-prefix');
    expect(rulesAfter((f) => { f.certs[3].superseded_by = '22:02'; })).toContain('real-data/fingerprint-prefix');
  });

  it('allows the serial 01 (D06 self-signed cert) while certs.json declares it untrusted_fixture', () => {
    expect(detectRealData(loadRealFixtures())).toEqual([]);
  });

  it('flags the serial 01 everywhere once no cert declares it untrusted_fixture', () => {
    const rules = rulesAfter((f) => {
      delete f.certs.find((c: { serial: string }) => c.serial === '01').untrusted_fixture;
    });
    expect(rules).toContain('real-data/fingerprint-prefix'); // cert serial and D06 signer_cert_serial
  });
});

describe('rule: CA/TSA subjects contain DEMO', () => {
  it('flags a CA subject without DEMO', () => {
    expect(rulesAfter((f) => { f.pki[2].subject = 'CN=Some Real TSA, C=TH'; })).toContain('real-data/ca-subject-demo');
  });

  it('flags a user cert subject without DEMO', () => {
    expect(rulesAfter((f) => { f.certs[0].subject = 'CN=สมชาย ใจดี, O=Real Company, C=TH'; })).toContain('real-data/cert-subject-demo');
  });
});

describe('rule: URLs', () => {
  it.each(['https://example.com/x', 'http://pki-demo.korakod.dev.evil.com/', 'https://pki-demo.korakod.dev@evil.com/', 'ftp://pki-demo.korakod.dev/f', '//evil.com/x', 'www.example.com'])(
    'flags %s',
    (value) => {
      expect(rulesAfter((f) => { f.mail[0].body_th = `ดู ${value} ได้`; })).toContain('real-data/url');
    },
  );

  it.each(['https://pki-demo.korakod.dev/verify', 'http://PKI-DEMO.korakod.dev:4173/x', '/previews/D01-p1.svg', '/verify/job-1'])('allows %s', (value) => {
    expect(rulesAfter((f) => { f.mail[0].body_th = `ดู ${value} ได้`; })).toEqual([]);
  });

  it('flags a system host outside the allow-list', () => {
    expect(rulesAfter((f) => { f.system.host = 'example.com'; })).toContain('real-data/url');
  });
});

describe('findings', () => {
  it('carry file + JSON pointer + rule, and never the offending value', () => {
    const files = loadRealFixtures() as FixtureFiles & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    files['personas'][2].email = 'secret.person@gmail.com';
    const findings = detectRealData(files);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ file: 'personas.json', pointer: '/2/email', rule: 'real-data/email' });
    expect(JSON.stringify(findings)).not.toContain('secret.person');
  });

  it('escapes ~ and / in pointers', () => {
    const files = loadRealFixtures() as FixtureFiles & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    files['system'].extra = { 'a/b~c': 'x@gmail.com' };
    expect(detectRealData(files)[0]?.pointer).toBe('/extra/a~1b~0c');
  });
});
