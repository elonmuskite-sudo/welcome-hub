import assert from 'node:assert/strict'
import test from 'node:test'
import { keepUserOnSessionHydrationError } from '../src/lib/authSessionState.js'

test('a transient profile error does not clear the matching authenticated user', () => {
  const currentUser = { id: 'user-1', role: 'user' }
  assert.equal(keepUserOnSessionHydrationError(currentUser, 'user-1'), currentUser)
})

test('a failed account switch never keeps the previous account in auth state', () => {
  const previousUser = { id: 'user-1', role: 'admin' }
  assert.equal(keepUserOnSessionHydrationError(previousUser, 'user-2'), null)
  assert.equal(keepUserOnSessionHydrationError(null, 'user-1'), null)
})
