const KEY_STORAGE = 'nexus_e2ee_keys'
const ENCRYPTION_ENABLED_KEY = 'nexus_e2ee_enabled'

function toBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
}

function fromBase64(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

async function generateKeyPair() {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  )
}

async function exportPublicKey(key) {
  const exported = await crypto.subtle.exportKey('raw', key)
  return toBase64(exported)
}

async function importPublicKey(base64Key) {
  return crypto.subtle.importKey(
    'raw',
    fromBase64(base64Key),
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  )
}

async function deriveSharedKey(privateKey, publicKey) {
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: publicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function initializeE2EE() {
  const stored = localStorage.getItem(KEY_STORAGE)
  if (stored) return JSON.parse(stored)

  const keyPair = await generateKeyPair()
  const publicKey = await exportPublicKey(keyPair.publicKey)

  const keys = {
    publicKey,
    privateKeyJwk: await crypto.subtle.exportKey('jwk', keyPair.privateKey),
    publicKeyJwk: await crypto.subtle.exportKey('jwk', keyPair.publicKey),
  }
  localStorage.setItem(KEY_STORAGE, JSON.stringify(keys))
  return keys
}

export function isE2EEEnabled() {
  return localStorage.getItem(ENCRYPTION_ENABLED_KEY) === 'true'
}

export function setE2EEEnabled(enabled) {
  localStorage.setItem(ENCRYPTION_ENABLED_KEY, String(enabled))
}

export async function getMyPublicKey() {
  const keys = await initializeE2EE()
  return keys.publicKey
}

const peerPublicKeys = new Map()

export function registerPeerPublicKey(chatId, publicKeyBase64) {
  peerPublicKeys.set(chatId, publicKeyBase64)
}

async function getChatKey(chatId) {
  const keys = await initializeE2EE()
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    keys.privateKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  )

  let peerKey = peerPublicKeys.get(chatId)
  if (!peerKey) throw new Error('This chat has no encryption key yet, so nothing was sent. Turn off End-to-End Encryption in Settings → Privacy to send messages in this conversation.')

  const peerPublicKey = await importPublicKey(peerKey)
  return deriveSharedKey(privateKey, peerPublicKey)
}

export async function encryptMessage(chatId, plaintext) {
  if (!isE2EEEnabled()) return { encrypted: false, content: plaintext }

  const key = await getChatKey(chatId)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  )

  return {
    encrypted: true,
    content: JSON.stringify({
      iv: toBase64(iv),
      data: toBase64(ciphertext),
    }),
  }
}

// Throws when a message cannot be decrypted (missing peer key, malformed
// payload, or a payload from another key) so the caller can decide whether to
// retry later or display a placeholder. Never returns a fake plaintext string.
export async function decryptMessage(chatId, content, isEncrypted) {
  if (!isEncrypted || !isE2EEEnabled()) return content

  const { iv, data } = JSON.parse(content)
  const key = await getChatKey(chatId)
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv) },
    key,
    fromBase64(data)
  )
  return new TextDecoder().decode(decrypted)
}

export function generateSecurityCode(chatId) {
  const hash = chatId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  const code = ((hash * 7919) % 900000) + 100000
  return String(code).match(/.{1,3}/g).join(' ')
}
