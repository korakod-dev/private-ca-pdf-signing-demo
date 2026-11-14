// Mission done conditions M1-M11 (plan section 3.7), each driven through the same API calls a learner would make.
import { describe, expect, it } from 'vitest';
import type { CertDto, CertRequestDto } from '../../contracts/api';
import { Sim, body } from './helpers';

const CHECKLIST = { checklist: [true, true, true, true, true] };
const done = (sim: Sim): string[] => sim.engine.evaluateMissions(sim.state).filter((m) => m.done).map((m) => m.id);
const pem = (sim: Sim, who: 'u-nattapon' | 'u-aree', name: string, email: string): string =>
  body<{ csr_pem: string }>(sim.by(who, 'demo.keygen', { body: { name, email } })).csr_pem;

describe('missions', () => {
  it('starts with all 11 missions open and no done_at', () => {
    const sim = new Sim();
    const m = sim.engine.evaluateMissions(sim.state);
    expect(m.map((x) => x.id)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10', 'M11']);
    expect(m.every((x) => !x.done && x.done_at === null)).toBe(true);
  });

  it('M1: progress key M1.fingerprint_matched; done_at is the simulated time it happened and stays put', () => {
    const sim = new Sim();
    sim.advance('PT1H');
    sim.call('demo.progress', { body: { key: 'M1.fingerprint_matched' } });
    expect(done(sim)).toEqual(['M1']);
    expect(sim.engine.evaluateMissions(sim.state)[0]?.done_at).toBe('2026-11-12T10:00:00+07:00');
    sim.advance('P1D');
    expect(sim.engine.evaluateMissions(sim.state)[0]?.done_at).toBe('2026-11-12T10:00:00+07:00');
  });

  it('M2: a u-nattapon certificate is Active', () => {
    const sim = new Sim();
    const csr = pem(sim, 'u-nattapon', 'ณัฐพล ทองดี', 'nattapon@lab.korakod.dev');
    const req = body<CertRequestDto>(sim.by('u-nattapon', 'certRequests.create', { body: { csr_pem: csr, appointment_id: 'slot-20261113' } }));
    sim.admin('certRequests.approve', { params: { id: req.id }, body: CHECKLIST });
    expect(done(sim)).toEqual([]); // Issued is not enough
    const [cert] = body<CertDto[]>(sim.by('u-nattapon', 'certs.list'));
    sim.by('u-nattapon', 'certs.finalize', { params: { serial: cert?.serial ?? '' } });
    expect(done(sim)).toEqual(['M2']);
  });

  it('M3: req-manop-01 is rejected', () => {
    const sim = new Sim();
    sim.admin('certRequests.reject', { params: { id: 'req-manop-01' }, body: { reason_code: 'identity_mismatch', note: 'ชื่อไม่ตรง' } });
    expect(done(sim)).toEqual(['M3']);
  });

  it('M4: D12-s2 exists and a job on it finished TOTAL-PASSED', () => {
    const sim = new Sim();
    const sign = (who: 'u-somchai' | 'u-wipawan', doc: string, field: string, certify: boolean) =>
      sim.by(who, 'sign.commit', {
        body: { document_id: doc, field, certify, purpose: 1, sha256_suffix: sim.state.documents.find((d) => d.id === doc)?.sha256.slice(-4), p12_password: 'demo-p12-password' },
      });
    sign('u-somchai', 'D12', 'approver-1', true);
    sign('u-wipawan', 'D12-s1', 'approver-2', false);
    expect(done(sim)).toEqual([]); // exists, but not verified yet
    sim.verify('u-wipawan', 'D12-s2');
    expect(done(sim)).toEqual(['M4']);
  });

  it('M5: every one of D01-D11 opened (jobs done for D01-D09, 413/422 recorded for D10/D11)', () => {
    const sim = new Sim();
    for (const id of ['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09']) sim.verify('u-guest', id);
    expect(done(sim)).toEqual([]);
    sim.verify('u-guest', 'D10');
    expect(done(sim)).toEqual([]);
    sim.verify('u-guest', 'D11');
    expect(done(sim)).toEqual(['M5']); // D11 is the 11th POST: rejected with 413, which still counts
  });

  it('M6: OCSP revoked while absent from the CRL (R14), then a REVOKED job; both orders matter', () => {
    const sim = new Sim();
    // a REVOKED result before the R14 observation does not count
    sim.verify('u-guest', 'D04');
    sim.by('u-somchai', 'certs.revoke', { params: { serial: 'DE:M0:4F:2A:91:01' }, body: { reason: 'cessationOfOperation' } });
    expect(done(sim)).toEqual([]);
    sim.call('pki.ocsp', { params: { serial: 'DE:M0:4F:2A:91:01' } });
    expect(done(sim)).toEqual([]);
    // D01 still passes (revocation after the timestamp), D04 fails as REVOKED -> mission done
    expect(sim.verify('u-guest', 'D01').job?.result?.indication).toBe('TOTAL-PASSED');
    expect(done(sim)).toEqual([]);
    expect(sim.verify('u-guest', 'D04').job?.result).toMatchObject({ indication: 'TOTAL-FAILED', sub_indication: 'REVOKED' });
    expect(done(sim)).toEqual(['M6']);
  });

  it('M7: aree has a new Active certificate and AF:03 is Revoked / superseded', () => {
    const sim = new Sim();
    const csr = pem(sim, 'u-aree', 'อารีย์ มีสุข', 'aree@lab.korakod.dev');
    sim.by('u-aree', 'certs.renew', { params: { serial: 'DE:M0:22:91:AF:03' }, body: { csr_pem: csr } });
    expect(done(sim)).toEqual([]);
    const fresh = body<CertDto[]>(sim.by('u-aree', 'certs.list')).find((c) => c.state === 'Issued');
    sim.by('u-aree', 'certs.finalize', { params: { serial: fresh?.serial ?? '' } });
    expect(done(sim)).toEqual(['M7']);
  });

  it('M8: a somchai archive item reached deleted and archive.deleted with its sha256 exists', () => {
    const sim = new Sim();
    const v = sim.verify('u-somchai', 'D01');
    sim.by('u-somchai', 'archive.add', { body: { document_id: 'D01', verify_job_id: (v.create.body as { job_id: string }).job_id } });
    sim.advance('P1Y');
    expect(done(sim)).toEqual([]);
    sim.advance('P5Y');
    expect(done(sim)).toEqual(['M8']);
  });

  it('M8 is not triggered by another persona\'s archive item', () => {
    const sim = new Sim();
    const v = sim.verify('u-wipawan', 'D01');
    sim.by('u-wipawan', 'archive.add', { body: { document_id: 'D01', verify_job_id: (v.create.body as { job_id: string }).job_id } });
    sim.advance('P5Y');
    sim.advance('P1Y');
    expect(done(sim)).toEqual([]);
  });

  it('M9: a sign.refused audit with code TSA_DRIFT exists', () => {
    const sim = new Sim();
    sim.setFaults({ tsa_drift_ms: 1400 });
    expect(done(sim)).toEqual([]);
    sim.by('u-somchai', 'sign.commit', {
      body: { document_id: 'D12', field: 'approver-1', certify: true, purpose: 3, sha256_suffix: sim.state.documents.find((d) => d.id === 'D12')?.sha256.slice(-4), p12_password: 'demo-p12-password' },
    });
    expect(done(sim)).toEqual(['M9']);
  });

  it('M9 also holds when only the runtime-chained audit carries the refusal (state restored from storage)', () => {
    const sim = new Sim();
    sim.state = {
      ...sim.state,
      audit: [{ seq: 1, at: sim.now, actor: 'u-somchai', action: 'sign.refused', target: 'D12', details: { code: 'TSA_DRIFT' }, prev_hash: '0', hash: 'h' }],
    };
    expect(done(sim)).toEqual(['M9']);
  });

  it('M10: a D01 job finished INDETERMINATE / TRY_LATER (both status services down)', () => {
    const sim = new Sim();
    sim.setFaults({ ocsp_down: true });
    expect(sim.verify('u-guest', 'D01').job?.result?.indication).toBe('TOTAL-PASSED');
    expect(done(sim)).toEqual([]);
    sim.setFaults({ crl_down: true });
    expect(sim.verify('u-guest', 'D01').job?.result).toMatchObject({ indication: 'INDETERMINATE', sub_indication: 'TRY_LATER' });
    expect(done(sim)).toEqual(['M10']);
  });

  it('M11: progress key M11.chain_verified', () => {
    const sim = new Sim();
    sim.call('demo.progress', { body: { key: 'M11.chain_verified' } });
    expect(done(sim)).toEqual(['M11']);
    expect(body<{ missions: { id: string; done: boolean }[] }>(sim.call('demo.status')).missions.find((m) => m.id === 'M11')?.done).toBe(true);
  });

  it('wipawan keyCompromise with invalidity_date 2026-10-15 makes the (fake) D01 verdict REVOKED; somchai cessationOfOperation does not', () => {
    const sim = new Sim();
    sim.admin('certs.revoke', { params: { serial: 'DE:M0:4F:2A:91:01' }, body: { reason: 'cessationOfOperation' } });
    expect(sim.verify('u-guest', 'D01').job?.result?.indication).toBe('TOTAL-PASSED');
    sim.admin('certs.revoke', { params: { serial: 'DE:M0:6B:D0:22:02' }, body: { reason: 'keyCompromise', invalidity_date: '2026-10-15T09:00:00+07:00' } });
    expect(sim.verify('u-guest', 'D01').job?.result).toMatchObject({ indication: 'TOTAL-FAILED', sub_indication: 'REVOKED' });
  });
});
