// Simulated mailbox (assumption A27): approval, rejection, certificate expiry notices, archive notices.
import type { MailDto } from '../contracts/api';
import type { MailFixture, PersonaId } from '../contracts/fixtures';
import { mailId, nextId } from './state';
import type { Ctx, EngineState, MailRecord } from './types';

type MailKind = MailFixture['kind'];

/** Appends a message to the recipient's mailbox. `at` defaults to the current simulated time. */
export function sendMail(ctx: Ctx, to: PersonaId, kind: MailKind, subject_th: string, body_th: string, at: string = ctx.now): MailRecord {
  const m: MailRecord = { id: mailId(nextId(ctx.state, 'mail')), to, at, kind, subject_th, body_th, read: false };
  ctx.state.mail.push(m);
  return m;
}

export const MAIL = {
  approved: (serial: string): [string, string] => [
    'ใบรับรองของคุณได้รับอนุมัติแล้ว (โหมดสาธิต)',
    `คำขอใบรับรองของคุณผ่านการอนุมัติแล้ว ใบรับรองหมายเลข ${serial} พร้อมให้ยืนยันการติดตั้ง (finalize) ที่หน้า "ใบรับรองของฉัน" (ข้อความจำลอง)`,
  ],
  rejected: (requestId: string, reason: string): [string, string] => [
    'คำขอใบรับรองของคุณถูกปฏิเสธ (โหมดสาธิต)',
    `คำขอ ${requestId} ถูกปฏิเสธ เหตุผล: ${reason} (ข้อความจำลอง)`,
  ],
  expiry: (serial: string, days: number, notAfter: string): [string, string] => [
    `ใบรับรองของคุณจะหมดอายุใน ${days} วัน (โหมดสาธิต)`,
    `ใบรับรองหมายเลข ${serial} จะหมดอายุ ${notAfter} กรุณาต่ออายุที่หน้า "ใบรับรองของฉัน" (ข้อความจำลอง)`,
  ],
  archiveNotice: (fileName: string, expiresAt: string): [string, string] => [
    'เอกสารในคลังจะครบ 5 ปีใน 30 วัน (โหมดสาธิต)',
    `เอกสาร ${fileName} จะถูกลบออกจากคลังเมื่อ ${expiresAt} ระบบจะเก็บเฉพาะค่า SHA-256 และเมตาดาทา (ข้อความจำลอง)`,
  ],
  archiveDeleted: (fileName: string, sha256: string): [string, string] => [
    'เอกสารในคลังถูกลบแล้ว (โหมดสาธิต)',
    `เอกสาร ${fileName} ครบ 5 ปีและถูกลบแล้ว เหลือเฉพาะ SHA-256 ${sha256} และเมตาดาทา (ข้อความจำลอง)`,
  ],
};

export function unreadCount(state: EngineState, persona: PersonaId): number {
  return state.mail.filter((m) => m.to === persona && !m.read).length;
}

/**
 * GET demo.mailbox (F8 contract): build the response first, then mark the persona's mail read, so this response still
 * shows `read: false` for the messages that were unread before the call. Newest first.
 */
export function readMailbox(state: EngineState, persona: PersonaId): MailDto[] {
  const mine = state.mail.filter((m) => m.to === persona);
  const dto: MailDto[] = mine
    .map((m) => ({ id: m.id, to: m.to, at: m.at, kind: m.kind, subject_th: m.subject_th, body_th: m.body_th, read: m.read }))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id));
  for (const m of mine) m.read = true;
  return dto;
}
