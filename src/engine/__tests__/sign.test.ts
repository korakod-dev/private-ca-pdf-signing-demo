// Sign desk: review/commit flow D12 -> D12-s1 -> D12-s2 (injected fake resolver) and every refusal rule.
import { describe, expect, it } from 'vitest';
import type { SignResultDto, SignReviewDto } from '../../contracts/api';
import type { FixtureDocument, PersonaId } from '../../contracts/fixtures';
import { Sim, body, resolverCalls } from './helpers';
import { createEngine } from '../index';
import { fixtures } from '../../fixtures';

const PASSWORD = 'demo-p12-password';

const suffixOf = (sim: Sim, docId: string): string => (sim.state.documents.find((d) => d.id === docId)?.sha256 ?? '').slice(-4);

function review(sim: Sim, who: PersonaId, document_id: string, field: string, certify = false) {
  return sim.by(who, 'sign.review', { body: { document_id, field, certify } });
}

function commit(sim: Sim, who: PersonaId, document_id: string, field: string, o: Record<string, unknown> = {}) {
  return sim.by(who, 'sign.commit', {
    body: { document_id, field, certify: false, purpose: 1, sha256_suffix: suffixOf(sim, document_id), p12_password: PASSWORD, ...o },
  });
}

const code = (r: { body: unknown }): string => (r.body as { code: string }).code;

describe('D12 -> s1 -> s2 flow', () => {
  it('somchai certifies s1, wipawan approves s2; documents get derived ids, file names and fake hashes', () => {
    const sim = new Sim();
    const rev = review(sim, 'u-somchai', 'D12', 'approver-1', true);
    expect(rev.status).toBe(200);
    const dto = body<SignReviewDto>(rev);
    expect(dto).toMatchObject({ document_id: 'D12', file_name: 'memo-130-unsigned.pdf', pages: 2, existing_signatures: [] });
    expect(dto.sha256).toMatch(/^de00[0-9a-f]{60}$/);

    const c1 = commit(sim, 'u-somchai', 'D12', 'approver-1', { certify: true, purpose: 3 });
    expect(c1.status).toBe(201);
    expect(body<SignResultDto>(c1)).toEqual({ document_id: 'D12-s1', file_name: 'memo-130-s1.signed.pdf', levels: ['B-T', 'B-LT', 'B-LTA'] });
    const s1 = sim.state.documents.find((d) => d.id === 'D12-s1') as FixtureDocument;
    expect(s1.sha256).toMatch(/^de00[0-9a-f]{60}$/);
    expect(s1.sha256).not.toBe(sim.state.documents.find((d) => d.id === 'D12')?.sha256);
    expect(s1.signatures).toHaveLength(1);
    expect(s1.signatures[0]).toMatchObject({
      field: 'approver-1',
      type: 'certification',
      signer_cert_serial: 'DE:M0:4F:2A:91:01',
      level: 'B-LTA',
      purpose: 3,
      signature_timestamp: { tsa_serial: 'DE:M0:00:00:00:03' },
    });

    // the original D12 is untouched
    expect(sim.state.documents.find((d) => d.id === 'D12')?.signatures).toHaveLength(0);

    // existing signatures are verified (through the resolver) at review time
    resolverCalls.length = 0;
    const rev2 = review(sim, 'u-wipawan', 'D12-s1', 'approver-2');
    expect(body<SignReviewDto>(rev2).existing_signatures).toEqual([
      { field: 'approver-1', signer_subject: 'CN=สมชาย ใจดี, O=Korakod Lab DEMO, C=TH', indication: 'TOTAL-PASSED' },
    ]);
    expect(resolverCalls).toHaveLength(1);
    expect(resolverCalls[0]?.document.id).toBe('D12-s1');
    expect(resolverCalls[0]?.certs['DE:M0:4F:2A:91:01']?.trusted_chain).toBe(true);
    expect(resolverCalls[0]?.policy).toBe('strict-v1');

    const c2 = commit(sim, 'u-wipawan', 'D12-s1', 'approver-2', { purpose: 1 });
    expect(body<SignResultDto>(c2)).toMatchObject({ document_id: 'D12-s2', file_name: 'memo-130-s2.signed.pdf' });
    const s2 = sim.state.documents.find((d) => d.id === 'D12-s2') as FixtureDocument;
    expect(s2.signatures.map((s) => s.field)).toEqual(['approver-1', 'approver-2']);
    expect(s2.signatures[1]?.type).toBe('approval');
    expect(s2.doc_timestamps).toHaveLength(2);

    // D12-s2 verifies (fake resolver) and the sign desk workstation lists the files
    const v = sim.verify('u-somchai', 'D12-s2');
    expect(v.job?.result?.indication).toBe('TOTAL-PASSED');
    const ws = body<{ documents: { path: string; document_id: string }[] }>(sim.by('u-somchai', 'demo.workstation'));
    expect(ws.documents.map((d) => d.path)).toEqual(expect.arrayContaining(['~/Documents/memo-130-unsigned.pdf', '~/Documents/memo-130-s1.signed.pdf', '~/Documents/memo-130-s2.signed.pdf']));
    expect(sim.actions().filter((a) => a === 'document.signed')).toHaveLength(2);
  });

  it('signing the same original again does not collide with earlier derived ids', () => {
    const sim = new Sim();
    commit(sim, 'u-somchai', 'D12', 'approver-1');
    const again = commit(sim, 'u-wipawan', 'D12', 'approver-2');
    expect(body<SignResultDto>(again).document_id).toBe('D12-s2');
    expect(sim.state.documents.filter((d) => d.id.startsWith('D12-s'))).toHaveLength(2);
  });

  it('after the signer certificate has expired the sign desk refuses (certificates last one year)', () => {
    const sim = new Sim();
    sim.advance('P1Y'); // somchai's certificate is valid until 2027-10-07
    expect(commit(sim, 'u-somchai', 'D12', 'approver-1').status).toBe(403);
  });
});

