// Sign desk (demo-only routes sign.review / sign.commit). Nothing is really signed: a successful commit derives a new
// fixture-like document (D12 -> D12-s1 -> D12-s2 ...) with a fake deterministic SHA-256 that verifies like any other.
//
// Refusal rules (each one is audited as `sign.refused` with details.code):
//   S5 existing signatures must pass verification (resolver) -> 422 EXISTING_SIGNATURE_INVALID
//   encrypted -> 422 ENCRYPTED_PDF · > 200 pages or > 20 MB -> 413 PDF_TOO_LARGE
//   the signer's own certificate must be Active (A23: revoked/expired/pending -> 403 CERT_NOT_ACTIVE)
//   certify only as the first signature -> 409 CERTIFY_NOT_FIRST
//   wrong SHA-256 suffix / wrong p12 password -> 400
//   TSA drift above 1000 ms (T4, T9) -> 503 TSA_DRIFT, plus `tsa.stopped` once
import type { SignCommitBody, SignResultDto, SignReviewBody, SignReviewDto } from '../contracts/api';
import { TSA_DRIFT_LIMIT_MS } from '../contracts/api';
import type { EngineResponse } from '../contracts/engine';
import type { CertFixture, DocumentId, FixtureDocument, FixtureSignature, Persona, SigLevel } from '../contracts/fixtures';
import { isOnOrBefore, isBefore } from './clock';
import { fakeDocumentHash } from './hash';
import { asObject, fail, ok, reqString } from './http';
import { buildResolverInput } from './machines/verifyJob';
import { activeTsa, emit } from './state';
import type { Ctx } from './types';

const SIGNABLE_ID = /^D12(-s\d+)?$/;
const DERIVED_ID = /^D12-s(\d+)$/;
/** What the sign desk prints for a finished signature (B-T -> B-LT -> B-LTA). */
const LEVELS: SigLevel[] = ['B-T', 'B-LT', 'B-LTA'];

/** Audits the refusal, remembers its code for the missions, and stops with a problem response. */
function refuse(ctx: Ctx, actor: Persona, doc: string, field: string, status: number, code: string, detail: string, ref?: string): never {
  emit(ctx, actor.id, 'sign.refused', doc, { code, field, ref: ref ?? null });
  ctx.state.learning.sign_refused_codes.push(code);
  return fail(status, code, detail, ref ? { ref } : {});
}

/** Active, currently valid certificate of the persona (newest first). */
function signingCert(ctx: Ctx, actor: Persona): CertFixture | undefined {
  return ctx.state.certs
    .filter((c) => c.holder === actor.id && c.state === 'Active' && isOnOrBefore(c.not_before, ctx.now) && isBefore(ctx.now, c.not_after))
    .sort((a, b) => Date.parse(b.not_before) - Date.parse(a.not_before))[0];
}

interface Prepared {
  doc: FixtureDocument;
  cert: CertFixture;
  existing: SignReviewDto['existing_signatures'];
  field: string;
  certify: boolean;
}

function readReviewBody(body: unknown): SignReviewBody {
  const b = asObject(body);
  if (typeof b.certify !== 'boolean') fail(400, 'INVALID_REQUEST', 'ต้องระบุ certify เป็น true/false');
  return { document_id: reqString(b, 'document_id') as DocumentId, field: reqString(b, 'field'), certify: b.certify };
}

/** Preconditions shared by review and commit. */
function prepare(ctx: Ctx, actor: Persona, b: SignReviewBody): Prepared {
  const s = ctx.state;
  const doc = s.documents.find((d) => d.id === b.document_id);
  if (!doc) fail(404, 'NOT_FOUND', 'ไม่พบเอกสารนี้');
  const docId = doc.id;
  function r(status: number, code: string, detail: string, ref?: string): never {
    return refuse(ctx, actor, docId, b.field, status, code, detail, ref);
  }

  if (!SIGNABLE_ID.test(doc.id)) r(422, 'INVALID_REQUEST', 'โต๊ะเซ็นรับเฉพาะเอกสารต้นฉบับ memo-130 และฉบับที่เซ็นต่อกัน');
  if (doc.encrypted) r(422, 'ENCRYPTED_PDF', 'ระบบไม่รับ PDF ที่เข้ารหัส', 'V10');
  if (doc.pages > s.system.limits.pdf_max_pages || doc.size_bytes > s.system.limits.pdf_max_bytes) {
    r(413, 'PDF_TOO_LARGE', 'เอกสารเกิน 200 หน้า หรือเกิน 20 MB', 'V10');
  }
  if (!doc.signature_fields.includes(b.field)) r(422, 'INVALID_REQUEST', `เอกสารนี้ไม่มีช่องลายเซ็น "${b.field}"`);
  if (doc.signatures.some((x) => x.field === b.field)) r(409, 'INVALID_STATE', `ช่องลายเซ็น "${b.field}" มีลายเซ็นอยู่แล้ว`);
  if (b.certify && doc.signatures.length > 0) {
    r(409, 'CERTIFY_NOT_FIRST', 'ลายเซ็นแบบ certification ทำได้เฉพาะลายเซ็นแรกของเอกสาร');
  }
  const cert = signingCert(ctx, actor);
  if (!cert) r(403, 'CERT_NOT_ACTIVE', 'คุณไม่มีใบรับรองที่ใช้งานได้ (Active) จึงเซ็นไม่ได้');

  let existing: SignReviewDto['existing_signatures'] = [];
  if (doc.signatures.length > 0) {
    const out = ctx.resolve(buildResolverInput(s, doc, ctx.now));
    existing = out.signatures.map((sig) => ({ field: sig.field, signer_subject: sig.signer.subject, indication: sig.indication }));
    const allPass = out.indication === 'TOTAL-PASSED' && out.signatures.every((sig) => sig.indication === 'TOTAL-PASSED');
    if (!allPass) r(422, 'EXISTING_SIGNATURE_INVALID', 'ลายเซ็นเดิมในเอกสารยังไม่ผ่านการตรวจ จึงเซ็นต่อไม่ได้', 'S5');
  }
  return { doc, cert, existing, field: b.field, certify: b.certify };
}

