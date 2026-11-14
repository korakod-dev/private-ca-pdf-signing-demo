// Certificate requests, certificates, revocation (R14 window), CRL / OCSP, account closing.
import { describe, expect, it } from 'vitest';
import type { CertDto, CertRequestDto, CrlDto, OcspDto } from '../../contracts/api';
import type { PersonaId } from '../../contracts/fixtures';
import { Sim, body } from './helpers';

const CHECKLIST = { checklist: [true, true, true, true, true] };
const SOMCHAI = 'DE:M0:4F:2A:91:01';
const WIPAWAN = 'DE:M0:6B:D0:22:02';
const AREE = 'DE:M0:22:91:AF:03';

/** keygen on the persona's simulated machine; returns the CSR pem. */
function keygen(sim: Sim, who: PersonaId, name: string, email: string): string {
  const r = sim.by(who, 'demo.keygen', { body: { name, email } });
  expect(r.status).toBe(200);
  return body<{ csr_pem: string }>(r).csr_pem;
}

/** nattapon requests a certificate; returns the request. */
function nattaponRequest(sim: Sim): CertRequestDto {
  const pem = keygen(sim, 'u-nattapon', 'ณัฐพล ทองดี', 'nattapon@lab.korakod.dev');
  const r = sim.by('u-nattapon', 'certRequests.create', { body: { csr_pem: pem, appointment_id: 'slot-20261113' } });
  expect(r.status).toBe(201);
  return body<CertRequestDto>(r);
}

