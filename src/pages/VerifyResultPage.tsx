// /verify/:jobId (spec 7.6 page 3): the verification result of one job. A job that is not finished yet is polled every
// 500 ms (same hook as /verify), so opening the link early or reloading the page still ends in the result.
import { Link, useParams } from 'react-router';
import { StateBadge } from '../components';
import type { ApiError } from '../contracts/api-client';
import { ROUTES } from '../contracts/routes';
import { TID } from '../contracts/testids';
import { ProblemBox } from './verify/ProblemBox';
import { ReportView } from './verify/ReportView';
import { useJobPolling } from './verify/useJobPolling';

export function VerifyResultPage() {
  const { jobId = '' } = useParams();
  const { job, error } = useJobPolling(jobId === '' ? null : jobId);

  // A job that finished with an error carries the problem; show it like any other API error.
  const jobError: ApiError | null =
    job?.status === 'error' && job.error
      ? {
          status: job.error.status,
          code: job.error.code,
          title: job.error.title,
          detail: job.error.detail,
          retry_after_s: job.error.retry_after_s,
          problem: job.error,
        }
      : null;
  const shownError = error ?? jobError;
  const pending = !shownError && (job === null || job.status === 'queued' || job.status === 'running');

  return (
    <section data-testid={TID.page('verifyResult')}>
      <h1 className="text-2xl font-bold">ผลตรวจเอกสาร</h1>
      <p className="mt-1 text-sm text-slate-700">
        งานตรวจ <span className="font-mono">{jobId}</span> ·{' '}
        <Link className="text-blue-800 underline" to={ROUTES.verify}>
          ตรวจเอกสารอื่น
        </Link>
      </p>

      {shownError ? (
        <div className="mt-4">
          <ProblemBox error={shownError} testId={TID.verify.error} />
        </div>
      ) : null}

      {pending ? (
        <p
          role="status"
          data-testid={TID.verify.jobProgress}
          data-state={job?.status ?? 'queued'}
          className="mt-4 flex items-center gap-2 rounded border border-blue-700 bg-blue-50 p-3 text-slate-900"
        >
          <span>กำลังตรวจ…</span>
          <StateBadge state={job?.status ?? 'queued'} />
        </p>
      ) : null}

      {job?.status === 'done' && job.result ? (
        <div className="mt-4">
          <ReportView report={job.result} />
        </div>
      ) : null}
    </section>
  );
}
