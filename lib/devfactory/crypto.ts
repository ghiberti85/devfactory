/**
 * DevFactory — Criptografia de segredos BYOK
 * lib/devfactory/crypto.ts
 *
 * Camada de aplicação (AES-256-GCM) usada para criptografar API keys de
 * usuário e tokens do GitHub antes de persistir em user_api_keys /
 * user_github_connections (ver db/schema.sql — encrypted_key/encrypted_token
 * "NUNCA fica em texto puro"). Chave mestra vem de BYOK_ENCRYPTION_KEY
 * (gerar com `openssl rand -base64 32`), nunca versionada.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // recomendado para GCM

function getMasterKey(): Buffer {
  const raw = process.env.BYOK_ENCRYPTION_KEY
  if (!raw) throw new Error('BYOK_ENCRYPTION_KEY não configurada — obrigatória para criptografar segredos de usuário.')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error('BYOK_ENCRYPTION_KEY inválida — precisa decodificar para exatamente 32 bytes (gerar com `openssl rand -base64 32`).')
  }
  return key
}

// Formato serializado: base64(iv) + '.' + base64(authTag) + '.' + base64(ciphertext)
export function encryptSecret(plaintext: string): string {
  const key = getMasterKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join('.')
}

export function decryptSecret(serialized: string): string {
  const [ivB64, authTagB64, ciphertextB64] = serialized.split('.')
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error('Formato inválido de segredo criptografado.')
  }
  const key = getMasterKey()
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ])
  return plaintext.toString('utf8')
}
