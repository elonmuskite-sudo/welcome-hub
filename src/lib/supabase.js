import { createClient } from '@supabase/supabase-js'
import { appwriteAccount, appwriteData, createAppwriteRecovery, isAppwriteAuthEnabled, signOutFromAppwrite } from './appwrite.js'

const env = import.meta.env || {}
const supabaseUrl = env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || ''
const appwriteSelected = env.VITE_AUTH_PROVIDER === 'appwrite'

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: !appwriteSelected,
        autoRefreshToken: !appwriteSelected,
        detectSessionInUrl: false,
      },
    })
  : null

export function isSupabaseConfigured() {
  return isAppwriteAuthEnabled() || Boolean(supabase && supabaseUrl && supabaseAnonKey)
}

const normalizeEmail = (email) => String(email || '').trim().toLowerCase()
export const RECOVERY_SESSION_KEY = 'nexus-recovery-user'
const OTP_TYPE_KEY = 'nexus-email-otp-type'
const OTP_TYPES = new Set(['signup', 'invite', 'magiclink', 'recovery', 'email', 'email_change'])

function normalizePurpose(value) {
  return ['signup', 'recovery', 'email'].includes(value) ? value : 'signup'
}

function defaultOtpType(purpose) {
  if (purpose === 'recovery') return 'recovery'
  if (purpose === 'email') return 'email'
  return 'signup'
}

function readOtpType(email, purpose) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(OTP_TYPE_KEY) || 'null')
    if (
      saved
      && saved.email === normalizeEmail(email)
      && saved.purpose === purpose
      && OTP_TYPES.has(saved.otpType)
    ) {
      return saved.otpType
    }
  } catch {
    // Session storage is optional; verification still works with the purpose default.
  }
  return defaultOtpType(purpose)
}

function writeOtpType(email, purpose, otpType) {
  try {
    sessionStorage.setItem(OTP_TYPE_KEY, JSON.stringify({
      email: normalizeEmail(email),
      purpose,
      otpType: OTP_TYPES.has(otpType) ? otpType : defaultOtpType(purpose),
    }))
  } catch {
    // Session storage is optional; verification still works while the page stays open.
  }
}

function throwEmailCodeError(body, fallback) {
  const error = new Error(body?.error || fallback)
  if (body?.verificationPending) error.verificationPending = true
  if (body?.code) error.code = body.code
  throw error
}

async function invokeEmailCodeViaApi(payload) {
  const response = await fetch('/api/auth/email-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(payload),
  })
  let body = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  return { status: response.status, ok: response.ok, body }
}

async function invokeEmailCode(payload) {
  let apiResult = null
  try {
    apiResult = await invokeEmailCodeViaApi(payload)
  } catch {
    apiResult = null
  }

  if (apiResult?.ok && !apiResult.body?.error) {
    return apiResult.body || { ok: true }
  }

  const apiStatus = apiResult?.status
  if (apiResult && [400, 429].includes(apiStatus)) {
    throwEmailCodeError(apiResult.body, 'Could not send a verification code.')
  }

  const shouldFallback = !apiResult || [401, 403, 404, 405, 501, 502, 503].includes(apiStatus)
  if (!shouldFallback) {
    throwEmailCodeError(apiResult?.body, 'Could not send a verification code.')
  }

  if (!supabase) throwEmailCodeError(apiResult?.body, 'Email verification is not configured.')

  const { data, error } = await supabase.functions.invoke('email-code', { body: payload })
  if (error) {
    let details = error.message
    let verificationPending = false
    let code = ''
    try {
      if (error.context instanceof Response) {
        const body = await error.context.json()
        if (body?.error) details = body.error
        verificationPending = Boolean(body?.verificationPending)
        if (body?.code) code = body.code
      }
    } catch {
      // Keep the original error message when the response is not JSON.
    }
    throwEmailCodeError({ error: details, verificationPending, code }, details)
  }
  if (data?.error) throwEmailCodeError(data, data.error)
  return data
}

function rememberIssuedOtp(email, purpose, data) {
  writeOtpType(email, purpose, data?.otpType)
  return data
}

