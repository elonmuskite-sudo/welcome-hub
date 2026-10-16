import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { otpEmail } from '../_shared/otp-email.js'

const RATE_LIMIT_WINDOW_SECONDS = 60
const RATE_LIMIT_PER_WINDOW = 3
const PURPOSES = new Set(['signup', 'recovery', 'email'])

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

const normalizedEmail = (value: unknown) => String(value || '').trim().toLowerCase()

function createAdminClient(url: string, serviceRoleKey: string) {
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
}

async function sha256Hex(input: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function isPasswordPwned(password: string) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password))
  const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  let response: Response
  try {
    response = await fetch(`https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true' },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
  if (!response.ok) throw new Error(`Pwned Passwords API returned HTTP ${response.status}.`)
  const suffix = hash.slice(5)
  const ranges = await response.text()
  return ranges.split(/\r?\n/).some((line) => line.split(':')[0]?.toUpperCase() === suffix)
}

async function checkSendLimit(admin: ReturnType<typeof createAdminClient>, purpose: string, email: string) {
  const bucketKey = await sha256Hex(`${purpose}:${email}`)
  const { data, error } = await admin.rpc('consume_auth_email_code_limit', {
    p_bucket_key: bucketKey,
    p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
    p_limit: RATE_LIMIT_PER_WINDOW,
  })
  if (error) throw new Error('Email code rate limiting is unavailable.')
  return data === true
}

function nativeEmailOtp(data: { properties?: { email_otp?: string }; email_otp?: string } | null) {
  return data?.properties?.email_otp || data?.email_otp || ''
}

function nativeVerificationType(data: { properties?: { verification_type?: string }; verification_type?: string } | null) {
  return data?.properties?.verification_type || data?.verification_type || ''
}

async function findAuthUserByEmail(admin: ReturnType<typeof createAdminClient>, email: string) {
  try {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (error) return null
    return data?.users?.find((item) => normalizedEmail(item.email) === email) || null
  } catch {
    return null
  }
}

async function sendWithResend({
  email, code, purpose, apiKey, from, idempotencyKey,
}: {
  email: string; code: string; purpose: string; apiKey: string; from: string; idempotencyKey: string
}) {
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
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.error('Resend delivery failed', response.status, detail)
    throw new Error('Email delivery failed. Check the Resend API key and verified sender domain.')
  }
}

function fallbackOtpType(purpose: string) {
  if (purpose === 'recovery') return 'recovery'
  if (purpose === 'email') return 'email'
  return 'signup'
}

function linkAttempts({ email, purpose, password }: { email: string; purpose: string; password?: string }) {
  if (purpose === 'recovery') return [{ type: 'recovery' as const, email }]
  if (purpose === 'email') return [{ type: 'magiclink' as const, email }]
  const attempts: Array<{ type: 'signup' | 'magiclink'; email: string; password?: string }> = []
  if (password) attempts.push({ type: 'signup', email, password })
  attempts.push({ type: 'magiclink', email })
  return attempts
}

async function issueNativeOtp(admin: ReturnType<typeof createAdminClient>, {
  email, purpose, userId, apiKey, from, password,
}: {
  email: string; purpose: string; userId: string; apiKey: string; from: string; password?: string
}) {
  let issued: { data: { properties?: { hashed_token?: string; verification_type?: string }; hashed_token?: string; verification_type?: string } | null; code: string } | null = null
  let lastError: { message?: string } | null = null
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
  const tokenHint = issued.data?.properties?.hashed_token || `${Date.now()}`
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const sender = Deno.env.get('RESEND_FROM')
  if (!supabaseUrl || !serviceRoleKey || !resendApiKey || !sender) {
    return json(503, { error: 'Email verification is not configured on the server.' })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'Invalid request body.' })
  }

  const action = String(body.action || '')
  const purpose = String(body.purpose || (action === 'signup' ? 'signup' : ''))
  const email = normalizedEmail(body.email)
  if (!PURPOSES.has(purpose) || !email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(400, { error: 'Enter a valid email address.' })
  }

  const admin = createAdminClient(supabaseUrl, serviceRoleKey)

  if (action === 'verify') {
    return json(400, { error: 'Enter the code from your email in the app. Verification links are not used.' })
  }

  if (!['signup', 'recovery', 'email', 'resend'].includes(action)) {
    return json(400, { error: 'Invalid email code action.' })
  }
  if (action !== 'resend' && action !== purpose) {
    return json(400, { error: 'Invalid email code action.' })
  }

  let allowed: boolean
  try {
    allowed = await checkSendLimit(admin, purpose, email)
  } catch (error) {
    return json(503, { error: (error as Error).message })
  }
  if (!allowed) return json(429, { error: 'Please wait a minute before requesting another code.' })

  let user: { id: string; email_confirmed_at?: string | null } | null = null
  let password = ''
  if (action === 'signup') {
    password = String(body.password || '')
    const firstName = String(body.firstName || '').trim()
    const lastName = String(body.lastName || '').trim()
    const memberId = String(body.memberId || '')
    if (password.length < 8 || firstName.length > 128 || lastName.length > 128 || !/^10\d{8}$/.test(memberId)) {
      return json(400, { error: 'Provide a valid name, an 8-character password, and a valid member ID.' })
    }
    let passwordPwned: boolean
    try {
      passwordPwned = await isPasswordPwned(password)
    } catch {
      return json(503, { error: 'Could not check this password against known data breaches. Please try again.' })
    }
    if (passwordPwned) {
      return json(400, { error: 'This password has appeared in known data breaches. Choose a different password.' })
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
        return json(400, { error: error.message })
      }
      user = existing
    } else {
      user = data.user
    }
  } else {
    user = await findAuthUserByEmail(admin, email)
    if (!user) return json(200, { ok: true })
  }
  if (!user?.id) return json(502, { error: 'Could not prepare email verification. Please try again.' })

  try {
    const otpType = await issueNativeOtp(admin, {
      email,
      purpose,
      userId: user.id,
      apiKey: resendApiKey,
      from: sender,
      password: action === 'signup' ? password : '',
    })
    return json(200, { ok: true, otpType })
  } catch (error) {
    return json(502, {
      error: (error as Error).message,
      verificationPending: purpose === 'signup',
    })
  }
})
