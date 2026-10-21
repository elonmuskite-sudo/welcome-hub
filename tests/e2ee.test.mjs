import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isEncryptedTextEnvelope, requiresE2EEEncryption } from '../src/lib/crypto/envelope.js'

// Minimal localStorage for the E2EE key store (the module only touches it
// inside functions, so installing the stub before calling is enough).
const store = new Map()
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { store.set(key, String(value)) },
  removeItem: (key) => { store.delete(key) },
  clear: () => store.clear(),
}

const {
  initializeE2EE,
  isE2EEEnabled,
  setE2EEEnabled,
  getMyPublicKey,
  registerPeerPublicKey,
  encryptMessage,
  decryptMessage,
  clearPeerKeyCache,
  provisionE2EEForNewAccount,
  applyE2EEDefaultForExistingAccount,
  isE2EEProvisionedForDevice,
  shouldShowE2EEDefaultNotice,
  dismissE2EEDefaultNotice,
  NO_PEER_KEY_MESSAGE,
} = await import('../src/lib/crypto/e2ee.js')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const toBase64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)))
const fromBase64 = (base64) => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

// A stand-in for the contact's device, implementing the same published protocol
// so we can prove the envelope is real ECDH P-256 + AES-256-GCM rather than a
// local-only format.
async function makeParty() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey'])
  const publicKey = toBase64(await crypto.subtle.exportKey('raw', pair.publicKey))
  return { pair, publicKey }
}

async function deriveAes(privateKey, peerPublicBase64) {
  const peer = await crypto.subtle.importKey('raw', fromBase64(peerPublicBase64), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  return crypto.subtle.deriveKey({ name: 'ECDH', public: peer }, privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

test('attempting to disable E2EE never sends plaintext', async () => {
  setE2EEEnabled(false)
  assert.equal(isE2EEEnabled(), true)
  clearPeerKeyCache()
  await assert.rejects(
    () => encryptMessage('chat-off', 'hello plain'),
    new RegExp(NO_PEER_KEY_MESSAGE),
  )
  assert.equal(await decryptMessage('chat-off', 'hello plain', false), 'hello plain')
})

test('text remains encrypted after a disable attempt when recipient key exists', async () => {
  setE2EEEnabled(false)
  clearPeerKeyCache()
  registerPeerPublicKey('chat-after-disable', (await makeParty()).publicKey)
  const result = await encryptMessage('chat-after-disable', 'must stay encrypted')
  assert.equal(result.encrypted, true)
  assert.ok(!result.content.includes('must stay encrypted'))
})

test('the encrypted-envelope validator rejects plaintext and malformed envelopes', () => {
  assert.equal(isEncryptedTextEnvelope(JSON.stringify({
    alg: 'ECDH-P256+AES-256-GCM',
    iv: 'AAAAAAAAAAAAAAAA',
    data: `${'A'.repeat(23)}=`,
  })), true)
  assert.equal(isEncryptedTextEnvelope(JSON.stringify({
    alg: 'ECDH-P256+AES-256-GCM',
    iv: 'AAAAAAAAAAAAAAAA',
    data: `${'A'.repeat(23)}=`,
    plaintext: 'must not be accepted as an envelope extension',
  })), false)
  assert.equal(isEncryptedTextEnvelope('plaintext'), false)
  assert.equal(isEncryptedTextEnvelope(JSON.stringify({ alg: 'other', iv: 'AAAAAAAAAAAAAAAA', data: `${'A'.repeat(23)}=` })), false)
  assert.equal(isEncryptedTextEnvelope(JSON.stringify({ alg: 'ECDH-P256+AES-256-GCM', iv: 'bad', data: `${'A'.repeat(23)}=` })), false)
  assert.equal(isEncryptedTextEnvelope(JSON.stringify({ alg: 'ECDH-P256+AES-256-GCM', iv: 'AAAAAAAAAAAAAAAA', data: 'short' })), false)
  assert.equal(requiresE2EEEncryption('sticker'), true)
  assert.equal(requiresE2EEEncryption('system'), true)
  assert.equal(requiresE2EEEncryption('image'), false)
  assert.equal(requiresE2EEEncryption('receipt'), false)
})

test('persistence rejects plaintext before any chat-service request', async () => {
  const { sendChatMessage } = await import('../src/lib/persistence.js')
  await assert.rejects(
    sendChatMessage('chat-plaintext', {
      type: 'text',
      content: 'must never be transmitted as plaintext',
      sender_id: 'user-id',
    }),
    /Text and sticker messages must be end-to-end encrypted/,
  )
})

test('ChatView encrypts text and rejects failed encryption before message persistence', () => {
  const chatView = fs.readFileSync(path.join(root, 'src', 'components', 'chat', 'ChatView.jsx'), 'utf8')
  const sendHandler = chatView.slice(
    chatView.indexOf('const handleSendMessage'),
    chatView.indexOf('const handleReact'),
  )
  const encryptionPosition = sendHandler.indexOf('await encryptMessage(chat.id, content)')
  const persistencePosition = sendHandler.indexOf('await sendChatMessage(chat.id, newMessage)')
  assert.match(sendHandler, /if \(type === 'text'\)/)
  assert.match(sendHandler, /if \(!result\.encrypted\)/)
  assert.ok(encryptionPosition >= 0 && encryptionPosition < persistencePosition)
})

test('a missing contact key prevents sending plaintext', async () => {
  setE2EEEnabled(true)
  clearPeerKeyCache()
  await assert.rejects(
    () => encryptMessage('chat-no-key', 'top secret'),
    new RegExp(NO_PEER_KEY_MESSAGE),
  )
})

test('an invalid contact key prevents sending plaintext', async () => {
  setE2EEEnabled(true)
  clearPeerKeyCache()
  registerPeerPublicKey('chat-invalid-key', 'not-a-public-key')
  await assert.rejects(
    () => encryptMessage('chat-invalid-key', 'top secret'),
    /End-to-end encryption failed/,
  )
})

test('the contact can decrypt a message we encrypt (real ECDH + AES-256-GCM)', async () => {
  setE2EEEnabled(true)
  clearPeerKeyCache()
  const myPublicKey = await getMyPublicKey()
  const remote = await makeParty()
  registerPeerPublicKey('chat-out', remote.publicKey)

  const { encrypted, content } = await encryptMessage('chat-out', 'meet at noon')
  assert.equal(encrypted, true)
  assert.ok(!content.includes('meet at noon'), 'ciphertext must not contain the plaintext')

  const payload = JSON.parse(content)
  assert.equal(payload.alg, 'ECDH-P256+AES-256-GCM')

  const aes = await deriveAes(remote.pair.privateKey, myPublicKey)
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(payload.iv) },
    aes,
    fromBase64(payload.data),
  )
  assert.equal(new TextDecoder().decode(decrypted), 'meet at noon')
})

test('we decrypt a message the contact encrypts to us', async () => {
  setE2EEEnabled(true)
  clearPeerKeyCache()
  const myPublicKey = await getMyPublicKey()
  const remote = await makeParty()
  registerPeerPublicKey('chat-in', remote.publicKey)

  const aes = await deriveAes(remote.pair.privateKey, myPublicKey)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode('incoming hello'))
  const envelope = JSON.stringify({ alg: 'ECDH-P256+AES-256-GCM', iv: toBase64(iv), data: toBase64(ciphertext) })

  assert.equal(await decryptMessage('chat-in', envelope, true), 'incoming hello')
})

