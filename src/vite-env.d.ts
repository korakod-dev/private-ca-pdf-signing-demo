/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "mock" (default): MSW answers /api/*. "live": real backend, mocks are never imported. */
  readonly VITE_API_MODE?: 'mock' | 'live';
  /** Base URL prepended to /api/v1 paths (default ''). */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