describe('new-user request flow (M2)', () => {
  it('request -> awaitingInPerson -> admin approves with MFA + 5 checks -> Issued -> finalize -> Active, with mail', () => {
    const sim = new Sim();
    const req = nattaponRequest(sim);
    expect(req).toMatchObject({ requester: 'u-nattapon', state: 'awaitingInPerson', kind: 'new' });
    expect(req.csr_checks).toHaveLength(6);
    expect(req.csr_checks.every((c) => c.passed)).toBe(true);
    expect(req.expires_at).toBe('2026-11-26T09:00:00+07:00');
    expect(req.appointment?.id).toBe('slot-20261113');
    // the pending request shows a Requested certificate
    const certs = body<CertDto[]>(sim.by('u-nattapon', 'certs.list'));
    expect(certs).toHaveLength(1);
    expect(certs[0]?.state).toBe('Requested');

    // approval needs the full checklist and MFA
    expect(sim.by('a-admin-a', 'certRequests.approve', { params: { id: req.id }, body: CHECKLIST }).status).toBe(403);
    expect(sim.admin('certRequests.approve', { params: { id: req.id }, body: { checklist: [true, true, true, true, false] } }).status).toBe(422);
    expect(sim.admin('certRequests.approve', { params: { id: req.id }, body: { checklist: [true] } }).status).toBe(400);
    expect(sim.by('u-nattapon', 'certRequests.approve', { params: { id: req.id }, body: CHECKLIST, mfa: '246810' }).status).toBe(403);
    const ok = sim.admin('certRequests.approve', { params: { id: req.id }, body: CHECKLIST });
    expect(ok.status).toBe(200);
    expect(body<CertRequestDto>(ok).state).toBe('approved');
    expect(sim.admin('certRequests.approve', { params: { id: req.id }, body: CHECKLIST }).status).toBe(409);

    const [cert] = body<CertDto[]>(sim.by('u-nattapon', 'certs.list'));
    expect(cert?.state).toBe('Issued');
    expect(cert?.serial).toMatch(/^DE:M0:A0:00:00:01$/);
    expect(cert?.subject).toBe('CN=ณัฐพล ทองดี, O=Korakod Lab DEMO, C=TH');
    // somebody else cannot finalize it
    expect(sim.by('u-manop', 'certs.finalize', { params: { serial: cert?.serial ?? '' } }).status).toBe(404);
    const fin = sim.by('u-nattapon', 'certs.finalize', { params: { serial: cert?.serial ?? '' } });
    expect(body<CertDto>(fin)).toMatchObject({ state: 'Active', days_left: 365 });
    expect(sim.by('u-nattapon', 'certs.finalize', { params: { serial: cert?.serial ?? '' } }).status).toBe(409);

    const mail = body<{ kind: string }[]>(sim.by('u-nattapon', 'demo.mailbox'));
    expect(mail.map((m) => m.kind)).toContain('approved');
    expect(sim.state.users['u-nattapon']?.last_in_person_proofing).toBe('2026-11-12T09:00:00+07:00');
    expect(sim.actions()).toEqual(expect.arrayContaining(['request.created', 'request.approved', 'cert.issued', 'cert.finalized']));
  });

  it('validates the CSR source, the appointment and duplicates', () => {
    const sim = new Sim();
    const pem = keygen(sim, 'u-nattapon', 'ณัฐพล ทองดี', 'nattapon@lab.korakod.dev');
    const create = (csr_pem: string, appointment_id: string) =>
      sim.by('u-nattapon', 'certRequests.create', { body: { csr_pem, appointment_id } });
    expect(create('-----BEGIN FAKE-----', 'slot-20261113').status).toBe(400);
    expect(create(pem, 'slot-nope').status).toBe(422);
    expect(sim.by('u-nattapon', 'certRequests.create', { body: {} }).status).toBe(400);
    expect(create(pem, 'slot-20261113').status).toBe(201);
    expect(create(pem, 'slot-20261113').status).toBe(409); // one pending request at a time
    // roles: admins and verifiers cannot request; Active holders must renew instead
    expect(sim.by('a-admin-a', 'certRequests.create', { body: { csr_pem: pem, appointment_id: 'slot-20261113' } }).status).toBe(403);
    expect(sim.by('u-guest', 'certRequests.create', { body: { csr_pem: pem, appointment_id: 'slot-20261113' } }).status).toBe(403);
    const sPem = keygen(sim, 'u-somchai', 'สมชาย ใจดี', 'somchai@lab.korakod.dev');
    expect(sim.by('u-somchai', 'certRequests.create', { body: { csr_pem: sPem, appointment_id: 'slot-20261113' } }).status).toBe(409);
    expect(sim.by('u-nattapon', 'demo.keygen', { body: { name: 'x'.repeat(200), email: 'a@b' } }).status).toBe(400);
  });

  it('appointments list only future slots and synthesise new ones when the fixtures have passed', () => {
    const sim = new Sim();
    const slots = (): { id: string; at: string }[] => body(sim.by('u-nattapon', 'certRequests.appointments'));
    expect(slots().map((s) => s.id)).toEqual(['slot-20261113', 'slot-20261114', 'slot-20261116']);
    sim.advance('P30D');
    const later = slots();
    expect(later).toHaveLength(3);
    expect(later.every((s) => Date.parse(s.at) > Date.parse(sim.now))).toBe(true);
  });

  it('request list/get scope: users see their own, admins see all', () => {
    const sim = new Sim();
    const req = nattaponRequest(sim);
    expect(body<unknown[]>(sim.by('u-nattapon', 'certRequests.list'))).toHaveLength(1);
    expect(body<unknown[]>(sim.by('u-somchai', 'certRequests.list'))).toHaveLength(0);
    const all = body<CertRequestDto[]>(sim.by('a-admin-b', 'certRequests.list'));
    expect(all.map((r) => r.id)).toEqual([req.id, 'req-manop-01']);
    expect(sim.by('u-somchai', 'certRequests.get', { params: { id: req.id } }).status).toBe(403);
    expect(sim.by('u-nattapon', 'certRequests.get', { params: { id: req.id } }).status).toBe(200);
    expect(sim.by('a-admin-b', 'certRequests.get', { params: { id: req.id } }).status).toBe(200);
    expect(sim.by('a-admin-b', 'certRequests.get', { params: { id: 'req-x' } }).status).toBe(404);
  });
});

