import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { otpEmail, resolveResendFrom } from '../_shared/otp-email.js'

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

// Accounts are resolved through the members mirror (unique, indexed email) instead of
// paging auth.users, which only ever inspected the first 1000 accounts.
async function findAuthUserByEmail(admin: ReturnType<typeof createAdminClient>, email: string) {
  try {
    const { data, error } = await admin
      .from('members')
      .select('id, email_verified')
      .eq('email', email)
      .maybeSingle()
    if (error || !data) return null
    return { id: data.id as string, emailVerified: Boolean(data.email_verified) }
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
    throw new Error('Email delivery failed. Check the Resend API key and verified sender domain nexus-chat-world.com.')
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
  const sender = resolveResendFrom(Deno.env.get('RESEND_FROM'))
  if (!supabaseUrl || !serviceRoleKey || !resendApiKey) {
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

  let user: { id: string; emailVerified?: boolean } | null = null
  let password = ''
  if (action === 'signup') {
    password = String(body.password || '')
    const firstName = String(body.firstName || '').trim()
    const lastName = String(body.lastName || '').trim()
    const memberId = String(body.memberId || '')
    if (firstName.length > 128 || lastName.length > 128 || !/^10\d{8}$/.test(memberId)) {
      return json(400, { error: 'Provide a valid name and member ID.' })
    }
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
      user_metadata: { first_name: firstName, last_name: lastName, member_id: memberId },
    })
    if (error) {
      const existing = await findAuthUserByEmail(admin, email)
      if (!existing) return json(400, { error: error.message })
      if (existing.emailVerified) {
        // A confirmed account must never be re-registered with a new password.
        // The code lets the client point at the sign-in flow instead.
        return json(400, {
          error: 'An account with this email address already exists.',
          code: 'email_already_registered',
        })
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
