// Single definition of what each fault toggle means, shared by the demo bar and /admin/status (sub-task G imports it),
// so both places always agree on aria-pressed and on the request they send.
//
// 'ocsp', 'crl' and 'ocsp-crl' are three mutually exclusive presets of the two flags (ocsp_down, crl_down):
//   ocsp     = OCSP down, CRL up        -> pressed only in that exact combination
//   crl      = CRL down, OCSP up
//   ocsp-crl = both down
// Turning a preset off clears both flags. Turning one on replaces the others (e.g. M10: first 'ocsp', then 'ocsp-crl').
import { TSA_DRIFT_FAULT_MS, type FaultToggleKey, type DemoFaultsBody } from '../contracts/api';
import type { FaultState } from '../contracts/fixtures';

export const FAULT_TOGGLE_KEYS: readonly FaultToggleKey[] = ['ocsp', 'crl', 'ocsp-crl', 'tsa-drift', 'queue-full'];

export const FAULT_LABEL_TH: Record<FaultToggleKey, string> = {
  ocsp: 'OCSP ล่ม',
  crl: 'CRL ล่ม',
  'ocsp-crl': 'OCSP+CRL ล่ม',
  'tsa-drift': 'เวลา TSA เพี้ยน',
  'queue-full': 'คิวเต็ม',
};

/** Is this toggle currently on, given the server's fault state? */
export function isFaultOn(key: FaultToggleKey, faults: FaultState): boolean {
  switch (key) {
    case 'ocsp':
      return faults.ocsp_down && !faults.crl_down;
    case 'crl':
      return faults.crl_down && !faults.ocsp_down;
    case 'ocsp-crl':
      return faults.ocsp_down && faults.crl_down;
    case 'tsa-drift':
      return faults.tsa_drift_ms > 0;
    case 'queue-full':
      return faults.queue_full;
  }
}

/** Body of POST /demo/faults that sets this toggle to `on`. */
export function faultPatch(key: FaultToggleKey, on: boolean): DemoFaultsBody {
  switch (key) {
    case 'ocsp':
      return { ocsp_down: on, crl_down: false };
    case 'crl':
      return { ocsp_down: false, crl_down: on };
    case 'ocsp-crl':
      return { ocsp_down: on, crl_down: on };
    case 'tsa-drift':
      return { tsa_drift_ms: on ? TSA_DRIFT_FAULT_MS : 0 };
    case 'queue-full':
      return { queue_full: on };
  }
}
