// Thai wording for problem+json answers on the verify pages (413 / 422 / 429 / 503 and friends).
// Pure: maps an ApiError to what the page shows. The code decides the text; the status is only a fallback.
import type { ApiError } from '../../contracts/api-client';
import { retryAfterText } from '../info/format';

export interface ProblemView {
  /** Short headline. */
  title: string;
  /** One or two plain sentences: what happened and what to do. */
  detail: string;
  /** Main-spec reference of the violated rule (problem.ref), when the engine sent one. */
  ref: string | null;
}

const BY_CODE: Record<string, { title: string; detail: string }> = {
  PDF_TOO_LARGE: {
    title: 'เอกสารใหญ่เกินกำหนด (413)',
    detail: 'ระบบรับเอกสารไม่เกิน 200 หน้า และไม่เกิน 20 MB เลือกเอกสารตัวอย่างอื่นแทน',
  },
  ENCRYPTED_PDF: {
    title: 'ระบบไม่รับ PDF ที่เข้ารหัส (422)',
    detail: 'ระบบตรวจเอกสารที่เข้ารหัสไม่ได้ ต้องถอดรหัสก่อนส่ง เลือกเอกสารตัวอย่างอื่นแทน',
  },
  NOT_SIGNED: {
    title: 'เอกสารนี้ยังไม่มีลายเซ็นให้ตรวจ (422)',
    detail: 'ต้องมีลายเซ็นหรือตราประทับเวลาอย่างน้อยหนึ่งอย่างจึงจะตรวจได้ ลองเซ็นเอกสารที่หน้า "โต๊ะเซ็นเอกสาร" ก่อน',
  },
  RATE_LIMITED: {
    title: 'ส่งคำขอตรวจถี่เกินไป (429)',
    detail: 'ส่งได้ไม่เกิน 10 ครั้งต่อนาที (เวลาจำลอง) กดเลื่อนเวลา +5 นาทีที่แถบสาธิตแล้วลองใหม่ได้',
  },
  QUEUE_FULL: {
    title: 'คิวตรวจเต็มชั่วคราว (503)',
    detail: 'ตอนนี้มีงานรอตรวจมากเกินไป รอสักครู่แล้วลองใหม่ (ถ้าเปิดสวิตช์ "คิวเต็ม" ที่แถบสาธิตอยู่ ให้ปิดก่อน)',
  },
  NOT_FOUND: {
    title: 'ไม่พบข้อมูลที่ขอ (404)',
    detail: 'ไม่พบงานตรวจนี้ อาจเพราะกดรีเซ็ตการสาธิตไปแล้ว ลองสั่งตรวจใหม่จากหน้า "ตรวจเอกสาร"',
  },
  CRL_UNAVAILABLE: {
    title: 'บริการ CRL ล่ม (503)',
    detail: 'ดึงรายการเพิกถอน (CRL) ไม่ได้ตอนนี้ (อาจเปิดสวิตช์ "CRL ล่ม" ไว้ที่แถบสาธิต) ลองใหม่ภายหลัง',
  },
  OCSP_UNAVAILABLE: {
    title: 'บริการ OCSP ล่ม (503)',
    detail: 'ถามสถานะใบรับรองผ่าน OCSP ไม่ได้ตอนนี้ (อาจเปิดสวิตช์ "OCSP ล่ม" ไว้ที่แถบสาธิต) ลองใหม่ภายหลัง',
  },
  NETWORK_ERROR: {
    title: 'ติดต่อระบบไม่ได้',
    detail: 'ระบบจำลองไม่ตอบ ลองโหลดหน้านี้ใหม่ ถ้ายังไม่ได้ ให้ดูหน้า "เกี่ยวกับการสาธิต" เรื่อง Service Worker',
  },
};

const BY_STATUS: Record<number, { title: string; detail: string }> = {
  413: BY_CODE.PDF_TOO_LARGE!,
  422: BY_CODE.ENCRYPTED_PDF!,
  429: BY_CODE.RATE_LIMITED!,
  503: BY_CODE.QUEUE_FULL!,
};

export function problemView(error: Pick<ApiError, 'status' | 'code' | 'title' | 'detail' | 'retry_after_s' | 'problem'>): ProblemView {
  const known = BY_CODE[error.code] ?? BY_STATUS[error.status];
  const retry = retryAfterText(error);
  const baseDetail = known ? known.detail : (error.detail ?? 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง');
  return {
    title: known ? known.title : error.title,
    detail: retry ? `${baseDetail} (${retry})` : baseDetail,
    ref: error.problem?.ref ?? null,
  };
}