export async function startSignupEmailCode({ email, password, firstName, lastName, memberId }) {
  if (!supabase) throw new Error('Account registration is not configured.')
  const normalized = normalizeEmail(email)
  const data = await invokeEmailCode({
    action: 'signup',
    purpose: 'signup',
    email: normalized,
    password,
    firstName,
    lastName,
    memberId,
  })
  return rememberIssuedOtp(normalized, 'signup', data)
}

export async function startSignInEmailCode(email) {
  if (!supabase) throw new Error('Email sign-in is not configured.')
  const normalized = normalizeEmail(email)
  const data = await invokeEmailCode({
    action: 'email',
    purpose: 'email',
    email: normalized,
  })
  return rememberIssuedOtp(normalized, 'email', data)
}

export async function verifyEmailCode(email, token, type = 'signup') {
  if (!supabase) throw new Error('Email verification is not configured.')
  const purpose = normalizePurpose(type)
  const otpTypes = [...new Set([
    readOtpType(email, purpose),
    defaultOtpType(purpose),
    purpose === 'signup' ? 'magiclink' : '',
    purpose === 'email' ? 'magiclink' : '',
  ].filter(Boolean))]

  let authData = null
  let lastError = null
  for (const otpType of otpTypes) {
    const { data, error } = await supabase.auth.verifyOtp({
      email: normalizeEmail(email),
      token: String(token || '').trim(),
      type: otpType,
    })
    if (!error && data?.session && data?.user) {
      authData = data
      break
    }
    lastError = error
    if (/expired|otp_expired/i.test(error?.message || '')) break
  }
  if (!authData) {
    const message = lastError?.message || ''
    if (/expired|otp_expired/i.test(message)) throw new Error('This code expired. Request a new one.')
    throw lastError || new Error('Verification did not establish an account session. Request a fresh code.')
  }
  if (purpose === 'recovery') sessionStorage.setItem(RECOVERY_SESSION_KEY, authData.user.id)
  try {
    sessionStorage.removeItem(OTP_TYPE_KEY)
  } catch {
    // Session storage is optional.
  }
  return authData
}

export async function resendEmailCode(email, purpose = 'signup') {
  if (!supabase) throw new Error('Email verification is not configured.')
  const normalizedPurpose = normalizePurpose(purpose)
  const normalized = normalizeEmail(email)
  const data = await invokeEmailCode({
    action: 'resend',
    purpose: normalizedPurpose,
    email: normalized,
  })
  return rememberIssuedOtp(normalized, normalizedPurpose, data)
}

export async function sendWelcomeEmail() {
  if (!supabase || isAppwriteAuthEnabled()) return
  const { error } = await supabase.functions.invoke('welcome-email', { body: {} })
  if (error) {
    const details = error.context instanceof Response ? await error.context.text() : error.message
    console.error('Welcome email delivery:', details)
  }
}

export async function signInWithEmail(email, password) {
  if (isAppwriteAuthEnabled()) {
    await appwriteAccount.createEmailPasswordSession(String(email || '').trim().toLowerCase(), password)
    const account = await appwriteAccount.get()
    if (!account.emailVerification) throw new Error('Verify your email before signing in.')
    const { profile } = await appwriteData('profile.get')
    return {
      user: { ...profile, email: account.email, email_confirmed_at: account.emailVerification ? new Date().toISOString() : null },
    }
  }
  if (!supabase) throw new Error('Supabase Auth is not configured.')
  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(email || '').trim().toLowerCase(),
    password,
  })
  if (error) throw error
  return data
}

