// Thai labels for the verification report (V3 shape, src/contracts/api.ts). Presentation only.
import type { VerifyCheck, VerifyReport } from '../../contracts/api';
import type { Indication, ResultCode, SubIndication } from '../../contracts/fixtures';

export const CHECK_LABEL_TH: Record<VerifyCheck['id'], string> = {
  integrity: 'ลายเซ็นตรงกับข้อมูลที่เซ็น',
  modification: 'เอกสารไม่ถูกแก้หลังเซ็น',
  chain: 'ใบรับรองมาจาก CA ที่เชื่อถือ',
  poe: 'หลักฐานเวลาของลายเซ็น (POE)',
  validity: 'ใบรับรองใช้ได้ตอนเซ็น',
  revocation: 'ใบรับรองไม่ถูกเพิกถอน',
  policy: 'นโยบายตรวจ strict-v1',
};

export const CHECK_RESULT_TH: Record<VerifyCheck['result'], { symbol: string; th: string; cls: string }> = {
  passed: { symbol: '✓', th: 'ผ่าน', cls: 'bg-green-100 text-green-900 border-green-700' },
  failed: { symbol: '✗', th: 'ไม่ผ่าน', cls: 'bg-red-100 text-red-900 border-red-700' },
  indeterminate: { symbol: '?', th: 'ตัดสินไม่ได้', cls: 'bg-amber-100 text-amber-900 border-amber-700' },
  skipped: { symbol: '–', th: 'ข้ามไป', cls: 'bg-slate-100 text-slate-900 border-slate-500' },
};

export const SUB_INDICATION_TH: Record<SubIndication, string> = {
  REVOKED: 'ใบรับรองถูกเพิกถอน',
  NO_CERTIFICATE_CHAIN_FOUND: 'หาสายความน่าเชื่อถือของใบรับรองไม่พบ',
  NO_POE: 'ไม่มีหลักฐานเวลา',
  TRY_LATER: 'ตรวจไม่ได้ตอนนี้ ลองใหม่ภายหลัง',
  HASH_FAILURE: 'ค่า hash ไม่ตรง',
};

export const RESULT_CODE_TH: Record<ResultCode, string> = {
  VALID: 'ถูกต้อง',
  MODIFIED: 'ถูกแก้ไขหลังเซ็น',
  REVOKED: 'ใบรับรองถูกเพิกถอน',
  UNTRUSTED: 'ผู้ลงนามไม่น่าเชื่อถือ',
  NO_POE: 'ไม่มีหลักฐานเวลา',
  TRY_LATER: 'ลองใหม่ภายหลัง',
};

export const INDICATION_SUMMARY_TH: Record<Indication, string> = {
  'TOTAL-PASSED': 'ผ่าน: ทุกลายเซ็นผ่านการตรวจ',
  'TOTAL-FAILED': 'ไม่ผ่าน: พบปัญหาที่ทำให้เชื่อเอกสารนี้ไม่ได้',
  INDETERMINATE: 'ตัดสินไม่ได้: ข้อมูลไม่พอหรือตรวจไม่ได้ในตอนนี้',
};

export const SIGNATURE_TYPE_TH = { certification: 'ลายเซ็นรับรอง (certification)', approval: 'ลายเซ็นอนุมัติ (approval)' } as const;

type Answer = 'yes' | 'no' | 'unknown';

/** One row of the "3 questions" block: the question, the answer in words, and whether the answer is good news. */
export interface QuestionRow {
  key: keyof VerifyReport['questions'];
  question: string;
  answer: string;
  /** 'good' | 'bad' | 'unknown' drives the symbol next to the answer (never color alone). */
  tone: 'good' | 'bad' | 'unknown';
}

const ANSWERS: Record<keyof VerifyReport['questions'], { question: string; good: Answer; text: Record<Answer, string> }> = {
  modified: {
    question: 'เอกสารถูกแก้ไขหลังลงนามหรือไม่',
    good: 'no',
    text: { no: 'ไม่ ไม่พบการแก้ไข', yes: 'ใช่ พบการแก้ไขหลังลงนาม', unknown: 'ตอบไม่ได้' },
  },
  signer_trusted: {
    question: 'ผู้ลงนามมาจาก CA ที่ระบบเชื่อถือหรือไม่',
    good: 'yes',
    text: { yes: 'ใช่ น่าเชื่อถือ', no: 'ไม่ มีผู้ลงนามที่เชื่อถือไม่ได้', unknown: 'ตอบไม่ได้ (ไม่มีผู้ลงนาม)' },
  },
  valid_at_signing: {
    question: 'ใบรับรองใช้ได้ในเวลาที่ลงนามหรือไม่',
    good: 'yes',
    text: { yes: 'ใช่ ใช้ได้', no: 'ไม่ ใช้ไม่ได้ในเวลานั้น', unknown: 'ตอบไม่ได้' },
  },
};

export function questionRows(questions: VerifyReport['questions']): QuestionRow[] {
  return (Object.keys(ANSWERS) as (keyof VerifyReport['questions'])[]).map((key) => {
    const spec = ANSWERS[key];
    const answer = questions[key];
    return {
      key,
      question: spec.question,
      answer: spec.text[answer],
      tone: answer === 'unknown' ? 'unknown' : answer === spec.good ? 'good' : 'bad',
    };
  });
}

/** Distinct warning codes of the document and all its signatures, in first-seen order. */
export function allWarnings(report: Pick<VerifyReport, 'warnings' | 'signatures'>): string[] {
  const seen = new Set<string>();
  for (const w of [...report.warnings, ...report.signatures.flatMap((s) => s.warnings)]) seen.add(w);
  return [...seen];
}
