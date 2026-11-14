// Contract: mission metadata (spec 7.8). FROZEN: change only deliberately.
// Done conditions are evaluated by the engine (`evaluateMissions`); this file holds only static labels.
// Long mission text (intro / what happened) lives in src/content/missions/M*.md.
import type { MissionProgress } from './engine';
import type { PersonaId } from './fixtures';
import { ROUTES } from './routes';

export type MissionId = MissionProgress['id'];

export interface MissionMeta {
  id: MissionId;
  title_th: string;
  /** Persona that should run the mission (first one when several). */
  start_persona: PersonaId;
  role_th: string;
  learns_th: string;
  done_when_th: string;
  start_route: string;
}

export const MISSIONS: readonly MissionMeta[] = [
  { id: 'M1', title_th: 'ติดตั้งและเทียบลายนิ้วมือ Root', start_persona: 'u-guest', role_th: 'ผู้ใช้', learns_th: 'ทำไมต้องเทียบ fingerprint ผ่านช่องทางอื่น', done_when_th: 'กรอก fingerprint ตรง', start_route: ROUTES.guide },
  { id: 'M2', title_th: 'ขอใบรับรองตั้งแต่ต้น', start_persona: 'u-nattapon', role_th: 'u-nattapon → admin-a', learns_th: 'ขั้นตอนขอใบ กุญแจไม่ออกจากเครื่อง พิสูจน์ตัวตนแบบพบตัว', done_when_th: 'ใบของ nattapon เป็น Active', start_route: ROUTES.certRequest },
  { id: 'M3', title_th: 'ปฏิเสธคำขอที่ผิด', start_persona: 'a-admin-a', role_th: 'admin-a', learns_th: 'การตรวจ CSR และการขอใบในชื่อคนอื่น', done_when_th: 'คำขอของ manop เป็น Rejected', start_route: ROUTES.adminRequests },
  { id: 'M4', title_th: 'เซ็นเอกสาร 2 คน', start_persona: 'u-somchai', role_th: 'somchai → wipawan', learns_th: 'ขั้นแสดงเจตนา, certification + approval, B-LTA', done_when_th: 'ได้ D12-s2 ที่ตรวจผ่าน', start_route: ROUTES.sign },
  { id: 'M5', title_th: 'ตรวจเอกสารทุกแบบ', start_persona: 'u-guest', role_th: 'ผู้ตรวจ', learns_th: 'indication / sub_indication, 3 คำถาม, ความต่างจาก Adobe', done_when_th: 'เปิดผลตรวจครบ D01–D11', start_route: ROUTES.verify },
  { id: 'M6', title_th: 'เพิกถอนแล้วดูผลกระทบ', start_persona: 'u-somchai', role_th: 'somchai / admin-a', learns_th: 'OCSP ทันที vs CRL ตามรอบ ผลต่อเอกสารเก่า/ใหม่', done_when_th: 'เห็น R14 บนหน้า /pki/status แล้วตรวจเอกสารที่เซ็นหลังเพิกถอนแล้วไม่ผ่าน', start_route: ROUTES.certs },
  { id: 'M7', title_th: 'ต่ออายุใบรับรอง', start_persona: 'u-aree', role_th: 'u-aree', learns_th: 'สร้างกุญแจใหม่ ไม่ต้องพบตัวถ้าพบตัวไม่เกิน 3 ปี', done_when_th: 'ใบใหม่ Active ใบเก่า superseded', start_route: ROUTES.certs },
  { id: 'M8', title_th: 'เก็บเข้าคลังและย่นเวลา 5 ปี', start_persona: 'u-somchai', role_th: 'somchai', learns_th: 'ประทับเวลาซ้ำ แจ้ง 30 วัน ลบแต่เก็บ hash', done_when_th: 'เอกสารถูกลบ เหลือ SHA-256 ใน audit log', start_route: ROUTES.verify },
  { id: 'M9', title_th: 'เหตุขัดข้องของ TSA', start_persona: 'a-admin-a', role_th: 'admin-a + ผู้ลงนาม', learns_th: 'หยุดออกตราประทับเมื่อเวลาเพี้ยน', done_when_th: 'เปิดสวิตช์ แล้วการเซ็นถูกปฏิเสธ + มี audit event', start_route: ROUTES.adminStatus },
  { id: 'M10', title_th: 'ระบบสถานะล่ม', start_persona: 'u-guest', role_th: 'ผู้ตรวจ', learns_th: 'hard-fail และ INDETERMINATE / TRY_LATER', done_when_th: 'ตรวจ D01 ขณะ OCSP + CRL ล่ม แล้วได้ INDETERMINATE', start_route: ROUTES.verify },
  { id: 'M11', title_th: 'ตรวจ audit log', start_persona: 'a-admin-b', role_th: 'admin-b', learns_th: 'hash chain และการตรวจความครบถ้วน', done_when_th: 'ปุ่มตรวจแจ้งว่า chain ถูกต้อง', start_route: ROUTES.adminStatus },
] as const;
