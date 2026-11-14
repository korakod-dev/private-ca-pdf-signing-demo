// Revocation, CRL and OCSP views (spec 7.4 "การเพิกถอน", R14).
// OCSP answers from live certificate state (immediate). The CRL is a published snapshot: it changes at the next 06:00
// run, except keyCompromise (immediate re-issue) and the admin "issue CRL now" action.
import type { OcspDto } from '../contracts/api';
import type { CertView, CrlEntry } from '../contracts/engine';
import type { CertFixture, Instant, PersonaId, RevocationReason } from '../contracts/fixtures';
import { addDays, isOnOrBefore } from './clock';
import { emit, findCert } from './state';
import type { Ctx, EngineState } from './types';

/** Every revoked certificate of the document-signing CA that was revoked at or before `at`. */
export function crlEntriesAt(state: EngineState, at: Instant): CrlEntry[] {
  return state.certs
    .filter((c) => c.issuer_ca === state.crl.ca && c.state === 'Revoked' && c.revoked_at !== null && isOnOrBefore(c.revoked_at, at))
    .map((c) => ({
      serial: c.serial,
      revoked_at: c.revoked_at as Instant,
      reason: c.revocation_reason ?? 'unspecified',
      invalidity_date: c.invalidity_date,
    }));
}

/** Publishes a new CRL with number+1. Scheduled issues are aggregated by the scheduler; others are audited here. */
export function issueCrl(ctx: Ctx, at: Instant, reason: 'keyCompromise' | 'admin', actor: PersonaId | 'system' = 'system'): void {
  const crl = ctx.state.crl;
  crl.number += 1;
  crl.this_update = at;
  crl.next_update = addDays(at, ctx.state.system.schedule.crl_next_update_days);
  crl.entries = crlEntriesAt(ctx.state, at);
  emit(ctx, actor, 'crl.issued', crl.ca, { number: crl.number, reason, entries: crl.entries.length }, at);
}

/** Status the OCSP responder gives for a certificate. */
export function ocspStatusOf(cert: CertFixture | undefined): OcspDto['status'] {
  if (!cert || cert.issuer_ca === null) return 'unknown';
  if (cert.state === 'Revoked') return 'revoked';
  if (cert.state === 'Active' || cert.state === 'Issued' || cert.state === 'Expired') return 'good';
  return 'unknown';
}

/** Certificate as the resolver sees it. `ocsp` is the true responder answer; the resolver applies fault rules itself. */
export function toCertView(cert: CertFixture): CertView {
  const status = ocspStatusOf(cert);
  const revoked = status === 'revoked';
  return {
    serial: cert.serial,
    subject: cert.subject,
    trusted_chain: cert.issuer_ca !== null && cert.untrusted_fixture !== true,
    not_before: cert.not_before,
    not_after: cert.not_after,
    ocsp: {
      status,
      revoked_at: revoked ? cert.revoked_at : null,
      reason: revoked ? cert.revocation_reason : null,
      invalidity_date: revoked ? cert.invalidity_date : null,
    },
  };
}

/** True when OCSP says revoked while the published CRL does not list the serial yet (R14 window). */
export function inR14Window(state: EngineState, serial: string): boolean {
  const cert = findCert(state, serial);
  return ocspStatusOf(cert) === 'revoked' && !state.crl.entries.some((e) => e.serial === serial);
}

/**
 * Revokes a certificate now. OCSP reflects it immediately; the CRL only when it is re-issued (next 06:00, or right
 * away for keyCompromise). `invalidity` is the optional backdated compromise time (admin only).
 */
export function revokeCert(
  ctx: Ctx,
  cert: CertFixture,
  reason: RevocationReason,
  invalidity: Instant | null,
  actor: PersonaId | 'system',
  supersededBy: string | null = null,
): void {
  cert.state = 'Revoked';
  cert.revoked_at = ctx.now;
  cert.revocation_reason = reason;
  cert.invalidity_date = invalidity;
  if (supersededBy) cert.superseded_by = supersededBy;
  emit(ctx, actor, 'cert.revoked', cert.serial, {
    reason,
    invalidity_date: invalidity,
    holder: cert.holder,
    crl_publication: reason === 'keyCompromise' ? 'immediate' : 'next_scheduled_run',
  });
  if (reason === 'keyCompromise') issueCrl(ctx, ctx.now, 'keyCompromise', actor);
}
