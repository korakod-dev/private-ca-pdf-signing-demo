// Resolver tests (sub-task B2): golden table 7.5 against the real fixtures, fault switches, revocation timing
// (invalidity_date, R14 view differences), purity, and the edge branches the fixtures do not reach.
import { describe, expect, it } from 'vitest';
import { fixtures } from '../../../fixtures';
import type { CertView, CrlEntry, ResolverInput } from '../../../contracts/engine';
import type { CertFixture, FaultState, FixtureDocument, FixtureSignature } from '../../../contracts/fixtures';
import { CHECK_CODES, SKIPPED_CODE, resolveVerification } from '..';

const NO_FAULTS: FaultState = { ocsp_down: false, crl_down: false, tsa_drift_ms: 0, queue_full: false };
const EPOCH = fixtures.system.epoch;

const SOMCHAI = 'DE:M0:4F:2A:91:01';
const WIPAWAN = 'DE:M0:6B:D0:22:02';

const doc = (id: string): FixtureDocument => {
  const d = fixtures.documents.find((x) => x.id === id);
  if (!d) throw new Error(`missing fixture document ${id}`);
  return d;
};

/** Revocation view of a fixture cert, as the engine would derive it for OCSP (immediate). */
function viewOf(c: CertFixture): CertView {
  const revoked = c.state === 'Revoked';
  return {
    serial: c.serial,
    subject: c.subject,
    trusted_chain: c.issuer_ca === 'doc-signing-2026',
    not_before: c.not_before,
    not_after: c.not_after,
    ocsp: {
      status: revoked ? 'revoked' : 'good',
      revoked_at: c.revoked_at,
      reason: c.revocation_reason,
      invalidity_date: c.invalidity_date,
    },
  };
}

const crlOf = (certs: CertFixture[]): CrlEntry[] =>
  certs
    .filter((c) => c.state === 'Revoked' && c.revoked_at && c.revocation_reason)
    .map((c) => ({ serial: c.serial, revoked_at: c.revoked_at as string, reason: c.revocation_reason!, invalidity_date: c.invalidity_date }));

/** Build a resolver input from the epoch fixtures; `patch` overrides the pieces a test cares about. */
function inputFor(
  id: string,
  patch: { now?: string; faults?: Partial<FaultState>; certs?: CertFixture[]; crl?: CrlEntry[]; document?: FixtureDocument } = {},
): ResolverInput {
  const certs = patch.certs ?? fixtures.certs;
  return {
    document: patch.document ?? doc(id),
    now: patch.now ?? EPOCH,
    certs: Object.fromEntries(certs.map((c) => [c.serial, viewOf(c)])),
    crl_entries: patch.crl ?? crlOf(certs),
    faults: { ...NO_FAULTS, ...patch.faults },
    policy: 'strict-v1',
  };
}

/** Fixture cert with fields replaced (used to model revocations that happen during a demo run). */
const withCert = (serial: string, changes: Partial<CertFixture>): CertFixture[] =>
  fixtures.certs.map((c) => (c.serial === serial ? { ...c, ...changes } : c));

const deepFreeze = <T>(v: T): T => {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v as object)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
};

const summary = (id: string, patch?: Parameters<typeof inputFor>[1]) => {
  const r = resolveVerification(inputFor(id, patch));
  return { indication: r.indication, sub_indication: r.sub_indication, code: r.code, warnings: r.warnings };
};

