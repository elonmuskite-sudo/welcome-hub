import test from 'node:test'
import assert from 'node:assert/strict'

const storage = new Map()
const events = []

globalThis.window = {
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
  },
  dispatchEvent: (event) => { events.push(event); return true },
}
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init) {
    this.type = type
    this.detail = init?.detail
  }
}

const { isChatMuted, setChatMuted } = await import('../src/lib/chatPreferences.js')

test('mute preference is scoped to its conversation and can be toggled', () => {
  storage.clear()
  events.length = 0

  assert.equal(isChatMuted('chat-a'), false)
  setChatMuted('chat-a', true)
  assert.equal(isChatMuted('chat-a'), true)
  assert.equal(isChatMuted('chat-b'), false)

  setChatMuted('chat-a', false)
  assert.equal(isChatMuted('chat-a'), false)
  assert.deepEqual(events.map((event) => event.detail), [
    { chatId: 'chat-a' },
    { chatId: 'chat-a' },
  ])
})

test('invalid persisted mute data does not mute conversations', () => {
  storage.set('nexus-muted-chats-v1', '{')
  assert.equal(isChatMuted('chat-a'), false)
})
