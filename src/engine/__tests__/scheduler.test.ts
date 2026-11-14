// Scheduled jobs, certificate notices/expiry, archive lifecycle and the P5Y advance.
import { describe, expect, it } from 'vitest';
import type { ArchiveDto, CertDto, CrlDto, AdminStatusDto } from '../../contracts/api';
import { Sim, body } from './helpers';

const AREE = 'DE:M0:22:91:AF:03';

/** somchai verifies D01 and archives it; returns the archive row. */
function archiveD01(sim: Sim, who: 'u-somchai' | 'u-wipawan' = 'u-somchai'): ArchiveDto {
  const v = sim.verify(who, 'D01');
  const jobId = (v.create.body as { job_id: string }).job_id;
  const r = sim.by(who, 'archive.add', { body: { document_id: 'D01', verify_job_id: jobId } });
  expect(r.status).toBe(201);
  return body<ArchiveDto>(r);
}

describe('aree certificate notices and expiry (21 days left at the epoch)', () => {
  it('7-day notice at +14d, 1-day notice at +20d, Expired at +21d', () => {
    const sim = new Sim();
    const kinds = (): string[] => body<{ kind: string; subject_th: string }[]>(sim.by('u-aree', 'demo.mailbox')).map((m) => m.subject_th);
    const cert = (): CertDto | undefined => body<CertDto[]>(sim.by('u-aree', 'certs.list')).find((c) => c.serial === AREE);
    sim.advanceDays(13);
    expect(kinds()).toHaveLength(1); // only the seeded 30-day notice
    sim.advance('P1D'); // +14d: exactly 7 days before expiry
    expect(kinds().filter((s) => s.includes('7 วัน'))).toHaveLength(1);
    expect(cert()?.state).toBe('Active');
    sim.advanceDays(5);
    expect(kinds().filter((s) => s.includes('1 วัน'))).toHaveLength(0);
    sim.advance('P1D'); // +20d
    expect(kinds().filter((s) => s.includes('1 วัน'))).toHaveLength(1);
    expect(cert()?.state).toBe('Active');
    sim.advance('P1D'); // +21d
    expect(cert()).toMatchObject({ state: 'Expired', days_left: 0 });
    expect(sim.drafts.filter((d) => d.action === 'cert.expired').map((d) => d.target)).toEqual([AREE]);
    // no duplicate notices when more time passes
    sim.advance('P30D');
    expect(kinds().filter((s) => s.includes('7 วัน'))).toHaveLength(1);
  });

  it('a notice is not sent twice even when a long advance covers several thresholds at once', () => {
    const sim = new Sim();
    sim.advance('P30D');
    const mail = body<{ subject_th: string }[]>(sim.by('u-aree', 'demo.mailbox'));
    expect(mail.map((m) => m.subject_th).filter((s) => s.includes('7 วัน'))).toHaveLength(1);
    expect(mail.map((m) => m.subject_th).filter((s) => s.includes('1 วัน'))).toHaveLength(1);
    expect(sim.drafts.filter((d) => d.action === 'job.cert_notices')).toHaveLength(1);
    expect(sim.drafts.find((d) => d.action === 'job.cert_notices')?.details).toMatchObject({ count: 2 });
  });
});

