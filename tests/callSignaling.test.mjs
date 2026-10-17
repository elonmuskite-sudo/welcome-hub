import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CALL_EVENTS,
  CALL_CHANNEL_EVENTS,
  INBOX_EVENTS,
  buildRingPayload,
  callChannelName,
  createCallId,
  inboxChannelName,
  matchesCall,
} from '../src/lib/callSignaling.js'

test('inbox and per-call channel names are namespaced and reject empty ids', () => {
  assert.equal(inboxChannelName(' user-1 '), 'nexus-call-inbox:user-1')
  assert.equal(callChannelName('  c-1  '), 'nexus-call:c-1')
  assert.equal(inboxChannelName(''), '')
  assert.equal(inboxChannelName(null), '')
  assert.equal(callChannelName('   '), '')
  // The two kinds must never collide on the same Realtime topic.
  assert.notEqual(inboxChannelName('x'), callChannelName('x'))
})

test('call control and handshake events stay separated', () => {
  assert.deepEqual(INBOX_EVENTS, ['ring', 'ready', 'decline', 'busy', 'hangup'])
  assert.deepEqual(CALL_CHANNEL_EVENTS, ['offer', 'answer', 'ice'])
  assert.equal(new Set([...INBOX_EVENTS, ...CALL_CHANNEL_EVENTS]).size, 8)
})

test('createCallId returns a distinct id per call', () => {
  const ids = new Set(Array.from({ length: 100 }, () => createCallId()))
  assert.equal(ids.size, 100)
  for (const id of ids) assert.ok(id.trim().length > 0)
})

test('buildRingPayload trims values and defaults the caller name', () => {
  const payload = buildRingPayload({
    callId: ' c1 ',
    chatId: ' chat-9 ',
    caller: { id: ' u2 ', name: '   ', avatar: null },
  })
  assert.deepEqual(payload, {
    callId: 'c1',
    chatId: 'chat-9',
    fromUserId: 'u2',
    fromName: 'Nexus user',
    fromAvatar: null,
  })
  assert.equal(buildRingPayload({ caller: { id: 'u2', name: 'Ada', avatar: 'a.png' } }).fromAvatar, 'a.png')
})

test('matchesCall only accepts the payload of the call in progress', () => {
  const call = { id: 'c1' }
  assert.equal(matchesCall({ callId: 'c1' }, call), true)
  assert.equal(matchesCall({ callId: 'c2' }, call), false)
  assert.equal(matchesCall({}, call), false)
  assert.equal(matchesCall(null, call), false)
  assert.equal(matchesCall({ callId: 'c1' }, null), false)
  // A stale hangup from an earlier call must not end the current one.
  assert.equal(matchesCall({ callId: 'c0' }, { id: 'c1' }), false)
})