describe('manop request (M3)', () => {
  it('fails CSR checks 2 and 4, cannot be approved, can be rejected with a reason + mail', () => {
    const sim = new Sim();
    const r = body<CertRequestDto>(sim.by('a-admin-a', 'certRequests.get', { params: { id: 'req-manop-01' } }));
    expect(r.csr_checks.filter((c) => !c.passed).map((c) => c.id)).toEqual([2, 4]);
    expect(sim.admin('certRequests.approve', { params: { id: 'req-manop-01' }, body: CHECKLIST }).status).toBe(422);
    expect(sim.admin('certRequests.reject', { params: { id: 'req-manop-01' }, body: { reason_code: 'nonsense', note: '' } }).status).toBe(400);
    expect(sim.admin('certRequests.reject', { params: { id: 'req-nope' }, body: { reason_code: 'other', note: '' } }).status).toBe(404);
    const rej = sim.admin('certRequests.reject', { params: { id: 'req-manop-01' }, body: { reason_code: 'csr_check_failed', note: 'ชื่อไม่ตรง' } });
    expect(body<CertRequestDto>(rej).state).toBe('rejected');
    expect(sim.admin('certRequests.reject', { params: { id: 'req-manop-01' }, body: { reason_code: 'other', note: '' } }).status).toBe(409);
    expect(sim.admin('certRequests.approve', { params: { id: 'req-nope' }, body: CHECKLIST }).status).toBe(404);
    expect(body<{ kind: string }[]>(sim.by('u-manop', 'demo.mailbox')).map((m) => m.kind)).toContain('rejected');
  });

  it('a request that is not decided within 14 days expires, and its certificate becomes ExpiredRequest', () => {
    const sim = new Sim();
    const req = nattaponRequest(sim);
    sim.advanceDays(13);
    expect(body<CertRequestDto>(sim.by('u-nattapon', 'certRequests.get', { params: { id: req.id } })).state).toBe('awaitingInPerson');
    sim.advance('P1D'); // exactly 14 days after creation
    expect(body<CertRequestDto>(sim.by('u-nattapon', 'certRequests.get', { params: { id: req.id } })).state).toBe('expired');
    expect(body<CertDto[]>(sim.by('u-nattapon', 'certs.list'))[0]?.state).toBe('ExpiredRequest');
    expect(sim.admin('certRequests.reject', { params: { id: req.id }, body: { reason_code: 'other', note: '' } }).status).toBe(409);
    expect(sim.actions()).toContain('request.expired');
  });
});

