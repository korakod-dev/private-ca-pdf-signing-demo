// Role gate for pages. NO redirect: a wrong role (or nobody signed in) sees a Thai explanation and a hint to switch role
// in the demo bar, so the learner understands why the page is closed (spec 7.2). Pages wrap their content with it:
//   <RequireRole roles={['admin-a']}>...</RequireRole>
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Role } from '../contracts/fixtures';
import { ROUTES } from '../contracts/routes';
import { TID } from '../contracts/testids';
import { ROLE_LABEL_TH } from '../components/roles';
import { useAppStore } from '../store';

export interface RequireRoleProps {
  /** Roles allowed to see the children. */
  roles: readonly Role[];
  children: ReactNode;
}

export function RequireRole({ roles, children }: RequireRoleProps) {
  const user = useAppStore((s) => s.user);
  const hasToken = useAppStore((s) => s.token !== null);
  const statusKnown = useAppStore((s) => s.demo !== null);

  // A token is stored but the identity has not been loaded yet (page reload): wait instead of flashing the warning.
  if (!user && hasToken && !statusKnown) {
    return (
      <p role="status" className="text-slate-700">
        กำลังตรวจสอบสิทธิ์…
      </p>
    );
  }

  if (user && roles.includes(user.role)) return <>{children}</>;

  const needed = roles.map((r) => ROLE_LABEL_TH[r]).join(' หรือ ');
  return (
    <div
      role="alert"
      data-testid={TID.requireRole.mismatch}
      data-required-roles={roles.join(',')}
      className="rounded-lg border border-amber-600 bg-amber-50 p-4 text-slate-900"
    >
      <h2 className="text-lg font-semibold">หน้านี้สำหรับบทบาท: {needed}</h2>
      <p className="mt-2">
        {user ? (
          <>
            ตอนนี้คุณใช้บทบาท <strong>{ROLE_LABEL_TH[user.role]}</strong> ({user.display_name})
          </>
        ) : (
          <>ตอนนี้ยังไม่ได้เลือกบทบาทหรือเข้าสู่ระบบ</>
        )}
      </p>
      <p className="mt-2">
        วิธีดู: เลือกบทบาทที่ถูกต้องที่ช่อง <strong>“สลับบทบาท”</strong> บนแถบโหมดสาธิตด้านบน (บนมือถือให้กด “เมนูสาธิต” ก่อน) หรือ{' '}
        <Link className="text-blue-800 underline" to={ROUTES.login}>
          ลองล็อกอินเอง
        </Link>
      </p>
    </div>
  );
}
