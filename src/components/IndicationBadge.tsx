// Verification result badge (spec 7.5). Shows a symbol + Thai word + the code, so color is never the only signal.
import type { Indication } from '../contracts/fixtures';

const META: Record<Indication, { symbol: string; th: string; cls: string }> = {
  'TOTAL-PASSED': { symbol: '✓', th: 'ผ่าน', cls: 'bg-green-100 text-green-900 border-green-700' },
  'TOTAL-FAILED': { symbol: '✗', th: 'ไม่ผ่าน', cls: 'bg-red-100 text-red-900 border-red-700' },
  INDETERMINATE: { symbol: '?', th: 'ตัดสินไม่ได้', cls: 'bg-amber-100 text-amber-900 border-amber-700' },
};

export interface IndicationBadgeProps {
  indication: Indication;
  /** Pass TID.result.indication on the result page. The element also carries data-indication. */
  testId?: string;
}

export function IndicationBadge({ indication, testId }: IndicationBadgeProps) {
  const meta = META[indication];
  return (
    <span
      data-testid={testId}
      data-indication={indication}
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-sm font-semibold ${meta.cls}`}
    >
      <span aria-hidden="true">{meta.symbol}</span>
      <span>{meta.th}</span>
      <span className="font-mono text-xs">({indication})</span>
    </span>
  );
}
