// "เก็บเข้าคลัง" (spec 7.6 page 3). Enabled only for a TOTAL-PASSED report AND a signed-in persona (the archive is
// per user). The engine enforces the same rule (409 NOT_TOTAL_PASSED); this button just avoids offering a dead end.
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api';
import { Button } from '../../components';
import type { VerifyReport } from '../../contracts/api';
import type { DocumentId } from '../../contracts/fixtures';
import { ROUTES } from '../../contracts/routes';
import { TID } from '../../contracts/testids';
import { useAppStore } from '../../store';

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done' } | { kind: 'error'; message: string };

const ERROR_TH: Record<string, string> = {
  NOT_TOTAL_PASSED: 'เก็บเข้าคลังได้เฉพาะเอกสารที่ผลตรวจเป็น TOTAL-PASSED',
  INVALID_STATE: 'เอกสารนี้อยู่ในคลังของคุณแล้ว',
  QUOTA_EXCEEDED: 'โควตาคลังของคุณเต็ม',
  UNAUTHENTICATED: 'ต้องเลือกบทบาทที่แถบสาธิตก่อนจึงจะเก็บเข้าคลังได้',
};

export function ArchiveAddButton({ report }: { report: VerifyReport }) {
  const user = useAppStore((s) => s.user);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const passed = report.indication === 'TOTAL-PASSED';
  const disabled = !passed || !user || status.kind === 'busy' || status.kind === 'done';

  const add = async () => {
    setStatus({ kind: 'busy' });
    const result = await api.archive.add({ document_id: report.document.id as DocumentId, verify_job_id: report.job_id });
    setStatus(
      result.ok ? { kind: 'done' } : { kind: 'error', message: ERROR_TH[result.error.code] ?? result.error.detail ?? result.error.title },
    );
  };

  return (
    <div>
      <Button data-testid={TID.result.archiveAdd} disabled={disabled} onClick={() => void add()}>
        เก็บเข้าคลัง
      </Button>
      {!passed ? (
        <p className="mt-1 text-sm text-slate-700">เก็บเข้าคลังได้เฉพาะเอกสารที่ผลตรวจเป็น TOTAL-PASSED</p>
      ) : !user ? (
        <p className="mt-1 text-sm text-slate-700">เลือกบทบาท (เช่น ผู้ลงนาม) ที่แถบสาธิตก่อน จึงจะเก็บเข้าคลังได้</p>
      ) : null}
      <div role="status" aria-live="polite">
        {status.kind === 'done' ? (
          <p className="mt-1 text-sm text-green-900">
            เก็บเข้าคลังแล้ว{' '}
            <Link className="text-blue-800 underline" to={ROUTES.archive}>
              ดูที่คลังเอกสาร
            </Link>
          </p>
        ) : null}
        {status.kind === 'error' ? <p className="mt-1 text-sm text-red-900">{status.message}</p> : null}
      </div>
    </div>
  );
}
