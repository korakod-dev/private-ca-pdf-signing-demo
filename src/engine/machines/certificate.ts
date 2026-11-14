// Certificate state machine (spec 7.4):
//   Requested -> (proofed + approved) -> Issued -> (finalize) -> Active -> Revoked | Expired
//   Requested -> Rejected | ExpiredRequest (14 days)
import type { CertDto } from '../../contracts/api';
import type { CertFixture, Persona } from '../../contracts/fixtures';
import { MS_DAY, diffMs } from '../clock';
import { revokeCert } from '../revocation';
import { certSerial, emit, findCert, nextId, userCertEnd } from '../state';
import type { Ctx, RequestRecord } from '../types';

/** Creates the certificate record for a request in state 'Requested' (not valid yet; serial is reserved). */
export function createRequestedCert(ctx: Ctx, req: RequestRecord, holder: Persona): CertFixture {
  const s = ctx.state;
  const cert: CertFixture = {
    serial: certSerial(nextId(s, 'cert')),
    holder: holder.id,
    subject: `CN=${req.csr.subject_cn}, ${s.system.org}`,
    issuer_ca: 'doc-signing-2026',
    not_before: ctx.now,
    not_after: userCertEnd(s, ctx.now),
    state: 'Requested',
    revoked_at: null,
    revocation_reason: null,
    invalidity_date: null,
    superseded_by: null,
  };
  s.certs.push(cert);
  req.cert_serial = cert.serial;
  return cert;
}

/** Requested -> Issued: validity starts now. Creates the record first for fixture requests that have none. */
export function issueCert(ctx: Ctx, req: RequestRecord, holder: Persona): CertFixture {
  const existing = req.cert_serial ? findCert(ctx.state, req.cert_serial) : undefined;
  const cert = existing ?? createRequestedCert(ctx, req, holder);
  cert.state = 'Issued';
  cert.not_before = ctx.now;
  cert.not_after = userCertEnd(ctx.state, ctx.now);
  emit(ctx, 'system', 'cert.issued', cert.serial, { request: req.id, not_after: cert.not_after });
  return cert;
}

/** Issued -> Active. For a renewal this also revokes the replaced certificate as "superseded" (A9, A10). */
export function finalizeCert(ctx: Ctx, cert: CertFixture, actor: Persona, req: RequestRecord | undefined): void {
  cert.state = 'Active';
  ctx.state.cert_notices[cert.serial] = [];
  emit(ctx, actor.id, 'cert.finalized', cert.serial, {});
  if (req?.kind === 'renewal' && req.renews) {
    const old = findCert(ctx.state, req.renews);
    if (old && old.state === 'Active') revokeCert(ctx, old, 'superseded', null, actor.id, cert.serial);
  }
}

export function toCertDto(cert: CertFixture, now: string): CertDto {
  return {
    ...cert,
    days_left: Math.max(0, Math.ceil(diffMs(cert.not_after, now) / MS_DAY)),
    superseded: cert.state === 'Revoked' && cert.revocation_reason === 'superseded',
  };
}