describe('recurring jobs are aggregated and lazy', () => {
  it('one draft per job type per tick, with count / from / to', () => {
    const sim = new Sim();
    sim.advance('P30D');
    const agg = (a: string) => sim.drafts.filter((d) => d.action === a);
    expect(agg('job.crl_issue')).toHaveLength(1);
    expect(agg('job.crl_issue')[0]?.details).toMatchObject({ count: 30, from: '2026-11-13T06:00:00+07:00', to: '2026-12-12T06:00:00+07:00', last_number: 31 });
    expect(agg('job.backup')[0]?.details).toMatchObject({ count: 30, from: '2026-11-13T02:00:00+07:00' });
    expect(agg('job.retimestamp')[0]?.details).toMatchObject({ count: 30 });
    expect(agg('job.ocsp_rotate')[0]?.details).toMatchObject({ count: 2, last_serial: 'DE:M0:0C:SP:03' });
    // nothing runs when no time has passed
    const before = sim.drafts.length;
    sim.call('demo.status');
    expect(sim.drafts.length).toBe(before);
  });

  it('CRL: number counts the daily runs, nextUpdate is +7d; the OCSP signer rotates every 14 days with 30-day validity', () => {
    const sim = new Sim();
    sim.advanceDays(14);
    const crl = body<CrlDto>(sim.call('pki.crl', { params: { ca: 'doc-signing-2026' } }));
    expect(crl).toMatchObject({ number: 15, this_update: '2026-11-26T06:00:00+07:00', next_update: '2026-12-03T06:00:00+07:00' });
    const cas = body<{ id: string; serial: string; not_before: string; not_after: string }[]>(sim.call('pki.cas'));
    expect(cas.find((c) => c.id === 'ocsp-signer')).toMatchObject({ serial: 'DE:M0:0C:SP:02', not_before: '2026-11-26T09:00:00+07:00', not_after: '2026-12-26T09:00:00+07:00' });
    expect(body<AdminStatusDto>(sim.by('a-admin-a', 'admin.status')).ocsp_signer.serial).toBe('DE:M0:0C:SP:02');
  });

  it('audit drafts stay chronological and the clock advance itself is logged', () => {
    const sim = new Sim();
    sim.advance('P30D');
    const times = sim.drafts.map((d) => Date.parse(d.at));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(sim.drafts.find((d) => d.action === 'clock.advanced')?.details).toMatchObject({ advance: 'P30D' });
  });

  it('tick() on its own replays the schedule up to the given clock', () => {
    const sim = new Sim();
    const r = sim.engine.tick(sim.state, { now: '2026-11-14T09:00:00+07:00', wallMs: sim.wall });
    expect(r.state.crl.number).toBe(3);
    expect(r.state.last_tick).toBe('2026-11-14T09:00:00+07:00');
    expect(r.audit.map((d) => d.action)).toEqual(expect.arrayContaining(['job.crl_issue', 'job.backup']));
    // an earlier clock is a no-op for the schedule
    const back = sim.engine.tick(r.state, { now: '2026-11-13T09:00:00+07:00', wallMs: sim.wall });
    expect(back.state.crl.number).toBe(3);
    expect(back.audit).toEqual([]);
  });
});

