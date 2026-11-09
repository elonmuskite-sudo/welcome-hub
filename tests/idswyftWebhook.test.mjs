import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import test from 'node:test'
import { Readable } from 'node:stream'
import {
  buildIdswyftSessionUpdate,
  handleIdswyftWebhook,
  readIdswyftRawBody,
  verifyIdswyftSignature,
} from '../server/idswyftWebhook.js'

const secret = 'idswyft-webhook-test-secret'
const sessionId = '123e4567-e89b-12d3-a456-426614174000'
const now = 1_800_000_000_000

function signatureFor(body, timestamp = String(Math.floor(now / 1000))) {
  const digest = createHmac('sha256', secret)
    .update(timestamp)
    .update('.')
    .update(body)
    .digest('hex')
  return `t=${timestamp},v1=${digest}`
}

function responseStub() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; return this },
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

test('Idswyft webhook signature checks HMAC, format, and timestamp freshness', () => {
  const body = Buffer.from('{"type":"verification.completed"}')
  assert.equal(verifyIdswyftSignature(signatureFor(body), body, secret, now), true)
  assert.equal(verifyIdswyftSignature(signatureFor(body), Buffer.from('tampered'), secret, now), false)
  assert.equal(verifyIdswyftSignature('t=invalid,v1=00', body, secret, now), false)

  const staleTimestamp = String(Math.floor(now / 1000) - 301)
  assert.equal(verifyIdswyftSignature(signatureFor(body, staleTimestamp), body, secret, now), false)
})

test('webhook event updates only allowed KYC status and liveness fields', () => {
  const result = buildIdswyftSessionUpdate({
    type: 'verification.completed',
    data: {
      session_id: sessionId,
      status: 'APPROVED',
      liveness: { passed: true, score: 97.5, extra_private_data: 'not persisted' },
    },
  }, '2026-11-08T15:00:00.000Z')

  assert.equal(result.sessionId, sessionId)
  assert.deepEqual(result.update, {
    status: 'APPROVED',
    current_step: 5,
    liveness_results: { passed: true, score: 97.5 },
    updated_at: '2026-11-08T15:00:00.000Z',
  })
  assert.equal(buildIdswyftSessionUpdate({ type: 'verification.created' }), null)
})

test('webhook event validation rejects invalid session, status, and liveness values', () => {
  const base = {
    type: 'verification.completed',
    data: {
      session_id: sessionId,
      status: 'APPROVED',
      liveness: { passed: true, score: 97 },
    },
  }
  assert.throws(() => buildIdswyftSessionUpdate({
    ...base,
    data: { ...base.data, session_id: 'not-a-uuid' },
  }), /session ID/)
  assert.throws(() => buildIdswyftSessionUpdate({
    ...base,
    data: { ...base.data, status: 'UNRECOGNIZED' },
  }), /status/)
  assert.throws(() => buildIdswyftSessionUpdate({
    ...base,
    data: { ...base.data, liveness: { passed: 'true', score: 101 } },
  }), /liveness/)
})

test('raw webhook body reader bounds uploaded content', async () => {
  const req = Readable.from([Buffer.from('raw-body')])
  req.headers = { 'content-length': '8' }
  assert.deepEqual(await readIdswyftRawBody(req), Buffer.from('raw-body'))

  const tooLarge = Readable.from([Buffer.alloc(64 * 1024 + 1)])
  tooLarge.headers = {}
  await assert.rejects(readIdswyftRawBody(tooLarge), /too large/)
})

test('webhook handler rejects methods other than POST', async () => {
  const req = { method: 'GET', headers: {} }
  const res = responseStub()
  await handleIdswyftWebhook(req, res)
  assert.equal(res.statusCode, 405)
  assert.deepEqual(res.body, { error: 'Method not allowed.' })
})

test('webhook handler rejects an invalid signature before database access', async () => {
  const previous = process.env.IDSWYFT_WEBHOOK_SECRET
  process.env.IDSWYFT_WEBHOOK_SECRET = secret
  const req = Readable.from([Buffer.from('{"type":"verification.completed"}')])
  req.method = 'POST'
  req.headers = { 'x-idswyft-signature': 't=1800000000,v1=00' }
  const res = responseStub()
  try {
    await handleIdswyftWebhook(req, res, {
      createSupabaseClient() {
        assert.fail('database client must not be created for an invalid signature')
      },
    })
    assert.equal(res.statusCode, 401)
  } finally {
    if (previous === undefined) delete process.env.IDSWYFT_WEBHOOK_SECRET
    else process.env.IDSWYFT_WEBHOOK_SECRET = previous
  }
})

test('webhook handler persists verified events by session id using server credentials', async () => {
  const previous = {
    webhookSecret: process.env.IDSWYFT_WEBHOOK_SECRET,
    supabaseUrl: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }
  process.env.IDSWYFT_WEBHOOK_SECRET = secret
  process.env.SUPABASE_URL = 'https://project.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

  const body = Buffer.from(JSON.stringify({
    type: 'verification.completed',
    data: {
      session_id: sessionId,
      status: 'APPROVED',
      liveness: { passed: true, score: 97.5 },
    },
  }))
  const timestamp = String(Math.floor(Date.now() / 1000))
  const calls = {}
  const supabase = {
    from(table) {
      calls.table = table
      return this
    },
    update(update) {
      calls.update = update
      return this
    },
    eq(column, value) {
      calls.match = [column, value]
      return this
    },
    select(columns) {
      calls.select = columns
      return this
    },
    async maybeSingle() {
      return { data: { id: sessionId }, error: null }
    },
    rpc(name, params) {
      calls.rpc = [name, params]
      return { error: null }
    },
  }
  const req = Readable.from([body])
  req.method = 'POST'
  req.headers = {
    'content-length': String(body.length),
    'x-idswyft-signature': signatureFor(body, timestamp),
  }
  const res = responseStub()
  try {
    await handleIdswyftWebhook(req, res, {
      createSupabaseClient(url, key, options) {
        calls.client = [url, key, options]
        return supabase
      },
    })
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.body, { success: true })
    assert.equal(calls.table, 'kyc_sessions')
    assert.deepEqual(calls.match, ['id', sessionId])
    assert.equal(calls.select, 'id')
    assert.deepEqual(calls.update, {
      status: 'APPROVED',
      current_step: 5,
      liveness_results: { passed: true, score: 97.5 },
      updated_at: calls.update.updated_at,
    })
    assert.match(calls.update.updated_at, /^\d{4}-\d\d-\d\dT/)
    // An APPROVED provider result is the only event that grants the instant badge.
    assert.deepEqual(calls.rpc, ['approve_identity_from_kyc', { _session_id: sessionId }])
    assert.equal(calls.client[0], process.env.SUPABASE_URL)
    assert.equal(calls.client[1], process.env.SUPABASE_SERVICE_ROLE_KEY)
    assert.deepEqual(calls.client[2], {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  } finally {
    for (const [key, value] of Object.entries({
      IDSWYFT_WEBHOOK_SECRET: previous.webhookSecret,
      SUPABASE_URL: previous.supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: previous.serviceRoleKey,
    })) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
