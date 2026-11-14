// Error box for the verify pages. Carries the problem code/status as data attributes so tests can assert them
// without parsing Thai text. `testId` is TID.verify.error on both verify pages.
import type { ApiError } from '../../contracts/api-client';
import { problemView } from './problems';

export function ProblemBox({ error, testId }: { error: ApiError; testId?: string }) {
  const view = problemView(error);
  return (
    <div
      role="alert"
      data-testid={testId}
      data-code={error.code}
      data-status={error.status}
      className="rounded-lg border border-red-700 bg-red-50 p-4 text-slate-900"
    >
      <p className="font-semibold">{view.title}</p>
      <p className="mt-1">{view.detail}</p>
      {view.ref ? (
        <p className="mt-1 text-sm">
          อ้างอิงรหัสข้อใน spec หลัก: <span className="font-mono">{view.ref}</span>
        </p>
      ) : null}
    </div>
  );
}
