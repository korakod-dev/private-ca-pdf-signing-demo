// Polls GET /verify/:job_id every 500 ms (assumption A2) until the job is done or failed.
// The first poll runs immediately, so a job that is already done (latency off in test mode) shows up without waiting.
import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { ApiError } from '../../contracts/api-client';
import type { VerifyJobDto } from '../../contracts/api';

export const POLL_INTERVAL_MS = 500;

interface PollState {
  /** The job id this state belongs to (a new id never shows the previous job's data). */
  forId: string | null;
  job: VerifyJobDto | null;
  error: ApiError | null;
}

export interface JobPolling {
  job: VerifyJobDto | null;
  error: ApiError | null;
}

export function useJobPolling(jobId: string | null, intervalMs: number = POLL_INTERVAL_MS): JobPolling {
  const [state, setState] = useState<PollState>({ forId: null, job: null, error: null });

  useEffect(() => {
    if (jobId === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      const result = await api.verify.get(jobId);
      if (cancelled) return;
      if (!result.ok) {
        setState({ forId: jobId, job: null, error: result.error });
        return; // a failed poll (404, network) is final: the page shows the problem
      }
      setState({ forId: jobId, job: result.data, error: null });
      if (result.data.status === 'queued' || result.data.status === 'running') {
        timer = setTimeout(() => void poll(), intervalMs);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [jobId, intervalMs]);

  return state.forId === jobId ? { job: state.job, error: state.error } : { job: null, error: null };
}