describe('refusal rules', () => {
  const refused = (sim: Sim, c: string): boolean => sim.drafts.some((d) => d.action === 'sign.refused' && d.details.code === c);

  it('S5: existing signatures that do not pass verification block signing', () => {
    const sim = new Sim();
    commit(sim, 'u-somchai', 'D12', 'approver-1', { certify: true });
    // revoke somchai's certificate backdated before his signature: the existing signature no longer passes
    sim.admin('certs.revoke', { params: { serial: 'DE:M0:4F:2A:91:01' }, body: { reason: 'keyCompromise', invalidity_date: '2026-11-01T09:00:00+07:00' } });
    const r = review(sim, 'u-wipawan', 'D12-s1', 'approver-2');
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ code: 'EXISTING_SIGNATURE_INVALID', ref: 'S5' });
    expect(refused(sim, 'EXISTING_SIGNATURE_INVALID')).toBe(true);
    expect(commit(sim, 'u-wipawan', 'D12-s1', 'approver-2').status).toBe(422);
  });

  it('S5 also blocks when verification cannot reach a verdict (both status services down)', () => {
    const sim = new Sim();
    commit(sim, 'u-somchai', 'D12', 'approver-1');
    sim.setFaults({ ocsp_down: true, crl_down: true });
    expect(code(review(sim, 'u-wipawan', 'D12-s1', 'approver-2'))).toBe('EXISTING_SIGNATURE_INVALID');
  });

  it('encrypted -> 422, over 200 pages or 20 MB -> 413', () => {
    const encrypted = new Sim();
    encrypted.state.documents.find((d) => d.id === 'D12')!.encrypted = true;
    const e = review(encrypted, 'u-somchai', 'D12', 'approver-1');
    expect([e.status, code(e)]).toEqual([422, 'ENCRYPTED_PDF']);

    const pages = new Sim();
    pages.state.documents.find((d) => d.id === 'D12')!.pages = 201;
    expect([review(pages, 'u-somchai', 'D12', 'approver-1').status, refused(pages, 'PDF_TOO_LARGE')]).toEqual([413, true]);

    const bytes = new Sim();
    bytes.state.documents.find((d) => d.id === 'D12')!.size_bytes = 20 * 1024 * 1024 + 1;
    expect(review(bytes, 'u-somchai', 'D12', 'approver-1').status).toBe(413);
  });

  it('own certificate must be Active: no cert, revoked cert, expired cert, pending cert', () => {
    const sim = new Sim();
    expect(code(review(sim, 'u-guest', 'D12', 'approver-1'))).toBe('CERT_NOT_ACTIVE');
    expect(code(review(sim, 'u-nattapon', 'D12', 'approver-1'))).toBe('CERT_NOT_ACTIVE');
    // M6 / A23: after self-revocation the sign desk refuses
    sim.by('u-somchai', 'certs.revoke', { params: { serial: 'DE:M0:4F:2A:91:01' }, body: { reason: 'cessationOfOperation' } });
    const r = review(sim, 'u-somchai', 'D12', 'approver-1');
    expect([r.status, code(r)]).toEqual([403, 'CERT_NOT_ACTIVE']);
    // aree's certificate expires at +21 days
    sim.advanceDays(21);
    expect(code(review(sim, 'u-aree', 'D12', 'approver-1'))).toBe('CERT_NOT_ACTIVE');
    expect(sim.actions()).toContain('sign.refused');
  });

  it('certification is only allowed as the first signature', () => {
    const sim = new Sim();
    commit(sim, 'u-somchai', 'D12', 'approver-1');
    const r = review(sim, 'u-wipawan', 'D12-s1', 'approver-2', true);
    expect([r.status, code(r)]).toEqual([409, 'CERTIFY_NOT_FIRST']);
  });

  it('wrong SHA-256 suffix and wrong p12 password are 400 and audited', () => {
    const sim = new Sim();
    const bad = commit(sim, 'u-somchai', 'D12', 'approver-1', { sha256_suffix: 'zzzz' });
    expect([bad.status, code(bad)]).toEqual([400, 'SHA_SUFFIX_MISMATCH']);
    expect(bad.body).toMatchObject({ ref: 'S2' });
    const bad2 = commit(sim, 'u-somchai', 'D12', 'approver-1', { p12_password: 'nope' });
    expect([bad2.status, code(bad2)]).toEqual([400, 'P12_PASSWORD_INVALID']);
    // case-insensitive suffix
    expect(commit(sim, 'u-somchai', 'D12', 'approver-1', { sha256_suffix: suffixOf(sim, 'D12').toUpperCase() }).status).toBe(201);
    expect(sim.drafts.filter((d) => d.action === 'sign.refused')).toHaveLength(2);
  });

  it('TSA drift above 1000 ms refuses signing: 503 TSA_DRIFT, sign.refused + tsa.stopped (once); resumes when fixed', () => {
    const sim = new Sim();
    sim.setFaults({ tsa_drift_ms: 1400 });
    const r = commit(sim, 'u-somchai', 'D12', 'approver-1');
    expect([r.status, code(r)]).toEqual([503, 'TSA_DRIFT']);
    expect(r.body).toMatchObject({ ref: 'T9' });
    expect(sim.drafts.find((d) => d.action === 'sign.refused')).toMatchObject({ actor: 'u-somchai', details: { code: 'TSA_DRIFT' } });
    expect(sim.actions().filter((a) => a === 'tsa.stopped')).toHaveLength(1);
    commit(sim, 'u-somchai', 'D12', 'approver-1');
    expect(sim.actions().filter((a) => a === 'tsa.stopped')).toHaveLength(1);
    // exactly at the limit is still fine
    sim.setFaults({ tsa_drift_ms: 1000 });
    expect(sim.actions()).toContain('tsa.resumed');
    expect(commit(sim, 'u-somchai', 'D12', 'approver-1').status).toBe(201);
  });

  it('input validation: purpose, fields, unknown / non-signable documents, anonymous callers', () => {
    const sim = new Sim();
    expect(commit(sim, 'u-somchai', 'D12', 'approver-1', { purpose: 7 }).status).toBe(400);
    expect(sim.by('u-somchai', 'sign.commit', { body: { document_id: 'D12', field: 'approver-1' } }).status).toBe(400);
    expect(sim.by('u-somchai', 'sign.review', { body: { document_id: 'D12', field: 'approver-1', certify: 'yes' } }).status).toBe(400);
    expect(review(sim, 'u-somchai', 'D99', 'approver-1').status).toBe(404);
    expect(code(review(sim, 'u-somchai', 'D12', 'approver-9'))).toBe('INVALID_REQUEST');
    expect(code(review(sim, 'u-somchai', 'D01', 'approver-1'))).toBe('INVALID_REQUEST'); // not a sign-desk document
    commit(sim, 'u-somchai', 'D12', 'approver-1');
    expect(code(review(sim, 'u-somchai', 'D12-s1', 'approver-1'))).toBe('INVALID_STATE'); // field already signed
    expect(sim.call('sign.review', { body: { document_id: 'D12', field: 'approver-1', certify: false } }).status).toBe(401);
  });

  it('with no TSA left (far future) signing is refused with TSA_UNAVAILABLE', () => {
    const sim = new Sim();
    sim.state.pki = sim.state.pki.filter((c) => !c.id.startsWith('tsa-'));
    expect(code(commit(sim, 'u-somchai', 'D12', 'approver-1'))).toBe('TSA_UNAVAILABLE');
  });

  it('default engine without injected resolver can still review an unsigned document (no resolver call needed)', () => {
    const e = createEngine();
    const s0 = e.createInitialState(fixtures, { latency: false, clock_mode: 'frozen' }, 0);
    const clock = e.clockFrom(s0, 0);
    const login = e.dispatch(s0, { route: 'demo.persona', token: null, params: {}, query: {}, body: { user_id: 'u-somchai' }, mfa: null }, clock);
    const token = (login.response.body as { token: string }).token;
    const r = e.dispatch(login.state, { route: 'sign.review', token, params: {}, query: {}, body: { document_id: 'D12', field: 'approver-1', certify: true }, mfa: null }, clock);
    expect(r.response.status).toBe(200);
  });
});

