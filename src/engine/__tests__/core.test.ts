// Core engine behaviour: determinism, purity, clock modes, auth, access control, limits, services, mailbox.
import { describe, expect, it } from 'vitest';
import { SERVICE_IDS } from '../../contracts/api';
import type { AdminStatusDto, ServiceStatusDto } from '../../contracts/api';
import { fixtures } from '../../fixtures';
import { addDuration, addYears, atHour, dailyTriggers, isAdvanceDuration, isInstant, normalize, toMs, fromMs } from '../clock';
import { sha256Hex, fakeDocumentHash } from '../hash';
import { createEngine } from '../index';
import { ROUTE_ACCESS } from '../routes';
import { API_ROUTES } from '../../contracts/routes';
import type { EngineApi, EngineRequest } from '../../contracts/engine';
import { Sim, body, deepFreeze, fakeResolve } from './helpers';

describe('determinism and purity', () => {
  it('same input twice gives deep-equal results, and a deep-frozen input is not mutated', () => {
    const sim = new Sim();
    const token = sim.as('u-guest');
    deepFreeze(sim.state);
    const clock = sim.engine.clockFrom(sim.state, sim.wall);
    const reqs: EngineRequest[] = [
      { route: 'demo.clock', token: null, params: {}, query: {}, body: { advance: 'P30D' }, mfa: null },
      { route: 'verify.create', token, params: {}, query: {}, body: { fixture_id: 'D01' }, mfa: null },
      { route: 'auth.login', token: null, params: {}, query: {}, body: { email: 'somchai@lab.korakod.dev', password: 'x' }, mfa: null },
      { route: 'demo.mailbox', token: sim.tokenOf('u-aree'), params: {}, query: {}, body: null, mfa: null },
    ];
    for (const req of reqs) {
      const a = sim.engine.dispatch(sim.state, req, clock);
      const b = sim.engine.dispatch(sim.state, req, clock);
      expect(a).toEqual(b);
      expect(a.state).not.toBe(sim.state);
    }
    const t1 = sim.engine.tick(sim.state, { now: addDuration(clock.now, 'P1Y'), wallMs: clock.wallMs });
    const t2 = sim.engine.tick(sim.state, { now: addDuration(clock.now, 'P1Y'), wallMs: clock.wallMs });
    expect(t1).toEqual(t2);
  });

  it('createInitialState is deterministic and JSON-serialisable', () => {
    const e = createEngine({ resolve: fakeResolve });
    // Compile-time check: the concrete engine is usable wherever the frozen contract type EngineApi is expected.
    const asContract: EngineApi = e;
    expect(asContract.STATE_VERSION).toBe(e.STATE_VERSION);
    const opts = { latency: false, clock_mode: 'frozen' as const };
    const a = e.createInitialState(fixtures, opts, 1);
    const b = e.createInitialState(fixtures, opts, 1);
    expect(a).toEqual(b);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(a.version).toBe(e.STATE_VERSION);
  });

  it('a failing resolver turns the job into status error instead of crashing', () => {
    const e = createEngine({
      resolve: () => {
        throw new Error('boom');
      },
    });
    const s0 = e.createInitialState(fixtures, { latency: false, clock_mode: 'frozen' }, 0);
    const clock = e.clockFrom(s0, 0);
    const r = e.dispatch(s0, { route: 'verify.create', token: null, params: {}, query: {}, body: { fixture_id: 'D01' }, mfa: null }, clock);
    const jobId = (r.response.body as { job_id: string }).job_id;
    const g = e.dispatch(r.state, { route: 'verify.get', token: null, params: { job_id: jobId }, query: {}, body: null, mfa: null }, clock);
    const dto = g.response.body as { status: string; error: { code: string } };
    expect(dto.status).toBe('error');
    expect(dto.error.code).toBe('INTERNAL_ERROR');
  });

  it('the default resolver is the resolver module (stub throws until B2 lands) and errors become job errors', () => {
    const e = createEngine();
    const s0 = e.createInitialState(fixtures, { latency: false, clock_mode: 'frozen' }, 0);
    const clock = e.clockFrom(s0, 0);
    const r = e.dispatch(s0, { route: 'verify.create', token: null, params: {}, query: {}, body: { fixture_id: 'D01' }, mfa: null }, clock);
    expect(r.response.status).toBe(202);
  });

  it('SHA-256 helper matches known vectors and fake document hashes have the fixture format', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
    expect(fakeDocumentHash('x', 'y')).toMatch(/^de00[0-9a-f]{60}$/);
    expect(fakeDocumentHash('x', 'y')).toBe(fakeDocumentHash('x', 'y'));
    expect(fakeDocumentHash('x', 'y')).not.toBe(fakeDocumentHash('x', 'z'));
  });
});

