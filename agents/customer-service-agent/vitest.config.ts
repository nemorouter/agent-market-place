import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Vitest config for the customer-service-agent.
//
// Why this exists: the API route handlers import via the `@/` alias (e.g.
// `@/lib/settings`), matching tsconfig `paths`. Without this alias here, route-level
// tests can't import the handlers at all. Node environment (no DOM) keeps the suite
// fast — these are pure-logic + route-contract tests, not component render tests.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
  },
});
