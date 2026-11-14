// Contract: UI routes (ROUTES) and API routes (API_ROUTES). FROZEN: change only deliberately.
// Cypress specs and pages must take paths from here, never hard-code them.
import type { Role } from './fixtures';

// ====================== UI routes ======================

/** One key per page. 17 spec pages (spec 7.6 numbers 1-17) + the NotFound page. */
export type PageKey =
  | 'home'
  | 'verify'
  | 'verifyResult'
  | 'guide'
  | 'certRequest'
  | 'certs'
  | 'sign'
  | 'adminRequests'
  | 'adminCerts'
  | 'adminStatus'
  | 'login'
  | 'archive'
  | 'pkiStatus'
  | 'missions'
  | 'mailbox'
  | 'about'
  | 'policy'
  | 'notFound';

export const ROUTES = {
  home: '/',
  verify: '/verify',
  verifyResult: (jobId: string) => `/verify/${jobId}`,
  guide: '/guide',
  certRequest: '/certs/request',
  certs: '/certs',
  sign: '/sign',
  adminRequests: '/admin/requests',
  adminCerts: '/admin/certs',
  adminStatus: '/admin/status',
  login: '/login',
  archive: '/archive',
  pkiStatus: '/pki/status',
  missions: '/missions',
  mailbox: '/mailbox',
  about: '/about',
  policy: '/policy',
} as const;

export interface PageRoute {
  key: PageKey;
  /** React Router pattern, e.g. "/verify/:jobId" ("*" for NotFound). */
  pattern: string;
  /** A concrete path to visit (used by Cypress and tests). */
  sample: string;
  title_th: string;
  /** Spec 7.6 page number (0 = demo bar; null = NotFound). */
  spec_no: number | null;
}

/** Every page, in spec order. The smoke spec visits `sample` of each entry. */
export const PAGE_ROUTES: readonly PageRoute[] = [
  { key: 'home', pattern: '/', sample: '/', title_th: 'หน้าแรก', spec_no: 1 },
  { key: 'verify', pattern: '/verify', sample: '/verify', title_th: 'ตรวจเอกสาร', spec_no: 2 },
  { key: 'verifyResult', pattern: '/verify/:jobId', sample: '/verify/job-0001', title_th: 'ผลตรวจ', spec_no: 3 },
  { key: 'guide', pattern: '/guide', sample: '/guide', title_th: 'คู่มือ & Root', spec_no: 4 },
  { key: 'certRequest', pattern: '/certs/request', sample: '/certs/request', title_th: 'ขอใบรับรอง', spec_no: 5 },
  { key: 'certs', pattern: '/certs', sample: '/certs', title_th: 'ใบรับรองของฉัน', spec_no: 6 },
  { key: 'sign', pattern: '/sign', sample: '/sign', title_th: 'โต๊ะเซ็นเอกสาร', spec_no: 7 },
  { key: 'adminRequests', pattern: '/admin/requests', sample: '/admin/requests', title_th: 'Admin — คำขอ', spec_no: 8 },
  { key: 'adminCerts', pattern: '/admin/certs', sample: '/admin/certs', title_th: 'Admin — ใบรับรอง', spec_no: 9 },
  { key: 'adminStatus', pattern: '/admin/status', sample: '/admin/status', title_th: 'Admin — สถานะ & audit', spec_no: 10 },
  { key: 'login', pattern: '/login', sample: '/login', title_th: 'เข้าสู่ระบบ', spec_no: 11 },
  { key: 'archive', pattern: '/archive', sample: '/archive', title_th: 'คลังเอกสาร', spec_no: 12 },
  { key: 'pkiStatus', pattern: '/pki/status', sample: '/pki/status', title_th: 'CRL / OCSP', spec_no: 13 },
  { key: 'missions', pattern: '/missions', sample: '/missions', title_th: 'ภารกิจ', spec_no: 14 },
  { key: 'mailbox', pattern: '/mailbox', sample: '/mailbox', title_th: 'อีเมลจำลอง', spec_no: 15 },
  { key: 'about', pattern: '/about', sample: '/about', title_th: 'เกี่ยวกับการสาธิต', spec_no: 16 },
  { key: 'policy', pattern: '/policy', sample: '/policy', title_th: 'นโยบาย', spec_no: 17 },
  { key: 'notFound', pattern: '*', sample: '/no-such-page', title_th: 'ไม่พบหน้านี้', spec_no: null },
];

