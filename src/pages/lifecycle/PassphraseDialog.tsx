// Passphrase prompt of the "ต่ออายุ" button on /certs (QA F27). Renewal creates a NEW key, so the page asks for the key
// passphrase the same way `pki-tool init|renew` does in the terminal: secret input (type=password), at least 12 characters.
// The typed value is only MEASURED here: `onConfirm` takes no argument, so the passphrase cannot reach the API, the store or
// storage (assumption A26 / A42). The inner form is mounted only while the dialog is open, so the field starts empty every time.
import { useState, type FormEvent } from 'react';
import { Button, Dialog } from '../../components';
import { TID } from '../../contracts/testids';
import { MIN_PASSPHRASE_LENGTH, isPassphraseLongEnough } from '../../terminal/commands/pkiTool';

export interface PassphraseDialogProps {
  open: boolean;
  /** Serial of the certificate being renewed (shown for context). */
  serial: string;
  /** Called (without the passphrase) once a long enough passphrase was typed. */
  onConfirm: () => void;
  onCancel: () => void;
}

export function PassphraseDialog({ open, serial, onConfirm, onCancel }: PassphraseDialogProps) {
  return (
    <Dialog open={open} title="ตั้งรหัสผ่านให้กุญแจใหม่" onClose={onCancel} testId={TID.certs.passphraseDialog}>
      <PassphraseForm serial={serial} onConfirm={onConfirm} onCancel={onCancel} />
    </Dialog>
  );
}

function PassphraseForm({ serial, onConfirm, onCancel }: Omit<PassphraseDialogProps, 'open'>) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!isPassphraseLongEnough(value)) {
      setError(`รหัสผ่านสั้นเกินไป (${Array.from(value).length} ตัวอักษร) ต้องมีอย่างน้อย ${MIN_PASSPHRASE_LENGTH} ตัวอักษร`);
      return;
    }
    setValue(''); // forget it at once; nothing else ever holds it
    onConfirm();
  };

  return (
    <form onSubmit={submit} noValidate>
      <p className="mb-3 text-sm text-slate-700">
        การต่ออายุใบ <span className="break-all font-mono">{serial}</span> สร้างกุญแจส่วนตัวใหม่ ต้องตั้งรหัสผ่านปกป้องกุญแจ
        อย่างน้อย {MIN_PASSPHRASE_LENGTH} ตัวอักษร ระบบสาธิตใช้ค่านี้แค่ตรวจความยาว ไม่ส่งไปที่ไหนและไม่เก็บไว้
      </p>
      <label htmlFor="renew-passphrase-input" className="block text-sm font-medium">
        รหัสผ่านปกป้องกุญแจใหม่
      </label>
      <input
        id="renew-passphrase-input"
        data-testid={TID.certs.passphraseInput}
        type="password"
        autoComplete="new-password"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'renew-passphrase-error' : undefined}
        className="mt-1 block w-full rounded border border-slate-500 px-3 py-2 text-base"
      />
      {error ? (
        <p id="renew-passphrase-error" data-testid={TID.certs.passphraseError} role="alert" className="mt-2 text-sm font-medium text-red-800">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          ยกเลิก
        </Button>
        <Button type="submit" data-testid={TID.certs.passphraseSubmit}>
          ต่ออายุ
        </Button>
      </div>
    </form>
  );
}
