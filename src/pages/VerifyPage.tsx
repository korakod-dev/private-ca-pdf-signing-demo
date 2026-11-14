// /verify (spec 7.6 page 2): pick one of the 12 sample documents (or try to upload, which only explains why the demo
// cannot check real files), watch the job progress (polled every 500 ms), and land on /verify/:jobId when it is done.
//
// Errors from POST /verify (413 / 422 / 429 / 503) and from a failed job are shown as Thai problem messages that
// include Retry-After when the server sent one (TID.verify.error).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, demoApi } from '../api';
import { Card, StateBadge, useApi, LayeredContent } from '../components';
import { getMarkdown as getInfoMarkdown } from './info/content';
import type { ApiError } from '../contracts/api-client';
import { ROUTES } from '../contracts/routes';
import { TID } from '../contracts/testids';
import { ProblemBox } from './verify/ProblemBox';
import { SampleCard } from './verify/SampleCard';
import { UploadBox } from './verify/UploadBox';
import { useJobPolling } from './verify/useJobPolling';

export function VerifyPage() {
  const navigate = useNavigate();
  const samples = useApi(() => demoApi.samples(), []);

  // Which sample was clicked, and the job it created (null until POST /verify answered 202).
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [postError, setPostError] = useState<ApiError | null>(null);

  const { job, error: pollError } = useJobPolling(jobId);

  // Job finished: go to the result page. (A failed job stays here and is shown below.)
  useEffect(() => {
    if (jobId !== null && job?.status === 'done') navigate(ROUTES.verifyResult(jobId));
  }, [jobId, job?.status, navigate]);

  const start = async (fixtureId: string) => {
    setPostError(null);
    setJobId(null);
    setSubmitting(fixtureId);
    const result = await api.verify.create({ fixture_id: fixtureId });
    if (result.ok) {
      setJobId(result.data.job_id);
    } else {
      setPostError(result.error);
      setSubmitting(null);
    }
  };

  const jobFailed = job?.status === 'error';
  // Busy from the click until the job reaches a final state (done navigates away, error stays on the page).
  const busy = submitting !== null && !jobFailed && pollError === null;

  const shownError: ApiError | null =
    postError ??
    pollError ??
    (jobFailed && job?.error
      ? {
          status: job.error.status,
          code: job.error.code,
          title: job.error.title,
          detail: job.error.detail,
          retry_after_s: job.error.retry_after_s,
          problem: job.error,
        }
      : null);

  return (
    <section data-testid={TID.page('verify')}>
      <h1 className="text-2xl font-bold">ตรวจเอกสาร</h1>
      <div className="mt-3">
        <LayeredContent markdown={getInfoMarkdown('verify/intro')} />
      </div>

      {shownError ? (
        <div className="mt-4">
          <ProblemBox error={shownError} testId={TID.verify.error} />
        </div>
      ) : null}

      {jobId !== null && !jobFailed && pollError === null ? (
        <p
          role="status"
          data-testid={TID.verify.jobProgress}
          data-state={job?.status ?? 'queued'}
          className="mt-4 flex items-center gap-2 rounded border border-blue-700 bg-blue-50 p-3 text-slate-900"
        >
          <span>กำลังตรวจงาน {jobId}</span>
          <StateBadge state={job?.status ?? 'queued'} />
        </p>
      ) : null}

      <div className="mt-6">
        <h2 className="text-lg font-semibold">เลือกเอกสารตัวอย่าง (12 ใบ)</h2>
        {samples.error ? (
          <div className="mt-2">
            <ProblemBox error={samples.error} />
          </div>
        ) : null}
        {samples.loading && !samples.data ? <p className="mt-2 text-slate-700">กำลังโหลดรายการตัวอย่าง…</p> : null}
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(samples.data ?? []).map((s) => (
            <SampleCard key={s.id} sample={s} busy={busy} active={busy && submitting === s.id} onVerify={(id) => void start(id)} />
          ))}
        </ul>
      </div>

      <div className="mt-6">
        <Card title="อัปโหลดไฟล์ของคุณเอง" headingLevel={2}>
          <UploadBox />
        </Card>
      </div>
    </section>
  );
}
