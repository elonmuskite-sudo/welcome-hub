import test from 'node:test'
import assert from 'node:assert/strict'
import {
  chatDisplayName,
  chatListPreview,
  messageSnippet,
  normalizeSnippet,
  participantNamesFor,
  peerIdOf,
  resolveLastMessage,
  EMPTY_SNIPPET,
  SNIPPET_MAX,
} from '../src/lib/chatPreview.js'
import { encodeReply } from '../src/lib/chatProtocol.js'

const ME = 'user-1'
const PEER = 'user-2'
// Local noon keeps the day arithmetic below stable regardless of the test
// machine's timezone.
const NOW = new Date(2026, 9, 20, 12, 0, 0).getTime()

function chat(overrides = {}) {
  return {
    id: 'chat-1',
    title: 'Shared title',
    type: 'private',
    encrypted: false,
    participant_ids: [ME, PEER],
    participant_names: { [ME]: 'Me', [PEER]: 'Ada Lovelace' },
    messages: [],
    last_message: null,
    last_message_time: null,
    last_message_sender_id: null,
    last_message_type: 'text',
    last_message_encrypted: false,
    ...overrides,
  }
}

function storedLast(text, { sender = PEER, minutesAgo = 2, type = 'text', encrypted = false } = {}) {
  return {
    last_message: text,
    last_message_time: new Date(NOW - minutesAgo * 60000).toISOString(),
    last_message_sender_id: sender,
    last_message_type: type,
    last_message_encrypted: encrypted,
  }
}

test('a contact row shows the contact name, their message and a relative age', () => {
  const preview = chatListPreview(chat(storedLast('See you at six')), ME, NOW)

  assert.equal(preview.name, 'Ada Lovelace')
  assert.equal(preview.snippet, 'See you at six')
  assert.equal(preview.timeLabel, '2m ago')
  assert.equal(preview.sentByViewer, false)
  assert.equal(preview.hasHistory, true)
})

test('the row is named from the viewer\u2019s perspective', () => {
  assert.equal(chatDisplayName(chat(), ME), 'Ada Lovelace')
  assert.equal(chatDisplayName(chat(), PEER), 'Me')
  assert.equal(peerIdOf(chat(), ME), PEER)
  // Groups (or chats recorded before participant names existed) keep the title.
  assert.equal(chatDisplayName(chat({ participant_ids: [ME, PEER, 'user-3'], participant_names: null }), ME), 'Shared title')
})

test('new private chats store both names by participant id for either viewer', () => {
  const participantNames = participantNamesFor(ME, 'Ada Sender', PEER, 'Sam Receiver')
  const newChat = chat({ participant_names: participantNames })

  assert.equal(chatDisplayName(newChat, ME), 'Sam Receiver')
  assert.equal(chatDisplayName(newChat, PEER), 'Ada Sender')
  assert.equal(participantNamesFor(ME, '', PEER, ''), null)
})

test('the viewer\u2019s own last message is marked as theirs', () => {
  const preview = chatListPreview(chat(storedLast('On my way', { sender: ME })), ME, NOW)

  assert.equal(preview.sentByViewer, true)
  assert.equal(preview.snippet, 'On my way')
})

test('a very long message is truncated to fit the row and ends with an ellipsis', () => {
  const preview = chatListPreview(chat(storedLast('x'.repeat(400))), ME, NOW)

  assert.equal(preview.snippet, `${'x'.repeat(SNIPPET_MAX)}\u2026`)
  assert.equal(preview.snippet.length, SNIPPET_MAX + 1)
})

test('a message at the limit is left untouched', () => {
  const exact = 'y'.repeat(SNIPPET_MAX)
  assert.equal(chatListPreview(chat(storedLast(exact)), ME, NOW).snippet, exact)
})

test('multi-line content collapses to a single readable line', () => {
  assert.equal(normalizeSnippet('  hello\n\n  world  '), 'hello world')
  assert.equal(chatListPreview(chat(storedLast('line one\nline two')), ME, NOW).snippet, 'line one line two')
})

test('a contact with no history keeps the empty state instead of a stale preview', () => {
  const preview = chatListPreview(chat(), ME, NOW)

  assert.equal(preview.snippet, EMPTY_SNIPPET)
  assert.equal(preview.hasHistory, false)
  assert.equal(preview.timeLabel, '')
})

test('an attachment with no caption is described rather than shown as blank', () => {
  const preview = chatListPreview(chat(storedLast('', { type: 'image' })), ME, NOW)

  assert.equal(preview.snippet, 'Photo')
  assert.equal(preview.hasHistory, true)
})

test('an encrypted message never leaks ciphertext into the preview', () => {
  const preview = chatListPreview(chat(storedLast('Encrypted message', { encrypted: true })), ME, NOW)

  assert.equal(preview.snippet, 'Encrypted message')
  assert.equal(messageSnippet({ content: 'BASE64CIPHERTEXTNOISE', encrypted: true }), 'Encrypted message')
})

test('reactions and receipts never become the preview; the last real message is used', () => {
  const preview = chatListPreview(chat({
    messages: [
      { id: 'm1', sender_id: PEER, content: 'Are you around?', type: 'text', created_at: new Date(NOW - 5 * 60000).toISOString() },
      { id: 'm2', sender_id: PEER, content: '{"messageId":"m1","emoji":"\ud83d\udc4d","active":true}', type: 'reaction', created_at: new Date(NOW - 60000).toISOString() },
      { id: 'm3', sender_id: ME, content: '{"messageIds":["m1"],"status":"read"}', type: 'receipt', created_at: new Date(NOW - 30000).toISOString() },
      { id: 'm4', sender_id: PEER, content: 'nexus:v1:{"kind":"call"}', type: 'call', created_at: new Date(NOW - 10000).toISOString() },
    ],
  }), ME, NOW)

  assert.equal(preview.snippet, 'Are you around?')
  assert.equal(preview.sentByViewer, false)
  assert.equal(preview.timeLabel, '5m ago')
})

test('a reply-encoded message previews its readable text', () => {
  const content = encodeReply('Sure thing', { id: 'm1', content: 'Can you confirm?' })
  assert.equal(chatListPreview(chat(storedLast(content)), ME, NOW).snippet, 'Sure thing')
})

test('the stored summary wins over an older cached thread', () => {
  const target = chat({
    ...storedLast('newest'),
    messages: [{ id: 'old', sender_id: PEER, content: 'oldest', type: 'text', created_at: '2000-01-01T00:00:00.000Z' }],
  })

  assert.equal(resolveLastMessage(target).content, 'newest')
})

test('an invalid timestamp yields no age label instead of a broken one', () => {
  const preview = chatListPreview(chat(storedLast('hello', { minutesAgo: 0 }) ), ME, NOW)
  assert.equal(preview.timeLabel, 'now')

  const broken = chatListPreview(chat({ last_message: 'hello', last_message_time: 'not-a-date' }), ME, NOW)
  assert.equal(broken.timeLabel, '')
  assert.equal(broken.snippet, 'hello')
})
