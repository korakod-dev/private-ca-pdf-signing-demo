// /certs/request (spec 7.6 no. 5): simulated terminal -> `pki-tool init` -> CSR -> appointment -> request in state.
// Role: signer / new_user / user (RequireRole, F15). The CSR comes from the terminal command through the small
// store exported by src/terminal/commands/pkiTool.ts; the passphrase never reaches this page or any API call.
import { useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { RequireRole } from '../app/RequireRole';
import { formatSimTime } from '../app/DemoBar/format';
import { Button, Card, StateBadge, useApi, LayeredContent } from '../components';
import { ROUTES } from '../contracts/routes';
import type { CertRequestDto } from '../contracts/api';
import { TID } from '../contracts/testids';
import { useAppStore } from '../store';
import { TerminalView, type TerminalHandle } from '../terminal';
import { getLatestCsr, setLatestCsr, subscribeLatestCsr } from '../terminal/commands/pkiTool';
import requestContent from '../content/certs/request.md?raw';
import { describeError } from './lifecycle/problem';
import { REQUESTER_ROLES } from './lifecycle/roles';

/** What the learner should do next, per request state. */
const NEXT_STEP_TH: Record<string, string> = {
  submitted: 'ส่งคำขอแล้ว รอผู้ดูแลตรวจ',
  awaitingInPerson: 'รอไปพบผู้ดูแลตามนัด ผู้ดูแลจะตรวจตัวตนและอนุมัติ (สลับเป็น "ผู้ดูแล A" เพื่อลองเป็นผู้อนุมัติ)',
  approved: 'อนุมัติแล้ว ใบรับรองออกแล้ว ไปที่ "ใบรับรองของฉัน" เพื่อยืนยันติดตั้ง',
  rejected: 'คำขอถูกปฏิเสธ ดูเหตุผลที่กล่องอีเมลจำลอง แล้วสร้างคำขอใหม่ได้',
  expired: 'คำขอหมดอายุ (เกิน 14 วัน) สร้างคำขอใหม่ได้',
};

export function CertRequestPage() {
  return (
    <section data-testid={TID.page('certRequest')}>
      <h1 className="text-2xl font-bold">ขอใบรับรอง</h1>
      <RequireRole roles={REQUESTER_ROLES}>
        <CertRequestContent />
      </RequireRole>
    </section>
  );
}

function CertRequestContent() {
  const user = useAppStore((s) => s.user);
  const refreshDemoStatus = useAppStore((s) => s.refreshDemoStatus);

  // CSR created by the terminal command (only the one of the current persona is usable).
  const created = useSyncExternalStore(subscribeLatestCsr, getLatestCsr);
  const csr = created && user && created.persona === user.id ? created : null;

  const appointments = useApi(() => api.certRequests.appointments());
  const requests = useApi(() => api.certRequests.list());

  const terminalRef = useRef<TerminalHandle>(null); // "รัน pki-tool init" button types the example command for the learner
  const [appointmentId, setAppointmentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Newest first (the API sorts that way). A pending request blocks creating another one (engine rule).
  const latest: CertRequestDto | null = requests.data?.[0] ?? null;
  const pending = latest !== null && (latest.state === 'submitted' || latest.state === 'awaitingInPerson');

  const submit = async () => {
    if (!csr || appointmentId === '' || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.certRequests.create({ csr_pem: csr.csr_pem, appointment_id: appointmentId });
      if (!result.ok) {
        setError(describeError(result.error));
        return;
      }
      setLatestCsr(null); // the request now holds the CSR
      setAppointmentId('');
      requests.reload();
      void refreshDemoStatus();
    } finally {
      setBusy(false);
    }
  };

  const exampleCommand = user ? `pki-tool init --name "${user.display_name}" --email ${user.email}` : 'pki-tool init --name "<ชื่อ>" --email <อีเมล>';

  return (
    <div className="mt-3 space-y-4">
      <Card title="ขอใบรับรองทำอย่างไร">
        <LayeredContent markdown={requestContent} />
      </Card>

      {latest ? (
        <Card title="สถานะคำขอของคุณ">
          <div data-testid={TID.request.status} data-state={latest.state} data-request-id={latest.id}>
            <p>
              คำขอ <span className="font-mono">{latest.id}</span> ({latest.kind === 'renewal' ? 'ต่ออายุ' : 'ขอใหม่'}) สถานะ: <StateBadge state={latest.state} />
            </p>
            <p className="mt-2">{NEXT_STEP_TH[latest.state] ?? ''}</p>
            {latest.appointment ? (
              <p className="mt-1 text-sm text-slate-700">
                นัดพบ: {formatSimTime(latest.appointment.at)} · {latest.appointment.location_th}
              </p>
            ) : null}
            <p className="mt-1 text-sm text-slate-700">คำขอหมดอายุ: {formatSimTime(latest.expires_at)}</p>
            {latest.state === 'approved' ? (
              <p className="mt-2">
                <Link className="text-blue-800 underline" to={ROUTES.certs}>
                  ไปที่ใบรับรองของฉัน
                </Link>
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}

      {pending ? (
        <p role="note" className="rounded border border-slate-300 bg-white p-3 text-sm">
          คุณมีคำขอที่รอดำเนินการอยู่แล้ว ส่งคำขอใหม่ไม่ได้จนกว่าจะมีผลตัดสิน
        </p>
      ) : (
        <>
          <Card title="ขั้นที่ 1: สร้างกุญแจและ CSR ในเทอร์มินัลจำลอง">
            <p className="mb-2 text-sm">
              พิมพ์คำสั่งนี้ในช่องด้านล่าง แล้วตั้งรหัสผ่านปกป้องกุญแจอย่างน้อย 12 ตัวอักษร (รหัสผ่านไม่ถูกส่งไปที่ไหน):
            </p>
            <p className="mb-3">
              <code className="break-all rounded bg-slate-100 px-1 py-0.5 text-sm">{exampleCommand}</code>
            </p>
            <p className="mb-3">
              <Button data-testid={TID.request.runInit} onClick={() => terminalRef.current?.runCommand(exampleCommand)}>
                รัน pki-tool init
              </Button>
            </p>
            <TerminalView handleRef={terminalRef} />
          </Card>

          <Card title="ขั้นที่ 2: เลือกนัดหมายและส่งคำขอ">
            {csr ? (
              <div className="mb-3 rounded border border-green-700 bg-green-50 p-3 text-sm" role="status">
                <p className="font-medium">มี CSR พร้อมส่งแล้ว</p>
                <p>
                  ชื่อ: {csr.csr.subject_cn} · อีเมล: {csr.csr.email} · กุญแจ: {csr.csr.key_alg} {csr.csr.key_size} บิต
                </p>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-xs">{csr.csr_pem}</pre>
              </div>
            ) : (
              <p className="mb-3 text-sm text-slate-700">ยังไม่มี CSR ให้พิมพ์คำสั่งในขั้นที่ 1 ก่อน</p>
            )}

            <label htmlFor="request-appointment" className="block text-sm font-medium">
              ช่วงนัดหมายพบผู้ดูแล
            </label>
            <select
              id="request-appointment"
              data-testid={TID.request.appointmentSelect}
              value={appointmentId}
              onChange={(e) => setAppointmentId(e.target.value)}
              disabled={appointments.loading && !appointments.data}
              className="mt-1 block w-full rounded border border-slate-500 bg-white px-3 py-2 text-base"
            >
              <option value="">เลือกช่วงนัดหมาย</option>
              {(appointments.data ?? []).map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {formatSimTime(slot.at)} · {slot.location_th}
                </option>
              ))}
            </select>
            {appointments.error ? (
              <p role="alert" className="mt-2 text-sm text-red-800">
                {describeError(appointments.error)}
              </p>
            ) : null}

            <div className="mt-3">
              <Button data-testid={TID.request.submit} onClick={() => void submit()} disabled={!csr || appointmentId === '' || busy}>
                ส่งคำขอ
              </Button>
            </div>
            {error ? (
              <p role="alert" className="mt-2 text-sm font-medium text-red-800">
                {error}
              </p>
            ) : null}
          </Card>
        </>
      )}

      {requests.error ? (
        <p role="alert" className="text-sm text-red-800">
          {describeError(requests.error)}
        </p>
      ) : null}
    </div>
  );
}