test('a message encrypted to a different key fails closed', async () => {
  setE2EEEnabled(true)
  clearPeerKeyCache()
  const first = await makeParty()
  const second = await makeParty()
  registerPeerPublicKey('chat-wrong', first.publicKey)
  const { content } = await encryptMessage('chat-wrong', 'private note')

  clearPeerKeyCache('chat-wrong')
  registerPeerPublicKey('chat-wrong', second.publicKey)
  await assert.rejects(() => decryptMessage('chat-wrong', content, true))
  await assert.rejects(() => decryptMessage('chat-in', 'not-a-payload', true))
})

test('the generated key pair is stable for the device', async () => {
  const first = await initializeE2EE()
  const second = await initializeE2EE()
  assert.equal(first.publicKey, second.publicKey)
  assert.ok(first.privateKeyJwk && first.privateKeyJwk.d, 'private key stays on the device')
})

test('the key directory migration is participant scoped', () => {
  const migration = fs.readFileSync(
    path.join(root, 'supabase', 'migrations', '20261017060000_e2ee_key_directory.sql'),
    'utf8',
  )
  assert.match(migration, /create table if not exists public\.e2ee_public_keys/i)
  assert.match(migration, /revoke all on public\.e2ee_public_keys from public, anon, authenticated/i)
  assert.match(migration, /create or replace function public\.publish_e2ee_public_key/i)
  assert.match(migration, /if auth\.uid\(\) is null then raise exception/i)
  assert.match(migration, /create or replace function public\.list_chat_public_keys/i)
  assert.match(migration, /where me\.chat_id = p_chat_id and me\.profile_id = auth\.uid\(\)/i)
})