export async function signOutFromSupabase() {
  if (isAppwriteAuthEnabled()) {
    await signOutFromAppwrite()
    return
  }
  if (!supabase) return
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function startPasswordRecoveryCode(email) {
  if (isAppwriteAuthEnabled()) {
    const result = await createAppwriteRecovery(String(email || '').trim().toLowerCase())
    try {
      sessionStorage.setItem('nexus-appwrite-recovery-user-id', result.userId)
    } catch {
      throw new Error('Recovery could not be prepared in this browser. Enable session storage and try again.')
    }
    return result
  }
  if (!supabase) throw new Error('Password recovery is not configured.')
  const normalized = normalizeEmail(email)
  const data = await invokeEmailCode({ action: 'recovery', purpose: 'recovery', email: normalized })
  rememberIssuedOtp(normalized, 'recovery', data)
  return { ok: true }
}

export async function updateAuthenticatedPassword(password) {
  if (isAppwriteAuthEnabled()) {
    if (!appwriteAccount) throw new Error('Appwrite Auth is not configured.')
    const { code } = await appwriteAccount.updatePassword(password)
    if (code) throw new Error('Password update was not confirmed.')
    return { user: await appwriteAccount.get() }
  }
  if (!supabase) throw new Error('Supabase Auth is not configured.')
  const { data, error } = await supabase.auth.updateUser({ password })
  if (error) throw error
  return data
}

export async function getMemberProfile(userId) {
  if (isAppwriteAuthEnabled()) {
    const { profile } = await appwriteData('profile.get')
    return profile
  }
  if (!supabase) throw new Error('Supabase Auth is not configured.')
  const { data, error } = await supabase
    .from('members')
    .select('id, member_id, first_name, last_name, full_name, avatar_url, bio, interests, created_at')
    .eq('id', userId)
    .single()
  if (error) throw error
  const { data: isAdmin } = await supabase.rpc('has_role', { _user_id: userId, _role: 'admin' })
  return { ...data, role: isAdmin ? 'admin' : 'user' }
}

export async function findMemberByNexusId(nexusId) {
  if (isAppwriteAuthEnabled()) {
    const normalizedId = String(nexusId || '').replace(/\D/g, '')
    if (!/^10\d{8}$/.test(normalizedId)) return null
    const { member } = await appwriteData('directory.lookup', { memberId: normalizedId })
    if (!member) return null
    return {
      id: member.id,
      nexusId: member.member_id,
      nexusIdDisplay: formatMemberId(member.member_id),
      firstName: member.first_name,
      lastName: member.last_name,
      fullName: member.full_name,
      avatarUrl: member.avatar_url || null,
    }
  }
  if (!supabase) throw new Error('Supabase Auth is not configured.')
  const normalizedId = String(nexusId || '').replace(/\D/g, '')
  if (!/^10\d{8}$/.test(normalizedId)) return null

  const { data, error } = await supabase.rpc('lookup_member_by_nexus_id', {
    p_member_id: normalizedId,
  })
  if (error) {
    if (error.code === 'PGRST202' || String(error.message || '').includes('lookup_member_by_nexus_id')) {
      throw new Error('Recipient lookup migration is not installed. An administrator must run the reviewed Supabase migrations first.')
    }
    throw error
  }
  const member = Array.isArray(data) ? data[0] : data
  if (!member) return null
  return {
    id: member.id,
    nexusId: member.member_id,
    nexusIdDisplay: formatMemberId(member.member_id),
    firstName: member.first_name,
    lastName: member.last_name,
    fullName: member.full_name,
    avatarUrl: member.avatar_url || null,
  }
}

function formatMemberId(value) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length === 10 ? `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}` : digits
}

export async function updateMemberProfile(userId, updates) {
  if (isAppwriteAuthEnabled()) {
    const { profile } = await appwriteData('profile.update', { updates })
    return profile
  }
  if (!supabase) throw new Error('Supabase Auth is not configured.')
  const profileUpdates = {}
  if (updates.firstName !== undefined) profileUpdates.first_name = updates.firstName
  if (updates.lastName !== undefined) profileUpdates.last_name = updates.lastName
  if (updates.fullName !== undefined) profileUpdates.full_name = updates.fullName
  if (updates.avatarUrl !== undefined) profileUpdates.avatar_url = updates.avatarUrl
  if (updates.bio !== undefined) profileUpdates.bio = updates.bio
  if (updates.interests !== undefined) profileUpdates.interests = updates.interests

  const { data, error } = await supabase
    .from('members')
    .update(profileUpdates)
    .eq('id', userId)
    .select('id, member_id, first_name, last_name, full_name, avatar_url, bio, interests, created_at')
    .single()
  if (error) throw error
  const { data: isAdmin } = await supabase.rpc('has_role', { _user_id: userId, _role: 'admin' })
  return { ...data, role: isAdmin ? 'admin' : 'user' }
}

export function getSupabaseConfig() {
  return {
    url: supabaseUrl,
    anonKey: supabaseAnonKey,
    configured: isSupabaseConfigured(),
  }
}
