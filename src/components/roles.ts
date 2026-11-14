// Thai labels for roles (used by the persona switcher and RequireRole).
import type { Role } from '../contracts/fixtures';

export const ROLE_LABEL_TH: Record<Role, string> = {
  signer: 'ผู้ลงนาม',
  new_user: 'ผู้ใช้ใหม่',
  user: 'ผู้ใช้',
  verifier: 'ผู้ตรวจ',
  'admin-a': 'ผู้ดูแล A',
  'admin-b': 'ผู้ดูแล B',
};
