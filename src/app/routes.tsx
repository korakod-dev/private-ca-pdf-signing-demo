// Route table. The paths are written out here (JSX); they are NOT generated from PAGE_ROUTES in
// src/contracts/routes.ts. Drift is caught by src/test/shell-smoke.test.tsx, which renders every PAGE_ROUTES sample
// and expects the matching page.
// Keep this table in sync with PAGE_ROUTES (see above).
//
// Role-restricted pages (/admin/requests, /admin/certs, /admin/status, /certs/request, /certs, /sign, /archive) wrap their own
// content with <RequireRole roles={[...]}> (./RequireRole), so a wrong persona sees the Thai explanation
// (TID.requireRole.mismatch) instead of a raw 401/403 error. Role lists follow spec 7.2 and the engine access policy
// (src/engine/routes.ts); public pages stay unwrapped. src/app/__tests__/restrictedPages.test.tsx covers every wrapped page
// with wrong persona, allowed persona and no session (QA F15).
import { Route, Routes } from 'react-router';
import { Layout } from './Layout';
import { HomePage } from '../pages/HomePage';
import { VerifyPage } from '../pages/VerifyPage';
import { VerifyResultPage } from '../pages/VerifyResultPage';
import { GuidePage } from '../pages/GuidePage';
import { CertRequestPage } from '../pages/CertRequestPage';
import { MyCertsPage } from '../pages/MyCertsPage';
import { SignPage } from '../pages/SignPage';
import { AdminRequestsPage } from '../pages/AdminRequestsPage';
import { AdminCertsPage } from '../pages/AdminCertsPage';
import { AdminStatusPage } from '../pages/AdminStatusPage';
import { LoginPage } from '../pages/LoginPage';
import { ArchivePage } from '../pages/ArchivePage';
import { PkiStatusPage } from '../pages/PkiStatusPage';
import { MissionsPage } from '../pages/MissionsPage';
import { MailboxPage } from '../pages/MailboxPage';
import { AboutPage } from '../pages/AboutPage';
import { PolicyPage } from '../pages/PolicyPage';
import { NotFoundPage } from '../pages/NotFoundPage';

/** Routes without the router host, so tests can wrap them in a MemoryRouter. */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/verify" element={<VerifyPage />} />
        <Route path="/verify/:jobId" element={<VerifyResultPage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/certs/request" element={<CertRequestPage />} />
        <Route path="/certs" element={<MyCertsPage />} />
        <Route path="/sign" element={<SignPage />} />
        <Route path="/admin/requests" element={<AdminRequestsPage />} />
        <Route path="/admin/certs" element={<AdminCertsPage />} />
        <Route path="/admin/status" element={<AdminStatusPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/archive" element={<ArchivePage />} />
        <Route path="/pki/status" element={<PkiStatusPage />} />
        <Route path="/missions" element={<MissionsPage />} />
        <Route path="/mailbox" element={<MailboxPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/policy" element={<PolicyPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
