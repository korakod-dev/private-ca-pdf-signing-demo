// Build-time environment flags (Vite only; do not import from Cypress specs).

export type ApiMode = 'mock' | 'live';

/** "mock" (default): MSW answers /api/*. "live": real backend; mocks must never be imported. */
export const API_MODE: ApiMode = import.meta.env.VITE_API_MODE === 'live' ? 'live' : 'mock';

/** Base URL prepended to /api/v1 paths (default ''). */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '';
