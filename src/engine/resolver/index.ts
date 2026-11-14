// Verification resolver (sub-task B2).
// Pure function: document model + revocation views -> V3 report core (without job_id / created_at / finished_at).
// No clock, no randomness, no I/O, no mutation of the input; the output never aliases input objects.
//
// Scope rule (F1, docs/adr/0003-assumptions.md "Spec issue for the project maintainer"): the resolver does NOT check that a timestamp
// lies inside its TSA's validity period, nor that issuer/subject validity periods nest. Fixtures D04, D05 and D07 carry
// timestamps that predate the TSA's `not_before` (2026-10-01) and must still resolve exactly as golden table 7.5 says.
//
// Rules (plan B2, assumptions A14/A17/A18):
//  - Per signature the checks run in this order: integrity, modification, chain, poe, validity, revocation, policy.
//    A check that cannot be evaluated because an earlier one already ruled the signature out is `skipped`.
//  - POE (proof of existence) = signature-timestamp time. Without a timestamp the only POE is the validation time
//    itself, which is acceptable only while the signer certificate is valid now; otherwise INDETERMINATE/NO_POE.
//  - Effective revocation time = invalidity_date ?? revoked_at. Revoked at or before the POE -> TOTAL-FAILED/REVOKED,
//    revoked after the POE -> passes. (Assumption: a revoked cert with no timestamp is REVOKED, since the POE is "now".)
//  - Status source (A14): OCSP first; OCSP down -> CRL; CRL down -> OCSP; both down -> INDETERMINATE/TRY_LATER.
//    strict-v1 hard-fails and ignores embedded LTV data for current status.
//  - Untrusted chain -> TOTAL-FAILED/NO_CERTIFICATE_CHAIN_FOUND/UNTRUSTED; MIXED_TRUST warning when the document also
//    carries trusted signatures.
//  - Any modification after the last signature -> TOTAL-FAILED/MODIFIED on every signature (strict-v1 also rejects
//    DocMDP-permitted form fill).
//  - Document timestamp only -> VALID + NO_SIGNER; both status sources down -> TRY_LATER + TSA_STATUS_UNAVAILABLE
//    (fault-driven only; TSA cert dates/status data are not looked up, F1 rule unchanged; QA F18, assumption A41).
//  - Document result = worst signature: FAILED > INDETERMINATE > PASSED. Ties are broken by result-code precedence
//    MODIFIED > UNTRUSTED > REVOKED > NO_POE > TRY_LATER, then by signature order.
import type { Instant, FixtureSignature, FixtureTimestamp, Indication, ResultCode, SubIndication } from '../../contracts/fixtures';
import type { SignatureResult, VerifyCheck } from '../../contracts/api';
import type { CertView, CrlEntry, ResolverInput, ResolverOutput } from '../../contracts/engine';
import { SKIPPED_CODE, type CheckCode } from './codes';

export { CHECK_CODES, SKIPPED_CODE } from './codes';
export type { CheckCode } from './codes';

/** Result code -> (indication, sub_indication). Single source of truth for the mapping. */
const OUTCOMES: Record<ResultCode, { indication: Indication; sub: SubIndication | null }> = {
  VALID: { indication: 'TOTAL-PASSED', sub: null },
  MODIFIED: { indication: 'TOTAL-FAILED', sub: null },
  UNTRUSTED: { indication: 'TOTAL-FAILED', sub: 'NO_CERTIFICATE_CHAIN_FOUND' },
  REVOKED: { indication: 'TOTAL-FAILED', sub: 'REVOKED' },
  NO_POE: { indication: 'INDETERMINATE', sub: 'NO_POE' },
  TRY_LATER: { indication: 'INDETERMINATE', sub: 'TRY_LATER' },
};

const SEVERITY: Record<Indication, number> = { 'TOTAL-PASSED': 0, INDETERMINATE: 1, 'TOTAL-FAILED': 2 };

/** Tie-break order between result codes of equal severity (earlier wins). */
const CODE_PRECEDENCE: readonly ResultCode[] = ['MODIFIED', 'UNTRUSTED', 'REVOKED', 'NO_POE', 'TRY_LATER', 'VALID'];

/** A check plus the result code it contributes when it is not `passed`. */
interface Evaluated {
  check: VerifyCheck;
  outcome: ResultCode | null;
}

const mk = (
  id: VerifyCheck['id'],
  result: VerifyCheck['result'],
  code: CheckCode,
  refs: string[],
  outcome: ResultCode | null = null,
): Evaluated => ({ check: { id, result, code, refs }, outcome });

const skipped = (id: VerifyCheck['id'], refs: string[]): Evaluated => mk(id, 'skipped', SKIPPED_CODE, refs);

/** Parse an ISO instant (any offset) to epoch ms; reject garbage instead of silently comparing NaN. */
function ms(instant: Instant): number {
  const v = Date.parse(instant);
  if (Number.isNaN(v)) throw new RangeError(`resolveVerification: invalid instant "${instant}"`);
  return v;
}

const copyTs = (t: FixtureTimestamp): FixtureTimestamp => ({ time: t.time, tsa_serial: t.tsa_serial });

