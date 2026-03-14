import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./app/test-setup.ts'],
      include: ['app/**/*.test.{ts,tsx}'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov'],
        include: ['app/domain/**', 'app/application/**', 'app/infrastructure/**'],
        exclude: ['**/*.test.{ts,tsx}'],
      },
    },
  }),
)
