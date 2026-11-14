// /admin/requests (spec 7.6 no. 8): CSR check results (6), in-person checklist (5 checkboxes, NO data inputs: spec section 5),
// approve (enabled only when all 5 are ticked and every CSR check passed) and reject with reason + note.
// Every approve/reject asks for MFA (X-Demo-MFA). Role: admin-a only (A12), enforced with RequireRole (F15).
import { useState, type FormEvent } from 'react';
import { api, demoApi } from '../api';
import { RequireRole } from '../app/RequireRole';
import { formatSimTime } from '../app/DemoBar/format';
import { Button, Card, Dialog, StateBadge, useApi, LayeredContent } from '../components';
import { REJECT_REASON_CODES, type CertRequestDto, type RejectReasonCode } from '../contracts/api';
import { TID } from '../contracts/testids';
import { useAppStore } from '../store';
import adminRequestsContent from '../content/certs/admin-requests.md?raw';
import { describeError } from './lifecycle/problem';
import { ADMIN_A_ROLES } from './lifecycle/roles';
import { useMfaGate } from './lifecycle/useMfaGate';

/** The five in-person checks (assumption A8). Checkboxes only: the demo never asks for ID numbers, photos or laser codes. */
export const IN_PERSON_CHECKLIST_TH: readonly string[] = [
  'หน้าผู้ขอตรงกับรูปในบัตรที่แสดง',
  'บัตรที่แสดงยังไม่หมดอายุ',
  'ชื่อในบัตรตรงกับชื่อในคำขอ',
  'ผู้ขอยืนยัน fingerprint ของ CSR บนเครื่องของตัวเอง',
  'ผู้ขอรับทราบข้อตกลงผู้ใช้แล้ว',
];

const REJECT_REASON_TH: Record<RejectReasonCode, string> = {
  csr_check_failed: 'CSR ไม่ผ่านการตรวจ (csr_check_failed)',
  identity_mismatch: 'ตัวตนไม่ตรงกับคำขอ (identity_mismatch)',
  other: 'เหตุผลอื่น (other)',
};

const DECIDABLE = new Set<string>(['submitted', 'awaitingInPerson']);

export function AdminRequestsPage() {
  return (
    <section data-testid={TID.page('adminRequests')}>
      <h1 className="text-2xl font-bold">Admin — คำขอใบรับรอง</h1>
      <RequireRole roles={ADMIN_A_ROLES}>
        <AdminRequestsContent />
      </RequireRole>
    </section>
  );
}

