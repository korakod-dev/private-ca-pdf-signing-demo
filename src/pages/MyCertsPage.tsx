// /certs (spec 7.6 no. 6): my certificates with state badges; finalize, renew, self-revoke (3 reasons, A11), download.
// Role: signer / new_user / user (RequireRole, F15). Buttons run the same API steps as `pki-tool finalize|renew`.
// Renew first asks the new key's passphrase (>= 12 characters, secret input) like the terminal command; it is never sent or stored (F27).
import { useState } from 'react';
import { api } from '../api';
import { RequireRole } from '../app/RequireRole';
import { formatSimTime } from '../app/DemoBar/format';
import { Button, Card, DownloadDemoFile, StateBadge, useApi, LayeredContent } from '../components';
import type { CertDto } from '../contracts/api';
import type { RevocationReason } from '../contracts/fixtures';
import { TID } from '../contracts/testids';
import { useAppStore } from '../store';
import { finalizeCertificate, renewCertificate } from '../terminal/commands/pkiTool';
import certsContent from '../content/certs/certs.md?raw';
import { describeError } from './lifecycle/problem';
import { PassphraseDialog } from './lifecycle/PassphraseDialog';
import { RevokeForm } from './lifecycle/RevokeForm';
import { REQUESTER_ROLES } from './lifecycle/roles';

/** Text of the explanatory download (never a real certificate file, spec section 5). */
function downloadText(cert: CertDto): string {
  return [
    'ไฟล์นี้เป็นข้อความอธิบายจากระบบสาธิต ไม่ใช่ไฟล์ใบรับรองจริง (.crt) และใช้เซ็นหรือตรวจเอกสารไม่ได้',
    '',
    `serial: ${cert.serial}`,
    `subject: ${cert.subject}`,
    `สถานะ: ${cert.state}${cert.superseded ? ' (superseded)' : ''}`,
    `เริ่มใช้: ${cert.not_before}`,
    `หมดอายุ: ${cert.not_after}`,
    '',
    'ในระบบจริง ไฟล์ใบรับรองมีกุญแจสาธารณะและลายมือชื่อของ CA ส่วนกุญแจส่วนตัวอยู่ในเครื่องของเจ้าของใบเท่านั้น',
  ].join('\n');
}

export function MyCertsPage() {
  return (
    <section data-testid={TID.page('certs')}>
      <h1 className="text-2xl font-bold">ใบรับรองของฉัน</h1>
      <RequireRole roles={REQUESTER_ROLES}>
        <MyCertsContent />
      </RequireRole>
    </section>
  );
}

