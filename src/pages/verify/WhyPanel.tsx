// "ทำไมได้ผลนี้" (spec 7.6 page 3): explains the result step by step. For every check the explanation is the content
// file keyed by `check.code` (src/content/results/<CODE>.md); the document-level result and every warning have their own
// files (results/overall/<CODE>, results/warnings/<CODE>). Two layers: simple Thai text, technical details collapsed.
import type { SignatureResult, VerifyCheck, VerifyReport } from '../../contracts/api';
import { Card, IndicationBadge, LayeredContent } from '../../components';
import { TID } from '../../contracts/testids';
import { getMarkdown as getInfoMarkdown } from '../info/content';
import { formatSimTime } from '../info/format';
import { CHECK_LABEL_TH, CHECK_RESULT_TH, RESULT_CODE_TH, SIGNATURE_TYPE_TH, allWarnings } from './labels';

function CheckRow({ check }: { check: VerifyCheck }) {
  const result = CHECK_RESULT_TH[check.result];
  return (
    <li className="rounded border border-slate-200 p-3" data-check-id={check.id} data-check-code={check.code} data-check-result={check.result}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{CHECK_LABEL_TH[check.id]}</span>
        <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-sm font-semibold ${result.cls}`}>
          <span aria-hidden="true">{result.symbol}</span>
          <span>{result.th}</span>
        </span>
        <span className="font-mono text-xs text-slate-700">{check.code}</span>
      </div>
      <div className="mt-2">
        <LayeredContent markdown={getInfoMarkdown(`results/${check.code}`)} />
      </div>
    </li>
  );
}

function SignatureBlock({ sig }: { sig: SignatureResult }) {
  return (
    <Card headingLevel={3} title={`ลายเซ็น ${sig.id} · ช่อง ${sig.field}`}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-800">
        <IndicationBadge indication={sig.indication} />
        <span className="font-mono text-xs">{sig.code}</span>
        <span>{RESULT_CODE_TH[sig.code]}</span>
      </div>
      <dl className="mb-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        <div>
          <dt className="inline font-medium">ผู้ลงนาม (ชื่อสมมติ): </dt>
          <dd className="inline">{sig.signer.subject}</dd>
        </div>
        <div>
          <dt className="inline font-medium">ประเภท: </dt>
          <dd className="inline">{SIGNATURE_TYPE_TH[sig.type]}</dd>
        </div>
        <div>
          <dt className="inline font-medium">ระดับ: </dt>
          <dd className="inline font-mono">{sig.level}</dd>
        </div>
        <div>
          <dt className="inline font-medium">เวลาที่อ้างว่าเซ็น: </dt>
          <dd className="inline">{formatSimTime(sig.signing_time)}</dd>
        </div>
        <div>
          <dt className="inline font-medium">ตราประทับเวลา: </dt>
          <dd className="inline">{sig.timestamp ? formatSimTime(sig.timestamp.time) : 'ไม่มี'}</dd>
        </div>
      </dl>
      <ol className="space-y-2">
        {sig.checks.map((c) => (
          <CheckRow key={c.id} check={c} />
        ))}
      </ol>
    </Card>
  );
}

export function WhyPanel({ report }: { report: VerifyReport }) {
  const warnings = allWarnings(report);
  return (
    <section data-testid={TID.result.why} aria-labelledby="why-heading" className="space-y-3">
      <h2 id="why-heading" className="text-xl font-semibold">
        ทำไมได้ผลนี้
      </h2>
      <Card headingLevel={3} title={`ภาพรวม: ${RESULT_CODE_TH[report.code]}`}>
        <LayeredContent markdown={getInfoMarkdown(`results/overall/${report.code}`)} />
      </Card>
      {warnings.length > 0 ? (
        <Card headingLevel={3} title="คำเตือนที่ควรรู้">
          <ul className="space-y-3">
            {warnings.map((w) => (
              <li key={w}>
                <p className="font-mono text-sm font-semibold">{w}</p>
                <LayeredContent markdown={getInfoMarkdown(`results/warnings/${w}`)} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {report.signatures.length === 0 ? (
        <Card headingLevel={3} title="ไม่มีลายเซ็นของผู้ลงนาม">
          <p>เอกสารนี้มีเฉพาะตราประทับเวลาของเอกสาร จึงไม่มีรายการตรวจรายลายเซ็น</p>
          {report.doc_timestamps.length > 0 ? (
            <ul className="mt-2 list-disc pl-6 text-sm">
              {report.doc_timestamps.map((t) => (
                <li key={`${t.time}-${t.tsa_serial}`}>ตราประทับเวลา {formatSimTime(t.time)}</li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : (
        report.signatures.map((s) => <SignatureBlock key={s.id} sig={s} />)
      )}
    </section>
  );
}
