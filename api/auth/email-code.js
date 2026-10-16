import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { otpEmail } from '../../supabase/functions/_shared/otp-email.js'

const RATE_LIMIT_WINDOW_SECONDS = 60
const RATE_LIMIT_PER_WINDOW = 3
const PURPOSES = new Set(['signup', 'recovery', 'email'])

function json(res, status, body) {
  res.setHeader('Cache-Control', 'no-store')
  res.status(status).json(body)
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') return JSON.parse(req.body)
  return {}
}

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function secureOrigin(req) {
  const origin = req.headers.origin
  const host = req.headers.host
  if (!origin || !host) return null
  try {
    const parsed = new URL(origin)
    if (parsed.host !== host) return null
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') return null
    return parsed.origin
  } catch {
    return null
  }
}

function createAdminClient(url, serviceRoleKey) {
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function checkSendLimit(admin, purpose, email) {
  const bucketKey = createHash('sha256').update(`${purpose}:${email}`).digest('hex')
  const { data, error } = await admin.rpc('consume_auth_email_code_limit', {
    p_bucket_key: bucketKey,
    p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
    p_limit: RATE_LIMIT_PER_WINDOW,
  })
  if (error) throw new Error('Email code rate limiting is unavailable. Apply the latest Supabase schema migration.')
  return data === true
}

function nativeEmailOtp(data) {
  return data?.properties?.email_otp || data?.email_otp || ''
}

function nativeVerificationType(data) {
  return data?.properties?.verification_type || data?.verification_type || ''
}

async function findAuthUserByEmail(admin, email) {
  try {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (error) return null
    return data?.users?.find((item) => normalizedEmail(item.email) === email) || null
  } catch {
    return null
  }
}

async function sendWithResend({ email, code, purpose, apiKey, from, idempotencyKey }) {
  const template = otpEmail({ code, purpose })
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey.slice(0, 256),
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: template.subject,
      text: template.text,
      html: template.html,
    }),
  })

  if (!response.ok) throw new Error('Email delivery failed. Check the Resend API key and verified sender domain.')
}

function fallbackOtpType(purpose) {
  if (purpose === 'recovery') return 'recovery'
  if (purpose === 'email') return 'email'
  return 'signup'
}

function linkAttempts({ email, purpose, password }) {
  if (purpose === 'recovery') return [{ type: 'recovery', email }]
  if (purpose === 'email') return [{ type: 'magiclink', email }]
  const attempts = []
  if (password) attempts.push({ type: 'signup', email, password })
  attempts.push({ type: 'magiclink', email })
  return attempts
}

async function issueNativeOtp(admin, { email, purpose, userId, apiKey, from, password }) {
  let issued = null
  let lastError = null
  for (const params of linkAttempts({ email, purpose, password })) {
    const { data, error } = await admin.auth.admin.generateLink(params)
    const code = nativeEmailOtp(data)
    if (!error && code) {
      issued = { data, code }
      break
    }
    lastError = error
  }
  if (!issued) {
    throw new Error(lastError?.message || 'Could not generate a verification code. Please try again.')
  }
  const tokenHint = issued.data?.properties?.hashed_token || issued.data?.hashed_token || `${Date.now()}`
  await sendWithResend({
    email,
    code: issued.code,
    purpose,
    apiKey,
    from,
    idempotencyKey: `auth-otp/${purpose}/${userId}/${tokenHint}`,
  })
  return nativeVerificationType(issued.data) || fallbackOtpType(purpose)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return json(res, 405, { error: 'Method not allowed.' })
  }

  const origin = secureOrigin(req)
  if (!origin) return json(res, 403, { error: 'Invalid request origin.' })

  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const resendApiKey = process.env.RESEND_API_KEY
  const sender = process.env.RESEND_FROM
  if (!supabaseUrl || !serviceRoleKey || !resendApiKey || !sender) {
    return json(res, 503, { error: 'Email verification is not configured on the server.' })
  }

  let body
  try {
    body = readBody(req)
  } catch {
    return json(res, 400, { error: 'Invalid request body.' })
  }

  const action = String(body.action || '')
  const purpose = String(body.purpose || (action === 'signup' ? 'signup' : ''))
  const email = normalizedEmail(body.email)
  if (!PURPOSES.has(purpose) || !email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(res, 400, { error: 'Enter a valid email address.' })
  }

  const admin = createAdminClient(supabaseUrl, serviceRoleKey)

  if (action === 'verify') {
    return json(res, 400, { error: 'Enter the code from your email in the app. Verification links are not used.' })
  }

  if (!['signup', 'recovery', 'email', 'resend'].includes(action)) {
    return json(res, 400, { error: 'Invalid email code action.' })
  }
  if (action !== 'resend' && action !== purpose) {
    return json(res, 400, { error: 'Invalid email code action.' })
  }

  let allowed
  try {
    allowed = await checkSendLimit(admin, purpose, email)
  } catch (error) {
    return json(res, 503, { error: error.message })
  }
  if (!allowed) return json(res, 429, { error: 'Please wait a minute before requesting another code.' })

  let user = null
  let password = ''
  if (action === 'signup') {
    password = String(body.password || '')
    const firstName = String(body.firstName || '').trim()
    const lastName = String(body.lastName || '').trim()
    const memberId = String(body.memberId || '')
    if (password.length < 8 || firstName.length > 128 || lastName.length > 128 || !/^10\d{8}$/.test(memberId)) {
      return json(res, 400, { error: 'Provide a valid name, an 8-character password, and a valid member ID.' })
    }
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
      user_metadata: { first_name: firstName, last_name: lastName, member_id: memberId },
    })
    if (error) {
      const existing = await findAuthUserByEmail(admin, email)
      if (!existing || existing.email_confirmed_at) {
        return json(res, 400, { error: error.message })
      }
      user = existing
    } else {
      user = data.user
    }
  } else {
    user = await findAuthUserByEmail(admin, email)
    if (!user) return json(res, 200, { ok: true })
  }
  if (!user?.id) return json(res, 502, { error: 'Could not prepare email verification. Please try again.' })

  try {
    const otpType = await issueNativeOtp(admin, {
      email,
      purpose,
      userId: user.id,
      apiKey: resendApiKey,
      from: sender,
      password: action === 'signup' ? password : '',
    })
    return json(res, 200, { ok: true, otpType })
  } catch (error) {
    return json(res, 502, {
      error: error.message,
      verificationPending: purpose === 'signup',
    })
  }
}
