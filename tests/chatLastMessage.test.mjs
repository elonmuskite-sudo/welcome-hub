import test from 'node:test'
import assert from 'node:assert/strict'

// Browser shims: persistence.js persists through window.localStorage and
// announces updates with window events, so the sync workflow runs unmodified.
const store = new Map()
const events = []

globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { store.set(key, String(value)) },
  removeItem: (key) => { store.delete(key) },
  clear: () => store.clear(),
}
globalThis.window = {
  localStorage: globalThis.localStorage,
  dispatchEvent: (event) => { events.push(event); return true },
  addEventListener: () => {},
  removeEventListener: () => {},
}
if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = init?.detail }
  }
}

const { applyChatSyncBatch, appendMessage, applyLastMessageSummary } = await import('../src/lib/persistence.js')
const { chatListPreview } = await import('../src/lib/chatPreview.js')

const CHAT_KEY = 'nexus-chat-state-v1'
const ME = 'user-1'
// Local noon keeps the relative-age assertions stable on any test machine.
const NOW = new Date(2026, 9, 20, 12, 0, 0).getTime()

const at = (minutesAgo) => new Date(NOW - minutesAgo * 60000).toISOString()

function row(chatId, senderId, content, createdAt, extra = {}) {
  return {
    id: `${chatId}:${createdAt}`, chat_id: chatId, sender_id: senderId, content, created_at: createdAt,
    type: 'text', encrypted: false, file_url: null, file_name: null, duration: null, ...extra,
  }
}

function seedChat(id, peer, messages = []) {
  const last = messages[messages.length - 1]
  return {
    id, title: `Chat ${id}`, type: 'private', encrypted: false, owner_id: ME,
    participant_ids: [ME, peer], participant_names: { [ME]: 'Me', [peer]: `Peer ${peer}` },
    messages,
    last_message: last ? last.content : null,
    last_message_time: last ? last.created_at : null,
    last_message_sender_id: last ? last.sender_id : null,
    last_message_type: 'text', last_message_encrypted: false,
    unread_count: 0, created_at: '2026-01-01T00:00:00.000Z',
  }
}

function seed(chats) {
  store.clear()
  store.set(CHAT_KEY, JSON.stringify(chats))
  events.length = 0
  return chats.map(({ messages, ...chat }) => chat)
}

test('a new inbound message refreshes the contact-list preview immediately', async () => {
  const chats = seed([seedChat('chat-0', 'peer-0', [
    { id: 'a', sender_id: 'peer-0', content: 'hello', type: 'text', created_at: at(60) },
  ])])

  await appendMessage(chats[0].id, {
    id: 'b', sender_id: 'peer-0', content: 'Ping', type: 'text', created_at: at(2),
  })

  const [updated] = JSON.parse(store.get(CHAT_KEY))
  const preview = chatListPreview(updated, ME, NOW)
  assert.equal(preview.snippet, 'Ping')
  assert.equal(preview.sentByViewer, false)
  assert.equal(preview.timeLabel, '2m ago')
  assert.equal(events.filter((event) => event.type === 'nexus-chat:updated').length, 1)
})

test('simultaneous arrivals from several contacts each land on their own row', () => {
  const chats = seed([0, 1, 2, 3].map((index) => seedChat(`chat-${index}`, `peer-${index}`)))

  const { chats: next } = applyChatSyncBatch(chats, [
    row('chat-2', 'peer-2', 'from two', at(4)),
    row('chat-0', 'peer-0', 'from zero', at(3)),
    row('chat-3', 'peer-3', 'from three', at(2)),
    row('chat-1', 'peer-1', 'from one', at(1)),
  ])

  assert.deepEqual(
    next.map((chat) => chatListPreview(chat, ME, NOW).snippet),
    ['from zero', 'from one', 'from two', 'from three'],
  )
})

test('a batch that arrives out of order still settles on the newest message', () => {
  const chats = seed([seedChat('chat-0', 'peer-0')])

  applyChatSyncBatch(chats, [
    row('chat-0', 'peer-0', 'newest', at(1)),
    row('chat-0', 'peer-0', 'older', at(6)),
  ])

  const [updated] = JSON.parse(store.get(CHAT_KEY))
  assert.equal(updated.last_message, 'newest')
  assert.equal(chatListPreview(updated, ME, NOW).snippet, 'newest')
})

test('a reaction arriving last does not replace the preview', () => {
  const chats = seed([seedChat('chat-0', 'peer-0', [
    { id: 'a', sender_id: 'peer-0', content: 'still here?', type: 'text', created_at: at(30) },
  ])])

  applyChatSyncBatch(chats, [
    row('chat-0', 'peer-0', '{"messageId":"a","emoji":"x","active":true}', at(1), { type: 'reaction' }),
  ])

  const [updated] = JSON.parse(store.get(CHAT_KEY))
  assert.equal(updated.last_message, 'still here?')
  assert.equal(chatListPreview(updated, ME, NOW).snippet, 'still here?')
})

test('a cold cache is filled from the newest message returned with the chat list', () => {
  const cold = { id: 'chat-9', participant_ids: [ME, 'peer-9'], participant_names: { [ME]: 'Me', 'peer-9': 'Peer 9' }, messages: [], last_message: null, last_message_time: null }

  const filled = applyLastMessageSummary(cold, {
    content: 'Cold start', created_at: at(2), sender_id: 'peer-9', type: 'text', encrypted: false,
  })

  const preview = chatListPreview(filled, ME, NOW)
  assert.equal(preview.snippet, 'Cold start')
  assert.equal(preview.timeLabel, '2m ago')
  assert.equal(preview.hasHistory, true)
})

test('an older remote row cannot roll back a newer stored preview', () => {
  const stored = {
    id: 'chat-9', participant_ids: [ME, 'peer-9'], messages: [],
    last_message: 'Local newest', last_message_time: at(1), last_message_sender_id: 'peer-9',
  }

  const merged = applyLastMessageSummary(stored, {
    content: 'Remote older', created_at: at(120), sender_id: 'peer-9', type: 'text',
  })

  assert.equal(merged.last_message, 'Local newest')
})

test('a control row returned as the newest message is ignored', () => {
  const cold = { id: 'chat-9', participant_ids: [ME, 'peer-9'], messages: [], last_message: null, last_message_time: null }

  const merged = applyLastMessageSummary(cold, {
    content: '{"messageIds":["a"],"status":"read"}', created_at: at(1), sender_id: 'peer-9', type: 'receipt',
  })

  assert.equal(merged.last_message, null)
  assert.equal(chatListPreview(merged, ME, NOW).hasHistory, false)
})