describe('golden table 7.5 (epoch, no faults, real fixtures)', () => {
  const golden = ['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09'];

  it.each(golden)('%s matches the expected result in the fixture and in spec 7.5', (id) => {
    const e = doc(id).expected;
    expect(summary(id)).toEqual({
      indication: e.indication,
      sub_indication: e.sub_indication,
      code: e.code,
      warnings: e.warnings,
    });
  });

  // Spelled out independently of the fixture `expected` blocks, straight from spec 7.5.
  it.each([
    ['D01', 'TOTAL-PASSED', null, 'VALID', []],
    ['D02', 'TOTAL-FAILED', null, 'MODIFIED', []],
    ['D03', 'TOTAL-FAILED', null, 'MODIFIED', []],
    ['D04', 'TOTAL-FAILED', 'REVOKED', 'REVOKED', []],
    ['D05', 'TOTAL-PASSED', null, 'VALID', []],
    ['D06', 'TOTAL-FAILED', 'NO_CERTIFICATE_CHAIN_FOUND', 'UNTRUSTED', ['MIXED_TRUST']],
    ['D07', 'TOTAL-PASSED', null, 'VALID', []],
    ['D08', 'INDETERMINATE', 'NO_POE', 'NO_POE', []],
    ['D09', 'TOTAL-PASSED', null, 'VALID', ['NO_SIGNER']],
  ])('%s -> %s / %s / %s %j (literal spec values)', (id, indication, sub, code, warnings) => {
    expect(summary(id)).toEqual({ indication, sub_indication: sub, code, warnings });
  });

  it('D10, D11 and D12 are engine pre-checks, so the resolver refuses them', () => {
    for (const id of ['D10', 'D11', 'D12']) {
      expect(() => resolveVerification(inputFor(id))).toThrow(/pre-check/);
    }
  });

  it('echoes document metadata, policy, validation time, refs and timestamps', () => {
    const d = doc('D01');
    const r = resolveVerification(inputFor('D01'));
    expect(r.policy).toBe('strict-v1');
    expect(r.validation_time).toBe(EPOCH);
    expect(r.document).toEqual({ id: 'D01', file_name: d.file_name, sha256: d.sha256, pages: d.pages, size_bytes: d.size_bytes });
    expect(r.refs).toEqual(d.refs);
    expect(r.doc_timestamps).toEqual(d.doc_timestamps);
    expect(r.signatures.map((s) => [s.id, s.field, s.type, s.level, s.signer.serial, s.signing_time])).toEqual(
      d.signatures.map((s) => [s.id, s.field, s.type, s.level, s.signer_cert_serial, s.claimed_signing_time]),
    );
    expect(r.signatures[0]?.signer.subject).toBe(fixtures.certs.find((c) => c.serial === SOMCHAI)?.subject);
    expect(r.signatures.every((s) => s.timestamp !== null)).toBe(true);
  });
});

