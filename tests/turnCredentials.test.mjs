import test from 'node:test'
import assert from 'node:assert/strict'
import { buildValues, toList } from '../scripts/fetch-turn-credentials.js'

// Shape returned by Metered's Open Relay credentials endpoint.
const METERED_RESPONSE = [
  { urls: 'stun:stun.relay.metered.ca:80' },
  { urls: 'turn:global.relay.metered.ca:80', username: 'user-1', credential: 'cred-1' },
  { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: 'user-1', credential: 'cred-1' },
  { urls: 'turns:global.relay.metered.ca:443', username: 'user-1', credential: 'cred-1' },
]

test('toList normalises single and array url fields', () => {
  assert.deepEqual(toList('turn:a:3478'), ['turn:a:3478'])
  assert.deepEqual(toList(['turn:a:3478', ' turns:b:443 ']), ['turn:a:3478', 'turns:b:443'])
  assert.deepEqual(toList(undefined), [])
})

test('Metered iceServers map onto the four env values', () => {
  const values = buildValues(METERED_RESPONSE)
  assert.deepEqual(values, {
    VITE_STUN_URL: 'stun:stun.relay.metered.ca:80',
    VITE_TURN_URL: [
      'turn:global.relay.metered.ca:80',
      'turn:global.relay.metered.ca:80?transport=tcp',
      'turns:global.relay.metered.ca:443',
    ].join(','),
    VITE_TURN_USERNAME: 'user-1',
    VITE_TURN_CREDENTIAL: 'cred-1',
  })
})

test('grouped urls inside one entry are flattened in order', () => {
  const values = buildValues([
    { urls: ['turn:relay:80', 'turns:relay:443'], username: 'u', credential: 'c' },
  ])
  assert.equal(values.VITE_TURN_URL, 'turn:relay:80,turns:relay:443')
  assert.equal(values.VITE_STUN_URL, '')
})

test('a response without a usable TURN credential is rejected', () => {
  assert.throws(() => buildValues([]), /iceServers/)
  assert.throws(() => buildValues('nope'), /iceServers/)
  assert.throws(() => buildValues([{ urls: 'stun:stun.relay:80' }]), /TURN entry/)
  assert.throws(() => buildValues([{ urls: 'turn:relay:80', username: 'u' }]), /TURN entry/)
})
