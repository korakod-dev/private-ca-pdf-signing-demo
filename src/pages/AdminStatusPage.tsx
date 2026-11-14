// /admin/status - service cards, fault toggles, "issue CRL now", the not-simulated list, the audit log table and the
// hash-chain check (spec 7.6 row 10). Roles: admin-a and admin-b (engine policy: admin.status / admin.audit).
//   admin-a: may also issue a CRL (MFA, assumption A12).   admin-b: read-only auditor; his chain check records M11.
import { useState } from 'react';
import { RequireRole } from '../app/RequireRole';
import { api, demoApi } from '../api';
import { Button, Card, FAULT_LABEL_TH, FAULT_TOGGLE_KEYS, MfaDialog, faultPatch, isFaultOn, useApi, LayeredContent } from '../components';
import { getMarkdown as getOpsMarkdown } from './ops/content';
import type { AdminStatusDto, ServiceId } from '../contracts/api';
import { SERVICE_IDS } from '../contracts/api';
import type { ApiError } from '../contracts/api-client';
import { TID } from '../contracts/testids';
import { verifyChain } from '../lib/hashChain';
import { useAppStore } from '../store';
import { AuditTable } from './ops/AuditTable';
import { ProblemNote } from './ops/ProblemNote';
import { formatOffset, formatTime } from './ops/format';

type ServiceState = AdminStatusDto['services'][number]['state'];

const STATE_META: Record<ServiceState, { symbol: string; th: string; cls: string }> = {
  up: { symbol: '✓', th: 'ปกติ', cls: 'border-green-700 bg-green-50' },
  degraded: { symbol: '!', th: 'มีปัญหาบางส่วน', cls: 'border-amber-700 bg-amber-50' },
  down: { symbol: '✗', th: 'ล่ม / หยุดทำงาน', cls: 'border-red-700 bg-red-50' },
};

type ChainState = { phase: 'idle' } | { phase: 'checking' } | { phase: 'done'; valid: boolean; count: number; firstBad?: number; note?: string };

/** Extra lines under a service card, from the structured parts of the admin status. */
function extraLines(id: ServiceId, s: AdminStatusDto): string[] {
  switch (id) {
    case 'tsa':
      return [
        `เวลาต่างจาก NIMT (จำลอง): ${formatOffset(s.tsa.offset_ms)}`,
        `เกณฑ์ที่ยอมรับ: ${formatOffset(s.tsa.limit_ms)}`,
        `สถานะตราประทับเวลา: ${s.tsa.state === 'stopped' ? 'หยุดออกตราประทับ' : 'ออกได้ตามปกติ'}`,
      ];
    case 'verify-queue':
      return [`งานที่กำลังตรวจ: ${s.queue.active} จาก ${s.queue.max}`];
    case 'crl':
      return [`CRL หมายเลข ${s.crl.number} · รอบถัดไป ${formatTime(s.crl.next_update)}`];
    case 'ocsp':
      return [`ใบของ OCSP signer: ${s.ocsp_signer.serial} หมดอายุ ${formatTime(s.ocsp_signer.not_after)}`];
    case 'ca':
      return [];
  }
}

