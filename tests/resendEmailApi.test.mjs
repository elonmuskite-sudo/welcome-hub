import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'

process.env.SUPABASE_URL = 'https://auth.example.test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
process.env.RESEND_API_KEY = 'test-resend-api-key'
process.env.RESEND_FROM = 'Nexus <admin@example.test>'
process.env.NODE_ENV = 'production'

const originalFetch = globalThis.fetch
const originalNow = Date.now
const sentEmails = []
const authRequests = []
const testUserId = 'f9c2e2dd-f11f-43d4-ad07-c94269e5141d'
let rateLimitAllowed = true
let otpSequence = 100000

globalThis.fetch = async (request, options = {}) => {
  const url = new URL(request instanceof Request ? request.url : request)
  if (url.hostname === 'api.resend.com') {
    const body = JSON.parse(options.body)
    sentEmails.push(body)
    return new Response(JSON.stringify({ id: `resend-${sentEmails.length}` }), { status: 201 })
  }

  if (url.pathname.endsWith('/auth/v1/admin/users') && options.method === 'POST') {
    const body = JSON.parse(options.body)
    authRequests.push({ action: 'createUser', body })
    return new Response(JSON.stringify({ id: testUserId, email: body.email, user_metadata: body.user_metadata }), { status: 200 })
  }

  if (url.pathname.endsWith('/auth/v1/admin/users') && options.method === 'GET') {
    authRequests.push({ action: 'listUsers' })
    return new Response(JSON.stringify({ users: [
      { id: testUserId, email: 'verify-user@example.test' },
      { id: testUserId, email: 'resend-user@example.test' },
      { id: testUserId, email: 'recover-user@example.test' },
      { id: testUserId, email: 'reset-user@example.test' },
      { id: testUserId, email: 'rate-limited@example.test' },
      { id: testUserId, email: 'new-user@example.test' },
    ] }), { status: 200 })
  }

  if (url.pathname.endsWith(`/auth/v1/admin/users/${testUserId}`) && options.method === 'PUT') {
    const body = JSON.parse(options.body)
    authRequests.push({ action: 'updateUser', body })
    return new Response(JSON.stringify({ id: testUserId, email: 'test@example.test', email_confirmed_at: '2026-10-03T00:00:00Z' }), { status: 200 })
  }

  if (url.pathname.endsWith('/auth/v1/admin/generate_link')) {
    const body = JSON.parse(options.body)
    authRequests.push({ action: 'generateLink', body })
    return new Response(JSON.stringify({
      action_link: 'https://auth.example.test/action',
      hashed_token: 'mock-supabase-token-hash',
      verification_type: body.type,
      user: { id: testUserId, email: body.email },
    }), { status: 200 })
  }

  if (url.pathname.endsWith('/auth/v1/admin/users/by-email') && options.method === 'GET') {
    authRequests.push({ action: 'getUserByEmail', query: url.searchParams.get('email') })
    return new Response(JSON.stringify({ user: { id: testUserId, email: 'expired-user@example.test' } }), { status: 200 })
  }

  if (url.pathname.endsWith('/rest/v1/members')) {
    return new Response(JSON.stringify({ auth_user_id: testUserId }), { status: 200 })
  }

  if (url.pathname.endsWith('/rest/v1/rpc/consume_auth_email_code_limit')) {
    return new Response(String(rateLimitAllowed), { status: 200 })
  }

  throw new Error(`Unexpected mocked request: ${url.pathname}`)
}

const { default: handler } = await import('../api/auth/email-code.js')

function responseRecorder() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) { this.headers[name] = value },
    status(value) { this.statusCode = value; return this },
    json(value) { this.body = value; return this },
  }
}

function request(body, headers = {}) {
  return {
    method: 'POST',
    headers: { origin: 'https://app.example.test', host: 'app.example.test', ...headers },
    body,
  }
}

before(() => {
  Date.now = () => 1_000_000
})

after(() => {
  globalThis.fetch = originalFetch
  Date.now = originalNow
})

test('signup creates an unconfirmed Supabase user and sends a six-digit code through Resend', async () => {
  const res = responseRecorder()
  await handler(request({
    action: 'signup',
    purpose: 'signup',
    email: 'new-user@example.test',
    password: 'Secure-test-password-123',
    firstName: 'New',
    lastName: 'User',
    memberId: '1012345678',
  }), res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { ok: true })
  assert.match(res.headers['Set-Cookie'], /HttpOnly/)
  assert.match(res.headers['Set-Cookie'], /Secure/)
  assert.equal(authRequests.at(-1).action, 'createUser')
  assert.equal(authRequests.at(-1).body.email_confirm, false)
  assert.equal(authRequests.at(-1).body.user_metadata.member_id, '1012345678')
  assert.equal(sentEmails.at(-1).to[0], 'new-user@example.test')
  assert.match(sentEmails.at(-1).text, /code is \d{6}/)
  const code = sentEmails.at(-1).text.match(/code is (\d{6})/)[1]
  assert.equal(res.headers['Set-Cookie'].includes(code), false)
  assert.equal(JSON.stringify(res.body).includes(code), false)
})

