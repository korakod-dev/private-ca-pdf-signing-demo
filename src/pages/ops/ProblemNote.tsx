// Shows an API problem (RFC 9457 + `code`, assumption A3) in Thai: what happened, the code, the main-spec ref when the
// engine sent one, and when to retry. Used by the ops pages (status, archive).
import type { ApiError } from '../../contracts/api-client';

export function ProblemNote({ error, testId }: { error: ApiError; testId?: string }) {
  const ref = error.problem?.ref;
  return (
    <div role="alert" data-testid={testId} data-code={error.code} className="rounded border border-red-700 bg-red-50 p-3 text-sm text-red-900">
      <p className="font-semibold">{error.detail ?? error.title}</p>
      <p className="mt-1">
        รหัส: <code>{error.code}</code>
        {ref ? <> · อ้างอิง {ref}</> : null}
        {error.retry_after_s !== undefined ? <> · ลองใหม่ได้ใน {error.retry_after_s} วินาที</> : null}
      </p>
    </div>
  );
}