describe('simulated clock', () => {
  it('frozen mode ignores wall time; only demo.clock moves it', () => {
    const sim = new Sim({ clock_mode: 'frozen' });
    const t0 = sim.now;
    expect(t0).toBe('2026-11-12T09:00:00+07:00');
    sim.wall += 10 * 3600_000;
    expect(sim.now).toBe(t0);
    sim.advance('PT1H');
    expect(sim.now).toBe('2026-11-12T10:00:00+07:00');
  });

  it('running mode follows wall time 1:1 and is forward-only when the wall clock jumps back', () => {
    const sim = new Sim({ clock_mode: 'running' });
    expect(sim.now).toBe('2026-11-12T09:00:00+07:00');
    sim.wall += 90_000;
    expect(sim.now).toBe('2026-11-12T09:01:30+07:00');
    sim.call('demo.status'); // processes a tick: last_tick = 09:01:30
    sim.wall -= 3_600_000; // wall clock jumps back an hour
    expect(sim.now).toBe('2026-11-12T09:01:30+07:00');
    sim.advance('PT5M');
    expect(sim.now).toBe('2026-11-12T09:06:30+07:00');
  });

  it('only the six advance durations are accepted by the route', () => {
    const sim = new Sim();
    for (const d of ['PT5M', 'PT1H', 'P1D', 'P30D', 'P1Y', 'P5Y']) expect(isAdvanceDuration(d)).toBe(true);
    for (const bad of ['P2D', '-P1D', 'PT0S', '', 'P1M']) {
      expect(isAdvanceDuration(bad)).toBe(false);
      expect(sim.call('demo.clock', { body: { advance: bad } }).status).toBe(400);
    }
    expect(sim.call('demo.clock', { body: null }).status).toBe(400);
    expect(sim.now).toBe('2026-11-12T09:00:00+07:00');
  });

  it('duration and calendar arithmetic', () => {
    const t = '2026-11-12T09:00:00+07:00';
    expect(addDuration(t, 'P1D')).toBe('2026-11-13T09:00:00+07:00');
    expect(addDuration(t, 'PT5M')).toBe('2026-11-12T09:05:00+07:00');
    expect(addDuration(t, 'P1Y')).toBe('2027-11-12T09:00:00+07:00');
    expect(addDuration(t, 'P5Y')).toBe('2031-11-12T09:00:00+07:00');
    expect(addDuration(t, 'P1DT2H30M10S')).toBe('2026-11-13T11:30:10+07:00');
    expect(addYears('2028-02-29T09:00:00+07:00', 1)).toBe('2029-02-28T09:00:00+07:00');
    expect(() => addDuration(t, 'P')).toThrow();
    expect(() => addDuration(t, 'PT')).toThrow();
    expect(() => addDuration(t, '-P1D')).toThrow();
    expect(atHour('2026-11-12T23:59:59+07:00', 6)).toBe('2026-11-12T06:00:00+07:00');
    expect(dailyTriggers('2026-11-12T09:00:00+07:00', '2026-11-14T06:00:00+07:00', 6).map(fromMs)).toEqual([
      '2026-11-13T06:00:00+07:00',
      '2026-11-14T06:00:00+07:00',
    ]);
    expect(dailyTriggers('2026-11-12T06:00:00+07:00', '2026-11-12T08:00:00+07:00', 6)).toEqual([]);
    expect(normalize('2026-11-12T09:00:00.789+07:00')).toBe(t);
    expect(isInstant(t)).toBe(true);
    expect(isInstant('2026-11-12T09:00:00Z')).toBe(false);
    expect(isInstant('2026-13-45T09:00:00+07:00')).toBe(false);
    expect(isInstant(42)).toBe(false);
    expect(() => toMs('nope')).toThrow();
  });
});

