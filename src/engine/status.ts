// Read-only views: public service status, admin status, demo status.
import type { AdminStatusDto, ServiceId, ServiceStatusDto } from '../contracts/api';
import { SERVICE_IDS, TSA_DRIFT_LIMIT_MS } from '../contracts/api';
import type { Persona } from '../contracts/fixtures';
import type { DemoStatusDto } from '../contracts/store';
import { activeJobs } from './limits';
import { unreadCount } from './mail';
import { evaluateMissionState } from './missions';
import { toUserSummary } from './state';
import type { Ctx, EngineState } from './types';

type ServiceState = 'up' | 'down' | 'degraded';

const LABELS: Record<ServiceId, string> = {
  ca: 'ผู้ออกใบรับรอง (CA)',
  tsa: 'บริการตราประทับเวลา (TSA)',
  ocsp: 'บริการตรวจสถานะใบรับรอง (OCSP)',
  crl: 'รายการเพิกถอน (CRL)',
  'verify-queue': 'คิวตรวจเอกสาร',
};

function stateOf(s: EngineState, id: ServiceId): { state: ServiceState; detail_th?: string } {
  switch (id) {
    case 'ca':
      return { state: 'up' };
    case 'tsa':
      if (s.faults.tsa_drift_ms > TSA_DRIFT_LIMIT_MS) {
        return { state: 'down', detail_th: `เวลาเพี้ยน ${s.faults.tsa_drift_ms} ms เกินเกณฑ์ ${TSA_DRIFT_LIMIT_MS} ms หยุดออกตราประทับ` };
      }
      return s.faults.tsa_drift_ms > 0
        ? { state: 'degraded', detail_th: `เวลาเพี้ยน ${s.faults.tsa_drift_ms} ms` }
        : { state: 'up', detail_th: 'เวลาตรงกับ NIMT (จำลอง)' };
    case 'ocsp':
      return s.faults.ocsp_down ? { state: 'down', detail_th: 'OCSP ล่ม (สวิตช์จำลอง)' } : { state: 'up', detail_th: `ผู้เซ็นปัจจุบัน ${s.ocsp_signer.serial}` };
    case 'crl':
      return s.faults.crl_down ? { state: 'down', detail_th: 'CRL ล่ม (สวิตช์จำลอง)' } : { state: 'up', detail_th: `CRL หมายเลข ${s.crl.number}` };
    case 'verify-queue': {
      const active = activeJobs(s);
      const full = s.faults.queue_full || active >= s.system.limits.queue_max;
      return { state: full ? 'degraded' : 'up', detail_th: `งานในคิว ${active}/${s.system.limits.queue_max}` };
    }
  }
}

export function publicStatus(s: EngineState): ServiceStatusDto {
  return { services: SERVICE_IDS.map((id) => ({ id, label_th: LABELS[id], state: stateOf(s, id).state })) };
}

/** Static cards for what the demo does not simulate (spec 6 and 7.9). */
const NOT_SIMULATED: AdminStatusDto['not_simulated'] = [
  { id: 'deploy', label_th: 'การ deploy ระบบจริง ไม่ได้จำลอง' },
  { id: 'backup', label_th: 'การสำรองข้อมูลจริง ไม่ได้จำลอง (มีเฉพาะบันทึกงาน 02:00)' },
  { id: 'ci', label_th: 'CI/CD ของระบบจริง ไม่ได้จำลอง' },
  { id: 'pentest', label_th: 'การทดสอบเจาะระบบ (pentest) ไม่ได้จำลอง' },
  { id: 'hsm', label_th: 'กุญแจใน HSM จริง ไม่ได้จำลอง (ไม่มีกุญแจหรือลายเซ็นจริง)' },
  { id: 'nimt', label_th: 'เวลาอ้างอิง UTC(NIMT) จริง ไม่ได้จำลอง ใช้นาฬิกาจำลอง' },
];

export function adminStatus(s: EngineState): AdminStatusDto {
  return {
    services: SERVICE_IDS.map((id) => ({ id, label_th: LABELS[id], ...stateOf(s, id) })),
    tsa: {
      offset_ms: s.faults.tsa_drift_ms,
      limit_ms: TSA_DRIFT_LIMIT_MS,
      state: s.faults.tsa_drift_ms > TSA_DRIFT_LIMIT_MS ? 'stopped' : 'ok',
    },
    queue: { active: activeJobs(s), max: s.system.limits.queue_max },
    crl: { number: s.crl.number, next_update: s.crl.next_update },
    ocsp_signer: { serial: s.ocsp_signer.serial, not_after: s.ocsp_signer.not_after },
    not_simulated: NOT_SIMULATED,
  };
}

export function demoStatus(ctx: Ctx, actor: Persona | null): DemoStatusDto {
  const s = ctx.state;
  return {
    now: ctx.now,
    clock_mode: s.clock.mode,
    faults: { ...s.faults },
    actor: actor ? toUserSummary(actor) : null,
    missions: evaluateMissionState(s),
    unread_mail: actor ? unreadCount(s, actor.id) : 0,
    tsa_offset_ms: s.faults.tsa_drift_ms,
  };
}
