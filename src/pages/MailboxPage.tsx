// /mailbox (spec 7.6 no. 15): the simulated mailbox (Mailpit-like) of the acting persona: list + detail.
//
// QA F13: GET demo.mailbox marks the persona's mail as read AFTER building the response (src/engine/mail.ts readMailbox),
// and React StrictMode runs effects twice in dev. So the mailbox is fetched ONCE per visit and per persona: the promise
// is kept in a ref, the second effect run re-uses it, and the first response (with its `read: false` flags) is what we render.
// Unread styling therefore survives StrictMode, and a re-render never asks again.
import { useEffect, useRef, useState } from 'react';
import { demoApi } from '../api';
import { formatSimTime } from '../app/DemoBar/format';
import { Card, LayeredContent } from '../components';
import type { MailDto } from '../contracts/api';
import type { ApiError, ApiResult } from '../contracts/api-client';
import { TID } from '../contracts/testids';
import { useAppStore } from '../store';
import mailboxContent from '../content/certs/mailbox.md?raw';
import { describeError } from './lifecycle/problem';

const KIND_TH: Record<MailDto['kind'], string> = {
  email_verify: 'ยืนยันอีเมล',
  approved: 'อนุมัติคำขอ',
  rejected: 'ปฏิเสธคำขอ',
  expiry_notice: 'ใกล้หมดอายุ',
  archive_notice: 'คลังเอกสาร: ใกล้ครบ 5 ปี',
  archive_deleted: 'คลังเอกสาร: ลบแล้ว',
};

type Loaded = { userId: string; mail: MailDto[] | null; error: ApiError | null };

export function MailboxPage() {
  const userId = useAppStore((s) => s.user?.id ?? null);
  const refreshDemoStatus = useAppStore((s) => s.refreshDemoStatus);

  // One request per persona per visit. A ref (not state) so StrictMode's second effect run finds the same promise.
  const fetched = useRef<{ userId: string; promise: Promise<ApiResult<MailDto[]>> } | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    if (fetched.current?.userId !== userId) fetched.current = { userId, promise: demoApi.mailbox() };
    const { promise } = fetched.current;
    let live = true;
    void promise.then((result) => {
      if (!live) return;
      setLoaded(result.ok ? { userId, mail: result.data, error: null } : { userId, mail: null, error: result.error });
      if (result.ok) {
        setSelected((current) => current ?? result.data[0]?.id ?? null);
        void refreshDemoStatus(); // the server marked the mail read: refresh the unread badge in the menu
      }
    });
    return () => {
      live = false;
    };
  }, [userId, refreshDemoStatus]);

  // Ignore a result that belongs to another persona (the user switched while the request was running).
  const current = loaded && loaded.userId === userId ? loaded : null;
  const mail = current?.mail ?? [];
  const open = mail.find((m) => m.id === selected) ?? mail[0] ?? null;

  return (
    <section data-testid={TID.page('mailbox')}>
      <h1 className="text-2xl font-bold">อีเมลจำลอง</h1>
      <div className="mt-3 space-y-4">
        <Card title="กล่องจดหมายนี้ทำงานอย่างไร">
          <LayeredContent markdown={mailboxContent} />
        </Card>

        {!userId ? (
          <p role="status" className="rounded border border-amber-600 bg-amber-50 p-3">
            ยังไม่ได้เลือกบทบาท เลือกบทบาทที่ช่อง "สลับบทบาท" บนแถบสาธิตเพื่อดูกล่องจดหมายของคนนั้น
          </p>
        ) : null}
        {userId && !current ? <p role="status">กำลังโหลดกล่องจดหมาย…</p> : null}
        {current?.error ? (
          <p role="alert" className="text-sm font-medium text-red-800">
            {describeError(current.error)}
          </p>
        ) : null}
        {current?.mail && mail.length === 0 ? <p className="rounded border border-slate-300 bg-white p-3">ยังไม่มีจดหมาย</p> : null}

        {mail.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <ul data-testid={TID.mailbox.list} aria-label="รายการจดหมาย" className="space-y-2">
              {mail.map((m, i) => (
                <li key={m.id} data-testid={TID.mailbox.message(i)} data-read={m.read ? 'true' : 'false'} data-kind={m.kind}>
                  <button
                    type="button"
                    onClick={() => setSelected(m.id)}
                    aria-current={open?.id === m.id ? 'true' : undefined}
                    className={`w-full rounded border p-3 text-left focus-visible:outline-2 focus-visible:outline-blue-700 ${open?.id === m.id ? 'border-blue-800 bg-blue-50' : 'border-slate-300 bg-white'}`}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      {!m.read ? <span className="rounded bg-blue-800 px-1.5 py-0.5 text-xs font-semibold text-white">ใหม่</span> : null}
                      <span className={m.read ? 'font-normal' : 'font-bold'}>{m.subject_th}</span>
                    </span>
                    <span className="mt-1 block text-xs text-slate-700">
                      {KIND_TH[m.kind]} · {formatSimTime(m.at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {open ? (
              <article aria-label="เนื้อหาจดหมาย" className="rounded border border-slate-300 bg-white p-4">
                <h2 className="text-lg font-semibold">{open.subject_th}</h2>
                <p className="mt-1 text-xs text-slate-700">
                  ถึง {open.to} · {formatSimTime(open.at)} · {KIND_TH[open.kind]}
                </p>
                {/* Plain text on purpose: the body is not Markdown. */}
                <p className="mt-3 whitespace-pre-wrap break-words">{open.body_th}</p>
              </article>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
