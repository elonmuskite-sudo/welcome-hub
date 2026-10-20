import { supabase } from '../supabase.js'

// E2EE protocol: ECDH P-256 key agreement deriving an AES-256-GCM key.
// Private keys stay on the device (localStorage); only public keys are published
// to public.e2ee_public_keys and fetched through the participant-scoped
// list_chat_public_keys RPC.
const KEY_STORAGE = 'nexus_e2ee_keys'
const ENCRYPTION_ENABLED_KEY = 'nexus_e2ee_enabled'
// Marks that this device has already committed to an E2EE default, so an
// account that predates automatic enablement is never silently switched on.
const DEFAULT_DECISION_KEY = 'nexus_e2ee_default_decided'
// Set once the "encrypted by default" notice has been acknowledged.
const NOTICE_SEEN_KEY = 'nexus_e2ee_notice_seen'
const PROTOCOL = 'ECDH-P256+AES-256-GCM'

export const NO_PEER_KEY_MESSAGE = 'This contact has not shared an encryption key yet.'
export const NO_PEER_KEY_NOTICE = 'Sent without end-to-end encryption: this contact has not set up encryption yet.'
export const ENCRYPTION_FAILED_NOTICE = 'Sent without end-to-end encryption: encryption could not be set up on this device.'

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
  return localStorage.getItem(ENCRYPTION_ENABLED_KEY) === 'true'
}

export function setE2EEEnabled(enabled) {
  localStorage.setItem(ENCRYPTION_ENABLED_KEY, String(enabled))
}

// Accounts that predate automatic enablement keep whatever they had. Called on
// every signed-in app boot: the first run commits this device to the legacy
// opt-in value, so the new default can never switch an existing user on.
export function applyE2EEDefaultForExistingAccount() {
  if (localStorage.getItem(DEFAULT_DECISION_KEY) !== null) return isE2EEEnabled()
  localStorage.setItem(DEFAULT_DECISION_KEY, isE2EEEnabled() ? 'true' : 'false')
  return isE2EEEnabled()
}

// Signup path: new accounts are end-to-end encrypted by default. The key pair is
// generated and published before the account reaches the dashboard. The decision
// is recorded first so a failed run can never be re-derived as "default on".
export async function provisionE2EEForNewAccount() {
  localStorage.setItem(DEFAULT_DECISION_KEY, 'true')
  setE2EEEnabled(true)

  let keys
  try {
    keys = await initializeE2EE()
  } catch (error) {
    // No usable key material on this device. Fall back to the legacy opt-in
    // behaviour rather than claim encryption we cannot actually deliver.
    setE2EEEnabled(false)
    localStorage.setItem(DEFAULT_DECISION_KEY, 'false')
    return { ok: false, error }
  }

  try {
    await publishMyPublicKey()
    return { ok: true, publicKey: keys.publicKey }
  } catch (error) {
    // The keys exist locally, publishing retries on the next launch, and every
    // send has a plaintext fallback, so the account keeps its default-on status.
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
  try {
    const fetched = await fetchPeerPublicKey(id)
    if (fetched) {
      peerPublicKeys.set(id, fetched)
      return fetched
    }
  } catch (error) {
    console.warn('Could not load the contact encryption key:', error)
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
  if (!isE2EEEnabled()) return { encrypted: false, content: plaintext }

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
    // Default-on accounts must still reach contacts who have no published key,
    // so encryption fails open. The reason is reported back so the sender sees a
    // plaintext warning instead of believing the message was protected.
    return {
      encrypted: false,
      content: plaintext,
      reason: error?.message === NO_PEER_KEY_MESSAGE ? 'peer_key_missing' : 'encryption_failed',
    }
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
  const hash = String(chatId).split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  const code = ((hash * 7919) % 900000) + 100000
  return String(code).match(/.{1,3}/g).join(' ')
}
