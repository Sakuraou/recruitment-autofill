import { defineConfig } from 'vitest/config';
// DOM workflow files are CPU-heavy. Keep their original deadlines without
// competing jsdom workers making wall-clock assertions machine-dependent.
export default defineConfig({ test: { environment: 'jsdom', maxWorkers: 1,
  include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'] } });