/** Revocation status as seen through the fault-aware source selection (A14). */
type Status =
  | { kind: 'good'; source: 'ocsp' | 'crl' }
  | { kind: 'revoked'; source: 'ocsp' | 'crl'; effective: Instant | null }
  | { kind: 'unavailable' }
  | { kind: 'unknown' };

function lookupStatus(view: CertView, crl: readonly CrlEntry[], ocspDown: boolean, crlDown: boolean): Status {
  if (!ocspDown) {
    // OCSP first. (CRL-down alone does not matter while OCSP answers.)
    const o = view.ocsp;
    if (o.status === 'good') return { kind: 'good', source: 'ocsp' };
    if (o.status === 'revoked') return { kind: 'revoked', source: 'ocsp', effective: o.invalidity_date ?? o.revoked_at };
    return { kind: 'unknown' };
  }
  if (crlDown) return { kind: 'unavailable' }; // both down: hard fail under strict-v1, embedded LTV ignored
  const entry = crl.find((e) => e.serial === view.serial);
  return entry
    ? { kind: 'revoked', source: 'crl', effective: entry.invalidity_date ?? entry.revoked_at }
    : { kind: 'good', source: 'crl' };
}

interface SigEval {
  result: SignatureResult;
  trusted: boolean;
  /** Was the signer certificate valid (and not revoked) at the POE? 'unknown' when it could not be established. */
  validAtSigning: 'yes' | 'no' | 'unknown';
}

function evaluateSignature(sig: FixtureSignature, input: ResolverInput, nowMs: number): SigEval {
  const { document: doc, certs, crl_entries: crl, faults } = input;
  const view: CertView | undefined = certs[sig.signer_cert_serial];
  const evals: Evaluated[] = [];

  // 1. integrity: the fixtures model no hash failures, so the byte range always verifies.
  evals.push(mk('integrity', 'passed', 'INTEGRITY_OK', ['V5']));

  // 2. modification after the last signature (applies to every signature of the document).
  const mod = doc.modification_after_last_signature;
  evals.push(
    mod
      ? mk('modification', 'failed', mod.kind === 'form_fill' ? 'MODIFIED_FORM_FILL' : 'MODIFIED_CONTENT', ['V5'], 'MODIFIED')
      : mk('modification', 'passed', 'NOT_MODIFIED', ['V5']),
  );

  // 3. chain trust; 4-6 only make sense under a trusted chain.
  const trusted = view?.trusted_chain === true;
  let statusUnavailable = false;
  let validAtSigning: SigEval['validAtSigning'] = 'unknown';
  if (!view || !trusted) {
    evals.push(mk('chain', 'failed', 'CHAIN_UNTRUSTED', ['V6'], 'UNTRUSTED'));
    evals.push(skipped('poe', ['V4']), skipped('validity', ['V4']), skipped('revocation', ['R15']));
  } else {
    evals.push(mk('chain', 'passed', 'CHAIN_TRUSTED', ['V6']));
    const nb = ms(view.not_before);
    const na = ms(view.not_after);
    const validAt = (t: number): boolean => t >= nb && t <= na;

    // 4. POE: timestamp time, else the validation time (only if the cert is valid now).
    let poeMs: number | null = null;
    if (sig.signature_timestamp) {
      poeMs = ms(sig.signature_timestamp.time);
      evals.push(mk('poe', 'passed', 'POE_TIMESTAMP', ['V4']));
    } else if (validAt(nowMs)) {
      poeMs = nowMs;
      evals.push(mk('poe', 'passed', 'POE_VALIDATION_TIME', ['V4']));
    } else {
      evals.push(mk('poe', 'indeterminate', 'NO_POE', ['V4'], 'NO_POE'));
    }

    if (poeMs === null) {
      evals.push(skipped('validity', ['V4']), skipped('revocation', ['R15']));
    } else if (!validAt(poeMs)) {
      // 5. validity: the POE lies outside the certificate period.
      evals.push(mk('validity', 'indeterminate', 'CERT_NOT_VALID_AT_POE', ['V4'], 'NO_POE'), skipped('revocation', ['R15']));
      validAtSigning = 'no';
    } else {
      evals.push(mk('validity', 'passed', 'CERT_VALID_AT_POE', ['V4']));
      // 6. revocation, relative to the POE.
      const st = lookupStatus(view, crl, faults.ocsp_down, faults.crl_down);
      if (st.kind === 'good') {
        evals.push(mk('revocation', 'passed', st.source === 'ocsp' ? 'REVOCATION_GOOD_OCSP' : 'REVOCATION_GOOD_CRL', ['R15']));
        validAtSigning = 'yes';
      } else if (st.kind === 'revoked') {
        // A revoked entry without any time is treated as revoked before the POE (conservative).
        const before = st.effective === null || ms(st.effective) <= poeMs;
        evals.push(
          before
            ? mk('revocation', 'failed', 'REVOKED_BEFORE_POE', ['R15'], 'REVOKED')
            : mk('revocation', 'passed', 'REVOKED_AFTER_POE', ['R15', 'Q3']),
        );
        validAtSigning = before ? 'no' : 'yes';
      } else if (st.kind === 'unavailable') {
        evals.push(mk('revocation', 'indeterminate', 'REVOCATION_UNAVAILABLE', ['R15'], 'TRY_LATER'));
        statusUnavailable = true;
      } else {
        evals.push(mk('revocation', 'indeterminate', 'REVOCATION_UNKNOWN', ['R15'], 'TRY_LATER'));
      }
    }
  }

  // 7. policy strict-v1: DocMDP-permitted form fill is still a modification; embedded LTV is ignored for current status.
  if (mod?.kind === 'form_fill' && mod.docmdp_permitted) {
    evals.push(mk('policy', 'failed', 'POLICY_FORM_FILL_REJECTED', ['V5'], 'MODIFIED'));
  } else if (statusUnavailable) {
    evals.push(mk('policy', 'indeterminate', 'POLICY_LTV_IGNORED', ['R15'], 'TRY_LATER'));
  } else {
    evals.push(mk('policy', 'passed', 'POLICY_STRICT_V1_OK', ['V5']));
  }

  const code = pickCode(evals.map((e) => e.outcome));
  const out = OUTCOMES[code];
  return {
    result: {
      id: sig.id,
      field: sig.field,
      type: sig.type,
      signer: { subject: view?.subject ?? '(unknown signer)', serial: sig.signer_cert_serial },
      signing_time: sig.claimed_signing_time,
      timestamp: sig.signature_timestamp ? copyTs(sig.signature_timestamp) : null,
      level: sig.level,
      indication: out.indication,
      sub_indication: out.sub,
      code,
      checks: evals.map((e) => e.check),
      warnings: [],
    },
    trusted,
    validAtSigning,
  };
}