describe('renewal (M7, A9)', () => {
  it('auto-approves within 3 years of proofing: new cert Issued, old cert revoked as superseded only on finalize', () => {
    const sim = new Sim();
    const pem = keygen(sim, 'u-aree', 'อารีย์ มีสุข', 'aree@lab.korakod.dev');
    const r = sim.by('u-aree', 'certs.renew', { params: { serial: AREE }, body: { csr_pem: pem } });
    expect(r.status).toBe(201);
    expect(body<CertRequestDto>(r)).toMatchObject({ kind: 'renewal', state: 'approved', appointment: null });
    // a second renewal while one is pending is refused
    expect(sim.by('u-aree', 'certs.renew', { params: { serial: AREE }, body: { csr_pem: pem } }).status).toBe(409);
    let certs = body<CertDto[]>(sim.by('u-aree', 'certs.list'));
    const fresh = certs.find((c) => c.state === 'Issued');
    expect(fresh).toBeDefined();
    expect(certs.find((c) => c.serial === AREE)?.state).toBe('Active');
    sim.by('u-aree', 'certs.finalize', { params: { serial: fresh?.serial ?? '' } });
    certs = body<CertDto[]>(sim.by('u-aree', 'certs.list'));
    const old = certs.find((c) => c.serial === AREE);
    expect(old).toMatchObject({ state: 'Revoked', revocation_reason: 'superseded', superseded: true, superseded_by: fresh?.serial });
    expect(certs.find((c) => c.serial === fresh?.serial)?.state).toBe('Active');
    // the mail seed (30-day notice) plus the approval mail
    expect(body<{ kind: string }[]>(sim.by('u-aree', 'demo.mailbox')).map((m) => m.kind).sort()).toEqual(['approved', 'expiry_notice']);
  });

  it('renewal needs an in-person step when the last proofing is older than 3 years or the CSR checks fail', () => {
    const sim = new Sim();
    // somchai with a CSR in somebody else's name -> CSR checks fail -> manual path
    const bad = keygen(sim, 'u-somchai', 'ชื่ออื่น', 'somchai@lab.korakod.dev');
    const r1 = sim.by('u-somchai', 'certs.renew', { params: { serial: SOMCHAI }, body: { csr_pem: bad } });
    expect(body<CertRequestDto>(r1).state).toBe('awaitingInPerson');
    // wipawan: pretend the proofing is 4 years old
    sim.state.users['u-wipawan'] = { failures: 0, locked_until: null, last_in_person_proofing: '2022-01-01T09:00:00+07:00' };
    const ok = keygen(sim, 'u-wipawan', 'วิภาวรรณ ศรีสุข', 'wipawan@lab.korakod.dev');
    const r2 = sim.by('u-wipawan', 'certs.renew', { params: { serial: WIPAWAN }, body: { csr_pem: ok } });
    expect(body<CertRequestDto>(r2).state).toBe('awaitingInPerson');
  });

  it('refuses renewal of somebody else\'s, unknown or non-Active certificates', () => {
    const sim = new Sim();
    const pem = keygen(sim, 'u-somchai', 'สมชาย ใจดี', 'somchai@lab.korakod.dev');
    expect(sim.by('u-somchai', 'certs.renew', { params: { serial: WIPAWAN }, body: { csr_pem: pem } }).status).toBe(404);
    expect(sim.by('u-somchai', 'certs.renew', { params: { serial: 'nope' }, body: { csr_pem: pem } }).status).toBe(404);
    expect(sim.by('u-somchai', 'certs.renew', { params: { serial: 'DE:M0:4F:2A:91:00' }, body: { csr_pem: pem } }).status).toBe(409); // revoked
    sim.by('u-somchai', 'certs.revoke', { params: { serial: SOMCHAI }, body: { reason: 'cessationOfOperation' } });
    expect(sim.by('u-somchai', 'certs.renew', { params: { serial: SOMCHAI }, body: { csr_pem: pem } }).status).toBe(409);
  });
});

