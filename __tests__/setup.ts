import { vi } from 'vitest'

// Mock do 'workflow' SDK — não disponível fora do runtime Vercel
vi.mock('workflow', () => ({
  defineHook: vi.fn(() => ({
    create: vi.fn(() => ({
      token: 'mock-token',
      dispose: vi.fn(),
    })),
    resume: vi.fn(),
  })),
  FatalError: class FatalError extends Error {
    constructor(msg: string) { super(msg); this.name = 'FatalError' }
  },
  RetryableError: class RetryableError extends Error {
    constructor(msg: string) { super(msg); this.name = 'RetryableError' }
  },
}))

vi.mock('workflow/api', () => ({
  start:      vi.fn(() => Promise.resolve({ runId: 'mock-run-id' })),
  getRun:     vi.fn(() => Promise.resolve({ status: 'running', output: null })),
  resumeHook: vi.fn(() => Promise.resolve()),
}))

// Mock do @vercel/sandbox
vi.mock('@vercel/sandbox', () => ({
  Sandbox: {
    create: vi.fn(() => Promise.resolve({
      runCommand:       vi.fn(() => Promise.resolve({ exitCode: 0, stdout: '{}', stderr: '' })),
      setNetworkPolicy: vi.fn(() => Promise.resolve()),
      stop:             vi.fn(() => Promise.resolve()),
    })),
  },
}))
