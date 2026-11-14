// / (spec 7.6 page 1): what the demo is, where to start, and the live service status (GET /api/v1/status).
// The status follows the demo state: the fault toggles in the demo bar change it, so the learner sees cause and effect.
import { Link } from 'react-router';
import { Card, useApi } from '../components';
import { api } from '../api';
import { ROUTES } from '../contracts/routes';
import { TID } from '../contracts/testids';
import { ProblemBox } from './verify/ProblemBox';

const STATE_VIEW = {
  up: { symbol: '✓', th: 'ปกติ', cls: 'border-green-700 bg-green-100 text-green-900' },
  degraded: { symbol: '!', th: 'ทำงานบางส่วน', cls: 'border-amber-700 bg-amber-100 text-amber-900' },
  down: { symbol: '✗', th: 'ล่ม', cls: 'border-red-700 bg-red-100 text-red-900' },
} as const;

const START_LINKS = [
  { to: ROUTES.guide, title: 'เริ่มจากคู่มือ', text: 'ฝึกเทียบ fingerprint ของ Root ก่อนเชื่อใบรับรองใดๆ' },
  { to: ROUTES.verify, title: 'ตรวจเอกสาร', text: 'เลือกเอกสารตัวอย่าง 12 ใบ แล้วดูว่าทำไมได้ผลแบบนั้น' },
  { to: ROUTES.pkiStatus, title: 'ดู CRL / OCSP', text: 'ดูรายการเพิกถอนและถามสถานะใบรับรองทีละใบ' },
  { to: ROUTES.missions, title: 'ภารกิจ M1-M11', text: 'โจทย์ฝึกทีละข้อ ตั้งแต่ขอใบรับรองจนถึงตรวจ audit log' },
] as const;

export function HomePage() {
  const status = useApi(() => api.status.get(), []);

  return (
    <section data-testid={TID.page('home')} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">ลายมือชื่อดิจิทัลด้วย CA ส่วนตัว (เดโมให้ลองเล่น)</h1>
        <p className="mt-2 text-slate-800">
          เว็บนี้ให้ลองขั้นตอนทั้งหมดได้ในเบราว์เซอร์ ตั้งแต่ขอใบรับรอง เซ็น ตรวจ เพิกถอน จนถึงเก็บเข้าคลัง 5 ปี ทุกอย่างเป็นข้อมูลจำลอง ไม่มีการเซ็นหรือตรวจเอกสารจริง
              และไม่มีข้อมูลของคุณออกจากเครื่อง
        </p>
        <p className="mt-2 text-slate-800">
          สลับบทบาท เลื่อนเวลา และจำลองบริการล่มได้ที่แถบด้านบน อยากรู้ว่าส่วนไหนต่างจากของจริง ดูที่หน้า{' '}
          <Link className="text-blue-800 underline" to={ROUTES.about}>
            เกี่ยวกับการสาธิต
          </Link>
        </p>
      </div>

      <Card title="เริ่มจากตรงไหนดี" headingLevel={2}>
        <ul className="grid gap-3 sm:grid-cols-2">
          {START_LINKS.map((l) => (
            <li key={l.to} className="rounded border border-slate-300 p-3">
              <Link className="font-semibold text-blue-800 underline" to={l.to}>
                {l.title}
              </Link>
              <p className="mt-1 text-sm text-slate-800">{l.text}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="สถานะบริการตอนนี้" headingLevel={2}>
        {status.error ? <ProblemBox error={status.error} /> : null}
        {!status.data && !status.error ? <p className="text-slate-700">กำลังโหลดสถานะ…</p> : null}
        {status.data ? (
          <ul className="space-y-2">
            {status.data.services.map((s) => {
              const view = STATE_VIEW[s.state];
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-2" data-service={s.id} data-state={s.state}>
                  <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-sm font-semibold ${view.cls}`}>
                    <span aria-hidden="true">{view.symbol}</span>
                    <span>{view.th}</span>
                  </span>
                  <span>{s.label_th}</span>
                </li>
              );
            })}
          </ul>
        ) : null}
        <p className="mt-3 text-sm text-slate-700">ลองกดสวิตช์ "OCSP ล่ม" ที่แถบสาธิตแล้วกลับมาดูหน้านี้</p>
      </Card>
    </section>
  );
}
