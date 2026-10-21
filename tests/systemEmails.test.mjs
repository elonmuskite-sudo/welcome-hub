import assert from 'node:assert/strict'
import test from 'node:test'
import { createSystemEmailHandler } from '../api/notifications/system-email.js'
import { identityReviewEmail, securityAlertEmail, sendSystemEmail } from '../server/systemEmails.js'

process.env.SUPABASE_URL = 'https://auth.example.test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

const userId = '123e4567-e89b-42d3-a456-426614174000'
const verificationId = '123e4567-e89b-42d3-a456-426614174001'

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

function request(action, body = {}, headers = {}) {
  return {
    method: 'POST',
    headers: {
      origin: 'https://app.example.test',
      host: 'app.example.test',
      authorization: 'Bearer valid-session-token',
      ...headers,
    },
    body: { action, ...body },
  }
}

function makeDependencies({
  adminRole = false,
  aal = 'aal1',
  emailVerified = true,
  verification = null,
  recipient = null,
  rateLimitAllowed = true,
} = {}) {
  const sent = []
  const admin = {
    auth: {
      async getUser(token) {
        assert.equal(token, 'valid-session-token')
        return {
          data: {
            user: {
              id: userId,
              email: 'account@example.test',
              email_confirmed_at: emailVerified ? '2026-10-01T00:00:00Z' : null,
            },
          },
          error: null,
        }
      },
      async getClaims() {
        return {
          data: { claims: { sub: userId, session_id: 'session-123', aal } },
          error: null,
        }
      },
    },
    async rpc(name, args) {
      if (name === 'has_role') return { data: adminRole, error: null }
      if (name === 'consume_auth_email_code_limit') {
        assert.match(args.p_bucket_key, /^[a-f0-9]{64}$/)
        assert.equal(args.p_window_seconds, 3600)
        assert.equal(args.p_limit, 3)
        return { data: rateLimitAllowed, error: null }
      }
      assert.fail(`Unexpected RPC ${name}`)
    },
    from(table) {
      const filters = {}
      const query = {
        select(columns) { query.columns = columns; return query },
        eq(column, value) { filters[column] = value; return query },
        async maybeSingle() {
          if (table === 'identity_verifications') {
            assert.equal(filters.id, verificationId)
            assert.equal(filters.reviewed_by, userId)
            return { data: verification, error: null }
          }
          assert.equal(table, 'members')
          assert.equal(filters.id, verification.user_id)
          return { data: recipient, error: null }
        },
      }
      return query
    },
  }
  return {
    sent,
    handler: createSystemEmailHandler({
      adminClientFactory: () => admin,
      emailSender: async (message) => { sent.push(message) },
    }),
  }
}

test('security alert emails use only the verified session account and stable idempotency', async () => {
  const { handler, sent } = makeDependencies()
  const res = responseRecorder()
  await handler(request('security-alert', { to: 'attacker@example.test' }), res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { ok: true })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, 'account@example.test')
  assert.equal(sent[0].idempotencyKey, `security-alert/${userId}/session-123`)
  assert.deepEqual(
    { subject: sent[0].subject, text: sent[0].text, html: sent[0].html },
    securityAlertEmail(),
  )
})

test('security alerts require AAL2 for administrators and are rate limited', async () => {
  const admin = makeDependencies({ adminRole: true })
  const mfaResponse = responseRecorder()
  await admin.handler(request('security-alert'), mfaResponse)
  assert.equal(mfaResponse.statusCode, 403)
  assert.equal(admin.sent.length, 0)

  const limited = makeDependencies({ rateLimitAllowed: false })
  const limitResponse = responseRecorder()
  await limited.handler(request('security-alert'), limitResponse)
  assert.equal(limitResponse.statusCode, 429)
  assert.equal(limited.sent.length, 0)
})

