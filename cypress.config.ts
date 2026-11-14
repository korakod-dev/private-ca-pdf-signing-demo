// Cypress config. E2E runs against the production build served by `vite preview` (port 4173, see package.json).
import { defineConfig } from 'cypress';

export default defineConfig({
  // Public config would come from `--expose` / Cypress.expose(); Cypress.env() stays off (Cypress 15 warning).
  allowCypressEnv: false,
  e2e: {
    baseUrl: 'http://localhost:4173',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    supportFile: 'cypress/support/e2e.ts',
    video: false,
    screenshotOnRunFailure: false,
    // Missions are deterministic in test mode (frozen clock, no latency), so short timeouts are enough.
    defaultCommandTimeout: 6000,
    viewportWidth: 1280,
    viewportHeight: 800,
  },
});
