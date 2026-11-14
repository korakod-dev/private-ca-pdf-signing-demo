// Two-layer explanation (spec: simple text first, technical details on demand).
// The technical part sits in a <details> that is COLLAPSED by default.
import type { ReactNode } from 'react';

export interface ExplainProps {
  /** Plain-language text, always visible. */
  children: ReactNode;
  /** Technical details, hidden until the reader opens them. Omit for no details block. */
  technical?: ReactNode;
  testId?: string;
}

export function Explain({ children, technical, testId }: ExplainProps) {
  return (
    <div data-testid={testId} className="text-slate-800">
      <div>{children}</div>
      {technical ? (
        <details className="mt-2 rounded border border-slate-300 bg-slate-50 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-blue-900">รายละเอียดทางเทคนิค</summary>
          <div className="mt-2 text-sm text-slate-800">{technical}</div>
        </details>
      ) : null}
    </div>
  );
}
