const E164_PATTERN = /^\+[1-9]\d{7,14}$/
const ACCOUNT_SID_PATTERN = /^AC[a-f0-9]{32}$/i
const SERVICE_SID_PATTERN = /^MG[a-f0-9]{32}$/i

export function hasSmsConsent(user) {
  return Boolean(
    user?.phone_confirmed_at
    && E164_PATTERN.test(String(user.phone || ''))
    && user.user_metadata?.sms_transactional_opt_in === true,
  )
}

export function securityAlertSms() {
  return 'Nexus Chat: Sign-in detected. If this was not you, change your password and contact support. Msg & data rates may apply. Reply STOP to opt out.'
}

export function identityReviewSms(status) {
  if (!['approved', 'rejected'].includes(status)) throw new Error('Invalid identity review status.')
  const label = status === 'approved' ? 'approved' : 'not approved'
  return `Nexus Chat: Your identity verification was ${label}. Msg & data rates may apply. Reply STOP to opt out.`
}

export function createTwilioSmsSender({
  getEnv = () => undefined,
  fetchImpl = (...args) => fetch(...args),
} = {}) {
  return async function sendTwilioSms({ to, body }) {
    const accountSid = String(getEnv('TWILIO_ACCOUNT_SID') || '').trim()
    const authToken = String(getEnv('TWILIO_AUTH_TOKEN') || '').trim()
    const messagingServiceSid = String(getEnv('TWILIO_MESSAGING_SERVICE_SID') || '').trim()

    if (!accountSid || !authToken || !messagingServiceSid) {
      throw new Error('Twilio SMS delivery is not configured on the server.')
    }
    if (!ACCOUNT_SID_PATTERN.test(accountSid) || !SERVICE_SID_PATTERN.test(messagingServiceSid)) {
      throw new Error('Twilio SMS configuration is invalid.')
    }
    if (!E164_PATTERN.test(String(to || '')) || !body || String(body).length > 1600) {
      throw new Error('Twilio SMS recipient or message is invalid.')
    }

    const credentials = btoa(`${accountSid}:${authToken}`)
    const response = await fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: to,
          MessagingServiceSid: messagingServiceSid,
          Body: body,
        }),
      },
    )
    if (!response.ok) {
      console.error('Twilio SMS delivery failed', response.status)
      throw new Error('SMS delivery failed. Check the Twilio Messaging Service configuration.')
    }
  }
}
