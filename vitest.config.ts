import { defineConfig } from 'vitest/config'

// Kept apart from vite.config.ts: the dev server and its plugins have no place in a test run.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
})