describe('archive (A16, A31)', () => {
  it('add requires a finished TOTAL-PASSED job of that document; duplicates and unknown ids are refused', () => {
    const sim = new Sim();
    const add = (b: unknown) => sim.by('u-somchai', 'archive.add', { body: b });
    const d02 = sim.verify('u-somchai', 'D02');
    expect(d02.job?.result?.indication).toBe('TOTAL-FAILED');
    const d02Job = (d02.create.body as { job_id: string }).job_id;
    expect(add({ document_id: 'D02', verify_job_id: d02Job }).status).toBe(409);
    expect(body<{ code: string }>(add({ document_id: 'D02', verify_job_id: d02Job })).code).toBe('NOT_TOTAL_PASSED');
    expect(add({ document_id: 'D01', verify_job_id: d02Job }).status).toBe(409); // job belongs to another document
    expect(add({ document_id: 'D01', verify_job_id: 'job-9999' }).status).toBe(409);
    expect(add({ document_id: 'D99', verify_job_id: d02Job }).status).toBe(404);
    expect(add({}).status).toBe(400);
    const row = archiveD01(sim);
    expect(row).toMatchObject({ state: 'archived', owner: 'u-somchai', document_id: 'D01', expires_at: '2031-11-12T09:00:00+07:00', retimestamp_count: 0 });
    expect(row).not.toHaveProperty('tsa');
    const v2 = sim.verify('u-somchai', 'D01');
    const dup = sim.by('u-somchai', 'archive.add', { body: { document_id: 'D01', verify_job_id: (v2.create.body as { job_id: string }).job_id } });
    expect(dup.status).toBe(409);
    expect(body<{ code: string }>(dup).code).toBe('INVALID_STATE');
  });

  it('a job that is still running (latency on) cannot be archived', () => {
    const sim = new Sim({ latency: true });
    const id = (sim.call('verify.create', { body: { fixture_id: 'D01' } }).body as { job_id: string }).job_id;
    expect(sim.by('u-somchai', 'archive.add', { body: { document_id: 'D01', verify_job_id: id } }).status).toBe(409);
  });

  it('share: owner only, read access for the target, deleted rows keep only hash + metadata', () => {
    const sim = new Sim();
    const row = archiveD01(sim);
    const share = (who: 'u-somchai' | 'u-wipawan', b: unknown) => sim.by(who, 'archive.share', { params: { id: row.id }, body: b });
    expect(share('u-wipawan', { user_id: 'u-aree' }).status).toBe(403);
    expect(share('u-somchai', { user_id: 'u-nobody' }).status).toBe(404);
    expect(share('u-somchai', { user_id: 'u-somchai' }).status).toBe(400);
    expect(share('u-somchai', {}).status).toBe(400);
    expect(sim.by('u-somchai', 'archive.share', { params: { id: 'arc-9' }, body: { user_id: 'u-wipawan' } }).status).toBe(404);
    expect(share('u-somchai', { user_id: 'u-wipawan' }).status).toBe(200);
    expect(share('u-somchai', { user_id: 'u-wipawan' }).status).toBe(200); // idempotent
    expect(body<ArchiveDto[]>(sim.by('u-wipawan', 'archive.list'))[0]?.shared_with).toEqual(['u-wipawan']);
    expect(body<ArchiveDto[]>(sim.by('u-aree', 'archive.list'))).toEqual([]);
    sim.advance('P5Y');
    const deleted = body<ArchiveDto[]>(sim.by('u-wipawan', 'archive.list'))[0];
    expect(deleted).toMatchObject({ state: 'deleted', deleted_at: '2031-11-12T09:00:00+07:00', sha256: row.sha256 });
    expect(share('u-somchai', { user_id: 'u-aree' }).status).toBe(409);
  });

  it('quota: per user 500 MB and total 10 GB', () => {
    const sim = new Sim();
    const row = archiveD01(sim);
    expect(row.size_bytes).toBe(184320);
    // user quota: fill it up with the first row, then one more document does not fit
    const v2 = sim.verify('u-somchai', 'D05');
    const r = sim.by('u-somchai', 'archive.add', { body: { document_id: 'D05', verify_job_id: (v2.create.body as { job_id: string }).job_id } });
    expect(r.status).toBe(201);
    sim.state.archive[0]!.size_bytes = 500 * 1024 * 1024;
    const v3 = sim.verify('u-somchai', 'D07');
    const over = sim.by('u-somchai', 'archive.add', { body: { document_id: 'D07', verify_job_id: (v3.create.body as { job_id: string }).job_id } });
    expect([over.status, body<{ code: string }>(over).code]).toEqual([409, 'QUOTA_EXCEEDED']);
    // total quota: another user, but the archive as a whole is full
    sim.state.archive[0]!.size_bytes = 10 * 1024 * 1024 * 1024;
    sim.state.archive[0]!.owner = 'u-aree';
    const v4 = sim.verify('u-wipawan', 'D07');
    const total = sim.by('u-wipawan', 'archive.add', { body: { document_id: 'D07', verify_job_id: (v4.create.body as { job_id: string }).job_id } });
    expect([total.status, body<{ code: string }>(total).code]).toEqual([409, 'QUOTA_EXCEEDED']);
  });

  it('30-day notice, then deletion at 5 years with the sha256 in the audit and mail to the owner', () => {
    const sim = new Sim();
    const row = archiveD01(sim);
    for (let i = 0; i < 4; i++) sim.advance('P1Y'); // 2030-11-12
    for (let i = 0; i < 11; i++) sim.advance('P30D'); // 2031-10-08: still before the notice (2031-10-13)
    // two re-timestamps by now (A31), still stored
    expect(body<ArchiveDto[]>(sim.by('u-somchai', 'archive.list'))[0]).toMatchObject({ state: 'retimestamped', retimestamp_count: 2 });
    sim.advance('P30D'); // 2031-11-07: past the 30-day notice, before the deletion at 2031-11-12
    expect(body<ArchiveDto[]>(sim.by('u-somchai', 'archive.list'))[0]?.state).toBe('expiryNotified');
    expect(sim.drafts.some((d) => d.action === 'archive.expiry_notified' && d.target === row.id)).toBe(true);
    sim.advance('P30D');
    const gone = body<ArchiveDto[]>(sim.by('u-somchai', 'archive.list'))[0];
    expect(gone?.state).toBe('deleted');
    const del = sim.drafts.find((d) => d.action === 'archive.deleted');
    expect(del?.details).toMatchObject({ sha256: row.sha256, document_id: 'D01', owner: 'u-somchai' });
    const kinds = body<{ kind: string }[]>(sim.by('u-somchai', 'demo.mailbox')).map((m) => m.kind);
    expect(kinds).toEqual(expect.arrayContaining(['archive_notice', 'archive_deleted']));
  });
});

