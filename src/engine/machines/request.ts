// Certificate request state machine and CSR checks (spec 7.4, assumptions A7-A9).
//   draft -> submitted -> awaitingInPerson -> approved | rejected | expired
import type { CertRequestDto, CsrCheckDto, RejectBody } from '../../contracts/api';
import { REJECT_REASON_CODES } from '../../contracts/api';
import type { AppointmentSlot, CsrModel, Instant, Persona } from '../../contracts/fixtures';
import { addDays, addYears, isBefore, isOnOrBefore } from '../clock';
import { MAIL, sendMail } from '../mail';
import { emit, findCert, findPersona, nextId, requestId } from '../state';
import type { Ctx, EngineState, RequestRecord } from '../types';
import { createRequestedCert, issueCert } from './certificate';
import { asObject, fail, reqString } from '../http';

/** The six CSR checks (A7). Computed from the CSR model, never from real cryptography. */
export function csrChecks(csr: CsrModel, requester: Persona): CsrCheckDto[] {
  const checks: [boolean, string][] = [
    [csr.pop_valid, 'พิสูจน์การครอบครองกุญแจ (proof of possession) ถูกต้อง'],
    [csr.subject_cn.trim() === requester.display_name, 'ชื่อใน CSR ตรงกับชื่อที่ยืนยันแล้วของผู้ขอ'],
    [csr.email.trim().toLowerCase() === requester.email.toLowerCase(), 'อีเมลใน CSR ตรงกับบัญชีผู้ขอ'],
    [csr.key_alg !== 'RSA' || csr.key_size >= 3072, 'กุญแจแข็งแรงพอ (ECDSA P-256/P-384 หรือ RSA ตั้งแต่ 3072 บิต)'],
    [csr.extra_extensions.length === 0, 'ไม่มี extension เพิ่มเติมที่ไม่อนุญาต'],
    [!csr.key_previously_used, 'กุญแจนี้ไม่เคยถูกใช้กับใบรับรองอื่น'],
  ];
  return checks.map(([passed, label_th], i) => ({
    id: (i + 1) as CsrCheckDto['id'],
    passed,
    label_th,
    ref: 'L3',
  }));
}

export function csrChecksPass(csr: CsrModel, requester: Persona): boolean {
  return csrChecks(csr, requester).every((c) => c.passed);
}

export function toRequestDto(state: EngineState, r: RequestRecord): CertRequestDto {
  return {
    id: r.id,
    requester: r.requester,
    state: r.state,
    kind: r.kind,
    created_at: r.created_at,
    expires_at: r.expires_at,
    csr: r.csr,
    csr_checks: csrChecks(r.csr, findPersona(state, r.requester)),
    appointment: r.appointment,
  };
}

