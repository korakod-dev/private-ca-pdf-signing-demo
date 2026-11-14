// Demo-only API client: /api/v1/demo/* and /api/v1/sign*. This is the ONLY place that names demo-only route keys.
// Against a real backend these calls simply do not exist.
import type { DemoApi } from '../contracts/api-client';
import type { Http } from './http';

export function createDemoApi(http: Http): DemoApi {
  return {
    status: () => http.call('demo.status'),
    setClock: (advance) => http.call('demo.clock', { body: { advance } }),
    setFaults: (faults) => http.call('demo.faults', { body: faults }),
    // Answered by the mock runtime (wipes all pcpsd.* storage); 204 -> data: null.
    reset: () => http.call('demo.reset'),
    personas: () => http.call('demo.personas'),
    switchPersona: (userId) => http.call('demo.persona', { body: { user_id: userId } }),
    samples: () => http.call('demo.samples'),
    mailbox: () => http.call('demo.mailbox'),
    progress: (key) => http.call('demo.progress', { body: { key } }),
    workstation: () => http.call('demo.workstation'),
    keygen: (body) => http.call('demo.keygen', { body }),
    signReview: (body) => http.call('sign.review', { body }),
    sign: (body) => http.call('sign.commit', { body }),
  };
}
