import test from 'node:test'
import assert from 'node:assert/strict'

// Browser shims: persistence.js reads/writes window.localStorage and announces
// updates through window events, so the sync workflow can run unmodified here.
const store = new Map()
let writeCount = 0
const events = []

globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => { writeCount += 1; store.set(key, String(value)) },
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

const { applyChatSyncBatch, appendMessages } = await import('../src/lib/persistence.js')

const CHAT_KEY = 'nexus-chat-state-v1'
// The requirement: the synchronization workflow must finish inside half a second.
const SYNC_BUDGET_MS = 500

function makeMessage(chatId, index, type = 'text') {
  return {
    id: `${chatId}-m${index}`,
    chat_id: chatId,
    sender_id: 'peer-1',
    content: type === 'text' ? `message ${index} in ${chatId}` : '',
    type,
    encrypted: false,
    file_url: null,
    file_name: null,
    duration: null,
    created_at: new Date(1700000000000 + index * 1000).toISOString(),
  }
}

// A busy but realistic account: many threads, long history, and a poll result
// that lands several messages across many of them at once.
function seedChats(chatCount, historyPerChat) {
  const chats = []
  for (let c = 0; c < chatCount; c += 1) {
    const id = `chat-${c}`
    const messages = []
    for (let m = 0; m < historyPerChat; m += 1) messages.push(makeMessage(id, m))
    chats.push({
      id,
      title: `Conversation ${c}`,
      type: 'private',
      encrypted: false,
      owner_id: 'user-1',
      participant_ids: ['user-1', `peer-${c}`],
      participant_names: { 'user-1': 'Me', [`peer-${c}`]: `Peer ${c}` },
      messages,
      last_message: messages.length ? messages[messages.length - 1].content : null,
      last_message_time: messages.length ? messages[messages.length - 1].created_at : null,
      unread_count: 0,
      created_at: new Date(1700000000000).toISOString(),
    })
  }
  return chats
}

function seedStorage(chats) {
  store.clear()
  store.set(CHAT_KEY, JSON.stringify(chats))
  events.length = 0
}

function countEvents(type) {
  return events.filter((event) => event.type === type).length
}

test(`a full sync tick across many busy threads completes within ${SYNC_BUDGET_MS} ms`, () => {
  const CHAT_COUNT = 60
  const HISTORY = 200
  const AFFECTED_CHATS = 20
  const NEW_PER_CHAT = 25

  const chats = seedChats(CHAT_COUNT, HISTORY)
  seedStorage(chats)

  const remoteChats = chats.map(({ messages, ...chat }) => chat)
  const incoming = []
  for (let c = 0; c < AFFECTED_CHATS; c += 1) {
    for (let m = 0; m < NEW_PER_CHAT; m += 1) {
      incoming.push(makeMessage(`chat-${c}`, HISTORY + m))
    }
  }

  const started = performance.now()
  const { chats: nextChats, notifications } = applyChatSyncBatch(remoteChats, incoming)
  const durationMs = performance.now() - started

  assert.ok(
    durationMs < SYNC_BUDGET_MS,
    `sync tick took ${durationMs.toFixed(1)} ms, budget is ${SYNC_BUDGET_MS} ms`,
  )
  assert.equal(notifications.length, AFFECTED_CHATS * NEW_PER_CHAT)
  assert.equal(nextChats[0].messages.length, HISTORY + NEW_PER_CHAT)
  assert.equal(nextChats[0].last_message, makeMessage('chat-0', HISTORY + NEW_PER_CHAT - 1).content)
  assert.equal(nextChats[CHAT_COUNT - 1].messages.length, HISTORY)
})

test('a sync tick writes local storage once and notifies once, however many messages arrive', () => {
  const chats = seedChats(12, 10)
  seedStorage(chats)
  const remoteChats = chats.map(({ messages, ...chat }) => chat)

  const incoming = []
  for (let c = 0; c < 12; c += 1) {
    for (let m = 0; m < 30; m += 1) incoming.push(makeMessage(`chat-${c}`, 10 + m))
  }

  const writesBefore = writeCount
  applyChatSyncBatch(remoteChats, incoming)
  const writes = writeCount - writesBefore

  // 360 messages used to cost 360 parse/write cycles plus 360 update events.
  assert.equal(writes, 1, 'the whole batch must be persisted in one write')
  assert.equal(countEvents('nexus-chat:updated'), 1, 'the whole batch must announce one update')
})

test('a message burst for one chat costs a single write through appendMessages', async () => {
  const chats = seedChats(3, 5)
  seedStorage(chats)

  const writesBefore = writeCount
  await appendMessages('chat-1', Array.from({ length: 40 }, (_, i) => makeMessage('chat-1', 5 + i)))
  const writes = writeCount - writesBefore

  assert.equal(writes, 1)
  assert.equal(countEvents('nexus-chat:updated'), 1)
  assert.equal(JSON.parse(store.get(CHAT_KEY))[1].messages.length, 45)
})

test('sync stays inside budget when the same tick repeats against grown history', () => {
  const chats = seedChats(40, 400)
  seedStorage(chats)
  const remoteChats = chats.map(({ messages, ...chat }) => chat)

  let worst = 0
  for (let round = 0; round < 5; round += 1) {
    const incoming = []
    for (let c = 0; c < 10; c += 1) incoming.push(makeMessage(`chat-${c}`, 400 + round))
    const started = performance.now()
    applyChatSyncBatch(remoteChats, incoming)
    worst = Math.max(worst, performance.now() - started)
  }

  assert.ok(worst < SYNC_BUDGET_MS, `worst sync tick took ${worst.toFixed(1)} ms, budget is ${SYNC_BUDGET_MS} ms`)
})