function AdminStatusContent() {
  const user = useAppStore((s) => s.user);
  const faults = useAppStore((s) => s.demo?.faults);
  const status = useApi(() => api.admin.status());
  const audit = useApi(() => api.admin.audit());

  const [busy, setBusy] = useState(false);
  const [faultError, setFaultError] = useState<ApiError | null>(null);
  const [mfaOpen, setMfaOpen] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [crlMessage, setCrlMessage] = useState<string | null>(null);
  const [crlError, setCrlError] = useState<ApiError | null>(null);
  const [chain, setChain] = useState<ChainState>({ phase: 'idle' });

  const isAdminA = user?.role === 'admin-a';

  const onFault = async (key: (typeof FAULT_TOGGLE_KEYS)[number]) => {
    if (!faults) return;
    setBusy(true);
    setFaultError(null);
    const result = await demoApi.setFaults(faultPatch(key, !isFaultOn(key, faults)));
    setBusy(false);
    if (!result.ok) {
      setFaultError(result.error);
      return;
    }
    // Same bookkeeping as the demo bar: show the new status at once, then reload every data hook.
    useAppStore.setState({ demo: result.data });
    useAppStore.getState().bumpDataVersion();
  };

  const onIssueCrl = async (code: string) => {
    setBusy(true);
    setMfaError(null);
    const result = await api.admin.crlIssue(code);
    setBusy(false);
    if (result.ok) {
      setMfaOpen(false);
      setCrlError(null);
      setCrlMessage(`ออก CRL หมายเลข ${result.data.number} แล้ว (มี ${result.data.entries.length} รายการเพิกถอน)`);
      useAppStore.getState().bumpDataVersion();
    } else if (result.error.code === 'MFA_INVALID' || result.error.code === 'MFA_REQUIRED') {
      setMfaError('รหัสยืนยันไม่ถูกต้อง ในระบบสาธิตให้ใช้ 246810');
    } else {
      setMfaOpen(false);
      setCrlMessage(null);
      setCrlError(result.error);
    }
  };

  const onVerifyChain = async () => {
    setChain({ phase: 'checking' });
    // Fetch the log again so the check covers what is stored right now, not what the table showed earlier.
    const fresh = await api.admin.audit();
    if (!fresh.ok) {
      setChain({ phase: 'done', valid: false, count: 0, note: `อ่าน audit log ไม่ได้: ${fresh.error.title}` });
      return;
    }
    const verdict = await verifyChain(fresh.data);
    if (!verdict.valid) {
      setChain({ phase: 'done', valid: false, count: fresh.data.length, firstBad: verdict.first_bad_seq });
      return;
    }
    // Chain is intact: report it to the demo so mission M11 can complete (the runtime only accepts admin-b).
    const progress = await demoApi.progress('M11.chain_verified');
    void useAppStore.getState().refreshDemoStatus();
    setChain({
      phase: 'done',
      valid: true,
      count: fresh.data.length,
      note: progress.ok ? undefined : 'บันทึกภารกิจ M11 ได้เฉพาะเมื่อใช้บทบาทผู้ดูแล B',
    });
  };

  const services = status.data
    ? SERVICE_IDS.map((id) => status.data?.services.find((s) => s.id === id)).filter((s): s is AdminStatusDto['services'][number] => s !== undefined)
    : [];

  return (
    <div className="mt-3 space-y-6">
      <LayeredContent markdown={getOpsMarkdown('ops', 'status')} />

      <section aria-labelledby="svc-h">
        <h2 id="svc-h" className="mb-2 text-lg font-semibold">
          สถานะบริการ
        </h2>
        {status.error ? <ProblemNote error={status.error} /> : null}
        {status.loading && !status.data ? <p role="status">กำลังโหลดสถานะ…</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {services.map((svc) => {
            const meta = STATE_META[svc.state];
            return (
              <section
                key={svc.id}
                data-testid={TID.adminStatus.service(svc.id)}
                data-state={svc.state}
                className={`rounded-lg border-2 p-3 ${meta.cls}`}
              >
                <h3 className="font-semibold">{svc.label_th}</h3>
                <p className="mt-1 font-medium">
                  <span aria-hidden="true">{meta.symbol} </span>
                  {meta.th}
                </p>
                {svc.detail_th ? <p className="mt-1 text-sm">{svc.detail_th}</p> : null}
                {status.data
                  ? extraLines(svc.id, status.data).map((line) => (
                      <p key={line} className="mt-1 text-sm">
                        {line}
                      </p>
                    ))
                  : null}
              </section>
            );
          })}
        </div>
      </section>

      <Card title="สวิตช์ความผิดพลาด (ใช้ทดลองเท่านั้น)" headingLevel={2}>
        <p className="mb-2 text-sm text-slate-700">กดเพื่อเปิดหรือปิดความผิดพลาดจำลอง แล้วไปดูผลที่หน้าตรวจเอกสารหรือโต๊ะเซ็น</p>
        <div className="flex flex-wrap gap-2">
          {FAULT_TOGGLE_KEYS.map((key) => (
            <Button
              key={key}
              variant="secondary"
              data-testid={TID.adminStatus.fault(key)}
              aria-pressed={faults ? isFaultOn(key, faults) : false}
              disabled={!faults || busy}
              onClick={() => void onFault(key)}
            >
              {FAULT_LABEL_TH[key]}
            </Button>
          ))}
        </div>
        {faultError ? <div className="mt-2"><ProblemNote error={faultError} /></div> : null}
      </Card>

      <Card title="ออก CRL ทันที" headingLevel={2}>
        {isAdminA ? (
          <>
            <p className="mb-2 text-sm text-slate-700">ออกรายการเพิกถอนใหม่ทันทีโดยไม่รอรอบ 06:00 (ต้องยืนยัน MFA)</p>
            <Button data-testid={TID.adminStatus.issueCrl} disabled={busy} onClick={() => { setMfaError(null); setMfaOpen(true); }}>
              ออก CRL ทันที
            </Button>
          </>
        ) : (
          <p className="text-sm text-slate-700">เฉพาะผู้ดูแล A ออก CRL ได้ ผู้ดูแล B เป็นผู้ตรวจสอบ ดูได้อย่างเดียว</p>
        )}
        {crlMessage ? (
          <p role="status" className="mt-2 font-medium text-green-900">
            {crlMessage}
          </p>
        ) : null}
        {crlError ? <div className="mt-2"><ProblemNote error={crlError} /></div> : null}
      </Card>
      <MfaDialog open={mfaOpen} onSubmit={onIssueCrl} onCancel={() => setMfaOpen(false)} error={mfaError} busy={busy} />

      <section aria-labelledby="ns-h">
        <h2 id="ns-h" className="mb-2 text-lg font-semibold">
          สิ่งที่ระบบจริงมีแต่ demo ไม่ได้จำลอง
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {status.data?.not_simulated.map((item) => (
            <li key={item.id} data-not-simulated={item.id} className="rounded border border-dashed border-slate-500 bg-white p-3 text-sm">
              {item.label_th}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="audit-h">
        <h2 id="audit-h" className="mb-2 text-lg font-semibold">
          Audit log และการตรวจ hash chain
        </h2>
        <LayeredContent markdown={getOpsMarkdown('ops', 'audit')} />
        <div className="my-3 flex flex-wrap items-center gap-3">
          <Button data-testid={TID.adminStatus.verifyChain} disabled={chain.phase === 'checking'} onClick={() => void onVerifyChain()}>
            ตรวจ hash chain
          </Button>
          {chain.phase === 'checking' ? <span role="status">กำลังคำนวณ…</span> : null}
        </div>
        {chain.phase === 'done' ? (
          <div
            role="status"
            data-testid={TID.adminStatus.chainResult}
            data-valid={String(chain.valid)}
            className={`mb-3 rounded border-2 p-3 font-medium ${chain.valid ? 'border-green-700 bg-green-50 text-green-900' : 'border-red-700 bg-red-50 text-red-900'}`}
          >
            {chain.valid ? `✓ chain ถูกต้อง ตรวจ ${chain.count} รายการ ไม่พบการแก้ไข` : null}
            {!chain.valid && chain.firstBad !== undefined ? `✗ chain ไม่ถูกต้อง พบความผิดปกติเริ่มที่รายการลำดับ ${chain.firstBad}` : null}
            {!chain.valid && chain.firstBad === undefined ? `✗ ตรวจไม่สำเร็จ ${chain.note ?? ''}` : null}
            {chain.valid && chain.note ? <span className="block text-sm font-normal">{chain.note}</span> : null}
          </div>
        ) : null}
        {audit.error ? <ProblemNote error={audit.error} /> : null}
        {audit.loading && !audit.data ? <p role="status">กำลังโหลด audit log…</p> : null}
        {audit.data ? <AuditTable entries={audit.data} /> : null}
      </section>
    </div>
  );
}

export function AdminStatusPage() {
  return (
    <section data-testid={TID.page('adminStatus')}>
      <h1 className="text-2xl font-bold">Admin — สถานะ & audit</h1>
      <RequireRole roles={['admin-a', 'admin-b']}>
        <AdminStatusContent />
      </RequireRole>
    </section>
  );
}
