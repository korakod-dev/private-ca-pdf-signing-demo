// Lazy scheduler: replays everything that should have happened between `last_tick` and `now`.
//
// Nothing runs on a timer. Each dispatch/tick calls runScheduler, which walks the window (last_tick, now] and applies
// recurring jobs and time-driven state changes in chronological order:
//   CRL 06:00 daily (nextUpdate +7d) · OCSP signer rotation every 14 days (30-day validity) · retimestamp 03:00 daily (A31)
//   backup 02:00 · request expiry (14 d) · certificate expiry and 30/7/1-day notices · archive notice (30 d) and deletion (5 y)
// Recurring jobs are aggregated into ONE audit draft per job type per tick ({count, from, to}); state-changing events
// (expiry, deletion with sha256, retimestamp, ...) are logged individually. This keeps a P5Y advance under ~500 drafts.
import type { Instant } from '../contracts/fixtures';
import { addDays, dailyTriggers, fromMs, isOnOrBefore, toMs } from './clock';
import { expireRequest } from './machines/request';
import { deleteArchived, noticeAt, notifyExpiry, retimestampRun } from './machines/archive';
import { progressJobs } from './machines/verifyJob';
import { MAIL, sendMail } from './mail';
import { crlEntriesAt } from './revocation';
import { NOTICE_DAYS, emit, ocspSerial } from './state';
import type { Ctx } from './types';

interface TimedEvent {
  t: number;
  /** Tie-breaker for events at the same instant (lower first). */
  order: number;
  run: () => void;
}

/** One draft per job type: how many runs happened in the window, the first and the last run time. */
function aggregate(ctx: Ctx, action: string, times: number[], extra: Record<string, string | number> = {}): void {
  const first = times[0];
  const last = times[times.length - 1];
  if (first === undefined || last === undefined) return;
  emit(ctx, 'system', action, null, { count: times.length, from: fromMs(first), to: fromMs(last), ...extra }, fromMs(last));
}

export function runScheduler(ctx: Ctx): void {
  const s = ctx.state;
  const from = s.last_tick;
  const to = ctx.now;
  if (toMs(to) > toMs(from)) {
    const auditStart = ctx.audit.length;
    const sched = s.system.schedule;
    const inWindow = (i: Instant): boolean => toMs(i) > toMs(from) && isOnOrBefore(i, to);

    // ---- aggregated recurring jobs (their effect depends only on the end of the window) ----
    const backups = dailyTriggers(from, to, sched.backup_hour);
    aggregate(ctx, 'job.backup', backups);

    const crlRuns = dailyTriggers(from, to, sched.crl_hour);
    const lastCrl = crlRuns[crlRuns.length - 1];
    if (lastCrl !== undefined) {
      const at = fromMs(lastCrl);
      s.crl.number += crlRuns.length;
      s.crl.this_update = at;
      s.crl.next_update = addDays(at, sched.crl_next_update_days);
      s.crl.entries = crlEntriesAt(s, at);
      aggregate(ctx, 'job.crl_issue', crlRuns, { last_number: s.crl.number, entries: s.crl.entries.length });
    }

    const rotations: number[] = [];
    for (;;) {
      const k = s.ocsp_signer.index + 1;
      const at = addDays(s.system.epoch, s.system.lifetimes.ocsp_rotate_days * k);
      if (!isOnOrBefore(at, to)) break;
      s.ocsp_signer = {
        serial: ocspSerial(k + 1),
        not_before: at,
        not_after: addDays(at, s.system.lifetimes.ocsp_signer_days),
        index: k,
      };
      rotations.push(toMs(at));
    }
    aggregate(ctx, 'job.ocsp_rotate', rotations, { last_serial: s.ocsp_signer.serial });

    // ---- individually logged, time-ordered events ----
    const events: TimedEvent[] = [];
    const retimestampRuns = dailyTriggers(from, to, sched.retimestamp_hour);
    let restamped = 0;
    if (s.archive.some((a) => a.state !== 'deleted')) {
      for (const t of retimestampRuns) {
        events.push({ t, order: 0, run: () => void (restamped += retimestampRun(ctx, fromMs(t))) });
      }
    }

    for (const rec of s.archive) {
      if (rec.state === 'deleted') continue;
      const notice = noticeAt(rec);
      if (rec.state !== 'expiryNotified' && inWindow(notice)) {
        events.push({ t: toMs(notice), order: 1, run: () => notifyExpiry(ctx, rec, notice) });
      }
      if (inWindow(rec.expires_at)) {
        events.push({ t: toMs(rec.expires_at), order: 2, run: () => deleteArchived(ctx, rec, rec.expires_at) });
      }
    }

    for (const req of s.requests) {
      const open = req.state === 'awaitingInPerson' || req.state === 'submitted' || req.state === 'draft';
      if (open && inWindow(req.expires_at)) {
        events.push({ t: toMs(req.expires_at), order: 3, run: () => expireRequest(ctx, req, req.expires_at) });
      }
    }

    const noticeTimes: number[] = [];
    for (const cert of s.certs) {
      if (cert.state === 'Active') {
        for (const d of NOTICE_DAYS) {
          const at = addDays(cert.not_after, -d);
          const sent = s.cert_notices[cert.serial] ?? [];
          if (!sent.includes(d) && inWindow(at) && cert.holder && isOnOrBefore(cert.not_before, at)) {
            events.push({
              t: toMs(at),
              order: 4,
              run: () => {
                const [subject, body] = MAIL.expiry(cert.serial, d, cert.not_after);
                sendMail(ctx, cert.holder as NonNullable<typeof cert.holder>, 'expiry_notice', subject, body, at);
                s.cert_notices[cert.serial] = [...(s.cert_notices[cert.serial] ?? []), d];
                noticeTimes.push(toMs(at));
              },
            });
          }
        }
      }
      if ((cert.state === 'Active' || cert.state === 'Issued') && inWindow(cert.not_after)) {
        events.push({
          t: toMs(cert.not_after),
          order: 5,
          run: () => {
            cert.state = 'Expired';
            emit(ctx, 'system', 'cert.expired', cert.serial, { holder: cert.holder }, cert.not_after);
          },
        });
      }
    }

    events.sort((a, b) => a.t - b.t || a.order - b.order);
    for (const ev of events) ev.run();
    aggregate(ctx, 'job.retimestamp', retimestampRuns, { restamped });
    noticeTimes.sort((a, b) => a - b);
    aggregate(ctx, 'job.cert_notices', noticeTimes);

    s.last_tick = to;
    // Keep drafts chronological (aggregates are stamped with their last run time).
    const added = ctx.audit.splice(auditStart);
    added.sort((a, b) => toMs(a.at) - toMs(b.at));
    ctx.audit.push(...added);
  }
  progressJobs(ctx);
}
