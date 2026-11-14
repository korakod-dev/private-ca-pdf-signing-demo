// Real-contract API client (valid against a real backend too). Names route KEYS from the frozen route table only;
// it must not reference demo-only routes (those are in ./demo.ts; enforced by src/mocks/__tests__/separation.test.ts).
import type { ApiClient } from '../contracts/api-client';
import type { Http } from './http';

export function createApiClient(http: Http): ApiClient {
  return {
    auth: {
      login: (body) => http.call('auth.login', { body }),
      mfa: (body) => http.call('auth.mfa', { body }),
      me: () => http.call('auth.me'),
      // POST with no body; 204 resolves to data: null.
      logout: () => http.call('auth.logout'),
    },
    status: {
      get: () => http.call('status.public'),
    },
    verify: {
      create: (body) => http.call('verify.create', { body }),
      get: (jobId) => http.call('verify.get', { params: { job_id: jobId } }),
    },
    certRequests: {
      appointments: () => http.call('certRequests.appointments'),
      create: (body) => http.call('certRequests.create', { body }),
      list: () => http.call('certRequests.list'),
      get: (id) => http.call('certRequests.get', { params: { id } }),
      approve: (id, body, mfa) => http.call('certRequests.approve', { params: { id }, body, mfa }),
      reject: (id, body, mfa) => http.call('certRequests.reject', { params: { id }, body, mfa }),
    },
    certs: {
      list: () => http.call('certs.list'),
      get: (serial) => http.call('certs.get', { params: { serial } }),
      // `mfa` is only sent when given (required for admins, ignored for the owner).
      revoke: (serial, body, mfa) => http.call('certs.revoke', { params: { serial }, body, ...(mfa !== undefined ? { mfa } : {}) }),
      renew: (serial, body) => http.call('certs.renew', { params: { serial }, body }),
      finalize: (serial) => http.call('certs.finalize', { params: { serial } }),
    },
    pki: {
      cas: () => http.call('pki.cas'),
      crl: (ca) => http.call('pki.crl', { params: { ca } }),
      ocsp: (serial) => http.call('pki.ocsp', { params: { serial } }),
    },
    archive: {
      list: () => http.call('archive.list'),
      add: (body) => http.call('archive.add', { body }),
      share: (id, body) => http.call('archive.share', { params: { id }, body }),
    },
    users: {
      directory: () => http.call('users.directory'),
    },
    admin: {
      status: () => http.call('admin.status'),
      audit: () => http.call('admin.audit'),
      crlIssue: (mfa) => http.call('admin.crlIssue', { mfa }),
      closeAccount: (userId, mfa) => http.call('admin.closeAccount', { params: { user_id: userId }, mfa }),
    },
  };
}