function AdminRequestsContent() {
  const refreshDemoStatus = useAppStore((s) => s.refreshDemoStatus);
  const requests = useApi(() => api.certRequests.list());
  const personas = useApi(() => demoApi.personas());

  // Ticks per request id (five booleans). Local only: nothing about them is stored until the approve call.
  const [ticks, setTicks] = useState<Record<string, boolean[]>>({});
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const mfa = useMfaGate((outcome) => {
    setNotice(outcome);
    requests.reload();
    void refreshDemoStatus();
  });

  const nameOf = (id: string) => personas.data?.find((p) => p.id === id)?.display_name ?? id;
  const ticksOf = (id: string) => ticks[id] ?? [false, false, false, false, false];

  const toggle = (id: string, index: number, checked: boolean) =>
    setTicks((prev) => {
      const next = [...(prev[id] ?? [false, false, false, false, false])];
      next[index] = checked;
      return { ...prev, [id]: next };
    });

  const approve = (req: CertRequestDto) => {
    const checklist = ticksOf(req.id) as [boolean, boolean, boolean, boolean, boolean];
    mfa.ask({
      run: (code) => api.certRequests.approve(req.id, { checklist }, code),
      successText: `อนุมัติคำขอ ${req.id} แล้ว ระบบออกใบรับรองและส่งอีเมลแจ้งผู้ขอ`,
    });
  };

  const reject = (id: string, reason_code: RejectReasonCode, note: string) => {
    setRejecting(null);
    mfa.ask({
      run: (code) => api.certRequests.reject(id, { reason_code, note }, code),
      successText: `ปฏิเสธคำขอ ${id} แล้ว ระบบส่งอีเมลแจ้งผู้ขอ`,
    });
  };

  return (
    <div className="mt-3 space-y-4">
      <Card title="อ่านก่อนใช้งาน">
        <LayeredContent markdown={adminRequestsContent} />
      </Card>

      {notice ? (
        <p
          role={notice.ok ? 'status' : 'alert'}
          className={`rounded border p-3 text-sm font-medium ${notice.ok ? 'border-green-700 bg-green-50 text-green-900' : 'border-red-700 bg-red-50 text-red-900'}`}
        >
          {notice.text}
        </p>
      ) : null}
      {requests.error ? (
        <p role="alert" className="text-sm font-medium text-red-800">
          {describeError(requests.error)}
        </p>
      ) : null}
      {requests.loading && !requests.data ? <p role="status">กำลังโหลดคำขอ…</p> : null}
      {requests.data && requests.data.length === 0 ? <p className="rounded border border-slate-300 bg-white p-3">ยังไม่มีคำขอ</p> : null}

      <ul className="space-y-4">
        {(requests.data ?? []).map((req) => {
          const decidable = DECIDABLE.has(req.state);
          const current = ticksOf(req.id);
          const allTicked = current.every(Boolean);
          const checksPass = req.csr_checks.every((c) => c.passed);
          const canApprove = req.state === 'awaitingInPerson' && allTicked && checksPass && !mfa.busy;
          return (
            <li
              key={req.id}
              data-testid={TID.adminRequests.row(req.id)}
              data-state={req.state}
              className="rounded-lg border border-slate-300 bg-white p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">
                  {nameOf(req.requester)} <span className="font-mono text-sm font-normal">({req.id})</span>
                </h2>
                <StateBadge state={req.state} />
                <span className="text-sm text-slate-700">{req.kind === 'renewal' ? 'ต่ออายุ' : 'ขอใหม่'}</span>
              </div>
              <p className="mt-1 text-sm text-slate-700">
                ส่งเมื่อ {formatSimTime(req.created_at)} · หมดอายุ {formatSimTime(req.expires_at)}
                {req.appointment ? ` · นัดพบ ${formatSimTime(req.appointment.at)}` : ''}
              </p>
              <p className="mt-1 text-sm">
                ใน CSR: ชื่อ {req.csr.subject_cn} · อีเมล {req.csr.email} · กุญแจ {req.csr.key_alg} {req.csr.key_size} บิต
              </p>

              <h3 className="mt-3 font-semibold">ผลตรวจ CSR</h3>
              <ul className="mt-1 space-y-1">
                {req.csr_checks.map((check) => (
                  <li
                    key={check.id}
                    data-testid={TID.adminRequests.csrCheck(req.id, check.id)}
                    data-state={check.passed ? 'passed' : 'failed'}
                    className={`rounded border px-2 py-1 text-sm ${check.passed ? 'border-green-700 bg-green-50 text-green-900' : 'border-red-700 bg-red-50 text-red-900'}`}
                  >
                    <span aria-hidden="true">{check.passed ? '✓' : '✗'}</span>{' '}
                    <span className="font-medium">{check.passed ? 'ผ่าน' : 'ไม่ผ่าน'}</span> · {check.id}. {check.label_th}{' '}
                    <span className="font-mono text-xs">[{check.ref}]</span>
                  </li>
                ))}
              </ul>

              {decidable ? (
                <>
                  <fieldset className="mt-3">
                    <legend className="font-semibold">รายการตรวจตอนพบตัว (ติ๊กให้ครบ 5 ช่อง)</legend>
                    <p className="text-xs text-slate-700">ระบบสาธิตไม่มีช่องกรอกเลขบัตรหรือรูปบัตร ติ๊กตามที่ตรวจจริงตอนพบตัวเท่านั้น</p>
                    <div className="mt-1 space-y-1">
                      {IN_PERSON_CHECKLIST_TH.map((label, i) => (
                        <label key={label} className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="mt-1 size-4"
                            data-testid={TID.adminRequests.checklist(req.id, i + 1)}
                            checked={current[i] === true}
                            onChange={(e) => toggle(req.id, i, e.target.checked)}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {!checksPass ? <p className="mt-2 text-sm font-medium text-red-800">CSR ไม่ผ่านการตรวจ จึงอนุมัติไม่ได้ ต้องปฏิเสธคำขอนี้</p> : null}
                  {checksPass && !allTicked ? <p className="mt-2 text-sm text-slate-700">ติ๊กรายการตรวจให้ครบทั้ง 5 ช่องก่อน ปุ่มอนุมัติจึงจะกดได้</p> : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button data-testid={TID.adminRequests.approve(req.id)} onClick={() => approve(req)} disabled={!canApprove}>
                      อนุมัติ
                    </Button>
                    <Button variant="danger" data-testid={TID.adminRequests.reject(req.id)} onClick={() => setRejecting(req.id)} disabled={mfa.busy}>
                      ปฏิเสธ
                    </Button>
                  </div>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>

      <Dialog open={rejecting !== null} title={`ปฏิเสธคำขอ ${rejecting ?? ''}`} onClose={() => setRejecting(null)}>
        {rejecting ? <RejectFields onSubmit={(reason, note) => reject(rejecting, reason, note)} onCancel={() => setRejecting(null)} /> : null}
      </Dialog>
      {mfa.dialog}
    </div>
  );
}

function RejectFields({ onSubmit, onCancel }: { onSubmit: (reason: RejectReasonCode, note: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState<RejectReasonCode>('csr_check_failed');
  const [note, setNote] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(reason, note.trim());
  };

  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor="reject-reason" className="block text-sm font-medium">
        เหตุผลที่ปฏิเสธ
      </label>
      <select
        id="reject-reason"
        data-testid={TID.adminRequests.rejectReason}
        value={reason}
        onChange={(e) => setReason(e.target.value as RejectReasonCode)}
        className="mt-1 block w-full rounded border border-slate-500 bg-white px-3 py-2 text-base"
      >
        {REJECT_REASON_CODES.map((code) => (
          <option key={code} value={code}>
            {REJECT_REASON_TH[code]}
          </option>
        ))}
      </select>
      <label htmlFor="reject-note" className="mt-3 block text-sm font-medium">
        หมายเหตุถึงผู้ขอ (ไม่บังคับ)
      </label>
      <textarea
        id="reject-note"
        data-testid={TID.adminRequests.rejectNote}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        maxLength={300}
        className="mt-1 block w-full rounded border border-slate-500 px-3 py-2 text-base"
      />
      <p className="mt-1 text-xs text-slate-700">อย่าใส่เลขบัตรหรือข้อมูลส่วนตัวจริงของใคร</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          ยกเลิก
        </Button>
        <Button type="submit" variant="danger" data-testid={TID.adminRequests.rejectSubmit}>
          ปฏิเสธคำขอ
        </Button>
      </div>
    </form>
  );
}
