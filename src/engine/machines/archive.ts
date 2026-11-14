// Archive state machine (spec 7.4, assumptions A16, A31):
//   archived -> (retimestamped)* -> expiryNotified (30 days before 5 years) -> deleted (SHA-256 + metadata only)
import type { ArchiveAddBody, ArchiveDto } from '../../contracts/api';
import type { CaFixture, FixtureDocument, Instant, Persona } from '../../contracts/fixtures';
import { MS_DAY, addDays, addYears, isOnOrBefore, toMs } from '../clock';
import { asObject, fail, reqString } from '../http';
import { assertArchiveQuota } from '../limits';
import { MAIL, sendMail } from '../mail';
import { activeTsa, archiveId, emit, findArchive, findCa, findDocument, findJob, nextId, usageEnd } from '../state';
import type { ArchiveRecord, Ctx, EngineState } from '../types';

/** CA id of the TSA behind the newest timestamp of a document; falls back to the TSA active at `now`. */
function newestTsaId(state: EngineState, doc: FixtureDocument, now: Instant): CaFixture['id'] {
  const stamps = [...doc.doc_timestamps, ...doc.signatures.flatMap((s) => (s.signature_timestamp ? [s.signature_timestamp] : []))];
  stamps.sort((a, b) => toMs(b.time) - toMs(a.time));
  const bySerial = stamps[0] ? state.pki.find((c) => c.serial === stamps[0]?.tsa_serial) : undefined;
  return bySerial?.id ?? activeTsa(state, now)?.id ?? 'tsa-2026';
}

export function toArchiveDto(a: ArchiveRecord): ArchiveDto {
  const { tsa: _tsa, ...dto } = a;
  return dto;
}

/** POST archive.add: requires a finished TOTAL-PASSED job for that very document (A16). */
export function addToArchive(ctx: Ctx, actor: Persona, body: unknown): ArchiveRecord {
  const s = ctx.state;
  const b = asObject(body) as Partial<ArchiveAddBody>;
  const documentId = reqString(b as Record<string, unknown>, 'document_id');
  const jobRef = reqString(b as Record<string, unknown>, 'verify_job_id');
  const doc = findDocument(s, documentId);
  if (!doc) fail(404, 'NOT_FOUND', 'ไม่พบเอกสารนี้');
  const job = findJob(s, jobRef);
  const passed = job?.document_id === doc.id && job.status === 'done' && job.result?.indication === 'TOTAL-PASSED';
  if (!passed) fail(409, 'NOT_TOTAL_PASSED', 'เก็บเข้าคลังได้เฉพาะเอกสารที่ผลตรวจเป็น TOTAL-PASSED', { ref: 'V12' });
  if (s.archive.some((a) => a.owner === actor.id && a.document_id === doc.id && a.state !== 'deleted')) {
    fail(409, 'INVALID_STATE', 'เอกสารนี้อยู่ในคลังของคุณแล้ว');
  }
  assertArchiveQuota(s, actor.id, doc.size_bytes);
  const rec: ArchiveRecord = {
    id: archiveId(nextId(s, 'archive')),
    document_id: doc.id,
    file_name: doc.file_name,
    owner: actor.id,
    state: 'archived',
    added_at: ctx.now,
    expires_at: addYears(ctx.now, s.system.lifetimes.archive_years),
    size_bytes: doc.size_bytes,
    sha256: doc.sha256,
    retimestamp_count: 0,
    shared_with: [],
    deleted_at: null,
    tsa: newestTsaId(s, doc, ctx.now),
  };
  s.archive.push(rec);
  emit(ctx, actor.id, 'archive.added', rec.id, { document_id: doc.id, sha256: doc.sha256 });
  return rec;
}