describe('workstation and keygen', () => {
  it('lists documents for everybody and ~/.private-ca per persona', () => {
    const sim = new Sim();
    const ws = (who: PersonaId) => body<{ documents: unknown[]; private_ca: { path: string; kind: string }[] }>(sim.by(who, 'demo.workstation'));
    expect(ws('u-guest').documents).toHaveLength(12);
    expect(ws('u-guest').private_ca).toEqual([]);
    expect(ws('u-somchai').private_ca).toEqual([
      { path: '~/.private-ca/signing.key', kind: 'private_key' },
      { path: '~/.private-ca/DE-M0-4F-2A-91-01.crt', kind: 'certificate' },
    ]);
    sim.by('u-nattapon', 'demo.keygen', { body: { name: 'ณัฐพล ทองดี', email: 'nattapon@lab.korakod.dev' } });
    expect(ws('u-nattapon').private_ca).toEqual([
      { path: '~/.private-ca/key-1.pem', kind: 'private_key' },
      { path: '~/.private-ca/key-1.csr', kind: 'csr' },
    ]);
    const keygen = sim.by('u-nattapon', 'demo.keygen', { body: { name: 'ณัฐพล ทองดี', email: 'nattapon@lab.korakod.dev' } });
    expect(body<{ csr: { key_alg: string; key_size: number } }>(keygen).csr).toMatchObject({ key_alg: 'ECDSA-P256', key_size: 256 });
    expect(sim.call('demo.workstation').status).toBe(401);
  });
});