test('resend generates a fresh code and updates the pending cookie', async () => {
  const signupResponse = responseRecorder()
  await handler(request({
    action: 'signup',
    purpose: 'signup',
    email: 'resend-user@example.test',
    password: 'Secure-test-password-123',
    firstName: 'Resend',
    lastName: 'User',
    memberId: '1098765432',
  }), signupResponse)

  const originalCode = sentEmails.at(-1).text.match(/code is (\d{6})/)[1]
  const cookie = signupResponse.headers['Set-Cookie'].split(';')[0]
  Date.now = () => 1_061_000
  const res = responseRecorder()
  await handler(request({ action: 'resend', purpose: 'signup', email: 'resend-user@example.test' }, { cookie }), res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { ok: true })
  const nextCode = sentEmails.at(-1).text.match(/code is (\d{6})/)[1]
  assert.notEqual(nextCode, originalCode)
})

test('password recovery generates and sends a recovery OTP through Resend', async () => {
  Date.now = () => 1_122_000
  const res = responseRecorder()
  await handler(request({
    action: 'recovery',
    purpose: 'recovery',
    email: 'recover-user@example.test',
  }), res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { ok: true })
  assert.equal(sentEmails.at(-1).to[0], 'recover-user@example.test')
  assert.match(sentEmails.at(-1).text, /code is \d{6}/)
})

test('resend regenerates a fresh code when a stale cookie is missing or expired', async () => {
  const email = 'expired-user@example.test'
  const signupResponse = responseRecorder()
  await handler(request({
    action: 'signup',
    purpose: 'signup',
    email,
    password: 'Secure-test-password-123',
    firstName: 'Expired',
    lastName: 'User',
    memberId: '1012349876',
  }), signupResponse)

  const firstCode = sentEmails.at(-1).text.match(/code is (\d{6})/)[1]
  const cookie = signupResponse.headers['Set-Cookie'].split(';')[0]
  Date.now = () => 2_000_000
  const res = responseRecorder()
  await handler(request({ action: 'resend', purpose: 'signup', email }, { cookie }), res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { ok: true })
  const nextCode = sentEmails.at(-1).text.match(/code is (\d{6})/)[1]
  assert.notEqual(nextCode, firstCode)
  assert.ok(res.headers['Set-Cookie'])
})

test('signup code verification confirms the user and returns a Supabase sign-in token hash', async () => {
  Date.now = () => 1_153_000
  const signupResponse = responseRecorder()
  await handler(request({
    action: 'signup',
    purpose: 'signup',
    email: 'verify-user@example.test',
    password: 'Secure-test-password-123',
    firstName: 'Verify',
    lastName: 'User',
    memberId: '1012123434',
  }), signupResponse)

  const code = sentEmails.at(-1).text.match(/code is (\d{6})/)[1]
  const cookie = signupResponse.headers['Set-Cookie'].split(';')[0]
  const res = responseRecorder()
  await handler(request({ action: 'verify', purpose: 'signup', email: 'verify-user@example.test', code }, { cookie }), res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.tokenHash, 'mock-supabase-token-hash')
  assert.equal(authRequests.at(-2).action, 'updateUser')
  assert.equal(authRequests.at(-2).body.email_confirm, true)
  assert.equal(authRequests.at(-1).action, 'generateLink')
  assert.equal(authRequests.at(-1).body.type, 'magiclink')
  assert.match(res.headers['Set-Cookie'], /Max-Age=0/)
})

test('recovery code verification returns a Supabase recovery token hash', async () => {
  Date.now = () => 1_183_000
  const recoveryResponse = responseRecorder()
  await handler(request({ action: 'recovery', purpose: 'recovery', email: 'reset-user@example.test' }), recoveryResponse)

  const code = sentEmails.at(-1).text.match(/code is (\d{6})/)[1]
  const cookie = recoveryResponse.headers['Set-Cookie'].split(';')[0]
  const res = responseRecorder()
  await handler(request({ action: 'verify', purpose: 'recovery', email: 'reset-user@example.test', code }, { cookie }), res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.tokenHash, 'mock-supabase-token-hash')
  assert.equal(authRequests.at(-1).body.type, 'recovery')
})

test('rejects requests from a different origin before calling providers', async () => {
  const authCount = authRequests.length
  const resendCount = sentEmails.length
  const res = responseRecorder()
  await handler(request({ action: 'recovery', purpose: 'recovery', email: 'private@example.test' }, {
    origin: 'https://attacker.example',
  }), res)

  assert.equal(res.statusCode, 403)
  assert.equal(authRequests.length, authCount)
  assert.equal(sentEmails.length, resendCount)
})

test('denies code sends when the persistent Supabase rate limit is exhausted', async () => {
  rateLimitAllowed = false
  const authCount = authRequests.length
  const resendCount = sentEmails.length
  const res = responseRecorder()
  await handler(request({
    action: 'recovery',
    purpose: 'recovery',
    email: 'rate-limited@example.test',
  }), res)
  rateLimitAllowed = true

  assert.equal(res.statusCode, 429)
  assert.equal(authRequests.length, authCount)
  assert.equal(sentEmails.length, resendCount)
})