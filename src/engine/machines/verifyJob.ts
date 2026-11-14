// Verification job state machine: queued -> running -> done | error (spec 7.4, assumptions A2, A4).
// The verdict itself comes from the injected resolver (B2); this module only prepares its input and manages the job.
import type { ProblemDto, VerifyJobDto, VerifyReport } from '../../contracts/api';
import type { ResolverInput } from '../../contracts/engine';
import type { FixtureDocument, Instant, Persona } from '../../contracts/fixtures';
import { addMs, isOnOrBefore, toMs, MS_SECOND } from '../clock';
import { problemBody } from '../http';
import { toCertView } from '../revocation';
import { jobId, nextId } from '../state';
import type { Ctx, EngineState, JobRecord } from '../types';
import { findCert } from '../state';

export interface Precheck {
  status: 413 | 422;
  code: 'PDF_TOO_LARGE' | 'ENCRYPTED_PDF' | 'NOT_SIGNED';
  detail: string;
  ref: string;
}

/** Synchronous rejections on POST /verify (V10, V11, A4). Null when the document may be queued. */
export function precheckDocument(state: EngineState, doc: FixtureDocument): Precheck | null {
  const lim = state.system.limits;
  if (doc.encrypted) {
    return { status: 422, code: 'ENCRYPTED_PDF', detail: 'ระบบไม่รับ PDF ที่เข้ารหัส', ref: 'V10' };
  }
  if (doc.pages > lim.pdf_max_pages || doc.size_bytes > lim.pdf_max_bytes) {
    return { status: 413, code: 'PDF_TOO_LARGE', detail: 'เอกสารเกิน 200 หน้า หรือเกิน 20 MB', ref: 'V10' };
  }
  if (doc.signatures.length === 0 && doc.doc_timestamps.length === 0) {
    return { status: 422, code: 'NOT_SIGNED', detail: 'เอกสารนี้ยังไม่มีลายเซ็นให้ตรวจ', ref: 'V11' };
  }
  return null;
}

/** Resolver input at `now`: the document, the certificate views for its signers, the published CRL and the faults. */
export function buildResolverInput(state: EngineState, doc: FixtureDocument, now: Instant): ResolverInput {
  const certs: ResolverInput['certs'] = {};
  for (const sig of doc.signatures) {
    const cert = findCert(state, sig.signer_cert_serial);
    if (cert) certs[cert.serial] = toCertView(cert);
  }
  return {
    document: doc,
    now,
    certs,
    crl_entries: state.crl.entries,
    faults: state.faults,
    policy: 'strict-v1',
  };
}

export function markAttempted(state: EngineState, docId: string): void {
  if (!state.learning.verified_docs.includes(docId)) state.learning.verified_docs.push(docId);
}

/** Queues a job. Latency (A2) is 1-3 simulated seconds, derived from the job number so it is deterministic. */
export function createJob(ctx: Ctx, doc: FixtureDocument, actor: Persona | null): JobRecord {
  const s = ctx.state;
  const n = nextId(s, 'job');
  const latencyS = 1 + (n % 3);
  const job: JobRecord = {
    job_id: jobId(n),
    n,
    document_id: doc.id,
    status: 'queued',
    created_at: ctx.now,
    running_at: addMs(ctx.now, MS_SECOND),
    ready_at: addMs(ctx.now, latencyS * MS_SECOND),
    requested_by: actor?.id ?? null,
    result: null,
    error: null,
  };
  s.jobs.push(job);
  return job;
}

/** Runs the resolver and stores the V3 report (or an error). `finishedAt` is when the job logically finished. */
export function completeJob(ctx: Ctx, job: JobRecord, finishedAt: Instant): void {
  const doc = ctx.state.documents.find((d) => d.id === job.document_id);
  try {
    if (!doc) throw new Error(`document ${job.document_id} missing`);
    const out = ctx.resolve(buildResolverInput(ctx.state, doc, ctx.now));
    const report: VerifyReport = { job_id: job.job_id, created_at: job.created_at, finished_at: finishedAt, ...out };
    job.result = report;
    job.status = 'done';
    // M5: a finished job counts as "opened".
    markAttempted(ctx.state, job.document_id);
  } catch (e) {
    const error: ProblemDto = problemBody(500, 'INTERNAL_ERROR', e instanceof Error ? e.message : 'resolver failed');
    job.error = error;
    job.status = 'error';
  }
}

/**
 * Moves jobs forward to `ctx.now`.
 * latency on : queued -> running -> done by simulated time.
 * latency off: done as soon as simulated time has moved past creation; `verify.get` also completes a job on its
 *              first observation (so frozen-clock Cypress runs never wait).
 */
export function progressJobs(ctx: Ctx): void {
  const latency = ctx.state.options.latency;
  for (const job of ctx.state.jobs) {
    if (job.status === 'done' || job.status === 'error') continue;
    if (latency) {
      if (isOnOrBefore(job.ready_at, ctx.now)) completeJob(ctx, job, job.ready_at);
      else if (isOnOrBefore(job.running_at, ctx.now)) job.status = 'running';
    } else if (toMs(ctx.now) > toMs(job.created_at)) {
      completeJob(ctx, job, ctx.now);
    }
  }
}

/** First observation of a job when latency is off. */
export function completeOnObservation(ctx: Ctx, job: JobRecord): void {
  if (!ctx.state.options.latency && job.status !== 'done' && job.status !== 'error') completeJob(ctx, job, ctx.now);
}

export function toJobDto(job: JobRecord): VerifyJobDto {
  return {
    job_id: job.job_id,
    status: job.status,
    created_at: job.created_at,
    result: job.result,
    error: job.error,
  };
}