describe('auth', () => {
  const login = (sim: Sim, email = 'somchai@lab.korakod.dev', password = 'demo-password') =>
    sim.call('auth.login', { body: { email, password } });

  it('two-step login: password -> ticket -> MFA 246810 -> token usable on auth.me; logout ends the session', () => {
    const sim = new Sim();
    const r1 = login(sim);
    expect(r1.status).toBe(200);
    const ticket = body<{ mfa_ticket: string }>(r1).mfa_ticket;
    expect(sim.call('auth.mfa', { body: { mfa_ticket: ticket, code: '000000' } }).status).toBe(401);
    const r2 = sim.call('auth.mfa', { body: { mfa_ticket: ticket, code: '246810' } });
    expect(r2.status).toBe(200);
    const { token, user } = body<{ token: string; user: { id: string; role: string } }>(r2);
    expect(user).toMatchObject({ id: 'u-somchai', role: 'signer' });
    expect(sim.call('auth.me', { token }).status).toBe(200);
    // single-use ticket
    expect(sim.call('auth.mfa', { body: { mfa_ticket: ticket, code: '246810' } }).status).toBe(401);
    expect(sim.call('auth.logout', { token }).status).toBe(204);
    expect(sim.call('auth.me', { token }).status).toBe(401);
    expect(sim.call('auth.logout', {}).status).toBe(204);
  });

  it('rejects unknown accounts, wrong passwords and malformed bodies', () => {
    const sim = new Sim();
    expect(login(sim, 'nobody@lab.korakod.dev').status).toBe(401);
    expect(login(sim, 'somchai@lab.korakod.dev', 'wrong').status).toBe(401);
    expect(sim.call('auth.login', { body: { password: 'x' } }).status).toBe(400);
    expect(sim.call('auth.login', { body: 'text' }).status).toBe(400);
    expect(sim.call('auth.mfa', { body: { mfa_ticket: 'mfa-99', code: '246810' } }).status).toBe(401);
  });

  it('locks the account after 3 failed attempts for 5 simulated minutes, then unlocks', () => {
    const sim = new Sim();
    expect(login(sim, undefined, 'bad1').status).toBe(401);
    expect(login(sim, undefined, 'bad2').status).toBe(401);
    const third = login(sim, undefined, 'bad3');
    expect(third.status).toBe(423);
    expect(body<{ code: string; locked_until: string }>(third)).toMatchObject({ code: 'ACCOUNT_LOCKED', locked_until: '2026-11-12T09:05:00+07:00' });
    // locked: even the right password is refused, and the response carries Retry-After
    const locked = login(sim);
    expect(locked.status).toBe(423);
    expect(locked.headers?.['Retry-After']).toBeDefined();
    // other accounts are unaffected
    expect(login(sim, 'wipawan@lab.korakod.dev').status).toBe(200);
    sim.advance('PT5M'); // exactly at locked_until the lock is over
    expect(login(sim).status).toBe(200);
    expect(sim.actions().filter((a) => a === 'auth.locked')).toHaveLength(1);
  });

  it('401 without a token, 403 for the wrong role, MFA header required for admin mutations', () => {
    const sim = new Sim();
    expect(sim.call('admin.status').status).toBe(401);
    expect(sim.call('admin.status', { token: 'bogus' }).status).toBe(401);
    expect(sim.by('u-somchai', 'admin.status').status).toBe(403);
    expect(sim.by('a-admin-b', 'admin.status').status).toBe(200);
    expect(sim.by('a-admin-b', 'admin.audit').status).toBe(200);
    // admin-b is a read-only auditor
    expect(sim.by('a-admin-b', 'admin.crlIssue', { mfa: '246810' }).status).toBe(403);
    // admin-a without / with a wrong MFA code
    const noMfa = sim.by('a-admin-a', 'admin.crlIssue');
    expect(noMfa.status).toBe(403);
    expect(body<{ code: string }>(noMfa).code).toBe('MFA_REQUIRED');
    const badMfa = sim.by('a-admin-a', 'admin.crlIssue', { mfa: '111111' });
    expect(body<{ code: string }>(badMfa).code).toBe('MFA_INVALID');
    expect(sim.by('a-admin-a', 'admin.crlIssue', { mfa: '246810' }).status).toBe(200);
  });

  it('has an access policy for every API route and rejects unknown routes', () => {
    expect(Object.keys(ROUTE_ACCESS).sort()).toEqual(Object.keys(API_ROUTES).sort());
    const sim = new Sim();
    expect(sim.call('nope.nothing' as never).status).toBe(404);
    expect(sim.call('demo.reset').status).toBe(501);
  });
});

