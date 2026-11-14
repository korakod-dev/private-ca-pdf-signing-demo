// Revocation form shared by /certs (self-revocation, 3 reasons, A11) and /admin/certs (all 6 reasons + invalidity date).
// It only collects the input; the page decides what to call (the admin page asks for MFA first).
import { useState, type FormEvent } from 'react';
import { Button, Dialog } from '../../components';
import type { RevocationReason } from '../../contracts/fixtures';
import { TID } from '../../contracts/testids';

/** Thai labels; the technical code stays visible because it is what the CRL/OCSP will carry. */
export const REVOCATION_REASON_TH: Record<RevocationReason, string> = {
  unspecified: 'ไม่ระบุเหตุผล (unspecified)',
  keyCompromise: 'กุญแจส่วนตัวรั่วไหลหรือสูญหาย (keyCompromise)',
  affiliationChanged: 'เปลี่ยนสังกัด (affiliationChanged)',
  superseded: 'ถูกแทนที่ด้วยใบใหม่ (superseded)',
  cessationOfOperation: 'เลิกใช้งานใบรับรอง (cessationOfOperation)',
  privilegeWithdrawn: 'ถอนสิทธิ์ (privilegeWithdrawn)',
};

/** Reasons an ordinary user may pick (A11). */
export const USER_REASONS: readonly RevocationReason[] = ['keyCompromise', 'affiliationChanged', 'cessationOfOperation'];
/** Reasons admin-a may pick (A11). */
export const ADMIN_REASONS: readonly RevocationReason[] = [
  'unspecified',
  'keyCompromise',
  'affiliationChanged',
  'superseded',
  'cessationOfOperation',
  'privilegeWithdrawn',
];

/**
 * <input type="datetime-local"> gives "YYYY-MM-DDTHH:mm" (no zone). The demo clock is Thailand time, so the value is
 * read as +07:00. Returns null for an empty or malformed value.
 */
export function toInvalidityInstant(value: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?$/.exec(value.trim());
  return m ? `${m[1]}T${m[2]}:${m[3] ?? '00'}+07:00` : null;
}

export interface RevokeFormProps {
  open: boolean;
  serial: string;
  /** true on /admin/certs: all six reasons and the optional invalidity date. */
  admin: boolean;
  busy?: boolean;
  error?: string | null;
  onSubmit: (input: { reason: RevocationReason; invalidity_date?: string }) => void;
  onCancel: () => void;
}

export function RevokeForm({ open, serial, admin, busy = false, error, onSubmit, onCancel }: RevokeFormProps) {
  return (
    <Dialog open={open} title={`เพิกถอนใบรับรอง ${serial}`} onClose={onCancel}>
      <RevokeFields admin={admin} busy={busy} error={error} onSubmit={onSubmit} onCancel={onCancel} />
    </Dialog>
  );
}

// Mounted only while the dialog is open, so every opening starts with an empty form.
function RevokeFields({ admin, busy, error, onSubmit, onCancel }: Omit<RevokeFormProps, 'open' | 'serial'>) {
  const [reason, setReason] = useState<RevocationReason | ''>('');
  const [invalidity, setInvalidity] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const reasons = admin ? ADMIN_REASONS : USER_REASONS;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (reason === '' || busy) return;
    let invalidityInstant: string | undefined;
    if (admin && invalidity.trim() !== '') {
      const parsed = toInvalidityInstant(invalidity);
      if (!parsed) {
        setLocalError('วันเวลาที่ใบเริ่มใช้ไม่ได้ไม่ถูกต้อง');
        return;
      }
      invalidityInstant = parsed;
    }
    setLocalError(null);
    onSubmit(invalidityInstant ? { reason, invalidity_date: invalidityInstant } : { reason });
  };

  const shownError = localError ?? error ?? null;

  return (
    <form onSubmit={submit} noValidate>
      <p className="mb-3 text-sm text-slate-700">
        เพิกถอนแล้วย้อนกลับไม่ได้ ใบรับรองนี้จะใช้เซ็นเอกสารใหม่ไม่ได้อีก (เอกสารที่เซ็นและประทับเวลาไว้ก่อนหน้า
        อาจยังตรวจผ่าน ลองดูที่หน้า CRL / OCSP)
      </p>
      <label htmlFor="revoke-reason" className="block text-sm font-medium">
        เหตุผล
      </label>
      <select
        id="revoke-reason"
        data-testid={TID.certs.revokeReason}
        value={reason}
        onChange={(e) => setReason(e.target.value as RevocationReason | '')}
        className="mt-1 block w-full rounded border border-slate-500 bg-white px-3 py-2 text-base"
      >
        <option value="">เลือกเหตุผล</option>
        {reasons.map((r) => (
          <option key={r} value={r}>
            {REVOCATION_REASON_TH[r]}
          </option>
        ))}
      </select>

      {admin ? (
        <div className="mt-3">
          <label htmlFor="revoke-invalidity" className="block text-sm font-medium">
            วันเวลาที่ใบเริ่มใช้ไม่ได้ (invalidityDate, ไม่บังคับ, เวลาประเทศไทย +07:00)
          </label>
          <input
            id="revoke-invalidity"
            data-testid={TID.certs.revokeInvalidity}
            type="datetime-local"
            value={invalidity}
            onChange={(e) => setInvalidity(e.target.value)}
            className="mt-1 block w-full rounded border border-slate-500 px-3 py-2 text-base"
          />
          <p className="mt-1 text-xs text-slate-700">ใส่เมื่อรู้ว่ากุญแจรั่วก่อนวันที่กดเพิกถอน ต้องไม่เป็นอนาคต</p>
        </div>
      ) : null}

      {shownError ? (
        <p role="alert" className="mt-3 text-sm font-medium text-red-800">
          {shownError}
        </p>
      ) : null}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          ยกเลิก
        </Button>
        <Button type="submit" variant="danger" data-testid={TID.certs.revokeSubmit} disabled={busy || reason === ''}>
          เพิกถอน
        </Button>
      </div>
    </form>
  );
}