test('contact reads resolve the name from the directory, scoped to the caller', () => {
  const migration = fs.readFileSync(
    path.join(root, 'supabase', 'migrations', '20261017050000_contact_directory_authority.sql'),
    'utf8',
  )
  assert.match(migration, /create or replace function public\.list_my_contacts/i)
  assert.match(migration, /where c\.user_id = auth\.uid\(\)/i)
  assert.match(migration, /left join public\.members m on m\.member_id = c\.nexus_id/i)
  assert.match(migration, /update public\.contacts c/i)
})

// --- Automatic enablement at signup -----------------------------------------

test('a new account is provisioned encrypted by default with a device key pair', async () => {
  store.clear()
  const result = await provisionE2EEForNewAccount()
  assert.equal(result.ok, true)
  assert.ok(result.publicKey, 'the device key pair is generated during signup')
  assert.equal(isE2EEEnabled(), true)
  assert.equal(isE2EEProvisionedForDevice(), true)
  assert.ok(store.get('nexus_e2ee_keys'), 'the key material is stored on the device')
})

test('failed key provisioning keeps encryption mandatory and pins the decision', async () => {
  store.clear()
  // Unreadable key material makes initializeE2EE throw, so provisioning cannot
  // claim encryption it cannot deliver.
  store.set('nexus_e2ee_keys', '{not valid json')
  const result = await provisionE2EEForNewAccount()
  assert.equal(result.ok, false)
  assert.equal(isE2EEEnabled(), true)
  assert.equal(isE2EEProvisionedForDevice(), true)
  assert.equal(store.get('nexus_e2ee_enabled'), 'true')
  assert.equal(store.get('nexus_e2ee_default_decided'), 'true')
})

test('an existing disabled account is switched to mandatory E2EE', () => {
  store.clear()
  setE2EEEnabled(false)
  assert.equal(applyE2EEDefaultForExistingAccount(), true)
  assert.equal(isE2EEEnabled(), true)
  assert.equal(store.get('nexus_e2ee_default_decided'), 'true')
  assert.equal(applyE2EEDefaultForExistingAccount(), true)
  assert.equal(isE2EEEnabled(), true)
})

test('an existing encrypted account keeps encryption on', () => {
  store.clear()
  setE2EEEnabled(true)
  assert.equal(applyE2EEDefaultForExistingAccount(), true)
  assert.equal(store.get('nexus_e2ee_default_decided'), 'true')
  assert.equal(isE2EEEnabled(), true)
})

test('the encrypted-by-default notice is shown once and can be dismissed', () => {
  store.clear()
  setE2EEEnabled(true)
  assert.equal(shouldShowE2EEDefaultNotice(), true)
  dismissE2EEDefaultNotice()
  assert.equal(shouldShowE2EEDefaultNotice(), false)
  // An attempted disable does not turn the required-encryption notice off.
  setE2EEEnabled(false)
  store.delete('nexus_e2ee_notice_seen')
  assert.equal(shouldShowE2EEDefaultNotice(), true)
})

test('post-signup audits: a subsequent app boot keeps encryption on and the key unchanged', async () => {
  store.clear()
  const provisioned = await provisionE2EEForNewAccount()
  assert.equal(provisioned.ok, true)

  // A later boot runs the legacy-preservation path; it must not weaken the
  // account that was provisioned encrypted at signup.
  applyE2EEDefaultForExistingAccount()
  assert.equal(isE2EEEnabled(), true)
  assert.equal(isE2EEProvisionedForDevice(), true)

  // The device key pair is reused rather than regenerated, so ciphertext already
  // sent to contacts stays decryptable.
  const reloaded = await initializeE2EE()
  assert.equal(reloaded.publicKey, provisioned.publicKey)
})

test('the default-enable migration stamps existing rows off before flipping the default', () => {
  const migration = fs.readFileSync(
    path.join(root, 'supabase', 'migrations', '20261017080000_e2ee_default_enabled.sql'),
    'utf8',
  )
  assert.match(migration, /add column if not exists e2ee_enabled boolean not null default false/i)
  assert.match(migration, /alter column e2ee_enabled set default true/i)
  const stampIndex = migration.indexOf('default false')
  const flipIndex = migration.indexOf('set default true')
  assert.ok(stampIndex >= 0 && flipIndex >= 0 && stampIndex < flipIndex, 'existing rows must be stamped before the default flips')
  assert.match(migration, /add column if not exists e2ee_key_published_at timestamptz/i)
  assert.match(migration, /create or replace function public\.set_my_e2ee_status/i)
  assert.match(migration, /if auth\.uid\(\) is null then\s+raise exception/i)
  assert.match(migration, /revoke execute on function public\.set_my_e2ee_status[\s\S]*from public, anon/i)
  assert.match(migration, /grant execute on function public\.set_my_e2ee_status[\s\S]*to authenticated/i)
})