/** Home page of each role after a persona switch. */
export const ROLE_HOME: Record<Role, string> = {
  signer: ROUTES.certs,
  new_user: ROUTES.certRequest,
  user: ROUTES.certs,
  verifier: ROUTES.verify,
  'admin-a': ROUTES.adminRequests,
  'admin-b': ROUTES.adminStatus,
};

// ====================== API routes ======================

export type HttpMethod = 'GET' | 'POST';

export interface ApiRouteDef {
  method: HttpMethod;
  /** Path with `:param` segments. Register static paths before parameterised ones
   *  (e.g. /cert-requests/appointments before /cert-requests/:id). */
  path: string;
  /** "always" = X-Demo-MFA required; "admin" = required when the caller is an admin; "none" = never. */
  mfa: 'always' | 'admin' | 'none';
  /** true => lives in src/mocks/demo-only and src/api/demo.ts; must not exist in a real backend. */
  demoOnly: boolean;
}

const real = (method: HttpMethod, path: string, mfa: ApiRouteDef['mfa'] = 'none'): ApiRouteDef => ({
  method,
  path,
  mfa,
  demoOnly: false,
});
const demo = (method: HttpMethod, path: string): ApiRouteDef => ({ method, path, mfa: 'none', demoOnly: true });

/** The full route table. Keys are the engine's RouteKey values. */
export const API_ROUTES = {
  'auth.login': real('POST', '/api/v1/auth/login'),
  'auth.mfa': real('POST', '/api/v1/auth/mfa'),
  'auth.me': real('GET', '/api/v1/auth/me'),
  'auth.logout': real('POST', '/api/v1/auth/logout'),
  'status.public': real('GET', '/api/v1/status'),
  'verify.create': real('POST', '/api/v1/verify'),
  'verify.get': real('GET', '/api/v1/verify/:job_id'),
  'certRequests.appointments': real('GET', '/api/v1/cert-requests/appointments'),
  'certRequests.create': real('POST', '/api/v1/cert-requests'),
  'certRequests.list': real('GET', '/api/v1/cert-requests'),
  'certRequests.get': real('GET', '/api/v1/cert-requests/:id'),
  'certRequests.approve': real('POST', '/api/v1/cert-requests/:id/approve', 'always'),
  'certRequests.reject': real('POST', '/api/v1/cert-requests/:id/reject', 'always'),
  'certs.list': real('GET', '/api/v1/certs'),
  'certs.get': real('GET', '/api/v1/certs/:serial'),
  'certs.revoke': real('POST', '/api/v1/certs/:serial/revoke', 'admin'),
  'certs.renew': real('POST', '/api/v1/certs/:serial/renew'),
  'certs.finalize': real('POST', '/api/v1/certs/:serial/finalize'),
  'pki.cas': real('GET', '/api/v1/pki/cas'),
  'pki.crl': real('GET', '/api/v1/pki/crl/:ca'),
  'pki.ocsp': real('GET', '/api/v1/pki/ocsp/:serial'),
  'archive.list': real('GET', '/api/v1/archive'),
  'archive.add': real('POST', '/api/v1/archive'),
  'archive.share': real('POST', '/api/v1/archive/:id/share'),
  'users.directory': real('GET', '/api/v1/users'),
  'admin.status': real('GET', '/api/v1/admin/status'),
  'admin.audit': real('GET', '/api/v1/admin/audit'),
  'admin.crlIssue': real('POST', '/api/v1/admin/crl/issue', 'always'),
  'admin.closeAccount': real('POST', '/api/v1/admin/users/:user_id/close', 'always'),
  'demo.status': demo('GET', '/api/v1/demo/status'),
  'demo.clock': demo('POST', '/api/v1/demo/clock'),
  'demo.faults': demo('POST', '/api/v1/demo/faults'),
  'demo.reset': demo('POST', '/api/v1/demo/reset'),
  'demo.personas': demo('GET', '/api/v1/demo/personas'),
  'demo.persona': demo('POST', '/api/v1/demo/persona'),
  'demo.samples': demo('GET', '/api/v1/demo/samples'),
  // GET also marks the actor's messages as read after building the response (F8; see MailDto in api.ts).
  'demo.mailbox': demo('GET', '/api/v1/demo/mailbox'),
  'demo.progress': demo('POST', '/api/v1/demo/progress'),
  'demo.workstation': demo('GET', '/api/v1/demo/workstation'),
  'demo.keygen': demo('POST', '/api/v1/demo/workstation/keygen'),
  'sign.review': demo('POST', '/api/v1/sign/review'),
  'sign.commit': demo('POST', '/api/v1/sign'),
} as const satisfies Record<string, ApiRouteDef>;

export type RouteKey = keyof typeof API_ROUTES;
