import { supabase } from '../supabase.js'
import { E2EE_PROTOCOL } from './envelope.js'

// E2EE protocol: ECDH P-256 key agreement deriving an AES-256-GCM key.
// Private keys stay on the device (localStorage); only public keys are published
// to public.e2ee_public_keys and fetched through the participant-scoped
// list_chat_public_keys RPC.
const KEY_STORAGE = 'nexus_e2ee_keys'
const ENCRYPTION_ENABLED_KEY = 'nexus_e2ee_enabled'
// Records that this device is enforcing mandatory E2EE for text messages.
const DEFAULT_DECISION_KEY = 'nexus_e2ee_default_decided'
// Set once the "encrypted by default" notice has been acknowledged.
const NOTICE_SEEN_KEY = 'nexus_e2ee_notice_seen'
const PROTOCOL = E2EE_PROTOCOL

export const NO_PEER_KEY_MESSAGE = 'This contact has not shared an encryption key yet.'
export const ENCRYPTION_FAILED_MESSAGE = 'End-to-end encryption failed. Please try again.'

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
    false,
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
  return true
}

export function setE2EEEnabled() {
  localStorage.setItem(ENCRYPTION_ENABLED_KEY, 'true')
}

// Enforce mandatory encryption on every signed-in app boot.
export function applyE2EEDefaultForExistingAccount() {
  setE2EEEnabled(true)
  localStorage.setItem(DEFAULT_DECISION_KEY, 'true')
  return true
}

// Signup provisions the device key before the account reaches the dashboard.
// The mandatory-encryption decision is recorded before attempting key creation.
export async function provisionE2EEForNewAccount() {
  localStorage.setItem(DEFAULT_DECISION_KEY, 'true')
  setE2EEEnabled(true)

  let keys
  try {
    keys = await initializeE2EE()
  } catch (error) {
    // No usable key material on this device.
    // Sending remains blocked until encryption keys are available.
    return { ok: false, error }
  }

  try {
    await publishMyPublicKey()
    return { ok: true, publicKey: keys.publicKey }
  } catch (error) {
    // Keep E2EE enabled; encrypted sends stay blocked until key publication works.
    return { ok: false, error, publicKey: keys.publicKey }
  }
}

export function isE2EEProvisionedForDevice() {
  return localStorage.getItem(DEFAULT_DECISION_KEY) === 'true'
}

// One-time, dismissible notice telling new users their messages are encrypted by
// default. Shown once per device so it never becomes permanent chrome.
export function shouldShowE2EEDefaultNotice() {
  return isE2EEEnabled() && localStorage.getItem(NOTICE_SEEN_KEY) !== 'true'
}

export function dismissE2EEDefaultNotice() {
  localStorage.setItem(NOTICE_SEEN_KEY, 'true')
}

export async function getMyPublicKey() {
  const keys = await initializeE2EE()
  return keys.publicKey
}

// Publishes the device public key so peers can derive the shared key. Safe to
// call repeatedly (upsert). Throws if the directory write fails so the caller
// can tell the user their key is not reachable yet.
export async function publishMyPublicKey() {
  const keys = await initializeE2EE()
  if (!supabase) return keys.publicKey
  const { error } = await supabase.rpc('publish_e2ee_public_key', { p_public_key: keys.publicKey })
  if (error) throw new Error(error.message || 'Could not publish your encryption key.')
  return keys.publicKey
}

// chatId -> peer public key (base64). Populated from the directory on demand.
const peerPublicKeys = new Map()
// chatId -> { peerKey, keyPromise } so the derived AES key is reused until the
// peer key changes.
const chatKeyCache = new Map()

export function registerPeerPublicKey(chatId, publicKeyBase64) {
  const id = String(chatId)
  if (publicKeyBase64) peerPublicKeys.set(id, publicKeyBase64)
  else peerPublicKeys.delete(id)
  chatKeyCache.delete(id)
}

export function clearPeerKeyCache(chatId) {
  if (chatId == null) {
    peerPublicKeys.clear()
    chatKeyCache.clear()
    return
  }
  const id = String(chatId)
  peerPublicKeys.delete(id)
  chatKeyCache.delete(id)
}

async function fetchPeerPublicKey(chatId) {
  if (!supabase) return null
  const mine = await getMyPublicKey()
  const { data, error } = await supabase.rpc('list_chat_public_keys', { p_chat_id: String(chatId) })
  if (error) throw new Error(error.message || 'Could not load the contact encryption key.')
  const rows = Array.isArray(data) ? data : []
  const peer = rows.find((row) => row && row.public_key && row.public_key !== mine)
  return peer ? peer.public_key : null
}

export async function getPeerPublicKey(chatId) {
  const id = String(chatId)
  const cached = peerPublicKeys.get(id)
  if (cached) return cached
  const fetched = await fetchPeerPublicKey(id)
  if (fetched) {
    peerPublicKeys.set(id, fetched)
    return fetched
  }
  return null
}

async function getChatKey(chatId) {
  const id = String(chatId)
  const peerKey = await getPeerPublicKey(id)
  if (!peerKey) throw new Error(NO_PEER_KEY_MESSAGE)

  const cached = chatKeyCache.get(id)
  if (cached && cached.peerKey === peerKey) return cached.keyPromise

  const keyPromise = (async () => {
    const keys = await initializeE2EE()
    const privateKey = await crypto.subtle.importKey(
      'jwk',
      keys.privateKeyJwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveKey']
    )
    const peerPublicKey = await importPublicKey(peerKey)
    return deriveSharedKey(privateKey, peerPublicKey)
  })()

  chatKeyCache.set(id, { peerKey, keyPromise })
  return keyPromise
}

export async function encryptMessage(chatId, plaintext) {
  try {
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
        alg: PROTOCOL,
        iv: toBase64(iv),
        data: toBase64(ciphertext),
      }),
    }
  } catch (error) {
    if (error instanceof Error && error.message === NO_PEER_KEY_MESSAGE) throw error
    throw new Error(ENCRYPTION_FAILED_MESSAGE, { cause: error })
  }
}

// Throws when a message cannot be decrypted (missing peer key, malformed
// payload, or a payload from another key) so the caller can decide whether to
// retry later or display a placeholder. Never returns a fake plaintext string.
export async function decryptMessage(chatId, content, isEncrypted) {
  if (!isEncrypted) return content

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
  const hash = String(chatId).split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  const code = ((hash * 7919) % 900000) + 100000
  return String(code).match(/.{1,3}/g).join(' ')
}
