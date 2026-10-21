import assert from 'node:assert/strict'
import test from 'node:test'
import { createTwilioSmsSender, hasSmsConsent } from '../supabase/functions/_shared/system-sms.js'

const VALID_ENV = {
  TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
  TWILIO_AUTH_TOKEN: 'test-twilio-token',
  TWILIO_MESSAGING_SERVICE_SID: `MG${'b'.repeat(32)}`,
}

test('Twilio sender posts an opted-in message through the configured Messaging Service', async () => {
  let request
  const send = createTwilioSmsSender({
    getEnv: (name) => VALID_ENV[name],
    fetchImpl: async (url, options) => {
      request = { url, options }
      return new Response('{}', { status: 201 })
    },
  })
  await send({ to: '+14155552671', body: 'Test alert' })

  assert.equal(
    request.url,
    `https://api.twilio.com/2010-04-01/Accounts/${VALID_ENV.TWILIO_ACCOUNT_SID}/Messages.json`,
  )
  assert.equal(request.options.method, 'POST')
  assert.equal(
    request.options.headers.Authorization,
    `Basic ${btoa(`${VALID_ENV.TWILIO_ACCOUNT_SID}:test-twilio-token`)}`,
  )
  assert.equal(request.options.headers['Content-Type'], 'application/x-www-form-urlencoded')
  assert.deepEqual(Object.fromEntries(new URLSearchParams(request.options.body)), {
    To: '+14155552671',
    MessagingServiceSid: VALID_ENV.TWILIO_MESSAGING_SERVICE_SID,
    Body: 'Test alert',
  })
})

test('Twilio sender rejects missing configuration, invalid destinations, and provider failures', async () => {
  await assert.rejects(
    createTwilioSmsSender({ getEnv: () => '' })({ to: '+14155552671', body: 'Test' }),
    /not configured/,
  )
  await assert.rejects(
    createTwilioSmsSender({ getEnv: (name) => VALID_ENV[name] })({ to: '4155552671', body: 'Test' }),
    /recipient or message is invalid/,
  )
  await assert.rejects(
    createTwilioSmsSender({
      getEnv: (name) => VALID_ENV[name],
      fetchImpl: async () => new Response('provider details', { status: 401 }),
    })({ to: '+14155552671', body: 'Test' }),
    /Check the Twilio Messaging Service configuration/,
  )
})

test('SMS delivery requires a verified E.164 phone and explicit transactional consent', () => {
  assert.equal(hasSmsConsent({
    phone: '+14155552671',
    phone_confirmed_at: '2026-10-01T00:00:00Z',
    user_metadata: { sms_transactional_opt_in: true },
  }), true)
  assert.equal(hasSmsConsent({
    phone: '+14155552671',
    phone_confirmed_at: null,
    user_metadata: { sms_transactional_opt_in: true },
  }), false)
  assert.equal(hasSmsConsent({
    phone: '+14155552671',
    phone_confirmed_at: '2026-10-01T00:00:00Z',
    user_metadata: { sms_transactional_opt_in: false },
  }), false)
  assert.equal(hasSmsConsent({
    phone: '4155552671',
    phone_confirmed_at: '2026-10-01T00:00:00Z',
    user_metadata: { sms_transactional_opt_in: true },
  }), false)
})

test('system SMS templates stay within one GSM-7 segment', async () => {
  const { identityReviewSms, securityAlertSms } = await import('../supabase/functions/_shared/system-sms.js')
  for (const message of [securityAlertSms(), identityReviewSms('approved'), identityReviewSms('rejected')]) {
    assert.ok(message.length <= 160, `SMS template uses ${message.length} characters`)
    assert.doesNotMatch(message, /[^\x00-\x7F]/, 'SMS templates should stay within GSM-7 basic characters')
  }
})
