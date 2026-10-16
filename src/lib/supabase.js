import { createClient } from '@supabase/supabase-js'
import { isPasswordPwned } from './pwnedPasswords'
import { appwriteAccount, appwriteData, createAppwriteRecovery, isAppwriteAuthEnabled, signOutFromAppwrite } from './appwrite'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || ''
const appwriteSelected = import.meta.env.VITE_AUTH_PROVIDER === 'appwrite'

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: !appwriteSelected,
        autoRefreshToken: !appwriteSelected,
        detectSessionInUrl: !appwriteSelected,
      },
    })
  : null

export function isSupabaseConfigured() {
  return isAppwriteAuthEnabled() || Boolean(supabase && supabaseUrl && supabaseAnonKey)
}

const normalizeEmail = (email) => String(email || '').trim().toLowerCase()
export const RECOVERY_SESSION_KEY = 'nexus-recovery-user'
const EMAIL_CODE_STATE_KEY = 'nexus-email-code-state'

function readEmailCodeState(email, purpose) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(EMAIL_CODE_STATE_KEY) || 'null')
    if (saved && saved.email === normalizeEmail(email) && saved.purpose === purpose) return saved.state || ''
  } catch {
    // Session storage is optional; a missing state simply requires a fresh code.
  }
  return ''
}

function writeEmailCodeState(email, purpose, state) {
  if (!state) return
  try {
    sessionStorage.setItem(EMAIL_CODE_STATE_KEY, JSON.stringify({ email: normalizeEmail(email), purpose, state }))
  } catch {
    // Session storage is optional; verification still works while the page stays open.
  }
}

async function invokeEmailCode(payload) {
  if (!supabase) throw new Error('Email verification is not configured.')
  const { data, error } = await supabase.functions.invoke('email-code', { body: payload })
  if (error) {
    let details = error.message
    try {
      if (error.context instanceof Response) {
        const body = await error.context.json()
        if (body?.error) details = body.error
      }
    } catch {
      // Keep the original error message when the response is not JSON.
    }
    throw new Error(details)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export async function startSignupEmailCode({ email, password, firstName, lastName, memberId }) {
  if (!supabase) throw new Error('Account registration is not configured.')
  if (await isPasswordPwned(password)) throw new Error('This password has appeared in known data breaches. Choose another password.')
  const data = await invokeEmailCode({
    action: 'signup',
    purpose: 'signup',
    email: normalizeEmail(email),
    password,
    firstName,
    lastName,
    memberId,
  })
  writeEmailCodeState(email, 'signup', data?.state)
  return data
}

export async function verifyEmailCode(email, token, type = 'signup') {
  if (!supabase) throw new Error('Email verification is not configured.')
  const purpose = ['signup', 'recovery'].includes(type) ? type : 'signup'
  const data = await invokeEmailCode({
    action: 'verify',
    purpose,
    email: normalizeEmail(email),
    code: String(token || '').trim(),
    state: readEmailCodeState(email, purpose),
  })
  if (!data?.tokenHash || !data?.verificationType) {
    throw new Error('Verification did not complete. Request a fresh code.')
  }
  const { data: authData, error } = await supabase.auth.verifyOtp({
    token_hash: data.tokenHash,
    type: data.verificationType,
  })
  if (error) throw error
  if (!authData.session || !authData.user) throw new Error('Verification did not establish an account session. Request a fresh code.')
  if (purpose === 'recovery') sessionStorage.setItem(RECOVERY_SESSION_KEY, authData.user.id)
  return authData
}

export async function resendEmailCode(email, purpose = 'signup') {
  if (!supabase) throw new Error('Email verification is not configured.')
  const normalizedPurpose = purpose === 'recovery' ? 'recovery' : 'signup'
  const data = await invokeEmailCode({
    action: 'resend',
    purpose: normalizedPurpose,
    email: normalizeEmail(email),
    state: readEmailCodeState(email, normalizedPurpose),
  })
  writeEmailCodeState(email, normalizedPurpose, data?.state)
  return data
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
  const { error } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email), { redirectTo: `${window.location.origin}/reset-password` })
  if (error) throw error
  return { ok: true }
}

export async function updateAuthenticatedPassword(password) {
  if (await isPasswordPwned(password)) {
    throw new Error('This password has appeared in known data breaches. Choose a different password.')
  }
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