describe('verify limits', () => {
  it('429 on the 11th POST in a rolling simulated minute, with Retry-After; recovers after PT5M', () => {
    const sim = new Sim();
    for (let i = 0; i < 10; i++) expect(sim.call('verify.create', { body: { fixture_id: 'D01' } }).status).toBe(202);
    const r = sim.call('verify.create', { body: { fixture_id: 'D01' } });
    expect(r.status).toBe(429);
    expect(body<{ code: string; retry_after_s: number }>(r)).toMatchObject({ code: 'RATE_LIMITED', retry_after_s: 60 });
    expect(r.headers?.['Retry-After']).toBe('60');
    sim.advance('PT5M');
    expect(sim.call('verify.create', { body: { fixture_id: 'D01' } }).status).toBe(202);
  });

  it('the M5 journey: D01-D09 jobs, D10 422, D11 413, then the next request is 429 (validation errors win over 429)', () => {
    const sim = new Sim();
    for (let i = 1; i <= 9; i++) expect(sim.verify('u-guest', `D0${i}`).create.status).toBe(202);
    expect(sim.verify('u-guest', 'D10').create.status).toBe(422);
    expect(sim.verify('u-guest', 'D11').create.status).toBe(413);
    expect(sim.verify('u-guest', 'D01').create.status).toBe(429);
    sim.advance('PT5M');
    expect(sim.verify('u-guest', 'D01').create.status).toBe(202);
  });

  it('rejects unknown fixtures (404), bad bodies (400), D10 (422 ENCRYPTED_PDF), D11 (413), D12 (422 NOT_SIGNED)', () => {
    const sim = new Sim();
    expect(sim.call('verify.create', { body: { fixture_id: 'D99' } }).status).toBe(404);
    expect(sim.call('verify.create', { body: {} }).status).toBe(400);
    expect(body<{ code: string }>(sim.call('verify.create', { body: { fixture_id: 'D10' } })).code).toBe('ENCRYPTED_PDF');
    expect(body<{ code: string }>(sim.call('verify.create', { body: { fixture_id: 'D11' } })).code).toBe('PDF_TOO_LARGE');
    expect(body<{ code: string }>(sim.call('verify.create', { body: { fixture_id: 'D12' } })).code).toBe('NOT_SIGNED');
    expect(sim.call('verify.get', { params: { job_id: 'job-9999' } }).status).toBe(404);
  });

  it('503 on the 21st active job and when the queue_full fault is on', () => {
    const sim = new Sim({ latency: true });
    // The 10/min rate limit makes 20 simultaneous jobs unreachable through the API, so seed 20 queued jobs directly.
    const template = {
      document_id: 'D01' as const,
      status: 'queued' as const,
      created_at: sim.now,
      running_at: sim.now,
      ready_at: '2026-11-12T10:00:00+07:00',
      requested_by: null,
      result: null,
      error: null,
    };
    sim.state = {
      ...sim.state,
      jobs: Array.from({ length: 20 }, (_, i) => ({ ...template, job_id: `job-seed-${i}`, n: 100 + i })),
    };
    const full = sim.call('verify.create', { body: { fixture_id: 'D01' } });
    expect(full.status).toBe(503);
    expect(body<{ code: string }>(full).code).toBe('QUEUE_FULL');
    expect(full.headers?.['Retry-After']).toBeDefined();

    const sim2 = new Sim();
    sim2.setFaults({ queue_full: true });
    const r = sim2.call('verify.create', { body: { fixture_id: 'D01' } });
    expect(r.status).toBe(503);
    expect(r.headers?.['Retry-After']).toBe('30');
    sim2.setFaults({ queue_full: false });
    expect(sim2.call('verify.create', { body: { fixture_id: 'D01' } }).status).toBe(202);
  });

  it('latency on: queued -> running -> done by simulated time (1-3 s); latency off: done on first observation', () => {
    const slow = new Sim({ latency: true });
    const id = body<{ job_id: string }>(slow.call('verify.create', { body: { fixture_id: 'D01' } })).job_id;
    const status = (): string => body<{ status: string }>(slow.call('verify.get', { params: { job_id: id } })).status;
    expect(status()).toBe('queued');
    slow.advance('PT5M');
    expect(status()).toBe('done');
    // job 2: latency 3 s -> running after 1 s
    const id2 = body<{ job_id: string }>(slow.call('verify.create', { body: { fixture_id: 'D01' } })).job_id;
    expect(id2).toBe('job-0002');
    const fast = new Sim({ latency: false });
    const r = fast.verify('u-guest', 'D01');
    expect(r.job?.status).toBe('done');
    expect(r.job?.result?.indication).toBe('TOTAL-PASSED');
  });

  it('latency on passes through the running state when the clock is running', () => {
    const sim = new Sim({ latency: true, clock_mode: 'running' });
    // job 1 -> latency 2 s
    const id = body<{ job_id: string }>(sim.call('verify.create', { body: { fixture_id: 'D01' } })).job_id;
    const status = (): string => body<{ status: string }>(sim.call('verify.get', { params: { job_id: id } })).status;
    sim.wall += 1000;
    expect(status()).toBe('running');
    sim.wall += 1500;
    expect(status()).toBe('done');
  });
});

