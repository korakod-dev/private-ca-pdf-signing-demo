// /admin/certs (spec 7.6 no. 9): revoke any certificate with a reason and an optional invalidityDate (datetime-local, +07:00),
// and close an account (revokes every live certificate of the user with affiliationChanged). Each action asks for MFA.
// Role: admin-a only (A12), enforced with RequireRole (F15).
import { useState } from 'react';
import { api, demoApi } from '../api';
import { RequireRole } from '../app/RequireRole';
import { formatSimTime } from '../app/DemoBar/format';
import { Button, Card, StateBadge, useApi, LayeredContent } from '../components';
import type { RevokeBody } from '../contracts/api';
import type { PersonaId } from '../contracts/fixtures';
import { TID } from '../contracts/testids';
import { useAppStore } from '../store';
import adminCertsContent from '../content/certs/admin-certs.md?raw';
import { describeError } from './lifecycle/problem';
import { RevokeForm } from './lifecycle/RevokeForm';
import { ADMIN_A_ROLES } from './lifecycle/roles';
import { useMfaGate } from './lifecycle/useMfaGate';

export function AdminCertsPage() {
  return (
    <section data-testid={TID.page('adminCerts')}>
      <h1 className="text-2xl font-bold">Admin — ใบรับรอง</h1>
      <RequireRole roles={ADMIN_A_ROLES}>
        <AdminCertsContent />
      </RequireRole>
    </section>
  );
}

function AdminCertsContent() {
  const refreshDemoStatus = useAppStore((s) => s.refreshDemoStatus);
  const certs = useApi(() => api.certs.list());
  const personas = useApi(() => demoApi.personas());

  const [revoking, setRevoking] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const mfa = useMfaGate((outcome) => {
    setNotice(outcome);
    certs.reload();
    void refreshDemoStatus();
  });

  const nameOf = (id: PersonaId | null) => (id ? (personas.data?.find((p) => p.id === id)?.display_name ?? id) : '—');
  // Everyone who can hold a certificate (admins cannot be closed, engine rule).
  const closable = (personas.data ?? []).filter((p) => p.role !== 'admin-a' && p.role !== 'admin-b');

  const revoke = (serial: string, body: RevokeBody) => {
    setRevoking(null);
    mfa.ask({
      run: (code) => api.certs.revoke(serial, body, code),
      successText: `เพิกถอนใบ ${serial} แล้ว (${body.reason}${body.invalidity_date ? `, invalidityDate ${body.invalidity_date}` : ''}) OCSP เปลี่ยนทันที ส่วน CRL ดูที่หน้า CRL / OCSP`,
    });
  };

  const closeAccount = (id: PersonaId, name: string) =>
    mfa.ask({
      run: (code) => api.admin.closeAccount(id, code),
      successText: `ปิดบัญชีของ ${name} แล้ว ใบรับรองที่ยังใช้งานถูกเพิกถอนด้วยเหตุผล affiliationChanged`,
    });

  return (
    <div className="mt-3 space-y-4">
      <Card title="อ่านก่อนใช้งาน">
        <LayeredContent markdown={adminCertsContent} />
      </Card>

      {notice ? (
        <p
          role={notice.ok ? 'status' : 'alert'}
          className={`rounded border p-3 text-sm font-medium ${notice.ok ? 'border-green-700 bg-green-50 text-green-900' : 'border-red-700 bg-red-50 text-red-900'}`}
        >
          {notice.text}
        </p>
      ) : null}
      {certs.error ? (
        <p role="alert" className="text-sm font-medium text-red-800">
          {describeError(certs.error)}
        </p>
      ) : null}
      {certs.loading && !certs.data ? <p role="status">กำลังโหลดใบรับรอง…</p> : null}

      <Card title="ใบรับรองทั้งหมด">
        <ul className="space-y-3">
          {(certs.data ?? []).map((cert) => (
            <li
              key={cert.serial}
              data-testid={TID.adminCerts.row(cert.serial)}
              data-state={cert.state}
              data-superseded={cert.superseded ? 'true' : 'false'}
              className="rounded border border-slate-300 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="break-all font-mono text-sm font-semibold">{cert.serial}</span>
                <StateBadge state={cert.state} label={cert.superseded ? 'superseded (ถูกแทนที่ด้วยใบใหม่)' : undefined} />
              </div>
              <p className="mt-1 text-sm">
                {cert.subject} · เจ้าของ: {nameOf(cert.holder)}
              </p>
              <p className="mt-1 text-sm text-slate-700">
                ใช้ได้ {formatSimTime(cert.not_before)} ถึง {formatSimTime(cert.not_after)}
              </p>
              {cert.state === 'Revoked' && cert.revoked_at ? (
                <p className="mt-1 text-sm text-slate-700">
                  เพิกถอนเมื่อ {formatSimTime(cert.revoked_at)} · เหตุผล: {cert.revocation_reason}
                  {cert.invalidity_date ? ` · ใช้ไม่ได้ตั้งแต่ ${formatSimTime(cert.invalidity_date)}` : ''}
                </p>
              ) : null}
              {cert.state === 'Active' || cert.state === 'Issued' ? (
                <div className="mt-2">
                  <Button variant="danger" data-testid={TID.adminCerts.revoke(cert.serial)} onClick={() => setRevoking(cert.serial)} disabled={mfa.busy}>
                    เพิกถอน
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="ปิดบัญชีผู้ใช้">
        <p className="mb-2 text-sm">ปิดบัญชีแล้วใบรับรองที่ยังใช้งานทุกใบของคนนั้นถูกเพิกถอนด้วยเหตุผลเปลี่ยนสังกัด (affiliationChanged)</p>
        <ul className="space-y-2">
          {closable.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2">
              <span className="text-sm">
                {p.display_name} <span className="font-mono text-xs">({p.id})</span>
              </span>
              <Button variant="danger" size="sm" data-testid={TID.adminCerts.closeAccount(p.id)} onClick={() => closeAccount(p.id, p.display_name)} disabled={mfa.busy}>
                ปิดบัญชี
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      <RevokeForm
        open={revoking !== null}
        serial={revoking ?? ''}
        admin
        onSubmit={(input) => revoking && revoke(revoking, input)}
        onCancel={() => setRevoking(null)}
      />
      {mfa.dialog}
    </div>
  );
}
