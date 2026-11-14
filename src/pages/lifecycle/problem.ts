// Turns an ApiError (RFC 9457 problem+json, A3) into one Thai sentence for the page. Engine details are already Thai,
// so they win over the generic English `title`. A `ref` (main-spec code of the violated rule, A40) is appended when present.
import type { ApiError } from '../../contracts/api-client';

/** Fallback sentences per problem code; used only when the engine sent no `detail`. */
const FALLBACK_TH: Record<string, string> = {
  UNAUTHENTICATED: 'ยังไม่ได้เข้าสู่ระบบ เลือกบทบาทที่แถบสาธิตด้านบน หรือเข้าสู่ระบบเอง',
  FORBIDDEN: 'บทบาทนี้ไม่มีสิทธิ์ทำรายการนี้',
  MFA_REQUIRED: 'งานนี้ต้องยืนยันรหัส MFA',
  MFA_INVALID: 'รหัส MFA ไม่ถูกต้อง (รหัสสาธิตคือ 246810)',
  INVALID_CREDENTIALS: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
  ACCOUNT_LOCKED: 'บัญชีถูกล็อกชั่วคราว',
  INVALID_STATE: 'ทำรายการนี้ไม่ได้ในสถานะปัจจุบัน',
  INVALID_REQUEST: 'ข้อมูลที่ส่งไม่ถูกต้อง',
  NOT_FOUND: 'ไม่พบข้อมูลที่ต้องการ',
  NETWORK_ERROR: 'ติดต่อระบบจำลองไม่ได้ ลองรีเฟรชหน้านี้',
};

export function describeError(error: ApiError): string {
  const base = error.detail ?? FALLBACK_TH[error.code] ?? error.title;
  const ref = error.problem?.ref;
  return ref ? `${base} (อ้างอิง spec หลัก: ${ref})` : base;
}
