import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { createClient } from 'npm:@supabase/supabase-js@2'

const CODE_TTL_SECONDS = 600
const RATE_LIMIT_WINDOW_SECONDS = 60
const RATE_LIMIT_PER_WINDOW = 3

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

const normalizedEmail = (value: unknown) => String(value || '').trim().toLowerCase()

async function hmacKey(secret: string, usage: 'sign' | 'verify') {
  const keyData = new TextEncoder().encode(secret)
  const hash = await crypto.subtle.digest('SHA-256', keyData)
  return crypto.subtle.importKey('raw', hash, { name: 'HMAC', hash: 'SHA-256' }, false, [usage])
}

function b64urlEncode(bytes: Uint8Array) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(value: string) {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

interface CodePayload {
  email: string
  purpose: 'signup' | 'recovery'
  code: string
  userId: string
  attempts: number
  expiresAt: number
}

async function sealPayload(payload: CodePayload, secret: string): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(payload))
  const key = await hmacKey(secret, 'sign')
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, data))
  const packed = new Uint8Array(data.length + sig.length)
  packed.set(data)
  packed.set(sig, data.length)
  return b64urlEncode(packed)
}

async function openPayload(token: string, secret: string): Promise<CodePayload | null> {
  try {
    const packed = b64urlDecode(String(token || ''))
    if (packed.length < 33) return null
    const data = packed.subarray(0, packed.length - 32)
    const sig = packed.subarray(packed.length - 32)
    const key = await hmacKey(secret, 'verify')
    const valid = await crypto.subtle.verify('HMAC', key, sig, data)
    if (!valid) return null
    return JSON.parse(new TextDecoder().decode(data))
  } catch {
    return null
  }
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

function generateVerificationCode(previousCode?: string) {
  const candidate = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0')
  if (!previousCode || candidate !== previousCode) return candidate
  return String((Number.parseInt(candidate, 10) + 1) % 1_000_000).padStart(6, '0')
}

function codeMatches(provided: unknown, expected: string) {
  const a = String(provided || '')
  return a.length === 6 && expected.length === 6 && a === expected
}

async function sendWithResend({ email, code, purpose, apiKey, from, lovableKey }: {
  email: string; code: string; purpose: string; apiKey: string; from: string; lovableKey: string
}) {
  const subject = purpose === 'signup' ? 'Verify your Nexus Chat email' : 'Reset your Nexus Chat password'
  const action = purpose === 'signup' ? 'verify your email address' : 'reset your password'
  const response = await fetch('https://connector-gateway.lovable.dev/resend/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${lovableKey}`,
      'X-Connection-Api-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject,
      text: `Your Nexus Chat verification code is ${code}. Enter this code to ${action}. It expires in 10 minutes. If you did not request this, ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;color:#172033"><h1 style="font-size:22px">Nexus Chat</h1><p>Use this code to ${action}:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p><p>This code expires in 10 minutes. If you did not request this, you can ignore this email.</p></div>`,
    }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.error('Resend delivery failed', response.status, detail)
    throw new Error('Email delivery failed. Check the Resend API key and verified sender domain.')
  }
}