describe('P5Y advance', () => {
  it('deletes archived documents with an audit sha256, re-stamps twice, counts CRLs and OCSP rotations; fast and compact', () => {
    const sim = new Sim();
    const row = archiveD01(sim);
    const days = 1826; // 2026-11-12 -> 2031-11-12 (one leap day)
    const t0 = performance.now();
    const res = sim.advance('P5Y');
    const ms = performance.now() - t0;
    expect(res.status).toBe(200);
    expect(ms).toBeLessThan(500);
    expect(sim.now).toBe('2031-11-12T09:00:00+07:00');

    // archive deleted, hash in the audit
    const deleted = sim.drafts.filter((d) => d.action === 'archive.deleted');
    expect(deleted).toHaveLength(1);
    expect(deleted[0]?.details.sha256).toBe(row.sha256);
    // two re-timestamps (A31): 2028-09-02 03:00 and 2030-08-03 03:00
    const restamps = sim.drafts.filter((d) => d.action === 'archive.retimestamped');
    expect(restamps.map((d) => d.at)).toEqual(['2028-09-02T03:00:00+07:00', '2030-08-03T03:00:00+07:00']);
    expect(restamps.map((d) => d.details.tsa_serial)).toEqual(['DE:M0:00:00:00:13', 'DE:M0:00:00:00:23']);
    expect(sim.state.archive[0]?.retimestamp_count).toBe(2);
    // CRL number = initial 1 + days elapsed (no immediate issues here); OCSP rotations = floor(days / 14)
    expect(sim.state.crl.number).toBe(1 + days);
    expect(sim.state.ocsp_signer.index).toBe(Math.floor(days / 14));
    expect(sim.state.ocsp_signer.serial).toBe(`DE:M0:0C:SP:${Math.floor(days / 14) + 1}`);
    expect(sim.state.certs.filter((c) => c.state === 'Expired').length).toBeGreaterThanOrEqual(2);
    // the audit stays small
    expect(sim.drafts.length).toBeLessThanOrEqual(500);
    expect(sim.drafts.length).toBeLessThan(60);
  });

  it('immediate CRL issues (keyCompromise, admin) add to the number on top of the daily runs', () => {
    const sim = new Sim();
    sim.admin('certs.revoke', { params: { serial: 'DE:M0:6B:D0:22:02' }, body: { reason: 'keyCompromise' } });
    sim.admin('admin.crlIssue');
    sim.advance('P1Y');
    expect(sim.state.crl.number).toBe(1 + 2 + 365);
  });

  it('request expiry and expiry notices do not block a long advance; certificates of all holders expire', () => {
    const sim = new Sim();
    sim.advance('P1Y');
    const states = body<CertDto[]>(sim.by('a-admin-b', 'certs.list')).filter((c) => c.holder === 'u-somchai').map((c) => `${c.serial}:${c.state}`);
    expect(states).toContain('DE:M0:4F:2A:91:01:Expired');
    expect(body<{ kind: string }[]>(sim.by('u-somchai', 'demo.mailbox')).filter((m) => m.kind === 'expiry_notice')).toHaveLength(3);
  });
});
