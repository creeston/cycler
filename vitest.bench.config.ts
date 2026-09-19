import { defineConfig } from 'vitest/config'

/** `npm run bench`: the timing files that `npm test` leaves out. */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['app/**/*.bench.ts'],
    testTimeout: 600_000,
  },
})
