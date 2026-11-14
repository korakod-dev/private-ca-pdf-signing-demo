// Audit log table (newest first). Scrollable inside its own region, which is keyboard-focusable so the rows can be
// scrolled without a mouse (axe: scrollable-region-focusable). `details` is shown as `key=value` pairs; archive.deleted
// entries therefore show their `sha256=...` in full.
import type { AuditEntry } from '../../contracts/engine';
import { TID } from '../../contracts/testids';
import { formatTime } from './format';

/** `key=value` text for one audit entry's details. */
export function detailsText(details: AuditEntry['details']): string {
  return Object.entries(details)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' · ');
}

export function AuditTable({ entries }: { entries: readonly AuditEntry[] }) {
  const rows = [...entries].sort((a, b) => b.seq - a.seq);
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div tabIndex={0} role="region" aria-label="ตาราง audit log (เลื่อนดูได้)" className="max-h-96 overflow-auto rounded border border-slate-300 bg-white">
      <table data-testid={TID.adminStatus.auditTable} data-count={rows.length} className="w-full min-w-[40rem] border-collapse text-left text-sm">
        <caption className="sr-only">บันทึกเหตุการณ์ของระบบ เรียงจากใหม่ไปเก่า ทั้งหมด {rows.length} รายการ</caption>
        <thead className="sticky top-0 bg-slate-100">
          <tr>
            <th scope="col" className="px-2 py-1">#</th>
            <th scope="col" className="px-2 py-1">เวลาจำลอง</th>
            <th scope="col" className="px-2 py-1">ผู้ทำ</th>
            <th scope="col" className="px-2 py-1">เหตุการณ์</th>
            <th scope="col" className="px-2 py-1">เป้าหมาย</th>
            <th scope="col" className="px-2 py-1">รายละเอียด</th>
            <th scope="col" className="px-2 py-1">hash</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.seq} data-action={e.action} className="border-t border-slate-200 align-top">
              <td className="px-2 py-1 font-mono">{e.seq}</td>
              <td className="whitespace-nowrap px-2 py-1 font-mono">{formatTime(e.at)}</td>
              <td className="px-2 py-1">{e.actor}</td>
              <td className="px-2 py-1 font-mono">{e.action}</td>
              <td className="px-2 py-1 font-mono">{e.target ?? '—'}</td>
              <td className="break-all px-2 py-1 font-mono text-xs">{detailsText(e.details)}</td>
              <td className="px-2 py-1 font-mono text-xs" title={e.hash}>
                {e.hash.slice(0, 12)}…
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
