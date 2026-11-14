// MFA prompt for admin actions (spec 7.2: show the code box every time so the real step is visible).
// Keyboard: focus starts in the input, Enter submits, Esc cancels, Tab stays inside (Dialog).
import { useState, type FormEvent } from 'react';
import { TID } from '../contracts/testids';
import { Button } from './Button';
import { Dialog } from './Dialog';

export interface MfaDialogProps {
  open: boolean;
  /** Receives the typed code. The caller sends it as X-Demo-MFA and decides whether it was accepted. */
  onSubmit: (code: string) => void | Promise<void>;
  onCancel: () => void;
  /** Error text to show (e.g. wrong code). */
  error?: string | null;
  busy?: boolean;
}

export function MfaDialog({ open, onSubmit, onCancel, error, busy = false }: MfaDialogProps) {
  // The inner form is mounted only while open (Dialog renders nothing when closed), so the field starts empty every time.
  return (
    <Dialog open={open} title="ยืนยันตัวตนอีกขั้น (MFA)" onClose={onCancel} testId={TID.mfa.dialog}>
      <MfaForm onSubmit={onSubmit} onCancel={onCancel} error={error} busy={busy} />
    </Dialog>
  );
}

function MfaForm({ onSubmit, onCancel, error, busy }: Omit<MfaDialogProps, 'open'>) {
  const [code, setCode] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (code.trim() === '' || busy) return;
    void onSubmit(code.trim());
  };

  return (
    <form onSubmit={submit} noValidate>
      <p className="mb-3 text-sm text-slate-700">
        งานนี้ต้องยืนยันซ้ำ ในระบบสาธิตให้ใช้รหัส <strong>246810</strong>
      </p>
      <label htmlFor="mfa-code-input" className="block text-sm font-medium">
        รหัสยืนยัน 6 หลัก
      </label>
      <input
        id="mfa-code-input"
        data-testid={TID.mfa.input}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={12}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'mfa-code-error' : undefined}
        className="mt-1 block w-full rounded border border-slate-500 px-3 py-2 text-base"
      />
      {error ? (
        <p id="mfa-code-error" role="alert" className="mt-2 text-sm font-medium text-red-800">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          ยกเลิก
        </Button>
        <Button type="submit" data-testid={TID.mfa.submit} disabled={busy || code.trim() === ''}>
          ยืนยัน
        </Button>
      </div>
    </form>
  );
}
