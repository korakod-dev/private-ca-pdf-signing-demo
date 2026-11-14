// Generic state chip for certificate / request / job / archive states. Carries data-state for Cypress.
// Unknown states render as-is (neutral), so a new engine state never crashes a page.
type Tone = 'good' | 'bad' | 'warn' | 'neutral';

// Keys are the exact state strings of src/contracts/fixtures.ts (CertState, RequestState, JobStatus, ArchiveState).
const STATES: Record<string, { th: string; tone: Tone }> = {
  // CertState
  Requested: { th: 'ส่งคำขอแล้ว', tone: 'warn' },
  Issued: { th: 'ออกแล้ว (รอยืนยันรับ)', tone: 'warn' },
  Active: { th: 'ใช้งานได้', tone: 'good' },
  Revoked: { th: 'เพิกถอนแล้ว', tone: 'bad' },
  Expired: { th: 'หมดอายุ', tone: 'neutral' },
  Rejected: { th: 'ถูกปฏิเสธ', tone: 'bad' },
  ExpiredRequest: { th: 'คำขอหมดอายุ', tone: 'neutral' },
  // RequestState
  draft: { th: 'ร่าง', tone: 'neutral' },
  submitted: { th: 'ส่งแล้ว', tone: 'warn' },
  awaitingInPerson: { th: 'รอพบตัว', tone: 'warn' },
  approved: { th: 'อนุมัติแล้ว', tone: 'good' },
  rejected: { th: 'ปฏิเสธแล้ว', tone: 'bad' },
  expired: { th: 'หมดอายุ', tone: 'neutral' },
  // JobStatus
  queued: { th: 'รอคิว', tone: 'neutral' },
  running: { th: 'กำลังตรวจ', tone: 'warn' },
  done: { th: 'เสร็จแล้ว', tone: 'good' },
  error: { th: 'ผิดพลาด', tone: 'bad' },
  // ArchiveState
  archived: { th: 'เก็บแล้ว', tone: 'good' },
  retimestamped: { th: 'ประทับเวลาซ้ำแล้ว', tone: 'good' },
  expiryNotified: { th: 'แจ้งใกล้ลบแล้ว', tone: 'warn' },
  deleted: { th: 'ลบแล้ว', tone: 'neutral' },
};

const TONE_CLASS: Record<Tone, string> = {
  good: 'bg-green-100 text-green-900 border-green-700',
  bad: 'bg-red-100 text-red-900 border-red-700',
  warn: 'bg-amber-100 text-amber-900 border-amber-700',
  neutral: 'bg-slate-100 text-slate-900 border-slate-500',
};

export interface StateBadgeProps {
  state: string;
  /** Overrides the Thai label (e.g. "superseded" for a Revoked cert whose reason is superseded). */
  label?: string;
  testId?: string;
}

export function StateBadge({ state, label, testId }: StateBadgeProps) {
  const meta = STATES[state] ?? { th: state, tone: 'neutral' as Tone };
  return (
    <span data-testid={testId} data-state={state} className={`inline-block rounded border px-2 py-0.5 text-sm font-medium ${TONE_CLASS[meta.tone]}`}>
      {label ?? meta.th}
    </span>
  );
}
