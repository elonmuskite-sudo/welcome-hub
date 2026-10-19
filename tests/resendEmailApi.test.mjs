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

// Emails that already exist in the auth store, so createUser fails for them.
const ALREADY_REGISTERED_EMAILS = new Set(['taken-user@example.test', 'unverified-user@example.test'])

function nextOtp() {
  otpSequence += 1
  return String(otpSequence)
}

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
    if (ALREADY_REGISTERED_EMAILS.has(body.email)) {
      return new Response(JSON.stringify({
        code: 422,
        msg: 'A user with this email address has already been registered',
        message: 'A user with this email address has already been registered',
      }), { status: 422 })
    }
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
      { id: testUserId, email: 'code-user@example.test' },
      { id: testUserId, email: 'taken-user@example.test', email_confirmed_at: '2026-01-01T00:00:00Z' },
      { id: testUserId, email: 'unverified-user@example.test', email_confirmed_at: null },
    ] }), { status: 200 })
  }

  if (url.pathname.endsWith('/auth/v1/admin/generate_link')) {
    const body = JSON.parse(options.body)
    const emailOtp = nextOtp()
    authRequests.push({ action: 'generateLink', body, emailOtp })
    return new Response(JSON.stringify({
      action_link: `https://auth.example.test/verify?token=${emailOtp}`,
      email_otp: emailOtp,
      hashed_token: `hash-${emailOtp}`,
      verification_type: body.type,
      user: { id: testUserId, email: body.email },
    }), { status: 200 })
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

function assertResendOtp(email, { purposeSubject } = {}) {
  const sent = sentEmails.at(-1)
  assert.equal(sent.to[0], email)
  assert.match(sent.from, /@nexus-chat-world\.com>?$/)
  assert.equal(sent.from.includes('example.test'), false)
  assert.match(sent.text, /code is \d{6}/)
  assert.match(sent.html, />\d{6}</)
  assert.equal(/https?:\/\//i.test(sent.text), false)
  assert.equal(/https?:\/\//i.test(sent.html), false)
  assert.equal(/href=/i.test(sent.html), false)
  if (purposeSubject) assert.match(sent.subject, purposeSubject)
  const code = sent.text.match(/code is (\d{6})/)[1]
  assert.equal(JSON.stringify(sentEmails.at(-1)).includes('action_link'), false)
  return code
}

before(() => {
  Date.now = () => 1_000_000
})

after(() => {
  globalThis.fetch = originalFetch
  Date.now = originalNow
})

test('signup creates an unconfirmed user and sends a Resend OTP from nexus-chat-world.com', async () => {
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
  assert.equal(res.body.ok, true)
  assert.equal(res.body.otpType, 'signup')
  assert.equal(res.headers['Set-Cookie'], undefined)
  const createUser = authRequests.find((item) => item.action === 'createUser')
  assert.equal(createUser.body.email_confirm, false)
  assert.equal(createUser.body.user_metadata.member_id, '1012345678')
  const generateLink = authRequests.filter((item) => item.action === 'generateLink').at(-1)
  assert.equal(generateLink.body.type, 'signup')
  const code = assertResendOtp('new-user@example.test', { purposeSubject: /verification code/ })
  assert.equal(JSON.stringify(res.body).includes(code), false)
})

test('signup refuses to re-register a confirmed account and returns a sign-in code', async () => {
  const resendCount = sentEmails.length
  const res = responseRecorder()
  await handler(request({
    action: 'signup',
    purpose: 'signup',
    email: 'taken-user@example.test',
    password: 'Secure-test-password-123',
    firstName: 'Taken',
    lastName: 'Account',
    memberId: '1011111111',
  }), res)

  assert.equal(res.statusCode, 400)
  assert.equal(res.body.code, 'email_already_registered')
  assert.match(res.body.error, /already exists/)
  assert.equal(sentEmails.length, resendCount)
})

test('signup reuses an unconfirmed account and emails a fresh OTP', async () => {
  const res = responseRecorder()
  await handler(request({
    action: 'signup',
    purpose: 'signup',
    email: 'unverified-user@example.test',
    password: 'Secure-test-password-123',
    firstName: 'Unverified',
    lastName: 'Account',
    memberId: '1022222222',
  }), res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.otpType, 'signup')
  assertResendOtp('unverified-user@example.test', { purposeSubject: /verification code/ })
})

test('resend issues a fresh Resend OTP without using a verification link', async () => {
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
  const res = responseRecorder()
  await handler(request({ action: 'resend', purpose: 'signup', email: 'resend-user@example.test' }), res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.ok, true)
  const nextCode = assertResendOtp('resend-user@example.test')
  assert.notEqual(nextCode, originalCode)
  assert.equal(authRequests.filter((item) => item.action === 'generateLink').at(-1).body.type, 'magiclink')
})

test('password recovery sends a recovery OTP through Resend', async () => {
  const res = responseRecorder()
  await handler(request({
    action: 'recovery',
    purpose: 'recovery',
    email: 'recover-user@example.test',
  }), res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.ok, true)
  assert.equal(res.body.otpType, 'recovery')
  assertResendOtp('recover-user@example.test', { purposeSubject: /password reset code/ })
  assert.equal(authRequests.filter((item) => item.action === 'generateLink').at(-1).body.type, 'recovery')
})

test('email sign-in sends a Resend OTP from the verified domain', async () => {
  const res = responseRecorder()
  await handler(request({
    action: 'email',
    purpose: 'email',
    email: 'code-user@example.test',
  }), res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.ok, true)
  assertResendOtp('code-user@example.test', { purposeSubject: /sign-in code/ })
})

test('verify action rejects link-based completion', async () => {
  const res = responseRecorder()
  await handler(request({
    action: 'verify',
    purpose: 'signup',
    email: 'verify-user@example.test',
    code: '123456',
  }), res)

  assert.equal(res.statusCode, 400)
  assert.match(res.body.error, /Verification links are not used/)
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