/** Worst outcome wins: severity first, then CODE_PRECEDENCE; no outcome at all means VALID. */
function pickCode(outcomes: readonly (ResultCode | null)[]): ResultCode {
  let best: ResultCode = 'VALID';
  for (const o of outcomes) {
    if (o === null) continue;
    const ds = SEVERITY[OUTCOMES[o].indication] - SEVERITY[OUTCOMES[best].indication];
    if (ds > 0 || (ds === 0 && CODE_PRECEDENCE.indexOf(o) < CODE_PRECEDENCE.indexOf(best))) best = o;
  }
  return best;
}

export function resolveVerification(input: ResolverInput): ResolverOutput {
  const { document: doc } = input;
  if (doc.signatures.length === 0 && doc.doc_timestamps.length === 0) {
    // D10/D11/D12 (encrypted, too large, unsigned) are rejected by the engine before it calls the resolver.
    throw new Error(`resolveVerification: ${doc.id} has no signatures or document timestamps (engine pre-check case)`);
  }
  const nowMs = ms(input.now);
  const evals = doc.signatures.map((s) => evaluateSignature(s, input, nowMs));
  const sigs = evals.map((e) => e.result);

  // Document-level result: worst signature; a modified doc without signatures (timestamp-only) fails as MODIFIED.
  const docOutcomes: (ResultCode | null)[] = sigs.map((s) => s.code);
  if (sigs.length === 0 && doc.modification_after_last_signature) docOutcomes.push('MODIFIED');
  // F18 / A41: a document with doc timestamps but no signature (D09) cannot obtain TSA status when OCSP and CRL are both
  // down (strict-v1 hard-fail). Fault-driven only: no TSA certificate dates or revocation data are looked up (F1 rule).
  // Single source down -> status still obtainable (A14) -> stays VALID. pickCode keeps MODIFIED ahead of TRY_LATER.
  const tsaStatusUnavailable =
    sigs.length === 0 && doc.doc_timestamps.length > 0 && input.faults.ocsp_down && input.faults.crl_down;
  if (tsaStatusUnavailable) docOutcomes.push('TRY_LATER');
  const code = pickCode(docOutcomes);
  const out = OUTCOMES[code];

  const warnings: string[] = [];
  if (sigs.length === 0) warnings.push('NO_SIGNER');
  if (tsaStatusUnavailable) warnings.push('TSA_STATUS_UNAVAILABLE');
  if (evals.some((e) => e.trusted) && evals.some((e) => !e.trusted)) warnings.push('MIXED_TRUST');

  const validity: SigEval['validAtSigning'] = evals.some((e) => e.validAtSigning === 'no')
    ? 'no'
    : evals.length > 0 && evals.every((e) => e.validAtSigning === 'yes')
      ? 'yes'
      : 'unknown';

  return {
    policy: input.policy,
    validation_time: input.now,
    document: { id: doc.id, file_name: doc.file_name, sha256: doc.sha256, pages: doc.pages, size_bytes: doc.size_bytes },
    indication: out.indication,
    sub_indication: out.sub,
    code,
    questions: {
      modified: doc.modification_after_last_signature ? 'yes' : 'no',
      signer_trusted: evals.length === 0 ? 'unknown' : evals.every((e) => e.trusted) ? 'yes' : 'no',
      valid_at_signing: validity,
    },
    signatures: sigs,
    doc_timestamps: doc.doc_timestamps.map(copyTs),
    warnings,
    refs: [...doc.refs],
  };
}
