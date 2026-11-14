// Plain-text body of the "DEMO-report.txt" download (spec section 5: downloads are explanatory .txt only).
// DownloadDemoFile prepends the DEMO watermark line; this adds the report summary and a plain statement that it is not real.
import type { VerifyReport } from '../../contracts/api';
import { formatSimTime } from '../info/format';
import { CHECK_LABEL_TH, CHECK_RESULT_TH, questionRows, allWarnings } from './labels';

export const REPORT_FILE_NAME = 'DEMO-report.txt';

export function buildReportText(report: VerifyReport): string {
  const lines: string[] = [];
  lines.push('รายงานผลตรวจ (จำลอง)');
  lines.push('');
  lines.push(`งานตรวจ: ${report.job_id}`);
  lines.push(`เอกสาร: ${report.document.file_name} (${report.document.id}), ${report.document.pages} หน้า`);
  lines.push(`SHA-256 (ค่าจำลอง): ${report.document.sha256}`);
  lines.push(`เวลาที่ตรวจ (เวลาจำลอง): ${formatSimTime(report.validation_time)}`);
  lines.push(`นโยบาย: ${report.policy}`);
  lines.push('');
  lines.push(`ผลรวม: ${report.indication} / ${report.sub_indication ?? '-'} / ${report.code}`);
  for (const q of questionRows(report.questions)) lines.push(`- ${q.question}: ${q.answer}`);
  const warnings = allWarnings(report);
  lines.push(`คำเตือน: ${warnings.length > 0 ? warnings.join(', ') : 'ไม่มี'}`);
  for (const sig of report.signatures) {
    lines.push('');
    lines.push(`ลายเซ็น ${sig.id} (ช่อง ${sig.field}, ${sig.type}, ระดับ ${sig.level}): ${sig.indication} / ${sig.code}`);
    lines.push(`  ผู้ลงนาม (ชื่อสมมติ): ${sig.signer.subject}`);
    for (const c of sig.checks) lines.push(`  - ${CHECK_LABEL_TH[c.id]}: ${CHECK_RESULT_TH[c.result].th} (${c.code})`);
  }
  lines.push('');
  lines.push('ไฟล์นี้เป็นข้อความอธิบายจากระบบจำลอง ไม่ใช่รายงาน PDF ที่ลงลายมือชื่อจริง และไม่ใช่ผลตรวจจริง');
  return lines.join('\n');
}
