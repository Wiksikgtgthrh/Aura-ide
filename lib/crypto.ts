import 'server-only'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto'

// AES-256-GCM encryption for secrets at rest.
// The key is derived from BETTER_AUTH_SECRET so no extra env var is needed.

const ENC_PREFIX = 'enc:v1:'

function getKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error('BETTER_AUTH_SECRET is not set')
  return createHash('sha256').update(secret).digest()
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv)
  const encrypted = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return (
    ENC_PREFIX +
    Buffer.concat([iv, tag, encrypted]).toString('base64')
  )
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX)
}

export function decryptSecret(value: string): string {
  // Legacy plaintext values pass through so old rows keep working.
  if (!isEncrypted(value)) return value
  const raw = Buffer.from(value.slice(ENC_PREFIX.length), 'base64')
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const encrypted = raw.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', getKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf8')
}
