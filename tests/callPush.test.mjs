import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const serviceWorker = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')

test('web push notification clicks preserve voice or video call type', () => {
  assert.match(serviceWorker, /callKind=.*data\.callKind === 'video' \? 'video' : 'voice'/)
})
