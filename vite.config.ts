// Vite config: React + Tailwind v4, plus a production-only Content-Security-Policy meta tag.
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin, type ResolvedConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// CSP for the built site (spec section 3: CSP check). No web fonts, no third-party origins.
// Production only: the dev server's HMR client needs inline scripts and would break under this policy.
// Cypress runs against `vite preview` (the production build), so CSP regressions show up in E2E.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function cspMetaPlugin(): Plugin {
  return {
    name: 'pcpsd-csp-meta',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

// Live builds (VITE_API_MODE=live) never import the mocks, so the msw Service Worker script that `public/` copies into
// the output is dead weight there (and would let a live site register a mock worker by URL). Remove it after the build.
function excludeMswWorkerInLive(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'pcpsd-exclude-msw-worker-in-live',
    apply: 'build',
    configResolved(c) {
      config = c;
    },
    closeBundle() {
      // `process.env` wins over .env files in loadEnv, so `VITE_API_MODE=live npm run build` is honoured.
      const mode = loadEnv(config.mode, config.envDir || config.root, 'VITE_').VITE_API_MODE;
      if (mode === 'live') rmSync(resolve(config.root, config.build.outDir, 'mockServiceWorker.js'), { force: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), cspMetaPlugin(), excludeMswWorkerInLive()],
  build: { target: 'es2022' },
});
