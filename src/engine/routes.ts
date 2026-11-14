// Route dispatch: one handler per RouteKey (src/contracts/routes.ts API_ROUTES). Handlers mutate the per-call clone
// in `ctx` and return the response; early exits throw ProblemError (dispatch turns them into the response while still
// returning the mutated state, e.g. failed-login counters).
//
// Order of checks: unknown route -> 404 · token / role -> 401 / 403 · X-Demo-MFA -> 403 · body validation -> 400/422.
import type {
  AdminStatusDto,
  CertDto,
  CloseAccountResponse,
  CrlDto,
  KeygenResponse,
  OcspDto,
  ProgressKey,
  SampleDto,
  UserDirectoryEntry,
  VerifyCreateResponse,
  WorkstationDto,
} from '../contracts/api';
import { API_ROUTES } from '../contracts/routes';
import type { RouteKey } from '../contracts/routes';
import type { EngineRequest, EngineResponse } from '../contracts/engine';
import type { CsrModel, Instant, Persona, RevocationReason, Role } from '../contracts/fixtures';
import { actorOf, createSession, login, logout, mfaStep, requireActor, requireMfa } from './auth';
import { addDuration, isAdvanceDuration, isInstant, isOnOrBefore, normalize } from './clock';
import { asObject, fail, ok, problem, reqString } from './http';
import { registerVerifyPost, assertQueueHasRoom } from './limits';
import { readMailbox } from './mail';
import { addToArchive, shareArchive, toArchiveDto, visibleArchive } from './machines/archive';
import { finalizeCert, toCertDto } from './machines/certificate';
import { approveRequest, createNewRequest, createRenewal, listAppointments, rejectRequest, toRequestDto } from './machines/request';
import { completeOnObservation, createJob, markAttempted, precheckDocument, toJobDto } from './machines/verifyJob';
import { inR14Window, issueCrl, ocspStatusOf, revokeCert } from './revocation';
import { runScheduler } from './scheduler';
import { signCommit, signReview } from './sign';
import { adminStatus, demoStatus, publicStatus } from './status';
import { emit, findCert, findDocument, findJob, findRequest, findArchive, isAdminRole, toUserSummary } from './state';
import type { Ctx, EngineState } from './types';
import { TSA_DRIFT_LIMIT_MS } from '../contracts/api';

type Handler = (ctx: Ctx, req: EngineRequest, actor: Persona | null) => EngineResponse;
/** 'public' = no token needed · 'any' = any signed-in persona · otherwise the allowed roles. */
type Access = 'public' | 'any' | readonly Role[];

const ADMINS: readonly Role[] = ['admin-a', 'admin-b'];
const ADMIN_A: readonly Role[] = ['admin-a'];
const REQUESTERS: readonly Role[] = ['signer', 'new_user', 'user'];

const ACCESS: Record<RouteKey, Access> = {
  'auth.login': 'public',
  'auth.mfa': 'public',
  'auth.me': 'any',
  'auth.logout': 'public',
  'status.public': 'public',
  'verify.create': 'public',
  'verify.get': 'public',
  'certRequests.appointments': 'any',
  'certRequests.create': REQUESTERS,
  'certRequests.list': 'any',
  'certRequests.get': 'any',
  'certRequests.approve': ADMIN_A,
  'certRequests.reject': ADMIN_A,
  'certs.list': 'any',
  'certs.get': 'any',
  'certs.revoke': 'any', // owner (self-revocation) or admin-a; checked in the handler
  'certs.renew': REQUESTERS,
  'certs.finalize': REQUESTERS,
  'pki.cas': 'public',
  'pki.crl': 'public',
  'pki.ocsp': 'public',
  'archive.list': 'any',
  'archive.add': 'any',
  'archive.share': 'any',
  'users.directory': 'any',
  'admin.status': ADMINS,
  'admin.audit': ADMINS,
  'admin.crlIssue': ADMIN_A,
  'admin.closeAccount': ADMIN_A,
  'demo.status': 'public',
  'demo.clock': 'public',
  'demo.faults': 'public',
  'demo.reset': 'public',
  'demo.personas': 'public',
  'demo.persona': 'public',
  'demo.samples': 'public',
  'demo.mailbox': 'any',
  'demo.progress': 'public',
  'demo.workstation': 'any',
  'demo.keygen': 'any',
  'sign.review': 'any',
  'sign.commit': 'any',
};

