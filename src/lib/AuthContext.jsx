import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react'
export function isAdminRole(role) {
  return role === 'admin' || role === 'supabase_admin'
}
import {
  getMemberProfile,
  sendWelcomeEmail,
  RECOVERY_SESSION_KEY,
  isSupabaseConfigured,
  resendEmailCode,
  startPasswordRecoveryCode,
  startSignupEmailCode,
  signInWithEmail,
  signOutFromSupabase,
  supabase,
  updateAuthenticatedPassword,
  updateMemberProfile,
  verifyEmailCode as verifyEmailOtp,
} from './supabase'
import {
  completeAppwriteRecovery,
  createAppwriteAccount,
  getAppwriteProfile,
  isAppwriteAuthEnabled,
  rememberAppwriteRecoveryCode,
  resendAppwriteVerification,
} from './appwrite'

const noopAsync = async () => { throw new Error('Account services are still loading. Please try again.') }
const DEFAULT_AUTH = {
  user: null, loading: true, login: noopAsync, logout: async () => {}, register: noopAsync,
  verifyEmailCode: noopAsync, resendVerificationCode: noopAsync, updateProfile: async () => {},
  requestPasswordReset: noopAsync, resetPassword: noopAsync,
}
// Reuse one context across hot reloads so the provider and consumers never split
const AuthContext = globalThis.__nexusAuthContext || (globalThis.__nexusAuthContext = createContext(DEFAULT_AUTH))

function normalizeUser(user) {
  const rawRole = user.role || user.user_role || user.profile_role || 'user'
  return {
    id: user.id || user.$id,
    nexusId: user.nexus_id || user.nexusId || user.member_id || user.memberId,
    nexusIdDisplay: user.nexusIdDisplay || user.memberIdDisplay || formatNexusIdForDisplay(user.nexus_id || user.nexusId || user.member_id || user.memberId),
    firstName: user.first_name || user.firstName,
    lastName: user.last_name || user.lastName,
    fullName: user.full_name || user.fullName || `${user.first_name || user.firstName || ''} ${user.last_name || user.lastName || ''}`.trim(),
    email: user.email,
    emailVerified: user.email_verified || user.emailVerified || false,
    role: isAdminRole(rawRole) ? 'admin' : rawRole,
    avatarUrl: user.avatar_url || user.avatarUrl || null,
    bio: user.bio ?? user.bioText ?? '',
    interests: user.interests || [],
    createdAt: user.created_at || user.createdAt || user.$createdAt
  }
}

function formatNexusIdForDisplay(raw) {
  const s = String(raw || '').replace(/\D/g, '')
  if (s.length >= 2) {
    let formatted = s.slice(0, 2)
    if (s.length >= 6) {
      formatted += '-' + s.slice(2, 6)
      if (s.length >= 10) {
        formatted += '-' + s.slice(6, 10)
      }
    }
    return formatted
  }
  return s
}

function generateNexusId() {
  return `10${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`
}