describe('per-signature detail and the three questions', () => {
  it('D01: every check passes on both signatures', () => {
    const r = resolveVerification(inputFor('D01'));
    expect(r.questions).toEqual({ modified: 'no', signer_trusted: 'yes', valid_at_signing: 'yes' });
    for (const s of r.signatures) {
      expect(s.indication).toBe('TOTAL-PASSED');
      expect(s.checks.map((c) => [c.id, c.result])).toEqual([
        ['integrity', 'passed'],
        ['modification', 'passed'],
        ['chain', 'passed'],
        ['poe', 'passed'],
        ['validity', 'passed'],
        ['revocation', 'passed'],
        ['policy', 'passed'],
      ]);
      expect(s.checks.find((c) => c.id === 'revocation')?.code).toBe('REVOCATION_GOOD_OCSP');
    }
  });

  it('D02/D03: modified on every signature, signer certs still fine; D03 also trips the strict-v1 policy', () => {
    const d02 = resolveVerification(inputFor('D02'));
    expect(d02.questions).toEqual({ modified: 'yes', signer_trusted: 'yes', valid_at_signing: 'yes' });
    expect(d02.signatures.every((s) => s.code === 'MODIFIED')).toBe(true);
    expect(d02.signatures[0]?.checks.find((c) => c.id === 'modification')?.code).toBe('MODIFIED_CONTENT');
    expect(d02.signatures[0]?.checks.find((c) => c.id === 'policy')?.result).toBe('passed');

    const d03 = resolveVerification(inputFor('D03'));
    const sig = d03.signatures[0];
    expect(sig?.checks.find((c) => c.id === 'modification')?.code).toBe('MODIFIED_FORM_FILL');
    expect(sig?.checks.find((c) => c.id === 'policy')).toMatchObject({ result: 'failed', code: 'POLICY_FORM_FILL_REJECTED' });
  });

  it('D04: s1 (revoked after its timestamp) passes, s2 (revoked before) fails', () => {
    const r = resolveVerification(inputFor('D04'));
    expect(r.signatures.map((s) => s.code)).toEqual(['VALID', 'REVOKED']);
    expect(r.signatures[0]?.checks.find((c) => c.id === 'revocation')?.code).toBe('REVOKED_AFTER_POE');
    expect(r.signatures[1]?.checks.find((c) => c.id === 'revocation')?.code).toBe('REVOKED_BEFORE_POE');
    expect(r.questions).toEqual({ modified: 'no', signer_trusted: 'yes', valid_at_signing: 'no' });
  });

  it('D05/D07: revoked-after-POE and expired-with-POE both pass', () => {
    const d05 = resolveVerification(inputFor('D05'));
    expect(d05.signatures[0]?.checks.find((c) => c.id === 'revocation')?.code).toBe('REVOKED_AFTER_POE');
    const d07 = resolveVerification(inputFor('D07'));
    expect(d07.signatures[0]?.checks.find((c) => c.id === 'validity')?.code).toBe('CERT_VALID_AT_POE');
  });

  it('D06: untrusted s2 skips the later checks; trusted s1 still passes', () => {
    const r = resolveVerification(inputFor('D06'));
    expect(r.signatures.map((s) => s.code)).toEqual(['VALID', 'UNTRUSTED']);
    const s2 = r.signatures[1];
    expect(s2?.checks.find((c) => c.id === 'chain')?.code).toBe('CHAIN_UNTRUSTED');
    expect(s2?.checks.filter((c) => c.result === 'skipped').map((c) => [c.id, c.code])).toEqual([
      ['poe', SKIPPED_CODE],
      ['validity', SKIPPED_CODE],
      ['revocation', SKIPPED_CODE],
    ]);
    expect(r.questions).toEqual({ modified: 'no', signer_trusted: 'no', valid_at_signing: 'unknown' });
  });

  it('D08: NO_POE stops before validity and revocation', () => {
    const r = resolveVerification(inputFor('D08'));
    const s = r.signatures[0];
    expect(s?.checks.map((c) => [c.id, c.result])).toEqual([
      ['integrity', 'passed'],
      ['modification', 'passed'],
      ['chain', 'passed'],
      ['poe', 'indeterminate'],
      ['validity', 'skipped'],
      ['revocation', 'skipped'],
      ['policy', 'passed'],
    ]);
    expect(s?.timestamp).toBeNull();
    expect(r.questions.valid_at_signing).toBe('unknown');
  });

  it('D09: timestamp only -> unknown signer, no signatures', () => {
    const r = resolveVerification(inputFor('D09'));
    expect(r.signatures).toEqual([]);
    expect(r.questions).toEqual({ modified: 'no', signer_trusted: 'unknown', valid_at_signing: 'unknown' });
    expect(r.doc_timestamps).toHaveLength(1);
  });

  it('every emitted check code is registered in CHECK_CODES (or is the skipped marker)', () => {
    for (const id of ['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09']) {
      for (const faults of [NO_FAULTS, { ...NO_FAULTS, ocsp_down: true }, { ...NO_FAULTS, ocsp_down: true, crl_down: true }]) {
        for (const s of resolveVerification(inputFor(id, { faults })).signatures) {
          for (const c of s.checks) {
            const known: readonly string[] = CHECK_CODES[c.id];
            expect(c.code === SKIPPED_CODE || known.includes(c.code)).toBe(true);
            expect(c.refs.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});

describe('fault switches (A14: OCSP first, CRL fallback, both down -> TRY_LATER)', () => {
  const D01_PASS = { indication: 'TOTAL-PASSED', sub_indication: null, code: 'VALID', warnings: [] };

  it('OCSP down only: D01 still passes, via CRL', () => {
    expect(summary('D01', { faults: { ocsp_down: true } })).toEqual(D01_PASS);
    const rev = resolveVerification(inputFor('D01', { faults: { ocsp_down: true } })).signatures[0]?.checks.find((c) => c.id === 'revocation');
    expect(rev?.code).toBe('REVOCATION_GOOD_CRL');
  });

  it('CRL down only: D01 still passes, via OCSP', () => {
    expect(summary('D01', { faults: { crl_down: true } })).toEqual(D01_PASS);
  });

  it('OCSP and CRL both down: D01 is INDETERMINATE / TRY_LATER on both signatures', () => {
    const r = resolveVerification(inputFor('D01', { faults: { ocsp_down: true, crl_down: true } }));
    expect(r).toMatchObject({ indication: 'INDETERMINATE', sub_indication: 'TRY_LATER', code: 'TRY_LATER', warnings: [] });
    expect(r.signatures.map((s) => s.code)).toEqual(['TRY_LATER', 'TRY_LATER']);
    const checks = r.signatures[0]?.checks;
    expect(checks?.find((c) => c.id === 'revocation')).toMatchObject({ result: 'indeterminate', code: 'REVOCATION_UNAVAILABLE' });
    // strict-v1 ignores embedded LTV for current status, and the report says so.
    expect(checks?.find((c) => c.id === 'policy')).toMatchObject({ result: 'indeterminate', code: 'POLICY_LTV_IGNORED' });
    expect(r.questions.valid_at_signing).toBe('unknown');
  });

  it('the non-status faults (TSA drift, queue full) do not change a verification result', () => {
    expect(summary('D01', { faults: { tsa_drift_ms: 1400, queue_full: true } })).toEqual(D01_PASS);
  });

  it('both down: D07 (expired + timestamp) is TRY_LATER too, but D08 stays NO_POE (retrying cannot help)', () => {
    expect(summary('D07', { faults: { ocsp_down: true, crl_down: true } }).code).toBe('TRY_LATER');
    expect(summary('D08', { faults: { ocsp_down: true, crl_down: true } }).code).toBe('NO_POE');
  });

  it('both down: failures that need no status lookup stay failures (D02 modified, D06 untrusted)', () => {
    const faults = { ocsp_down: true, crl_down: true };
    expect(summary('D02', { faults }).code).toBe('MODIFIED');
    expect(summary('D06', { faults })).toMatchObject({ code: 'UNTRUSTED', warnings: ['MIXED_TRUST'] });
  });

  it('both down: D09 (timestamp only) -> INDETERMINATE / TRY_LATER + TSA_STATUS_UNAVAILABLE (F18, A41)', () => {
    expect(summary('D09', { faults: { ocsp_down: true, crl_down: true } })).toEqual({
      indication: 'INDETERMINATE',
      sub_indication: 'TRY_LATER',
      code: 'TRY_LATER',
      warnings: ['NO_SIGNER', 'TSA_STATUS_UNAVAILABLE'],
    });
  });

  it('single source down: D09 stays VALID with only NO_SIGNER (A14: the other source answers)', () => {
    for (const faults of [{ ocsp_down: true }, { crl_down: true }]) {
      expect(summary('D09', { faults })).toEqual({
        indication: 'TOTAL-PASSED',
        sub_indication: null,
        code: 'VALID',
        warnings: ['NO_SIGNER'],
      });
    }
  });

  it('both down: D01 (has a doc timestamp but also signatures) gets no TSA_STATUS_UNAVAILABLE warning', () => {
    expect(summary('D01', { faults: { ocsp_down: true, crl_down: true } }).warnings).toEqual([]);
  });

  it('R14 window: OCSP already says revoked (invalidity before the timestamp) while the stale CRL does not list the serial yet', () => {
    // somchai: keyCompromise, effective 2026-10-19 (before the 2026-10-20 timestamp). OCSP knows now; the CRL changes at the next 06:00.
    const certs = withCert(SOMCHAI, {
      state: 'Revoked',
      revoked_at: EPOCH,
      revocation_reason: 'keyCompromise',
      invalidity_date: '2026-10-19T00:00:00+07:00',
    });
    const staleCrl = crlOf(fixtures.certs); // does not contain 91:01 yet
    const viaOcsp = resolveVerification(inputFor('D01', { certs, crl: staleCrl }));
    expect(viaOcsp.code).toBe('REVOKED');
    expect(viaOcsp.signatures[0]?.checks.find((c) => c.id === 'revocation')?.code).toBe('REVOKED_BEFORE_POE');
    // With OCSP down the same document resolves through the stale CRL and looks good: the two views disagree.
    const viaCrl = resolveVerification(inputFor('D01', { certs, crl: staleCrl, faults: { ocsp_down: true } }));
    expect(viaCrl.code).toBe('VALID');
    expect(viaCrl.signatures[0]?.checks.find((c) => c.id === 'revocation')?.code).toBe('REVOCATION_GOOD_CRL');
  });

  it('a CRL entry is honoured when OCSP is down (fallback sees a real revocation)', () => {
    const r = resolveVerification(inputFor('D04', { faults: { ocsp_down: true } }));
    expect(r.signatures[1]?.checks.find((c) => c.id === 'revocation')?.code).toBe('REVOKED_BEFORE_POE');
  });
});

describe('revocation timing (effective time = invalidity_date ?? revoked_at)', () => {
  it('wipawan keyCompromise, invalidity_date 2026-10-15 -> D01 TOTAL-FAILED / REVOKED', () => {
    const certs = withCert(WIPAWAN, {
      state: 'Revoked',
      revoked_at: EPOCH,
      revocation_reason: 'keyCompromise',
      invalidity_date: '2026-10-15T00:00:00+07:00',
    });
    const r = resolveVerification(inputFor('D01', { certs }));
    expect(r).toMatchObject({ indication: 'TOTAL-FAILED', sub_indication: 'REVOKED', code: 'REVOKED' });
    // Only wipawan's signature (timestamped 2026-10-21) is hit; somchai's stays valid.
    expect(r.signatures.map((s) => s.code)).toEqual(['VALID', 'REVOKED']);
    expect(r.questions.valid_at_signing).toBe('no');
  });

  it('same revocation without invalidity_date (revoked_at = now) leaves D01 valid: the invalidity date is what bites', () => {
    const certs = withCert(WIPAWAN, { state: 'Revoked', revoked_at: EPOCH, revocation_reason: 'keyCompromise' });
    expect(resolveVerification(inputFor('D01', { certs })).code).toBe('VALID');
  });

  it('the invalidity date also decides through the CRL fallback', () => {
    const certs = withCert(WIPAWAN, {
      state: 'Revoked',
      revoked_at: EPOCH,
      revocation_reason: 'keyCompromise',
      invalidity_date: '2026-10-15T00:00:00+07:00',
    });
    const r = resolveVerification(inputFor('D01', { certs, faults: { ocsp_down: true } }));
    expect(r.code).toBe('REVOKED');
    expect(r.signatures[1]?.checks.find((c) => c.id === 'revocation')?.code).toBe('REVOKED_BEFORE_POE');
  });

  it('invalidity date between the two timestamps: only the later signature fails', () => {
    // s1 (somchai) is stamped 2026-10-20 10:00; revoke somchai's cert effective 2026-10-20 12:00 -> still valid.
    const after = withCert(SOMCHAI, { state: 'Revoked', revoked_at: EPOCH, revocation_reason: 'keyCompromise', invalidity_date: '2026-10-20T12:00:00+07:00' });
    expect(resolveVerification(inputFor('D01', { certs: after })).code).toBe('VALID');
    // ... effective 2026-10-20 09:00 -> before the timestamp -> fails.
    const before = withCert(SOMCHAI, { state: 'Revoked', revoked_at: EPOCH, revocation_reason: 'keyCompromise', invalidity_date: '2026-10-20T09:00:00+07:00' });
    expect(resolveVerification(inputFor('D01', { certs: before })).signatures.map((s) => s.code)).toEqual(['REVOKED', 'VALID']);
  });

  it('somchai cessationOfOperation now -> D01 still TOTAL-PASSED (revoked after both timestamps)', () => {
    const certs = withCert(SOMCHAI, { state: 'Revoked', revoked_at: EPOCH, revocation_reason: 'cessationOfOperation' });
    const r = resolveVerification(inputFor('D01', { certs }));
    expect(r).toMatchObject({ indication: 'TOTAL-PASSED', sub_indication: null, code: 'VALID', warnings: [] });
    expect(r.signatures[0]?.checks.find((c) => c.id === 'revocation')).toMatchObject({ result: 'passed', code: 'REVOKED_AFTER_POE' });
  });

  it('revoked exactly at the POE counts as revoked (boundary)', () => {
    const certs = withCert(SOMCHAI, { state: 'Revoked', revoked_at: '2026-10-20T10:00:00+07:00', revocation_reason: 'unspecified' });
    expect(resolveVerification(inputFor('D01', { certs })).signatures[0]?.code).toBe('REVOKED');
  });

  it('a revoked cert with no timestamp has no proof it signed earlier -> REVOKED', () => {
    const base = doc('D08');
    const sig: FixtureSignature = { ...(base.signatures[0] as FixtureSignature), signer_cert_serial: SOMCHAI };
    const d: FixtureDocument = { ...base, signatures: [sig] };
    const certs = withCert(SOMCHAI, { state: 'Revoked', revoked_at: '2026-11-01T09:00:00+07:00', revocation_reason: 'unspecified' });
    expect(resolveVerification(inputFor('D08', { certs, document: d })).code).toBe('REVOKED');
  });

  it('a valid-now cert with no timestamp passes on the validation time (POE_VALIDATION_TIME)', () => {
    const base = doc('D08');
    const sig: FixtureSignature = { ...(base.signatures[0] as FixtureSignature), signer_cert_serial: SOMCHAI };
    const d: FixtureDocument = { ...base, signatures: [sig] };
    const r = resolveVerification(inputFor('D08', { document: d }));
    expect(r.code).toBe('VALID');
    expect(r.signatures[0]?.checks.find((c) => c.id === 'poe')?.code).toBe('POE_VALIDATION_TIME');
  });

  it('OCSP entry that is revoked without any time is treated as revoked before the POE', () => {
    const base = inputFor('D01');
    const view = base.certs[SOMCHAI] as CertView;
    const input: ResolverInput = {
      ...base,
      certs: { ...base.certs, [SOMCHAI]: { ...view, ocsp: { status: 'revoked', revoked_at: null, reason: null, invalidity_date: null } } },
    };
    expect(resolveVerification(input).signatures[0]?.code).toBe('REVOKED');
  });
});

describe('validity and unknown-status edge cases', () => {
  it('a timestamp after the cert expired is not a usable POE -> INDETERMINATE / NO_POE', () => {
    const base = doc('D07');
    const sig: FixtureSignature = {
      ...(base.signatures[0] as FixtureSignature),
      signature_timestamp: { time: '2025-12-04T10:00:00+07:00', tsa_serial: 'DE:M0:00:00:00:03' },
    };
    const r = resolveVerification(inputFor('D07', { document: { ...base, signatures: [sig] } }));
    expect(r).toMatchObject({ indication: 'INDETERMINATE', sub_indication: 'NO_POE', code: 'NO_POE' });
    expect(r.signatures[0]?.checks.find((c) => c.id === 'validity')).toMatchObject({ result: 'indeterminate', code: 'CERT_NOT_VALID_AT_POE' });
    expect(r.questions.valid_at_signing).toBe('no');
  });

  it('a timestamp before the cert became valid is not a usable POE either', () => {
    const base = doc('D07');
    const sig: FixtureSignature = {
      ...(base.signatures[0] as FixtureSignature),
      signature_timestamp: { time: '2024-12-02T10:00:00+07:00', tsa_serial: 'DE:M0:00:00:00:03' },
    };
    expect(resolveVerification(inputFor('D07', { document: { ...base, signatures: [sig] } })).code).toBe('NO_POE');
  });

  it('OCSP "unknown" is not accepted as good: INDETERMINATE / TRY_LATER', () => {
    const base = inputFor('D01');
    const view = base.certs[SOMCHAI] as CertView;
    const input: ResolverInput = {
      ...base,
      certs: { ...base.certs, [SOMCHAI]: { ...view, ocsp: { status: 'unknown', revoked_at: null, reason: null, invalidity_date: null } } },
    };
    const r = resolveVerification(input);
    expect(r.signatures[0]?.checks.find((c) => c.id === 'revocation')?.code).toBe('REVOCATION_UNKNOWN');
    expect(r).toMatchObject({ indication: 'INDETERMINATE', code: 'TRY_LATER' });
  });

  it('a signer with no certificate view at all is treated as untrusted', () => {
    const base = inputFor('D01');
    const certs = { ...base.certs };
    delete certs[WIPAWAN];
    const r = resolveVerification({ ...base, certs });
    expect(r).toMatchObject({ code: 'UNTRUSTED', warnings: ['MIXED_TRUST'] });
    expect(r.signatures[1]?.signer).toEqual({ subject: '(unknown signer)', serial: WIPAWAN });
  });

  it('a timestamp-only document that was modified afterwards fails as MODIFIED', () => {
    const base = doc('D09');
    const d: FixtureDocument = { ...base, modification_after_last_signature: { kind: 'content_stream', docmdp_permitted: false } };
    expect(summary('D09', { document: d })).toEqual({ indication: 'TOTAL-FAILED', sub_indication: null, code: 'MODIFIED', warnings: ['NO_SIGNER'] });
  });

  it('a modified timestamp-only document with OCSP + CRL down still fails as MODIFIED and carries both warnings', () => {
    const base = doc('D09');
    const d: FixtureDocument = { ...base, modification_after_last_signature: { kind: 'content_stream', docmdp_permitted: false } };
    expect(summary('D09', { document: d, faults: { ocsp_down: true, crl_down: true } })).toEqual({
      indication: 'TOTAL-FAILED',
      sub_indication: null,
      code: 'MODIFIED',
      warnings: ['NO_SIGNER', 'TSA_STATUS_UNAVAILABLE'],
    });
  });

  it('rejects an unparseable validation time instead of comparing NaN', () => {
    expect(() => resolveVerification(inputFor('D01', { now: 'not-a-date' }))).toThrow(RangeError);
  });
});

describe('document-level aggregation (worst signature wins)', () => {
  it('FAILED beats INDETERMINATE; MODIFIED beats UNTRUSTED beats REVOKED; NO_POE beats TRY_LATER', () => {
    // D04-like doc (s2 REVOKED) + D08-like NO_POE signature -> FAILED/REVOKED wins.
    const d04 = doc('D04');
    const d08sig = { ...(doc('D08').signatures[0] as FixtureSignature), id: 's3' };
    const mixed: FixtureDocument = { ...d04, signatures: [...d04.signatures, d08sig] };
    expect(summary('D04', { document: mixed }).code).toBe('REVOKED');

    // REVOKED + UNTRUSTED -> UNTRUSTED wins; add a modification -> MODIFIED wins.
    const d06sig = doc('D06').signatures[1] as FixtureSignature;
    const revokedPlusUntrusted: FixtureDocument = { ...d04, signatures: [...d04.signatures, d06sig] };
    expect(summary('D04', { document: revokedPlusUntrusted }).code).toBe('UNTRUSTED');
    const modified: FixtureDocument = { ...revokedPlusUntrusted, modification_after_last_signature: { kind: 'content_stream', docmdp_permitted: false } };
    expect(summary('D04', { document: modified }).code).toBe('MODIFIED');

    // NO_POE + TRY_LATER (both down; a NO_POE signature and a normal one) -> NO_POE wins.
    const d01 = doc('D01');
    const noPoePlusTryLater: FixtureDocument = { ...d01, signatures: [...d01.signatures, d08sig] };
    expect(summary('D01', { document: noPoePlusTryLater, faults: { ocsp_down: true, crl_down: true } }).code).toBe('NO_POE');
  });
});

describe('purity', () => {
  it('is deterministic: same input twice gives deep-equal output', () => {
    for (const id of ['D01', 'D04', 'D06', 'D08', 'D09']) {
      expect(resolveVerification(inputFor(id))).toEqual(resolveVerification(inputFor(id)));
    }
  });

  it('does not mutate a deep-frozen input (strict mode would throw on any write)', () => {
    for (const id of ['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09']) {
      const input = deepFreeze(inputFor(id, { faults: { ocsp_down: true } }));
      expect(() => resolveVerification(input)).not.toThrow();
    }
  });

  it('output does not alias input objects (mutating the report leaves the fixture alone)', () => {
    const input = inputFor('D01');
    const before = JSON.stringify(input);
    const r = resolveVerification(input);
    r.signatures[0]!.timestamp!.time = 'tampered';
    r.doc_timestamps[0]!.time = 'tampered';
    r.refs.push('X');
    r.document.id = 'tampered';
    expect(JSON.stringify(input)).toBe(before);
  });

  it('output is JSON-serialisable (state must be)', () => {
    const r = resolveVerification(inputFor('D06'));
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});