/** POST sign.review: shows what the user is about to sign (document, SHA-256, existing signatures). */
export function signReview(ctx: Ctx, actor: Persona, body: unknown): EngineResponse {
  const b = readReviewBody(body);
  const p = prepare(ctx, actor, b);
  const dto: SignReviewDto = {
    document_id: p.doc.id,
    file_name: p.doc.file_name,
    sha256: p.doc.sha256,
    pages: p.doc.pages,
    field: p.field,
    certify: p.certify,
    existing_signatures: p.existing,
  };
  return ok(dto);
}

/** `memo-130-unsigned.pdf` / `memo-130-s1.signed.pdf` -> stem `memo-130` (A29). */
function stemOf(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '').replace(/\.signed$/, '').replace(/-unsigned$/, '').replace(/-s\d+$/, '');
}

/** POST sign.commit: intent, SHA-4 confirmation, p12 password, TSA check, then the derived document. */
export function signCommit(ctx: Ctx, actor: Persona, body: unknown): EngineResponse {
  const raw = asObject(body);
  const base = readReviewBody(body);
  const purpose = raw.purpose;
  if (purpose !== 1 && purpose !== 2 && purpose !== 3 && purpose !== 4) fail(400, 'INVALID_REQUEST', 'purpose ต้องเป็น 1-4');
  const suffix = typeof raw.sha256_suffix === 'string' ? raw.sha256_suffix : '';
  const password = typeof raw.p12_password === 'string' ? raw.p12_password : '';
  const commit: SignCommitBody = { ...base, purpose, sha256_suffix: suffix, p12_password: password };

  const s = ctx.state;
  const p = prepare(ctx, actor, base);
  function r(status: number, code: string, detail: string, ref?: string): never {
    return refuse(ctx, actor, p.doc.id, commit.field, status, code, detail, ref);
  }

  if (suffix.toLowerCase() !== p.doc.sha256.slice(-4)) {
    r(400, 'SHA_SUFFIX_MISMATCH', 'อักขระ 4 ตัวท้ายของ SHA-256 ไม่ตรงกับเอกสาร ตรวจสอบแล้วพิมพ์ใหม่', 'S2');
  }
  if (password !== s.system.demo_p12_password) r(400, 'P12_PASSWORD_INVALID', 'รหัสผ่านไฟล์ .p12 ไม่ถูกต้อง');

  // The TSA stops stamping when its clock drifts too far from NIMT (T4, T9).
  if (s.faults.tsa_drift_ms > TSA_DRIFT_LIMIT_MS) {
    if (s.tsa.stopped_at === null) {
      s.tsa.stopped_at = ctx.now;
      emit(ctx, 'system', 'tsa.stopped', null, { drift_ms: s.faults.tsa_drift_ms, limit_ms: TSA_DRIFT_LIMIT_MS, ref: 'T4' });
    }
    r(503, 'TSA_DRIFT', 'TSA หยุดออกตราประทับเวลา เพราะเวลาเพี้ยนเกินกำหนด', 'T9');
  }
  const tsa = activeTsa(s, ctx.now);
  if (!tsa) r(503, 'TSA_UNAVAILABLE', 'ไม่มี TSA ที่ใช้งานได้ ณ เวลานี้');

  // Derive the new document.
  const maxN = s.documents.reduce((m, d) => Math.max(m, Number(DERIVED_ID.exec(d.id)?.[1] ?? 0)), 0);
  const newId = `D12-s${maxN + 1}` as DocumentId;
  const level: SigLevel = 'B-LTA';
  const sig: FixtureSignature = {
    id: `${newId}-sig${p.doc.signatures.length + 1}`,
    field: commit.field,
    type: commit.certify ? 'certification' : 'approval',
    signer_cert_serial: p.cert.serial,
    claimed_signing_time: ctx.now,
    signature_timestamp: { time: ctx.now, tsa_serial: tsa.serial },
    level,
    purpose: commit.purpose,
  };
  const fileName = `${stemOf(p.doc.file_name)}-s${maxN + 1}.signed.pdf`;
  const derived: FixtureDocument = {
    ...structuredClone(p.doc),
    id: newId,
    file_name: fileName,
    size_bytes: p.doc.size_bytes + 20480,
    sha256: fakeDocumentHash(p.doc.sha256, p.cert.serial, commit.field, ctx.now),
    signatures: [...structuredClone(p.doc.signatures), sig],
    doc_timestamps: [...structuredClone(p.doc.doc_timestamps), { time: ctx.now, tsa_serial: tsa.serial }],
    modification_after_last_signature: null,
    expected: { http_status: 200, indication: 'TOTAL-PASSED', sub_indication: null, code: 'VALID', problem_code: null, warnings: [] },
  };
  s.documents.push(derived);
  emit(ctx, actor.id, 'document.signed', newId, {
    parent: p.doc.id,
    field: commit.field,
    certify: commit.certify,
    purpose: commit.purpose,
    signer_serial: p.cert.serial,
    sha256: derived.sha256,
  });
  const res: SignResultDto = { document_id: newId, file_name: fileName, levels: LEVELS };
  return ok(res, 201);
}
