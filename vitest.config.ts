// Vitest config: jsdom + React Testing Library. Pure engine tests also run here (jsdom is harmless for them).
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'cypress'],
    coverage: {
      provider: 'v8',
      // Engine is the coverage-gated area (plan section 5 "Phase 1 integration" item 3, QA finding F14).
      include: ['src/engine/**'],
      // Test files and test helpers are not product code; counting them would inflate the numbers.
      exclude: ['src/engine/**/__tests__/**', 'src/engine/**/*.test.ts'],
      // skipFull: false keeps 100%-covered files in the printed table (engine/resolver, the strictest gate, must be visible).
      reporter: [['text', { skipFull: false }], 'html'],
      // Glob thresholds are evaluated per glob over the files it matches (the resolver also falls under the engine glob,
      // which is harmless: the stricter resolver gate is checked on its own).
      thresholds: {
        // Resolver (sub-task B2): decides verification results, so it carries the strictest gate.
        'src/engine/resolver/**': { lines: 95 },
        // Rest of the engine (sub-task B1).
        'src/engine/**': { lines: 90, branches: 85 },
      },
    },
  },
});
