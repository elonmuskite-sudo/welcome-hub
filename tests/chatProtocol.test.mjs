import test from 'node:test'
import assert from 'node:assert/strict'
import {
  callHistoryLabel,
  callHistoryOutcome,
  decodeCallHistory,
  decodeContent,
  encodeCallHistory,
  encodeReply,
  reactionContent,
  resolveMessages,
} from '../src/lib/chatProtocol.js'

test('reply protocol preserves ordinary text and bounds quoted previews', () => {
  assert.deepEqual(decodeContent('hello'), { text: 'hello' })
  const result = decodeContent(encodeReply('answer', { id: 'm1', content: 'x'.repeat(300) }))
  assert.equal(result.text, 'answer')
  assert.equal(result.reply.preview.length, 160)
  assert.deepEqual(decodeContent('nexus:v1:broken'), { text: 'nexus:v1:broken' })
})

test('call history events round-trip, validate outcomes, and show direction-aware labels', () => {
  const event = {
    callId: 'call-123',
    outcome: 'completed',
    duration: 87,
    startedAt: '2026-10-28T09:00:00.000Z',
    endedAt: '2026-10-28T09:01:27.000Z',
  }
  const encoded = encodeCallHistory(event)

  assert.match(encoded, /^nexus:v1:/)
  assert.deepEqual(decodeCallHistory(encoded), event)
  assert.equal(callHistoryLabel(event, true), 'Outgoing voice call')
  assert.equal(callHistoryLabel(event, false), 'Incoming voice call')
  assert.equal(callHistoryLabel({ ...event, outcome: 'missed' }, false), 'Missed call')
  assert.equal(callHistoryLabel({ ...event, outcome: 'declined' }, true), 'Outgoing call · Declined')
  assert.equal(decodeCallHistory('invalid'), null)
  assert.throws(() => encodeCallHistory({ ...event, outcome: 'unknown' }), /invalid/)
  assert.equal(resolveMessages([{
    id: 'call-row',
    sender_id: 'caller',
    type: 'call',
    content: encoded,
    created_at: event.endedAt,
  }])[0].type, 'call')
})

test('call outcomes distinguish completed, missed, declined, busy and failed calls', () => {
  assert.equal(callHistoryOutcome({ startedAt: 123 }, ''), 'completed')
  assert.equal(callHistoryOutcome({ startedAt: 123 }, 'No answer'), 'completed')
  assert.equal(callHistoryOutcome({}, 'No answer'), 'missed')
  assert.equal(callHistoryOutcome({}, 'Call declined'), 'declined')
  assert.equal(callHistoryOutcome({}, 'That contact is already on a call'), 'busy')
  assert.equal(callHistoryOutcome({}, 'network failure'), 'failed')
  assert.equal(callHistoryOutcome({}, ''), 'cancelled')
})
test('reactions toggle independently per user and stay hidden from transcript', () => {
  const message = { id: 'm1', content: 'hello', type: 'text', created_at: '2026-01-01' }
  const event = (id, user, active) => ({ id, sender_id: user, type: 'reaction', content: reactionContent('m1', '❤️', active), created_at: `2026-01-0${id}` })
  const resolved = resolveMessages([message, event('2', 'alice', true), event('3', 'bob', true), event('4', 'alice', false)])
  assert.equal(resolved.length, 1)
  assert.equal(resolved[0].reactions.length, 1)
  assert.equal(resolved[0].reactions[0].userId, 'bob')
  assert.throws(() => reactionContent('m1', 'invalid', true))
})