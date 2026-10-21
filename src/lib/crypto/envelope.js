export const E2EE_PROTOCOL = 'ECDH-P256+AES-256-GCM'

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const NON_TEXT_MESSAGE_TYPES = new Set([
  'reaction',
  'receipt',
  'image',
  'video',
  'voice',
  'file',
  'document',
])

export function requiresE2EEEncryption(type) {
  return !NON_TEXT_MESSAGE_TYPES.has(type)
}

export function isEncryptedTextEnvelope(content) {
  if (typeof content !== 'string') return false

  let payload
  try {
    payload = JSON.parse(content)
  } catch {
    return false
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  if (Object.keys(payload).length !== 3) return false
  if (payload.alg !== E2EE_PROTOCOL || typeof payload.iv !== 'string' || typeof payload.data !== 'string') return false
  if (!/^[A-Za-z0-9+/]{16}$/.test(payload.iv) || !BASE64_PATTERN.test(payload.data)) return false
  if (payload.data.length < 24 || payload.data.length % 4 !== 0) return false

  const padding = payload.data.endsWith('==') ? 2 : payload.data.endsWith('=') ? 1 : 0
  const ciphertextBytes = (payload.data.length / 4) * 3 - padding
  return ciphertextBytes >= 17
}
