import test from 'node:test'
import assert from 'node:assert/strict'
import { buildIceServers } from '../src/lib/callIce.js'

test('STUN falls back to the public servers when no override is configured', () => {
  const { iceServers } = buildIceServers({})
  assert.equal(iceServers.length, 1)
  assert.ok(iceServers[0].urls.includes('stun:stun.l.google.com:19302'))
})

test('a comma-separated STUN override replaces the defaults', () => {
  const { iceServers } = buildIceServers({ VITE_STUN_URL: 'stun:a.example:3478, stun:b.example:3478 ,' })
  assert.deepEqual(iceServers[0].urls, ['stun:a.example:3478', 'stun:b.example:3478'])
})

test('TURN is only added when a relay URL is configured', () => {
  assert.equal(buildIceServers({ VITE_TURN_USERNAME: 'user', VITE_TURN_CREDENTIAL: 'secret' }).iceServers.length, 1)

  const { iceServers } = buildIceServers({
    VITE_TURN_URL: 'turn:relay.example:3478?transport=udp,turns:relay.example:5349',
    VITE_TURN_USERNAME: ' user ',
    VITE_TURN_CREDENTIAL: ' secret ',
  })
  assert.equal(iceServers.length, 2)
  assert.deepEqual(iceServers[1].urls, [
    'turn:relay.example:3478?transport=udp',
    'turns:relay.example:5349',
  ])
  assert.equal(iceServers[1].username, 'user')
  assert.equal(iceServers[1].credential, 'secret')
})

test('a credential-free TURN relay omits the auth fields', () => {
  const { iceServers } = buildIceServers({ VITE_TURN_URL: 'turn:open.example:3478' })
  assert.deepEqual(iceServers[1], { urls: ['turn:open.example:3478'] })
})
