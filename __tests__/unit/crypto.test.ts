import { describe, expect, it, beforeAll } from 'vitest'
import { encryptSecret, decryptSecret } from '@/lib/devfactory/crypto'

beforeAll(() => {
  process.env.BYOK_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
})

describe('crypto secrets', () => {
  it('round-trips a plaintext value through encrypt/decrypt', () => {
    const plaintext = 'sk-test-1234567890'
    const encrypted = encryptSecret(plaintext)
    expect(encrypted).not.toContain(plaintext)
    expect(decryptSecret(encrypted)).toBe(plaintext)
  })

  it('produces a different ciphertext each time (random IV)', () => {
    const a = encryptSecret('same-value')
    const b = encryptSecret('same-value')
    expect(a).not.toBe(b)
  })

  it('throws when the auth tag does not match (tampered ciphertext)', () => {
    const encrypted = encryptSecret('sensitive-key')
    const [iv, tag] = encrypted.split('.')
    const tampered = [iv, tag, Buffer.from('tampered').toString('base64')].join('.')
    expect(() => decryptSecret(tampered)).toThrow()
  })

  it('throws when BYOK_ENCRYPTION_KEY is missing', () => {
    const original = process.env.BYOK_ENCRYPTION_KEY
    delete process.env.BYOK_ENCRYPTION_KEY
    expect(() => encryptSecret('x')).toThrow(/BYOK_ENCRYPTION_KEY/)
    process.env.BYOK_ENCRYPTION_KEY = original
  })
})