test('identity review emails require AAL2 admin and use the verified reviewed account address', async () => {
  const { handler, sent } = makeDependencies({
    adminRole: true,
    aal: 'aal2',
    verification: {
      id: verificationId,
      user_id: '123e4567-e89b-42d3-a456-426614174002',
      status: 'rejected',
      reviewer_note: '<img src=x onerror=alert(1)>',
      reviewed_by: userId,
      reviewed_at: '2026-10-21T10:00:00Z',
    },
    recipient: {
      email: 'reviewed-user@example.test',
      email_verified: true,
    },
  })
  const res = responseRecorder()
  await handler(request('identity-review', { verificationId, to: 'attacker@example.test' }), res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { ok: true })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, 'reviewed-user@example.test')
  assert.match(sent[0].text, /Reviewer note: <img/)
  assert.equal(sent[0].html.includes('<img src=x'), false)
  assert.match(sent[0].html, /&lt;img src=x/)
  assert.match(sent[0].idempotencyKey, new RegExp(`^identity-review/${verificationId}/rejected/`))
})

test('identity review email rejects non-admin, unverified-recipient, and malformed requests', async () => {
  const nonAdmin = makeDependencies({ aal: 'aal2' })
  const denied = responseRecorder()
  await nonAdmin.handler(request('identity-review', { verificationId }), denied)
  assert.equal(denied.statusCode, 403)
  assert.equal(nonAdmin.sent.length, 0)

  const missingRecipient = makeDependencies({
    adminRole: true,
    aal: 'aal2',
    verification: {
      id: verificationId,
      user_id: '123e4567-e89b-42d3-a456-426614174002',
      status: 'approved',
      reviewed_by: userId,
      reviewed_at: '2026-10-21T10:00:00Z',
    },
    recipient: { email: 'unverified@example.test', email_verified: false },
  })
  const unverified = responseRecorder()
  await missingRecipient.handler(request('identity-review', { verificationId }), unverified)
  assert.equal(unverified.statusCode, 409)
  assert.equal(missingRecipient.sent.length, 0)

  const malformed = responseRecorder()
  await missingRecipient.handler(request('identity-review', { verificationId: 'not-a-uuid' }), malformed)
  assert.equal(malformed.statusCode, 400)
})

test('identity review email template safely escapes reviewer notes and omits notes from approvals', () => {
  const rejected = identityReviewEmail({ status: 'rejected', reviewerNote: '<script>alert(1)</script>' })
  assert.match(rejected.text, /<script>/)
  assert.equal(rejected.html.includes('<script>'), false)
  assert.match(rejected.html, /&lt;script&gt;/)

  const approved = identityReviewEmail({ status: 'approved', reviewerNote: 'must not be sent' })
  assert.equal(approved.text.includes('must not be sent'), false)
  assert.equal(approved.html.includes('must not be sent'), false)
  assert.throws(() => identityReviewEmail({ status: 'pending' }), /Invalid identity review status/)
})

test('Resend delivery uses the configured verified sender and idempotency key', async () => {
  const previousApiKey = process.env.RESEND_API_KEY
  const previousSender = process.env.RESEND_FROM
  const originalFetch = globalThis.fetch
  let request
  process.env.RESEND_API_KEY = 'test-resend-key'
  process.env.RESEND_FROM = 'Nexus <alerts@nexus-chat-world.com>'
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return new Response(JSON.stringify({ id: 'resend-id' }), { status: 201 })
  }

  try {
    await sendSystemEmail({
      to: 'recipient@example.test',
      subject: 'Notice',
      text: 'Plain text',
      html: '<p>Notice</p>',
      idempotencyKey: 'notice/event-1',
    })
  } finally {
    globalThis.fetch = originalFetch
    if (previousApiKey === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = previousApiKey
    if (previousSender === undefined) delete process.env.RESEND_FROM
    else process.env.RESEND_FROM = previousSender
  }

  assert.equal(request.url, 'https://api.resend.com/emails')
  assert.equal(request.options.headers.Authorization, 'Bearer test-resend-key')
  assert.equal(request.options.headers['Idempotency-Key'], 'notice/event-1')
  assert.equal(request.options.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(request.options.body), {
    from: 'Nexus <alerts@nexus-chat-world.com>',
    to: ['recipient@example.test'],
    subject: 'Notice',
    text: 'Plain text',
    html: '<p>Notice</p>',
  })
})