/** Self-revocation reasons for ordinary users (A11); admin-a may use all six. */
const USER_REVOKE_REASONS: readonly RevocationReason[] = ['keyCompromise', 'affiliationChanged', 'cessationOfOperation'];
const ALL_REVOKE_REASONS: readonly RevocationReason[] = [
  'unspecified',
  'keyCompromise',
  'affiliationChanged',
  'superseded',
  'cessationOfOperation',
  'privilegeWithdrawn',
];
const PROGRESS_KEYS: readonly ProgressKey[] = ['M1.fingerprint_matched', 'M11.chain_verified'];

/** Narrowing helper: policy guarantees an actor, this makes the type say so. */
function must(actor: Persona | null): Persona {
  if (!actor) throw new Error('route policy let an anonymous caller through');
  return actor;
}

const notFound = (what: string): never => fail(404, 'NOT_FOUND', `ไม่พบ${what}`);

// ====================== handlers ======================
const HANDLERS: Record<RouteKey, Handler> = {
  // ---------- auth ----------
  'auth.login': (ctx, req) => login(ctx, req.body),
  'auth.mfa': (ctx, req) => mfaStep(ctx, req.body),
  'auth.me': (_ctx, _req, actor) => ok(toUserSummary(must(actor))),
  'auth.logout': (ctx, req) => logout(ctx, req),

  // ---------- public status ----------
  'status.public': (ctx) => ok(publicStatus(ctx.state)),

  // ---------- verification ----------
  'verify.create': (ctx, req, actor) => {
    const s = ctx.state;
    const rate = registerVerifyPost(ctx); // every POST counts (A30); validation errors still take precedence below
    const b = asObject(req.body);
    const docId = reqString(b, 'fixture_id');
    const doc = findDocument(s, docId);
    if (!doc) return notFound('เอกสารตัวอย่างนี้');
    const pre = precheckDocument(s, doc);
    if (pre) {
      markAttempted(s, doc.id); // M5: a recorded 413/422 counts as "opened"
      return problem(pre.status, pre.code, pre.detail, { ref: pre.ref });
    }
    if (rate.over) {
      return problem(429, 'RATE_LIMITED', 'ส่งคำขอตรวจถี่เกินไป (สูงสุด 10 ครั้งต่อนาที)', { retry_after_s: rate.retry_after_s });
    }
    assertQueueHasRoom(s);
    const job = createJob(ctx, doc, actor);
    const body: VerifyCreateResponse = { job_id: job.job_id, status: 'queued' };
    return ok(body, 202);
  },
  'verify.get': (ctx, req) => {
    const job = findJob(ctx.state, req.params.job_id ?? '');
    if (!job) return notFound('งานตรวจนี้');
    completeOnObservation(ctx, job);
    return ok(toJobDto(job));
  },

  // ---------- certificate requests ----------
  'certRequests.appointments': (ctx) => ok(listAppointments(ctx.state, ctx.now)),
  'certRequests.create': (ctx, req, actor) => {
    const a = must(actor);
    const b = asObject(req.body);
    const rec = createNewRequest(ctx, a, reqString(b, 'csr_pem'), reqString(b, 'appointment_id'));
    return ok(toRequestDto(ctx.state, rec), 201);
  },
  'certRequests.list': (ctx, _req, actor) => {
    const a = must(actor);
    const mine = ctx.state.requests.filter((r) => isAdminRole(a.role) || r.requester === a.id);
    const sorted = [...mine].sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at) || y.id.localeCompare(x.id));
    return ok(sorted.map((r) => toRequestDto(ctx.state, r)));
  },
  'certRequests.get': (ctx, req, actor) => {
    const a = must(actor);
    const r = findRequest(ctx.state, req.params.id ?? '');
    if (!r) return notFound('คำขอนี้');
    if (!isAdminRole(a.role) && r.requester !== a.id) fail(403, 'FORBIDDEN', 'ดูได้เฉพาะคำขอของตัวเอง');
    return ok(toRequestDto(ctx.state, r));
  },
  'certRequests.approve': (ctx, req, actor) => {
    const r = findRequest(ctx.state, req.params.id ?? '');
    if (!r) return notFound('คำขอนี้');
    approveRequest(ctx, r, must(actor), req.body);
    return ok(toRequestDto(ctx.state, r));
  },
  'certRequests.reject': (ctx, req, actor) => {
    const r = findRequest(ctx.state, req.params.id ?? '');
    if (!r) return notFound('คำขอนี้');
    rejectRequest(ctx, r, must(actor), req.body);
    return ok(toRequestDto(ctx.state, r));
  },

  // ---------- certificates ----------
  'certs.list': (ctx, _req, actor) => {
    const a = must(actor);
    const mine = ctx.state.certs.filter((c) => isAdminRole(a.role) || c.holder === a.id);
    const sorted = [...mine].sort((x, y) => Date.parse(y.not_before) - Date.parse(x.not_before) || x.serial.localeCompare(y.serial));
    return ok(sorted.map((c): CertDto => toCertDto(c, ctx.now)));
  },
  'certs.get': (ctx, req, actor) => {
    const a = must(actor);
    const c = findCert(ctx.state, req.params.serial ?? '');
    if (!c) return notFound('ใบรับรองนี้');
    if (!isAdminRole(a.role) && c.holder !== a.id) fail(403, 'FORBIDDEN', 'ดูได้เฉพาะใบรับรองของตัวเอง');
    return ok(toCertDto(c, ctx.now));
  },
  'certs.revoke': (ctx, req, actor) => {
    const a = must(actor);
    const c = findCert(ctx.state, req.params.serial ?? '');
    if (!c) return notFound('ใบรับรองนี้');
    const admin = a.role === 'admin-a';
    if (a.role === 'admin-b') fail(403, 'FORBIDDEN', 'admin-b เป็นผู้ตรวจสอบ ไม่มีสิทธิ์เพิกถอน');
    if (!admin && c.holder !== a.id) fail(403, 'FORBIDDEN', 'เพิกถอนได้เฉพาะใบรับรองของตัวเอง');
    const b = asObject(req.body);
    const reason = reqString(b, 'reason') as RevocationReason;
    if (!ALL_REVOKE_REASONS.includes(reason)) fail(400, 'INVALID_REQUEST', 'reason ไม่ถูกต้อง');
    if (!admin && !USER_REVOKE_REASONS.includes(reason)) fail(403, 'FORBIDDEN', 'เหตุผลนี้ใช้ได้เฉพาะผู้ดูแล');
    let invalidity: Instant | null = null;
    if (b.invalidity_date !== undefined && b.invalidity_date !== null) {
      if (!admin) fail(403, 'FORBIDDEN', 'เฉพาะผู้ดูแลที่ระบุ invalidity_date ได้');
      if (!isInstant(b.invalidity_date)) fail(400, 'INVALID_REQUEST', 'invalidity_date ต้องเป็นเวลา ISO 8601 แบบ +07:00');
      if (!isOnOrBefore(b.invalidity_date, ctx.now)) fail(400, 'INVALID_REQUEST', 'invalidity_date ต้องไม่เป็นอนาคต');
      invalidity = normalize(b.invalidity_date);
    }
    if (c.state !== 'Active' && c.state !== 'Issued') fail(409, 'INVALID_STATE', 'เพิกถอนได้เฉพาะใบรับรองที่ Active หรือ Issued');
    revokeCert(ctx, c, reason, invalidity, a.id);
    return ok(toCertDto(c, ctx.now));
  },
  'certs.renew': (ctx, req, actor) => {
    const a = must(actor);
    const b = asObject(req.body);
    const rec = createRenewal(ctx, a, req.params.serial ?? '', reqString(b, 'csr_pem'));
    return ok(toRequestDto(ctx.state, rec), 201);
  },
  'certs.finalize': (ctx, req, actor) => {
    const a = must(actor);
    const c = findCert(ctx.state, req.params.serial ?? '');
    if (!c || c.holder !== a.id) return notFound('ใบรับรองนี้');
    if (c.state !== 'Issued') fail(409, 'INVALID_STATE', 'ยืนยันติดตั้ง (finalize) ได้เฉพาะใบรับรองที่ออกแล้ว (Issued)');
    finalizeCert(ctx, c, a, ctx.state.requests.find((r) => r.cert_serial === c.serial));
    return ok(toCertDto(c, ctx.now));
  },

  // ---------- PKI ----------
  'pki.cas': (ctx) => {
    const s = ctx.state;
    // The OCSP signer entry follows the rotation (serial and validity change every 14 days).
    return ok(
      s.pki.map((c) =>
        c.id === 'ocsp-signer' ? { ...c, serial: s.ocsp_signer.serial, not_before: s.ocsp_signer.not_before, not_after: s.ocsp_signer.not_after } : c,
      ),
    );
  },
  'pki.crl': (ctx, req) => {
    const s = ctx.state;
    if (req.params.ca !== s.crl.ca) return notFound('CA นี้');
    if (s.faults.crl_down) return problem(503, 'CRL_UNAVAILABLE', 'บริการ CRL ล่ม', { retry_after_s: 60 });
    const dto: CrlDto = { ca: s.crl.ca, number: s.crl.number, this_update: s.crl.this_update, next_update: s.crl.next_update, entries: s.crl.entries };
    return ok(dto);
  },
  'pki.ocsp': (ctx, req) => {
    const s = ctx.state;
    if (s.faults.ocsp_down) return problem(503, 'OCSP_UNAVAILABLE', 'บริการ OCSP ล่ม', { retry_after_s: 60 });
    const serial = req.params.serial ?? '';
    const cert = findCert(s, serial);
    const status = ocspStatusOf(cert);
    // R14: OCSP already says revoked while the published CRL does not list the serial yet.
    if (inR14Window(s, serial) && s.learning.r14_observed_at === null) {
      s.learning.r14_observed_at = ctx.now;
      s.learning.r14_after_job = s.counters.job;
    }
    const revoked = status === 'revoked' && cert;
    const dto: OcspDto = {
      serial,
      status,
      revoked_at: revoked ? cert.revoked_at : null,
      reason: revoked ? cert.revocation_reason : null,
      produced_at: ctx.now,
      responder_serial: s.ocsp_signer.serial,
    };
    return ok(dto);
  },

  // ---------- archive ----------
  'archive.list': (ctx, _req, actor) => ok(visibleArchive(ctx.state, must(actor)).map(toArchiveDto)),
  'archive.add': (ctx, req, actor) => ok(toArchiveDto(addToArchive(ctx, must(actor), req.body)), 201),
  'archive.share': (ctx, req, actor) => {
    const rec = findArchive(ctx.state, req.params.id ?? '');
    if (!rec) return notFound('รายการในคลังนี้');
    shareArchive(ctx, must(actor), rec, req.body);
    return ok(toArchiveDto(rec));
  },
  'users.directory': (ctx, _req, actor) => {
    const a = must(actor);
    const list: UserDirectoryEntry[] = ctx.state.personas
      .filter((p) => !isAdminRole(p.role) && p.id !== a.id)
      .map((p) => ({ id: p.id, display_name: p.display_name }));
    return ok(list);
  },

  // ---------- admin ----------
  'admin.status': (ctx) => ok(adminStatus(ctx.state) satisfies AdminStatusDto),
  'admin.audit': (ctx) => ok(ctx.state.audit),
  'admin.crlIssue': (ctx, _req, actor) => {
    const a = must(actor);
    issueCrl(ctx, ctx.now, 'admin', a.id);
    const crl = ctx.state.crl;
    const dto: CrlDto = { ca: crl.ca, number: crl.number, this_update: crl.this_update, next_update: crl.next_update, entries: crl.entries };
    return ok(dto);
  },
  'admin.closeAccount': (ctx, req, actor) => {
    const a = must(actor);
    const target = ctx.state.personas.find((p) => p.id === req.params.user_id);
    if (!target) return notFound('ผู้ใช้นี้');
    if (isAdminRole(target.role)) fail(400, 'INVALID_REQUEST', 'ปิดบัญชีผู้ดูแลไม่ได้');
    const revoked: string[] = [];
    for (const c of ctx.state.certs) {
      if (c.holder === target.id && (c.state === 'Active' || c.state === 'Issued')) {
        revokeCert(ctx, c, 'affiliationChanged', null, a.id);
        revoked.push(c.serial);
      }
    }
    emit(ctx, a.id, 'account.closed', target.id, { revoked });
    const dto: CloseAccountResponse = { revoked };
    return ok(dto);
  },

  // ---------- demo-only ----------
  'demo.status': (ctx, req) => ok(demoStatus(ctx, actorOf(ctx.state, req))),
  'demo.clock': (ctx, req) => {
    const b = asObject(req.body);
    const advance = b.advance;
    if (!isAdvanceDuration(advance)) fail(400, 'INVALID_REQUEST', 'advance ต้องเป็น PT5M, PT1H, P1D, P30D, P1Y หรือ P5Y');
    const from = ctx.now;
    const to = addDuration(from, advance);
    emit(ctx, 'system', 'clock.advanced', null, { advance, from, to }, from);
    // Forward-only: re-base the clock on the new time, then replay everything scheduled up to it.
    ctx.state.clock = { sim_base: to, wall_base: ctx.wallMs, mode: ctx.state.clock.mode };
    ctx.now = to;
    runScheduler(ctx);
    return ok(demoStatus(ctx, actorOf(ctx.state, req)));
  },
  'demo.faults': (ctx, req) => {
    const s = ctx.state;
    const b = asObject(req.body);
    const changes: Record<string, boolean | number> = {};
    for (const [key, value] of Object.entries(b)) {
      if ((key === 'ocsp_down' || key === 'crl_down' || key === 'queue_full') && typeof value === 'boolean') {
        s.faults[key] = value;
      } else if (key === 'tsa_drift_ms' && typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 3_600_000) {
        s.faults.tsa_drift_ms = value;
      } else {
        fail(400, 'INVALID_REQUEST', `ค่าสวิตช์ไม่ถูกต้อง: ${key}`);
      }
      changes[key] = value;
    }
    emit(ctx, 'system', 'fault.set', null, { ...changes });
    if (s.tsa.stopped_at !== null && s.faults.tsa_drift_ms <= TSA_DRIFT_LIMIT_MS) {
      s.tsa.stopped_at = null;
      emit(ctx, 'system', 'tsa.resumed', null, { drift_ms: s.faults.tsa_drift_ms });
    }
    return ok(demoStatus(ctx, actorOf(s, req)));
  },
  // The runtime resets storage itself and never forwards this route; reaching the engine means a wiring mistake.
  'demo.reset': () => problem(501, 'INVALID_REQUEST', 'demo.reset ถูกจัดการโดย runtime ไม่ใช่ engine'),
  'demo.personas': (ctx) => ok(ctx.state.personas),
  'demo.persona': (ctx, req) => {
    const b = asObject(req.body);
    const persona = ctx.state.personas.find((p) => p.id === b.user_id);
    if (!persona) fail(404, 'NOT_FOUND', 'ไม่พบ persona นี้');
    return ok(createSession(ctx, persona));
  },
  'demo.samples': (ctx) => {
    const samples: SampleDto[] = ctx.state.documents
      .filter((d) => /^D\d\d$/.test(d.id))
      .map((d) => ({ id: d.id, file_name: d.file_name, title_th: d.title_th, scenario_th: d.scenario_th, pages: d.pages, previews: d.previews }));
    return ok(samples);
  },
  // F8: the mailbox is built first, then the persona's mail is marked read (see readMailbox).
  'demo.mailbox': (ctx, _req, actor) => ok(readMailbox(ctx.state, must(actor).id)),
  'demo.progress': (ctx, req) => {
    const b = asObject(req.body);
    const key = reqString(b, 'key') as ProgressKey;
    if (!PROGRESS_KEYS.includes(key)) fail(400, 'INVALID_REQUEST', 'key ไม่ถูกต้อง');
    const l = ctx.state.learning;
    if (!l.progress_keys.some((p) => p.key === key)) l.progress_keys.push({ key, at: ctx.now });
    return ok({ key, recorded: true });
  },
  'demo.workstation': (ctx, _req, actor) => ok(workstationOf(ctx.state, must(actor))),
  'demo.keygen': (ctx, req, actor) => {
    const a = must(actor);
    const b = asObject(req.body);
    const name = reqString(b, 'name').trim();
    const email = reqString(b, 'email').trim();
    if (name.length > 120 || email.length > 120) fail(400, 'INVALID_REQUEST', 'ชื่อหรืออีเมลยาวเกินไป');
    const ws = (ctx.state.workstation[a.id] ??= { keys: 0, csrs: [] });
    ws.keys += 1;
    const csr: CsrModel = {
      subject_cn: name,
      email,
      key_alg: 'ECDSA-P256',
      key_size: 256,
      pop_valid: true,
      extra_extensions: [],
      key_previously_used: false,
    };
    const csr_pem = `-----BEGIN DEMO CSR-----\n${a.id}-key-${ws.keys}\n-----END DEMO CSR-----`;
    ws.csrs.push({ pem: csr_pem, csr });
    const dto: KeygenResponse = { csr_pem, csr };
    return ok(dto);
  },

  // ---------- sign desk (demo-only) ----------
  'sign.review': (ctx, req, actor) => signReview(ctx, must(actor), req.body),
  'sign.commit': (ctx, req, actor) => signCommit(ctx, must(actor), req.body),
};

