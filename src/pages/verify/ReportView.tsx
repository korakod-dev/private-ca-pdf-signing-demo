// The finished report on /verify/:jobId: headline result (indication / sub-indication / code), the 3 questions,
// warnings, the "why" panel, the raw JSON toggle, the watermarked report preview, the demo download and "add to archive".
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { Button, Card, DownloadDemoFile, IndicationBadge, Watermark, LayeredContent } from '../../components';
import { getMarkdown as getInfoMarkdown } from '../info/content';
import type { VerifyReport } from '../../contracts/api';
import { ROUTES } from '../../contracts/routes';
import { TID } from '../../contracts/testids';
import { formatSimTime } from '../info/format';
import { ArchiveAddButton } from './ArchiveAddButton';
import { INDICATION_SUMMARY_TH, RESULT_CODE_TH, SUB_INDICATION_TH, allWarnings, questionRows } from './labels';
import { REPORT_FILE_NAME, buildReportText } from './reportText';
import { WhyPanel } from './WhyPanel';

const TONE_SYMBOL = { good: '✓', bad: '✗', unknown: '?' } as const;
const TONE_WORD = { good: 'ข่าวดี', bad: 'มีปัญหา', unknown: 'ไม่แน่ใจ' } as const;

export function ReportView({ report }: { report: VerifyReport }) {
  const [rawOpen, setRawOpen] = useState(false);
  const rawId = useId();
  const warnings = allWarnings(report);

  return (
    <div className="space-y-6">
      <Card title="ผลตรวจ" headingLevel={2}>
        <div className="flex flex-wrap items-center gap-2">
          <IndicationBadge indication={report.indication} testId={TID.result.indication} />
        </div>
        <p className="mt-2 text-slate-800">{INDICATION_SUMMARY_TH[report.indication]}</p>
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div>
            <dt className="inline font-medium">sub_indication: </dt>
            <dd className="inline" data-testid={TID.result.subIndication} data-value={report.sub_indication ?? ''}>
              {report.sub_indication ? (
                <>
                  <span className="font-mono">{report.sub_indication}</span> ({SUB_INDICATION_TH[report.sub_indication]})
                </>
              ) : (
                '— (ไม่มี)'
              )}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">รหัสผล: </dt>
            <dd className="inline" data-testid={TID.result.code} data-value={report.code}>
              <span className="font-mono">{report.code}</span> ({RESULT_CODE_TH[report.code]})
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">เอกสาร: </dt>
            <dd className="inline break-all">
              {report.document.file_name} ({report.document.id}, {report.document.pages} หน้า)
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">ตรวจเมื่อ (เวลาจำลอง): </dt>
            <dd className="inline">{formatSimTime(report.validation_time)}</dd>
          </div>
        </dl>
      </Card>

      <Card title="3 คำถามที่ควรรู้" headingLevel={2} testId={TID.result.questions}>
        <ul className="space-y-2">
          {questionRows(report.questions).map((q) => (
            <li key={q.key} data-question={q.key} data-tone={q.tone} className="flex flex-wrap gap-x-2">
              <span className="font-medium">{q.question}:</span>
              <span>
                <span aria-hidden="true">{TONE_SYMBOL[q.tone]} </span>
                <span className="sr-only">{TONE_WORD[q.tone]}: </span>
                {q.answer}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <LayeredContent markdown={getInfoMarkdown('verify/questions')} />
        </div>
      </Card>

      <Card title="คำเตือน" headingLevel={2} testId={TID.result.warnings}>
        {warnings.length === 0 ? (
          <p>ไม่มีคำเตือน</p>
        ) : (
          <ul className="list-disc pl-6">
            {warnings.map((w) => (
              <li key={w}>
                <span className="font-mono">{w}</span> (อ่านคำอธิบายในส่วน "ทำไมได้ผลนี้")
              </li>
            ))}
          </ul>
        )}
      </Card>

      <WhyPanel report={report} />

      <Card title="ข้อมูลดิบ (JSON)" headingLevel={2}>
        <Button
          variant="secondary"
          data-testid={TID.result.rawToggle}
          aria-expanded={rawOpen}
          aria-controls={rawId}
          onClick={() => setRawOpen((v) => !v)}
        >
          {rawOpen ? 'ซ่อน JSON ดิบ' : 'ดู JSON ดิบ'}
        </Button>
        <div id={rawId}>
          {rawOpen ? (
            // tabIndex: a long, horizontally scrollable block must be reachable by keyboard.
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            <pre data-testid={TID.result.raw} tabIndex={0} className="mt-3 max-h-96 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-50">
              {JSON.stringify(report, null, 2)}
            </pre>
          ) : null}
        </div>
      </Card>

      <Card title="รายงานผลตรวจ (ตัวอย่าง)" headingLevel={2}>
        <div data-testid={TID.result.reportPreview}>
          <Watermark>
            <div className="min-h-56 space-y-1 border border-slate-300 bg-white p-4 text-sm">
              <p className="text-base font-bold">รายงานผลตรวจลายมือชื่อดิจิทัล (จำลอง)</p>
              <p>
                เอกสาร: {report.document.file_name} ({report.document.id})
              </p>
              <p className="break-all">SHA-256 (ค่าจำลอง): {report.document.sha256}</p>
              <p>ตรวจเมื่อ: {formatSimTime(report.validation_time)} (เวลาจำลอง)</p>
              <p>
                ผลรวม: {report.indication} / {report.sub_indication ?? '—'} / {report.code}
              </p>
              <p>จำนวนลายเซ็น: {report.signatures.length}</p>
              <p className="pt-2 text-slate-700">เอกสารนี้เป็นภาพจำลองเพื่อการเรียนรู้ ไม่ใช่รายงานจริง</p>
            </div>
          </Watermark>
        </div>
        <div className="mt-3 flex flex-wrap items-start gap-4">
          <DownloadDemoFile fileName={REPORT_FILE_NAME} content={buildReportText(report)} testId={TID.result.download}>
            ดาวน์โหลด {REPORT_FILE_NAME}
          </DownloadDemoFile>
          <ArchiveAddButton report={report} />
        </div>
        <p className="mt-3 text-sm text-slate-700">
          ไฟล์ที่ดาวน์โหลดเป็นข้อความอธิบายเท่านั้น ไม่ใช่รายงานจริง อยากลองตรวจเอกสารอื่น?{' '}
          <Link className="text-blue-800 underline" to={ROUTES.verify}>
            กลับไปเลือกเอกสาร
          </Link>
        </p>
      </Card>
    </div>
  );
}