function MyCertsContent() {
  const user = useAppStore((s) => s.user);
  const refreshDemoStatus = useAppStore((s) => s.refreshDemoStatus);
  const certs = useApi(() => api.certs.list());

  const [busySerial, setBusySerial] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  // Certificate waiting for its renewal passphrase (F27): the button opens the dialog, the dialog confirms, then the renewal runs.
  const [renewing, setRenewing] = useState<CertDto | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  /** Runs one action on a certificate; reloads the list afterwards and shows the outcome. */
  const act = async (serial: string, run: () => Promise<{ ok: true; text: string } | { ok: false; text: string }>) => {
    setBusySerial(serial);
    setNotice(null);
    try {
      const result = await run();
      setNotice({ kind: result.ok ? 'ok' : 'err', text: result.text });
      certs.reload();
      void refreshDemoStatus();
    } finally {
      setBusySerial(null);
    }
  };

  const finalize = (cert: CertDto) =>
    act(cert.serial, async () => {
      const r = await finalizeCertificate(cert.serial);
      return r.ok ? { ok: true, text: `ยืนยันติดตั้งแล้ว ใบ ${cert.serial} ใช้งานได้` } : { ok: false, text: describeError(r.error) };
    });

  /** Runs after the passphrase dialog accepted a long enough passphrase (the value itself is never passed on). */
  const renew = (cert: CertDto) =>
    act(cert.serial, async () => {
      if (!user) return { ok: false, text: 'ยังไม่ได้เลือกบทบาท' };
      const r = await renewCertificate(cert.serial, user);
      if (!r.ok) return { ok: false, text: describeError(r.error) };
      return {
        ok: true,
        text:
          r.data.state === 'approved'
            ? 'สร้างกุญแจใหม่และส่งคำขอต่ออายุแล้ว พบตัวไม่เกิน 3 ปีจึงอนุมัติอัตโนมัติ ใบใหม่ออกแล้ว กด "ยืนยันติดตั้ง" ที่ใบใหม่'
            : 'สร้างกุญแจใหม่และส่งคำขอต่ออายุแล้ว ต้องพบตัวกับผู้ดูแลก่อนจึงจะออกใบใหม่',
      };
    });

  const revoke = async (input: { reason: RevocationReason }) => {
    const serial = revoking;
    if (!serial) return;
    setBusySerial(serial);
    setRevokeError(null);
    try {
      const r = await api.certs.revoke(serial, { reason: input.reason });
      if (!r.ok) {
        setRevokeError(describeError(r.error));
        return;
      }
      setRevoking(null);
      setNotice({ kind: 'ok', text: `เพิกถอนใบ ${serial} แล้ว (${input.reason}) OCSP เปลี่ยนทันที ลองดูที่หน้า CRL / OCSP` });
      certs.reload();
      void refreshDemoStatus();
    } finally {
      setBusySerial(null);
    }
  };

  return (
    <div className="mt-3 space-y-4">
      <Card title="อ่านก่อนใช้งาน">
        <LayeredContent markdown={certsContent} />
      </Card>

      {notice ? (
        <p
          role={notice.kind === 'err' ? 'alert' : 'status'}
          className={`rounded border p-3 text-sm font-medium ${notice.kind === 'err' ? 'border-red-700 bg-red-50 text-red-900' : 'border-green-700 bg-green-50 text-green-900'}`}
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
      {certs.data && certs.data.length === 0 ? (
        <p className="rounded border border-slate-300 bg-white p-3">
          ยังไม่มีใบรับรอง ไปที่หน้า "ขอใบรับรอง" เพื่อเริ่มต้น
        </p>
      ) : null}

      <ul className="space-y-3">
        {(certs.data ?? []).map((cert) => {
          const canAct = busySerial === null;
          return (
            <li
              key={cert.serial}
              data-testid={TID.certs.row(cert.serial)}
              data-state={cert.state}
              data-superseded={cert.superseded ? 'true' : 'false'}
              className="rounded-lg border border-slate-300 bg-white p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="break-all font-mono text-sm font-semibold">{cert.serial}</span>
                <StateBadge state={cert.state} label={cert.superseded ? 'superseded (ถูกแทนที่ด้วยใบใหม่)' : undefined} />
              </div>
              <p className="mt-1 text-sm">{cert.subject}</p>
              <p className="mt-1 text-sm text-slate-700">
                ใช้ได้ {formatSimTime(cert.not_before)} ถึง {formatSimTime(cert.not_after)}
                {cert.state === 'Active' ? ` · เหลือ ${cert.days_left} วัน` : ''}
              </p>
              {cert.state === 'Revoked' && cert.revoked_at ? (
                <p className="mt-1 text-sm text-slate-700">
                  เพิกถอนเมื่อ {formatSimTime(cert.revoked_at)} · เหตุผล: {cert.revocation_reason}
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                {cert.state === 'Issued' ? (
                  <Button data-testid={TID.certs.finalize(cert.serial)} onClick={() => void finalize(cert)} disabled={!canAct}>
                    ยืนยันติดตั้ง (finalize)
                  </Button>
                ) : null}
                {cert.state === 'Active' ? (
                  <Button data-testid={TID.certs.renew(cert.serial)} onClick={() => setRenewing(cert)} disabled={!canAct}>
                    ต่ออายุ
                  </Button>
                ) : null}
                {cert.state === 'Active' || cert.state === 'Issued' ? (
                  <Button
                    variant="danger"
                    data-testid={TID.certs.revoke(cert.serial)}
                    onClick={() => {
                      setRevokeError(null);
                      setRevoking(cert.serial);
                    }}
                    disabled={!canAct}
                  >
                    เพิกถอน
                  </Button>
                ) : null}
                {cert.state === 'Issued' || cert.state === 'Active' || cert.state === 'Revoked' || cert.state === 'Expired' ? (
                  <DownloadDemoFile fileName="DEMO-certificate.txt" content={downloadText(cert)} testId={TID.certs.download(cert.serial)}>
                    ดาวน์โหลด DEMO-certificate.txt
                  </DownloadDemoFile>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <PassphraseDialog
        open={renewing !== null}
        serial={renewing?.serial ?? ''}
        onCancel={() => setRenewing(null)}
        onConfirm={() => {
          const cert = renewing;
          setRenewing(null);
          if (cert) void renew(cert);
        }}
      />

      <RevokeForm
        open={revoking !== null}
        serial={revoking ?? ''}
        admin={false}
        busy={busySerial !== null}
        error={revokeError}
        onSubmit={(input) => void revoke(input)}
        onCancel={() => setRevoking(null)}
      />
    </div>
  );
}