/** Simulated workstation of a persona: ~/Documents is shared by everyone (A22), ~/.private-ca is per persona. */
function workstationOf(s: EngineState, a: Persona): WorkstationDto {
  const documents = s.documents.map((d) => ({ path: `~/Documents/${d.file_name}`, document_id: d.id, sha256: d.sha256 }));
  const private_ca: WorkstationDto['private_ca'] = [];
  const ws = s.workstation[a.id];
  const certs = s.certs.filter((c) => c.holder === a.id && (c.state === 'Active' || c.state === 'Issued'));
  if (ws) {
    for (let n = 1; n <= ws.keys; n++) {
      private_ca.push({ path: `~/.private-ca/key-${n}.pem`, kind: 'private_key' });
      private_ca.push({ path: `~/.private-ca/key-${n}.csr`, kind: 'csr' });
    }
  } else if (certs.length > 0) {
    private_ca.push({ path: '~/.private-ca/signing.key', kind: 'private_key' });
  }
  for (const c of certs) private_ca.push({ path: `~/.private-ca/${c.serial.replace(/:/g, '-')}.crt`, kind: 'certificate' });
  return { documents, private_ca };
}

/** Entry point used by createEngine().dispatch: access policy, MFA, then the handler. */
export function handleRoute(ctx: Ctx, req: EngineRequest): EngineResponse {
  const handler = (HANDLERS as Partial<Record<string, Handler>>)[req.route];
  const def = (API_ROUTES as Record<string, (typeof API_ROUTES)[RouteKey] | undefined>)[req.route];
  if (!handler || !def) return problem(404, 'NOT_FOUND', `ไม่รู้จัก route ${String(req.route)}`);
  const access = ACCESS[req.route];
  const actor = access === 'public' ? actorOf(ctx.state, req) : requireActor(ctx.state, req, access === 'any' ? undefined : access);
  requireMfa(ctx.state, req, actor, def.mfa);
  return handler(ctx, req, actor);
}

// Re-exported for tests that want to assert the policy table covers every route.
export const ROUTE_ACCESS = ACCESS;