describe('revocation, CRL and OCSP (R14)', () => {
  const ocsp = (sim: Sim, serial: string): OcspDto => body<OcspDto>(sim.call('pki.ocsp', { params: { serial } }));
  const crl = (sim: Sim): CrlDto => body<CrlDto>(sim.call('pki.crl', { params: { ca: 'doc-signing-2026' } }));

  it('initial CRL lists the two certificates revoked before the epoch; OCSP knows good / revoked / unknown', () => {
    const sim = new Sim();
    const c = crl(sim);
    expect(c.number).toBe(1);
    expect(c.entries.map((e) => e.serial).sort()).toEqual(['DE:M0:4F:2A:91:00', 'DE:M0:6B:D0:22:01']);
    expect(c.next_update).toBe('2026-11-19T06:00:00+07:00');
    expect(ocsp(sim, SOMCHAI)).toMatchObject({ status: 'good', responder_serial: 'DE:M0:0C:SP:01' });
    expect(ocsp(sim, 'DE:M0:6B:D0:22:01')).toMatchObject({ status: 'revoked', reason: 'keyCompromise' });
    expect(ocsp(sim, 'DE:M0:00:00:00:99').status).toBe('unknown');
    expect(ocsp(sim, '01').status).toBe('unknown'); // self-signed: no issuer
    expect(sim.call('pki.crl', { params: { ca: 'root-2026' } }).status).toBe(404);
  });

  it('OCSP is revoked at once while the CRL only changes at the next 06:00 (R14 window)', () => {
    const sim = new Sim();
    const rev = sim.by('u-somchai', 'certs.revoke', { params: { serial: SOMCHAI }, body: { reason: 'cessationOfOperation' } });
    expect(body<CertDto>(rev)).toMatchObject({ state: 'Revoked', revoked_at: '2026-11-12T09:00:00+07:00' });
    expect(ocsp(sim, SOMCHAI).status).toBe('revoked');
    expect(crl(sim).entries.some((e) => e.serial === SOMCHAI)).toBe(false);
    expect(crl(sim).number).toBe(1);
    expect(sim.state.learning.r14_observed_at).toBe('2026-11-12T09:00:00+07:00');
    sim.advance('PT1H');
    expect(crl(sim).entries.some((e) => e.serial === SOMCHAI)).toBe(false); // still 10:00 on the same day
    sim.advanceDays(1); // 2026-11-13 10:00 > 06:00 run
    const after = crl(sim);
    expect(after.entries.some((e) => e.serial === SOMCHAI)).toBe(true);
    expect(after.number).toBe(2);
    expect(after.this_update).toBe('2026-11-13T06:00:00+07:00');
    expect(after.next_update).toBe('2026-11-20T06:00:00+07:00');
  });

  it('keyCompromise re-issues the CRL immediately (number + 1, audit crl.issued)', () => {
    const sim = new Sim();
    const rev = sim.admin('certs.revoke', { params: { serial: WIPAWAN }, body: { reason: 'keyCompromise', invalidity_date: '2026-10-15T09:00:00+07:00' } });
    expect(body<CertDto>(rev)).toMatchObject({ state: 'Revoked', invalidity_date: '2026-10-15T09:00:00+07:00' });
    const c = crl(sim);
    expect(c.number).toBe(2);
    expect(c.entries.find((e) => e.serial === WIPAWAN)).toMatchObject({ reason: 'keyCompromise', invalidity_date: '2026-10-15T09:00:00+07:00' });
    expect(sim.drafts.filter((d) => d.action === 'crl.issued')).toHaveLength(1);
    // no R14 window for keyCompromise: the CRL already lists it
    expect(sim.state.learning.r14_observed_at).toBeNull();
    ocsp(sim, WIPAWAN);
    expect(sim.state.learning.r14_observed_at).toBeNull();
  });

  it('admin "issue CRL now" publishes pending revocations immediately (MFA, admin-a only)', () => {
    const sim = new Sim();
    sim.by('u-somchai', 'certs.revoke', { params: { serial: SOMCHAI }, body: { reason: 'affiliationChanged' } });
    const r = sim.admin('admin.crlIssue');
    expect(body<CrlDto>(r).entries.some((e) => e.serial === SOMCHAI)).toBe(true);
    expect(body<CrlDto>(r).number).toBe(2);
    expect(sim.drafts.find((d) => d.action === 'crl.issued')).toMatchObject({ actor: 'a-admin-a', details: { reason: 'admin' } });
  });

  it('CRL / OCSP outage faults answer 503 with Retry-After', () => {
    const sim = new Sim();
    sim.setFaults({ ocsp_down: true, crl_down: true });
    const o = sim.call('pki.ocsp', { params: { serial: SOMCHAI } });
    const c = sim.call('pki.crl', { params: { ca: 'doc-signing-2026' } });
    expect([o.status, c.status]).toEqual([503, 503]);
    expect(body<{ code: string }>(o).code).toBe('OCSP_UNAVAILABLE');
    expect(body<{ code: string }>(c).code).toBe('CRL_UNAVAILABLE');
    expect(o.headers?.['Retry-After']).toBe('60');
  });

  it('revoke validation: roles, reasons, invalidity_date, state', () => {
    const sim = new Sim();
    const rev = (who: PersonaId, serial: string, b: unknown, mfa = '246810') => sim.by(who, 'certs.revoke', { params: { serial }, body: b, mfa });
    expect(rev('u-wipawan', SOMCHAI, { reason: 'keyCompromise' }).status).toBe(403); // not the owner
    expect(rev('a-admin-b', SOMCHAI, { reason: 'keyCompromise' }).status).toBe(403); // auditor
    expect(rev('u-somchai', 'nope', { reason: 'keyCompromise' }).status).toBe(404);
    expect(rev('u-somchai', SOMCHAI, { reason: 'bogus' }).status).toBe(400);
    expect(rev('u-somchai', SOMCHAI, { reason: 'superseded' }).status).toBe(403); // admin-only reason
    expect(rev('u-somchai', SOMCHAI, { reason: 'keyCompromise', invalidity_date: '2026-11-01T09:00:00+07:00' }).status).toBe(403);
    // admin-a: MFA required, date validated, no future date
    expect(sim.by('a-admin-a', 'certs.revoke', { params: { serial: SOMCHAI }, body: { reason: 'privilegeWithdrawn' } }).status).toBe(403);
    expect(rev('a-admin-a', SOMCHAI, { reason: 'privilegeWithdrawn', invalidity_date: 'yesterday' }).status).toBe(400);
    expect(rev('a-admin-a', SOMCHAI, { reason: 'privilegeWithdrawn', invalidity_date: '2027-01-01T09:00:00+07:00' }).status).toBe(400);
    expect(rev('a-admin-a', 'DE:M0:4F:2A:91:00', { reason: 'unspecified' }).status).toBe(409); // already revoked
    expect(rev('a-admin-a', SOMCHAI, { reason: 'privilegeWithdrawn', invalidity_date: null }).status).toBe(200);
    expect(rev('u-somchai', SOMCHAI, { reason: 'keyCompromise' }).status).toBe(409);
  });

  it('closing an account revokes its active certificates (affiliationChanged) and reports them', () => {
    const sim = new Sim();
    const r = sim.admin('admin.closeAccount', { params: { user_id: 'u-wipawan' } });
    expect(body<{ revoked: string[] }>(r).revoked).toEqual([WIPAWAN]);
    expect(body<CertDto[]>(sim.by('u-wipawan', 'certs.list')).find((c) => c.serial === WIPAWAN)?.revocation_reason).toBe('affiliationChanged');
    expect(sim.admin('admin.closeAccount', { params: { user_id: 'u-wipawan' } }).status).toBe(200);
    expect(sim.admin('admin.closeAccount', { params: { user_id: 'a-admin-b' } }).status).toBe(400);
    expect(sim.admin('admin.closeAccount', { params: { user_id: 'nobody' } }).status).toBe(404);
  });

  it('certs.list/get scope and ordering', () => {
    const sim = new Sim();
    const mine = body<CertDto[]>(sim.by('u-wipawan', 'certs.list'));
    expect(mine.map((c) => c.serial)).toEqual([WIPAWAN, 'DE:M0:6B:D0:22:01', 'DE:M0:6B:D0:22:00']);
    expect(body<CertDto[]>(sim.by('a-admin-b', 'certs.list')).length).toBe(8);
    expect(sim.by('u-wipawan', 'certs.get', { params: { serial: SOMCHAI } }).status).toBe(403);
    expect(sim.by('u-wipawan', 'certs.get', { params: { serial: 'nope' } }).status).toBe(404);
    expect(body<CertDto>(sim.by('u-aree', 'certs.get', { params: { serial: AREE } })).days_left).toBe(21);
    expect(body<CertDto>(sim.by('a-admin-a', 'certs.get', { params: { serial: AREE } })).superseded).toBe(false);
  });
});
