// /archive - document archive (spec 7.6 row 12): list with states, share to another user, items shared with me,
// and deleted rows that keep only the SHA-256 and metadata (spec 7.4). Adding happens from the result page.
// Roles: everyone who is not an admin (engine: archive.* needs a signed-in persona; admins have no archive of their own).
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { RequireRole } from '../app/RequireRole';
import { api } from '../api';
import { Button, Dialog, StateBadge, useApi, LayeredContent } from '../components';
import { getMarkdown as getOpsMarkdown } from './ops/content';
import type { ArchiveDto } from '../contracts/api';
import type { ApiError } from '../contracts/api-client';
import { ROUTES } from '../contracts/routes';
import { TID } from '../contracts/testids';
import { useAppStore } from '../store';
import { ProblemNote } from './ops/ProblemNote';
import { formatBytes, formatTime } from './ops/format';

function ArchiveContent() {
  const user = useAppStore((s) => s.user);
  const list = useApi(() => api.archive.list());
  const directory = useApi(() => api.users.directory());

  const [shareFor, setShareFor] = useState<ArchiveDto | null>(null);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [shareError, setShareError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const people = directory.data ?? [];
  const nameOf = (id: string): string => (id === user?.id ? `${user.display_name} (คุณ)` : (people.find((p) => p.id === id)?.display_name ?? id));

  const rows = [...(list.data ?? [])].sort((a, b) => Date.parse(b.added_at) - Date.parse(a.added_at) || b.id.localeCompare(a.id));
  const usedBytes = rows.filter((r) => r.owner === user?.id && r.state !== 'deleted').reduce((sum, r) => sum + r.size_bytes, 0);
  const chosenTarget = target || people[0]?.id || '';

  const openShare = (row: ArchiveDto) => {
    setShareFor(row);
    setTarget('');
    setShareError(null);
    setMessage(null);
  };

  const submitShare = async (event: FormEvent) => {
    event.preventDefault();
    if (!shareFor || chosenTarget === '') return;
    setBusy(true);
    setShareError(null);
    const result = await api.archive.share(shareFor.id, { user_id: chosenTarget as ArchiveDto['shared_with'][number] });
    setBusy(false);
    if (!result.ok) {
      setShareError(result.error);
      return;
    }
    setMessage(`แชร์ ${shareFor.file_name} ให้ ${nameOf(chosenTarget)} แล้ว ลองสลับบทบาทเป็นคนนั้นเพื่อดูในหน้านี้`);
    setShareFor(null);
    list.reload();
  };

  return (
    <div className="mt-3 space-y-4">
      <LayeredContent markdown={getOpsMarkdown('archive', 'archive')} />
      <p className="text-sm text-slate-800">
        ยังไม่มีเอกสารในคลัง? ไปที่ <Link className="text-blue-800 underline" to={ROUTES.verify}>ตรวจเอกสาร</Link> เลือกเอกสารที่ผ่าน แล้วกด "เก็บเข้าคลัง" ที่หน้าผลตรวจ
      </p>

      {message ? (
        <p role="status" className="rounded border border-green-700 bg-green-50 p-3 font-medium text-green-900">
          {message}
        </p>
      ) : null}
      {list.error ? <ProblemNote error={list.error} /> : null}
      {list.loading && !list.data ? <p role="status">กำลังโหลดรายการในคลัง…</p> : null}
      {list.data ? (
        <p className="text-sm text-slate-800">
          รายการทั้งหมด {rows.length} · พื้นที่ที่คุณใช้ {formatBytes(usedBytes)}
        </p>
      ) : null}
      {list.data && rows.length === 0 ? <p className="rounded border border-dashed border-slate-500 bg-white p-4">ยังไม่มีรายการในคลัง</p> : null}

      <ul className="space-y-3">
        {rows.map((row) => {
          const mine = row.owner === user?.id;
          const deleted = row.state === 'deleted';
          return (
            <li key={row.id} data-testid={TID.archive.row(row.id)} data-state={row.state} className="rounded-lg border border-slate-300 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold break-all">{row.file_name}</h2>
                <StateBadge state={row.state} />
              </div>
              <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                <div>
                  <dt className="inline text-slate-700">รหัสเอกสาร: </dt>
                  <dd className="inline font-mono">{row.document_id}</dd>
                </div>
                <div>
                  <dt className="inline text-slate-700">เจ้าของ: </dt>
                  <dd className="inline">{mine ? nameOf(row.owner) : `${nameOf(row.owner)} (แชร์ให้คุณ)`}</dd>
                </div>
                <div>
                  <dt className="inline text-slate-700">ขนาด: </dt>
                  <dd className="inline">{formatBytes(row.size_bytes)}</dd>
                </div>
                <div>
                  <dt className="inline text-slate-700">เก็บเมื่อ: </dt>
                  <dd className="inline font-mono">{formatTime(row.added_at)}</dd>
                </div>
                <div>
                  <dt className="inline text-slate-700">{deleted ? 'ลบเมื่อ: ' : 'ครบกำหนดเก็บ: '}</dt>
                  <dd className="inline font-mono">{formatTime(deleted && row.deleted_at ? row.deleted_at : row.expires_at)}</dd>
                </div>
                <div>
                  <dt className="inline text-slate-700">ประทับเวลาซ้ำแล้ว: </dt>
                  <dd className="inline">{row.retimestamp_count} ครั้ง</dd>
                </div>
                {row.shared_with.length > 0 ? (
                  <div className="sm:col-span-2">
                    <dt className="inline text-slate-700">แชร์ให้: </dt>
                    <dd className="inline">{row.shared_with.map(nameOf).join(', ')}</dd>
                  </div>
                ) : null}
              </dl>
              <p className="mt-2 text-sm">
                <span className="text-slate-700">SHA-256: </span>
                <code className="break-all">{row.sha256}</code>
              </p>
              {deleted ? (
                <p className="mt-2 text-sm font-medium text-slate-800">เอกสารถูกลบแล้ว เหลือเฉพาะค่า SHA-256 และข้อมูลประกอบข้างต้นเท่านั้น</p>
              ) : null}
              {mine && !deleted ? (
                <div className="mt-3">
                  <Button variant="secondary" data-testid={TID.archive.share(row.id)} onClick={() => openShare(row)}>
                    แชร์ให้ผู้ใช้อื่น
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <Dialog open={shareFor !== null} title="แชร์เอกสารในคลัง" onClose={() => setShareFor(null)}>
        <form onSubmit={(e) => void submitShare(e)} noValidate>
          <p className="mb-3 text-sm text-slate-700">
            ผู้รับจะอ่านรายการนี้ได้ (อ่านอย่างเดียว) เอกสาร: <strong className="break-all">{shareFor?.file_name}</strong>
          </p>
          <label htmlFor="archive-share-target" className="block text-sm font-medium">
            แชร์ให้
          </label>
          <select
            id="archive-share-target"
            data-testid={TID.archive.shareTarget}
            value={chosenTarget}
            onChange={(e) => setTarget(e.target.value)}
            className="mt-1 block w-full rounded border border-slate-500 bg-white px-3 py-2 text-base"
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name}
              </option>
            ))}
          </select>
          {shareError ? <div className="mt-3"><ProblemNote error={shareError} /></div> : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShareFor(null)}>
              ยกเลิก
            </Button>
            <Button type="submit" data-testid={TID.archive.shareSubmit} disabled={busy || chosenTarget === ''}>
              แชร์
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

export function ArchivePage() {
  return (
    <section data-testid={TID.page('archive')}>
      <h1 className="text-2xl font-bold">คลังเอกสาร</h1>
      <RequireRole roles={['signer', 'new_user', 'user', 'verifier']}>
        <ArchiveContent />
      </RequireRole>
    </section>
  );
}
