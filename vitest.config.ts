import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // 'server-only' throws when imported outside an RSC; stub it in tests.
      'server-only': new URL('./tests/stubs/server-only.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
