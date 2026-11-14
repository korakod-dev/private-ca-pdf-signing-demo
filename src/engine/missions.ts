// Mission done conditions (plan section 3.7, spec 7.8). Missions are sticky: once seen done they stay done.
import type { MissionProgress } from '../contracts/engine';
import type { Instant } from '../contracts/fixtures';
import { findCert } from './state';
import type { Ctx, EngineState } from './types';

type MissionId = MissionProgress['id'];

export const MISSION_IDS: readonly MissionId[] = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10', 'M11'];

const M5_DOCS = ['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D10', 'D11'];
const AREE_OLD_CERT = 'DE:M0:22:91:AF:03';

const hasProgress = (s: EngineState, key: string): boolean => s.learning.progress_keys.some((p) => p.key === key);

/** Evaluates the done condition of one mission against the current state. */
export function missionHolds(s: EngineState, id: MissionId): boolean {
  switch (id) {
    case 'M1':
      return hasProgress(s, 'M1.fingerprint_matched');
    case 'M2':
      return s.certs.some((c) => c.holder === 'u-nattapon' && c.state === 'Active');
    case 'M3':
      return s.requests.some((r) => r.id === 'req-manop-01' && r.state === 'rejected');
    case 'M4':
      return s.documents.some((d) => d.id === 'D12-s2') && s.jobs.some((j) => j.document_id === 'D12-s2' && j.result?.indication === 'TOTAL-PASSED');
    case 'M5':
      return M5_DOCS.every((d) => s.learning.verified_docs.includes(d));
    case 'M6': {
      const after = s.learning.r14_after_job;
      return s.learning.r14_observed_at !== null && after !== null && s.jobs.some((j) => j.n > after && j.result?.sub_indication === 'REVOKED');
    }
    case 'M7': {
      const old = findCert(s, AREE_OLD_CERT);
      return (
        s.certs.some((c) => c.holder === 'u-aree' && c.serial !== AREE_OLD_CERT && c.state === 'Active') &&
        old?.state === 'Revoked' &&
        old.revocation_reason === 'superseded'
      );
    }
    case 'M8':
      return s.archive.some(
        (a) =>
          a.owner === 'u-somchai' &&
          a.state === 'deleted' &&
          (s.learning.archive_deleted_hashes.includes(a.sha256) ||
            s.audit.some((e) => e.action === 'archive.deleted' && e.details.sha256 === a.sha256)),
      );
    case 'M9':
      return s.learning.sign_refused_codes.includes('TSA_DRIFT') || s.audit.some((e) => e.action === 'sign.refused' && e.details.code === 'TSA_DRIFT');
    case 'M10':
      return s.jobs.some((j) => j.document_id === 'D01' && j.result?.indication === 'INDETERMINATE' && j.result.sub_indication === 'TRY_LATER');
    case 'M11':
      return hasProgress(s, 'M11.chain_verified');
  }
}

/** done_at is the first time the mission was recorded as done (falls back to the last tick if not recorded yet). */
export function evaluateMissionState(s: EngineState): MissionProgress[] {
  return MISSION_IDS.map((id) => {
    const recorded = s.mission_done[id];
    const done = recorded !== undefined || missionHolds(s, id);
    return { id, done, done_at: done ? (recorded ?? s.last_tick) : null };
  });
}

/** Records newly completed missions with the current simulated time. */
export function recordMissions(ctx: Ctx): void {
  for (const id of MISSION_IDS) {
    if (ctx.state.mission_done[id] === undefined && missionHolds(ctx.state, id)) {
      ctx.state.mission_done[id] = ctx.now as Instant;
    }
  }
}
