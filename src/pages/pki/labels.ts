// Thai labels for the CRL / OCSP page.
import type { RevocationReason } from '../../contracts/fixtures';

export const REASON_TH: Record<RevocationReason, string> = {
  unspecified: 'ไม่ระบุเหตุผล',
  keyCompromise: 'กุญแจรั่วหรือสงสัยว่ารั่ว',
  affiliationChanged: 'สังกัดเปลี่ยน',
  superseded: 'ถูกแทนที่ด้วยใบใหม่ (superseded)',
  cessationOfOperation: 'เลิกใช้งาน',
  privilegeWithdrawn: 'ถอนสิทธิ์',
};

export const OCSP_STATUS_TH = {
  good: { symbol: '✓', th: 'ปกติ (good)', cls: 'border-green-700 bg-green-50 text-green-900' },
  revoked: { symbol: '✗', th: 'ถูกเพิกถอนแล้ว (revoked)', cls: 'border-red-700 bg-red-50 text-red-900' },
  unknown: { symbol: '?', th: 'ไม่รู้จักใบรับรองนี้ (unknown)', cls: 'border-amber-700 bg-amber-50 text-amber-900' },
} as const;