function createAdminClient(url: string, serviceRoleKey: string) {
  return createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
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

async function resolvePendingUser(admin: ReturnType<typeof createAdminClient>, email: string, purpose: string, fallbackUserId?: string) {
  if (purpose === 'signup') {
    try {
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      if (error) return fallbackUserId ? { id: fallbackUserId } : null
      const user = data?.users?.find((item) => normalizedEmail(item.email) === email)
      if (!user) return fallbackUserId ? { id: fallbackUserId } : null
      return user
    } catch {
      return fallbackUserId ? { id: fallbackUserId } : null
    }
  }
  const { data, error } = await admin.from('members').select('auth_user_id').eq('email', email).maybeSingle()
  if (error || !data?.auth_user_id) return fallbackUserId ? { id: fallbackUserId } : null
  return { id: data.auth_user_id }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  const sender = Deno.env.get('RESEND_FROM') || 'Nexus Chat <onboarding@resend.dev>'
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
  if (!['signup', 'recovery'].includes(purpose) || !email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(400, { error: 'Enter a valid email address.' })
  }

  const admin = createAdminClient(supabaseUrl, serviceRoleKey)

  if (action === 'resend') {
    const saved = await openPayload(String(body.state || ''), serviceRoleKey)
    const hasSavedCode = saved && saved.email === email && saved.purpose === purpose
    const needsRefresh = !hasSavedCode || saved.expiresAt < Date.now()

    const user = needsRefresh
      ? await resolvePendingUser(admin, email, purpose, saved?.userId)
      : { id: saved!.userId }

    if (!user) return json(200, { ok: true })

    let allowed: boolean
    try {
      allowed = await checkSendLimit(admin, purpose, email)
    } catch (error) {
      return json(503, { error: (error as Error).message })
    }
    if (!allowed) return json(429, { error: 'Please wait a minute before requesting another code.' })

    const code = generateVerificationCode(saved?.code)
    const payload: CodePayload = {
      email,
      purpose: purpose as CodePayload['purpose'],
      code,
      userId: user.id,
      attempts: 0,
      expiresAt: Date.now() + CODE_TTL_SECONDS * 1000,
    }

    try {
      await sendWithResend({ email, code, purpose, apiKey: resendApiKey, from: sender })
      const state = await sealPayload(payload, serviceRoleKey)
      return json(200, { ok: true, state })
    } catch (error) {
      return json(502, { error: (error as Error).message })
    }
  }

  if (action === 'verify') {
    const saved = await openPayload(String(body.state || ''), serviceRoleKey)
    if (!saved || saved.email !== email || saved.purpose !== purpose) {
      return json(400, { error: 'This code expired. Request a new one.' })
    }
    if (saved.expiresAt < Date.now()) {
      return json(400, { error: 'This code expired. Request a new one.' })
    }
    if (saved.attempts >= 5) {
      return json(429, { error: 'Too many incorrect attempts. Request a new code.' })
    }
    if (!codeMatches(body.code, saved.code)) {
      saved.attempts += 1
      const state = await sealPayload(saved, serviceRoleKey)
      return json(400, { error: 'That code is not valid. Check it and try again.', state })
    }

    if (purpose === 'signup') {
      const { error: confirmError } = await admin.auth.admin.updateUserById(saved.userId, { email_confirm: true })
      if (confirmError) return json(502, { error: 'Could not confirm the account. Please try the code again.' })
    }

    const verificationType = purpose === 'signup' ? 'magiclink' : 'recovery'
    const { data, error } = await admin.auth.admin.generateLink({ type: verificationType, email })
    if (error || !data?.properties?.hashed_token) {
      return json(502, { error: 'Could not complete verification. Please try again.' })
    }

    return json(200, { ok: true, tokenHash: data.properties.hashed_token, verificationType })
  }

  if ((action !== 'signup' && action !== 'recovery') || action !== purpose) {
    return json(400, { error: 'Invalid email code action.' })
  }

  let allowed: boolean
  try {
    allowed = await checkSendLimit(admin, purpose, email)
  } catch (error) {
    return json(503, { error: (error as Error).message })
  }
  if (!allowed) return json(429, { error: 'Please wait a minute before requesting another code.' })

  let generated: { user: { id: string } }
  if (purpose === 'signup') {
    const password = String(body.password || '')
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
    if (error) return json(400, { error: error.message })
    generated = { user: data.user }
  } else {
    const { data, error } = await admin
      .from('members')
      .select('auth_user_id')
      .eq('email', email)
      .maybeSingle()
    if (error) return json(502, { error: 'Unable to send a recovery code right now.' })
    if (!data?.auth_user_id) return json(200, { ok: true })
    generated = { user: { id: data.auth_user_id } }
  }

  const code = generateVerificationCode()
  const state = await sealPayload({
    email,
    purpose: purpose as CodePayload['purpose'],
    code,
    userId: generated.user.id,
    attempts: 0,
    expiresAt: Date.now() + CODE_TTL_SECONDS * 1000,
  }, serviceRoleKey)

  try {
    await sendWithResend({ email, code, purpose, apiKey: resendApiKey, from: sender })
    return json(200, { ok: true, state })
  } catch (error) {
    return json(502, {
      error: (error as Error).message,
      verificationPending: purpose === 'signup',
    })
  }
})