/** Appointment slots still in the future; synthesises upcoming 10:00 slots so there are always at least 3. */
export function listAppointments(state: EngineState, now: Instant): AppointmentSlot[] {
  const slots = state.appointment_slots.filter((s) => isBefore(now, s.at));
  const day0 = now.slice(0, 10);
  for (let d = 1; slots.length < 3 && d < 60; d++) {
    const at = addDays(`${day0}T10:00:00+07:00`, d);
    const id = `slot-${at.slice(0, 10).replace(/-/g, '')}`;
    if (!slots.some((s) => s.id === id)) {
      slots.push({ id, at, location_th: 'จุดพบตัวสมมติ ห้อง A (DEMO)' });
    }
  }
  return slots.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** Looks up a CSR the persona generated on the simulated workstation (demo.keygen). */
export function csrFromWorkstation(state: EngineState, persona: Persona, pem: string): CsrModel {
  const csr = state.workstation[persona.id]?.csrs.find((c) => c.pem === pem)?.csr;
  if (!csr) fail(400, 'INVALID_REQUEST', 'ไม่พบ CSR นี้บนเครื่องของคุณ (สร้างด้วย pki-tool init ก่อน)');
  return csr;
}

/** New-user request: POST certRequests.create. State goes straight to awaitingInPerson (an appointment is chosen). */
export function createNewRequest(ctx: Ctx, persona: Persona, csrPem: string, appointmentId: string): RequestRecord {
  const s = ctx.state;
  const csr = csrFromWorkstation(s, persona, csrPem);
  const slot = listAppointments(s, ctx.now).find((x) => x.id === appointmentId);
  if (!slot) fail(422, 'INVALID_REQUEST', 'ไม่พบช่วงนัดหมายนี้ หรือเลยเวลาแล้ว');
  if (s.certs.some((c) => c.holder === persona.id && c.state === 'Active')) {
    fail(409, 'INVALID_STATE', 'คุณมีใบรับรองที่ใช้งานอยู่แล้ว ให้ใช้การต่ออายุแทน');
  }
  if (s.requests.some((r) => r.requester === persona.id && (r.state === 'submitted' || r.state === 'awaitingInPerson'))) {
    fail(409, 'INVALID_STATE', 'คุณมีคำขอที่รอดำเนินการอยู่แล้ว');
  }
  const req: RequestRecord = {
    id: requestId(nextId(s, 'request')),
    requester: persona.id,
    state: 'awaitingInPerson',
    kind: 'new',
    created_at: ctx.now,
    expires_at: addDays(ctx.now, s.system.lifetimes.request_days),
    csr,
    appointment: slot,
    cert_serial: null,
    renews: null,
    decided_at: null,
    decision_code: null,
  };
  s.requests.push(req);
  createRequestedCert(ctx, req, persona);
  emit(ctx, persona.id, 'request.created', req.id, { kind: 'new', appointment: slot.id });
  return req;
}

/**
 * Renewal (A9): no in-person step when the last proofing is at most 3 years old and the CSR checks pass.
 * Then the request is auto-approved and the new certificate is Issued (the old one stays Active until finalize).
 */
export function createRenewal(ctx: Ctx, persona: Persona, oldSerial: string, csrPem: string): RequestRecord {
  const s = ctx.state;
  const csr = csrFromWorkstation(s, persona, csrPem);
  const old = findCert(s, oldSerial);
  if (!old || old.holder !== persona.id) fail(404, 'NOT_FOUND', 'ไม่พบใบรับรองนี้');
  if (old.state !== 'Active') fail(409, 'INVALID_STATE', 'ต่ออายุได้เฉพาะใบรับรองที่ใช้งานอยู่ (Active)');
  const pending = s.requests.some(
    (r) =>
      r.renews === old.serial &&
      s.certs.some((c) => c.serial === r.cert_serial && (c.state === 'Issued' || c.state === 'Requested')),
  );
  if (pending) fail(409, 'INVALID_STATE', 'ใบนี้มีคำขอต่ออายุที่ค้างอยู่แล้ว');
  const proofed = s.users[persona.id]?.last_in_person_proofing ?? null;
  const proofingFresh = proofed !== null && isOnOrBefore(ctx.now, addYears(proofed, 3));
  const auto = proofingFresh && csrChecksPass(csr, persona);
  const req: RequestRecord = {
    id: requestId(nextId(s, 'request')),
    requester: persona.id,
    state: auto ? 'approved' : 'awaitingInPerson',
    kind: 'renewal',
    created_at: ctx.now,
    expires_at: addDays(ctx.now, s.system.lifetimes.request_days),
    csr,
    appointment: null,
    cert_serial: null,
    renews: old.serial,
    decided_at: auto ? ctx.now : null,
    decision_code: auto ? 'auto_renewal' : null,
  };
  s.requests.push(req);
  createRequestedCert(ctx, req, persona);
  emit(ctx, persona.id, 'request.created', req.id, { kind: 'renewal', renews: old.serial, auto_approved: auto });
  if (auto) {
    const cert = issueCert(ctx, req, persona);
    const [subject, body] = MAIL.approved(cert.serial);
    sendMail(ctx, persona.id, 'approved', subject, body);
  }
  return req;
}

export function approveRequest(ctx: Ctx, req: RequestRecord, admin: Persona, body: unknown): void {
  const b = asObject(body);
  const list = b.checklist;
  if (!Array.isArray(list) || list.length !== 5 || !list.every((x) => typeof x === 'boolean')) {
    fail(400, 'INVALID_REQUEST', 'checklist ต้องเป็นรายการ true/false 5 ข้อ');
  }
  if (req.state !== 'awaitingInPerson') fail(409, 'INVALID_STATE', 'คำขอนี้ไม่ได้อยู่ในสถานะรอพบตัว');
  const requester = findPersona(ctx.state, req.requester);
  if (!list.every((x) => x === true)) fail(422, 'INVALID_REQUEST', 'ต้องติ๊กรายการตรวจพบตัวครบทั้ง 5 ข้อ');
  if (!csrChecksPass(req.csr, requester)) fail(422, 'INVALID_REQUEST', 'CSR ไม่ผ่านการตรวจ จึงอนุมัติไม่ได้');
  req.state = 'approved';
  req.decided_at = ctx.now;
  req.decision_code = 'approved';
  const rec = ctx.state.users[requester.id];
  if (rec) rec.last_in_person_proofing = ctx.now;
  emit(ctx, admin.id, 'request.approved', req.id, { requester: req.requester });
  const cert = issueCert(ctx, req, requester);
  const [subject, text] = MAIL.approved(cert.serial);
  sendMail(ctx, requester.id, 'approved', subject, text);
}

export function rejectRequest(ctx: Ctx, req: RequestRecord, admin: Persona, body: unknown): void {
  const b = asObject(body);
  const reason = reqString(b, 'reason_code') as RejectBody['reason_code'];
  if (!REJECT_REASON_CODES.includes(reason)) fail(400, 'INVALID_REQUEST', 'reason_code ไม่ถูกต้อง');
  const note = typeof b.note === 'string' ? b.note : '';
  if (req.state !== 'awaitingInPerson' && req.state !== 'submitted') {
    fail(409, 'INVALID_STATE', 'คำขอนี้ไม่ได้อยู่ในสถานะที่ปฏิเสธได้');
  }
  req.state = 'rejected';
  req.decided_at = ctx.now;
  req.decision_code = reason;
  const cert = req.cert_serial ? findCert(ctx.state, req.cert_serial) : undefined;
  if (cert && cert.state === 'Requested') cert.state = 'Rejected';
  emit(ctx, admin.id, 'request.rejected', req.id, { reason_code: reason, note });
  const [subject, text] = MAIL.rejected(req.id, note || reason);
  sendMail(ctx, req.requester, 'rejected', subject, text);
}

/** Scheduler: a request not decided within 14 days expires; its certificate becomes ExpiredRequest. */
export function expireRequest(ctx: Ctx, req: RequestRecord, at: Instant): void {
  req.state = 'expired';
  req.decided_at = at;
  req.decision_code = 'expired';
  const cert = req.cert_serial ? findCert(ctx.state, req.cert_serial) : undefined;
  if (cert && cert.state === 'Requested') cert.state = 'ExpiredRequest';
  emit(ctx, 'system', 'request.expired', req.id, { requester: req.requester }, at);
}