describe('status, services and demo views', () => {
  it('public and admin status use the central SERVICE_IDS, in order', () => {
    const sim = new Sim();
    const pub = body<ServiceStatusDto>(sim.call('status.public'));
    expect(pub.services.map((s) => s.id)).toEqual([...SERVICE_IDS]);
    expect(pub.services.every((s) => s.state === 'up')).toBe(true);
    const adm = body<AdminStatusDto>(sim.by('a-admin-b', 'admin.status'));
    expect(adm.services.map((s) => s.id)).toEqual([...SERVICE_IDS]);
    expect(adm.tsa).toEqual({ offset_ms: 0, limit_ms: 1000, state: 'ok' });
    expect(adm.queue).toEqual({ active: 0, max: 20 });
    expect(adm.not_simulated.length).toBeGreaterThan(0);
  });

  it('fault switches show up in the service cards', () => {
    const sim = new Sim();
    sim.setFaults({ ocsp_down: true, crl_down: true, tsa_drift_ms: 1400, queue_full: true });
    const adm = body<AdminStatusDto>(sim.by('a-admin-b', 'admin.status'));
    const st = (id: string): string => adm.services.find((s) => s.id === id)?.state ?? '?';
    expect([st('ocsp'), st('crl'), st('tsa'), st('verify-queue'), st('ca')]).toEqual(['down', 'down', 'down', 'degraded', 'up']);
    expect(adm.tsa).toEqual({ offset_ms: 1400, limit_ms: 1000, state: 'stopped' });
    sim.setFaults({ tsa_drift_ms: 500 });
    expect(body<AdminStatusDto>(sim.by('a-admin-b', 'admin.status')).services.find((s) => s.id === 'tsa')?.state).toBe('degraded');
  });

  it('demo.faults validates input and demo.status reports the actor, clock mode and tsa offset', () => {
    const sim = new Sim();
    expect(sim.setFaults({ ocsp_down: 'yes' }).status).toBe(400);
    expect(sim.setFaults({ tsa_drift_ms: -1 }).status).toBe(400);
    expect(sim.setFaults({ bogus: true }).status).toBe(400);
    const res = sim.setFaults({ tsa_drift_ms: 1400 });
    expect(body<{ tsa_offset_ms: number; clock_mode: string; actor: unknown }>(res)).toMatchObject({ tsa_offset_ms: 1400, clock_mode: 'frozen', actor: null });
    const status = body<{ actor: { id: string } | null; missions: unknown[] }>(sim.by('u-somchai', 'demo.status'));
    expect(status.actor?.id).toBe('u-somchai');
    expect(status.missions).toHaveLength(11);
  });

  it('demo.personas, demo.samples (12 originals), users.directory (non-admins except self), pki.cas follow the rotation', () => {
    const sim = new Sim();
    expect(body<unknown[]>(sim.call('demo.personas'))).toHaveLength(8);
    const samples = body<{ id: string }[]>(sim.call('demo.samples'));
    expect(samples.map((s) => s.id)).toEqual(['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D10', 'D11', 'D12']);
    const dir = body<{ id: string }[]>(sim.by('u-somchai', 'users.directory'));
    expect(dir.map((d) => d.id)).toEqual(['u-wipawan', 'u-nattapon', 'u-aree', 'u-manop', 'u-guest']);
    expect(sim.call('demo.persona', { body: { user_id: 'u-nobody' } }).status).toBe(404);
    const cas = (): { id: string; serial: string }[] => body<{ id: string; serial: string }[]>(sim.call('pki.cas'));
    expect(cas().find((c) => c.id === 'ocsp-signer')?.serial).toBe('DE:M0:0C:SP:01');
    sim.advanceDays(14);
    expect(cas().find((c) => c.id === 'ocsp-signer')?.serial).toBe('DE:M0:0C:SP:02');
  });

  it('demo.progress accepts only the two known keys', () => {
    const sim = new Sim();
    expect(sim.call('demo.progress', { body: { key: 'M5.whatever' } }).status).toBe(400);
    expect(sim.call('demo.progress', { body: { key: 'M1.fingerprint_matched' } }).status).toBe(200);
    expect(sim.call('demo.progress', { body: { key: 'M1.fingerprint_matched' } }).status).toBe(200);
    expect(sim.state.learning.progress_keys).toHaveLength(1);
  });
});

describe('mailbox (F8)', () => {
  it('GET demo.mailbox returns unread flags as they were, then marks the persona mail read', () => {
    const sim = new Sim();
    const unread = (): number => body<{ unread_mail: number }>(sim.by('u-aree', 'demo.status')).unread_mail;
    expect(unread()).toBe(1);
    const first = body<{ id: string; read: boolean; kind: string }[]>(sim.by('u-aree', 'demo.mailbox'));
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ kind: 'expiry_notice', read: false });
    expect(unread()).toBe(0);
    expect(body<{ read: boolean }[]>(sim.by('u-aree', 'demo.mailbox'))[0]?.read).toBe(true);
    // other personas keep their own unread mail
    expect(body<{ unread_mail: number }>(sim.by('u-nattapon', 'demo.status')).unread_mail).toBe(1);
    expect(sim.call('demo.mailbox').status).toBe(401);
  });
});
