// Rate limit, queue cap and archive quota (spec 7.1 limits; assumption A30).
import { MS_MINUTE, fromMs, toMs } from './clock';
import { fail } from './http';
import type { Ctx, EngineState } from './types';

/** Max entries kept in the rolling window list, so the state cannot grow without bound under spam. */
const WINDOW_CAP = 200;

/**
 * Registers a POST /verify at `ctx.now` and reports whether it exceeds the rolling-minute limit.
 * Every POST counts (A30), including ones rejected later by validation; `retry_after_s` is the time until a slot frees.
 */
export function registerVerifyPost(ctx: Ctx): { over: boolean; retry_after_s: number } {
  const limit = ctx.state.system.limits.verify_rate_per_min;
  const nowMs = toMs(ctx.now);
  const window = ctx.state.rate.verify_posts.filter((t) => nowMs - toMs(t) < MS_MINUTE);
  const over = window.length >= limit;
  // The (len - limit)-th oldest entry must expire before a new request fits.
  const blocker = over ? window[window.length - limit] : undefined;
  const retry = blocker ? Math.max(1, Math.ceil((toMs(blocker) + MS_MINUTE - nowMs) / 1000)) : 0;
  window.push(fromMs(nowMs));
  ctx.state.rate.verify_posts = window.slice(-WINDOW_CAP);
  return { over, retry_after_s: retry };
}

export function activeJobs(state: EngineState): number {
  return state.jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;
}

/** 503 when the queue_full fault is on or 20 jobs are already queued/running. */
export function assertQueueHasRoom(state: EngineState): void {
  if (state.faults.queue_full) fail(503, 'QUEUE_FULL', 'คิวตรวจเต็ม ลองใหม่ภายหลัง', { retry_after_s: 30 });
  if (activeJobs(state) >= state.system.limits.queue_max) {
    fail(503, 'QUEUE_FULL', 'คิวตรวจเต็ม ลองใหม่ภายหลัง', { retry_after_s: 5 });
  }
}

export function archiveUsage(state: EngineState, owner?: string): number {
  return state.archive
    .filter((a) => a.state !== 'deleted' && (owner === undefined || a.owner === owner))
    .reduce((sum, a) => sum + a.size_bytes, 0);
}

/** 409 QUOTA_EXCEEDED when adding `bytes` would pass the per-user (500 MB) or total (10 GB) quota. */
export function assertArchiveQuota(state: EngineState, owner: string, bytes: number): void {
  const lim = state.system.limits;
  if (archiveUsage(state, owner) + bytes > lim.archive_quota_bytes_user) {
    fail(409, 'QUOTA_EXCEEDED', 'โควตาคลังของคุณเต็ม (500 MB ต่อคน)');
  }
  if (archiveUsage(state) + bytes > lim.archive_quota_bytes_total) {
    fail(409, 'QUOTA_EXCEEDED', 'โควตาคลังรวมเต็ม (10 GB)');
  }
}