export function shareArchive(ctx: Ctx, actor: Persona, rec: ArchiveRecord, body: unknown): void {
  const b = asObject(body);
  const target = reqString(b, 'user_id');
  if (rec.owner !== actor.id) fail(403, 'FORBIDDEN', 'แชร์ได้เฉพาะเอกสารของตัวเอง');
  if (rec.state === 'deleted') fail(409, 'INVALID_STATE', 'เอกสารนี้ถูกลบจากคลังแล้ว');
  const persona = ctx.state.personas.find((p) => p.id === target);
  if (!persona) fail(404, 'NOT_FOUND', 'ไม่พบผู้ใช้ปลายทาง');
  if (persona.id === actor.id) fail(400, 'INVALID_REQUEST', 'ไม่ต้องแชร์ให้ตัวเอง');
  if (!rec.shared_with.includes(persona.id)) rec.shared_with.push(persona.id);
  emit(ctx, actor.id, 'archive.shared', rec.id, { with: persona.id });
}

export function visibleArchive(state: EngineState, actor: Persona): ArchiveRecord[] {
  return state.archive.filter((a) => a.owner === actor.id || a.shared_with.includes(actor.id));
}

/** Scheduler: 30 days before the 5-year end the owner is notified. */
export function notifyExpiry(ctx: Ctx, rec: ArchiveRecord, at: Instant): void {
  rec.state = 'expiryNotified';
  const [subject, text] = MAIL.archiveNotice(rec.file_name, rec.expires_at);
  sendMail(ctx, rec.owner, 'archive_notice', subject, text, at);
  emit(ctx, 'system', 'archive.expiry_notified', rec.id, { expires_at: rec.expires_at }, at);
}

/** Scheduler: at 5 years the document is deleted; only the SHA-256 and metadata remain (also written to the audit). */
export function deleteArchived(ctx: Ctx, rec: ArchiveRecord, at: Instant): void {
  rec.state = 'deleted';
  rec.deleted_at = at;
  ctx.state.learning.archive_deleted_hashes.push(rec.sha256);
  const [subject, text] = MAIL.archiveDeleted(rec.file_name, rec.sha256);
  sendMail(ctx, rec.owner, 'archive_deleted', subject, text, at);
  emit(
    ctx,
    'system',
    'archive.deleted',
    rec.id,
    {
      sha256: rec.sha256,
      document_id: rec.document_id,
      file_name: rec.file_name,
      owner: rec.owner,
      size_bytes: rec.size_bytes,
      retimestamp_count: rec.retimestamp_count,
    },
    at,
  );
}

/**
 * Daily 03:00 job, rule A31: re-stamp when the newest timestamp's TSA usage period ends within 30 days, using the
 * next TSA from the PKI fixtures. Returns how many documents were re-stamped.
 */
export function retimestampRun(ctx: Ctx, at: Instant): number {
  const s = ctx.state;
  let count = 0;
  for (const rec of s.archive) {
    if (rec.state === 'deleted' || !isOnOrBefore(rec.added_at, at) || isOnOrBefore(rec.expires_at, at)) continue;
    const cur = findCa(s, rec.tsa);
    if (!cur) continue;
    const curEnd = usageEnd(cur);
    if (toMs(curEnd) - toMs(at) > 30 * MS_DAY) continue;
    const next = s.pki
      .filter((c) => c.id.startsWith('tsa-') && c.id !== cur.id && isOnOrBefore(c.not_before, at) && toMs(usageEnd(c)) > toMs(curEnd))
      .sort((a, b) => toMs(usageEnd(a)) - toMs(usageEnd(b)))[0];
    if (!next) continue;
    rec.tsa = next.id;
    rec.retimestamp_count += 1;
    if (rec.state === 'archived') rec.state = 'retimestamped';
    count += 1;
    emit(ctx, 'system', 'archive.retimestamped', rec.id, { tsa_serial: next.serial, count: rec.retimestamp_count }, at);
  }
  return count;
}

/** Trigger time of the 30-day notice. */
export function noticeAt(rec: ArchiveRecord): Instant {
  return addDays(rec.expires_at, -30);
}

export function archiveById(state: EngineState, id: string): ArchiveRecord | undefined {
  return findArchive(state, id);
}
