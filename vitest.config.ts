import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/unit/**/*.test.ts', '__tests__/integration/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['lib/devfactory/**', 'app/api/**'],
      exclude: ['**/*.d.ts', '**/node_modules/**'],
      thresholds: { statements: 70, branches: 65 },
    },
    setupFiles: ['__tests__/setup.ts'],
  },
  resolve: {
    alias: { '@': resolve(__dirname, '.') },
  },
})