// Context provider children are supplied by React composition, not an external prop API.
// eslint-disable-next-line react/prop-types
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('nexus-chat-users')
      window.localStorage.removeItem('nexus-chat-session')
    }
    if (isAppwriteAuthEnabled()) {
      let active = true
      getAppwriteProfile()
        .then((profile) => { if (active) setUser(normalizeUser(profile)) })
        .catch((error) => {
          if (error?.code !== 401) console.error('Appwrite profile lookup failed', error)
          if (active) setUser(null)
        })
        .finally(() => { if (active) setLoading(false) })
      return () => { active = false }
    }

    if (!isSupabaseConfigured() || !supabase) {
      setLoading(false)
      return undefined
    }

    let active = true
    const syncSession = async (session) => {
      if (!active) return
      if (!session?.user) {
        setUser(null)
        setLoading(false)
        return
      }
      try {
        const { data, error: validationError } = await supabase.auth.getUser()
        if (validationError || !data.user) throw validationError || new Error('Session expired.')
        const profile = await getMemberProfile(data.user.id)
        void sendWelcomeEmail()
        if (!active) return
        setUser(normalizeUser({
          ...profile,
          email: session.user.email,
          email_verified: Boolean(session.user.email_confirmed_at),
        }))
      } catch (error) {
        console.error('Authenticated profile lookup failed', error)
        if (active) setUser(null)
      } finally {
        if (active) setLoading(false)
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' && session?.user) sessionStorage.setItem(RECOVERY_SESSION_KEY, session.user.id)
      setTimeout(() => { void syncSession(session) }, 0)
    })
    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (error) throw error
        return syncSession(data.session)
      })
      .catch((error) => {
        console.error('Supabase session lookup failed', error)
        if (active) {
          setUser(null)
          setLoading(false)
        }
      })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const login = useCallback(async (email, password) => {
    if (!isSupabaseConfigured()) throw new Error('Account sign-in is not configured.')
    const { user: authUser } = await signInWithEmail(email, password)
    const profile = await getMemberProfile(authUser.id)
    void sendWelcomeEmail()
    const sessionUser = normalizeUser({
      ...profile,
      email: authUser.email,
      email_verified: Boolean(authUser.email_confirmed_at),
    })
    setUser(sessionUser)
    return { user: sessionUser, nexusId: sessionUser.nexusId }
  }, [])

  const verifyEmailCode = useCallback(async (email, token, purpose = 'signup', password = '') => {
    if (!isSupabaseConfigured()) throw new Error('Email verification is not configured.')
    if (isAppwriteAuthEnabled()) {
      if (purpose !== 'recovery') throw new Error('Use the verification link sent to your email to verify this account.')
      rememberAppwriteRecoveryCode(token)
      return { ok: true }
    }
    const authData = await verifyEmailOtp(email, token, purpose, password)
    const authUser = authData?.user || authData?.session?.user
    if (!authUser && purpose !== 'recovery') {
      throw new Error('Supabase did not return a verified account.')
    }
    if (!authUser && purpose === 'recovery') {
      return { ok: true }
    }
    if (purpose === 'recovery') return { ok: true }
    const profile = await getMemberProfile(authUser.id)
    void sendWelcomeEmail()
    const sessionUser = normalizeUser({
      ...profile,
      email: authUser.email,
      email_verified: Boolean(authUser.email_confirmed_at),
    })
    setUser(sessionUser)
    return sessionUser
  }, [])

  const resendVerificationCode = useCallback(async (email, purpose = 'signup') => {
    if (!isSupabaseConfigured()) throw new Error('Email verification is not configured.')
    if (isAppwriteAuthEnabled()) {
      if (purpose === 'recovery') {
        await startPasswordRecoveryCode(email)
      } else {
        await resendAppwriteVerification()
      }
      return
    }
    await resendEmailCode(email, purpose)
  }, [])

  const logout = useCallback(async () => {
    await signOutFromSupabase()
    setUser(null)
  }, [])

  const register = useCallback(async ({ email, firstName, lastName, password }) => {
    if (!isSupabaseConfigured()) throw new Error('Account registration is not configured.')
    const normalizedEmail = String(email || '').trim().toLowerCase()
    const normalizedFirstName = String(firstName || '').trim()
    const normalizedLastName = String(lastName || '').trim()
    const cleanPassword = String(password || '')
    if (!normalizedEmail) throw new Error('Email is required.')
    if (cleanPassword.length < 8) throw new Error('Password must be at least 8 characters.')
    if (isAppwriteAuthEnabled()) {
      await createAppwriteAccount({
        email: normalizedEmail,
        password: cleanPassword,
        firstName: normalizedFirstName,
        lastName: normalizedLastName,
      })
      return { user: null, email: normalizedEmail, needsEmailConfirmation: true, verificationMethod: 'link' }
    }
    const nexusId = generateNexusId()
    await startSignupEmailCode({
      email: normalizedEmail,
      password: cleanPassword,
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
      memberId: nexusId,
    })
    return { user: null, nexusId, email: normalizedEmail, needsEmailConfirmation: true }
  }, [])

  const updateProfile = useCallback(async (updates) => {
    if (!user) return
    const profile = await updateMemberProfile(user.id, updates)
    setUser(normalizeUser({ ...profile, email: user.email, email_verified: user.emailVerified }))
  }, [user])

  const requestPasswordReset = useCallback(async (email) => {
    if (!isSupabaseConfigured()) throw new Error('Password recovery is not configured.')
    await startPasswordRecoveryCode(email)
    return { ok: true }
  }, [])

  const resetPassword = useCallback(async (newPassword) => {
    if (String(newPassword || '').length < 8) {
      throw new Error('Password must be at least 8 characters.')
    }
    if (isAppwriteAuthEnabled()) {
      await completeAppwriteRecovery(newPassword)
    } else {
      await updateAuthenticatedPassword(newPassword)
    }
    await signOutFromSupabase()
    sessionStorage.removeItem(RECOVERY_SESSION_KEY)
    setUser(null)
    return { ok: true }
  }, [])

  const value = useMemo(() => ({
    user,
    loading,
    login,
    logout,
    register,
    verifyEmailCode,
    resendVerificationCode,
    updateProfile,
    requestPasswordReset,
    resetPassword,
  }), [user, loading, login, logout, register, verifyEmailCode, resendVerificationCode, updateProfile, requestPasswordReset, resetPassword])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext) || DEFAULT_AUTH
}

export { formatNexusIdForDisplay }
