import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ShieldCheckIcon } from '@heroicons/react/24/solid'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../lib/AuthContext'
import ChatButton from '../components/chat/ChatButton'
import AuthShell from '../components/AuthShell'
import { clearAdminSession, establishAdminSession } from '../lib/adminSession'
import { sendSecurityAlertEmail, supabase } from '../lib/supabase'
import { isAppwriteAuthEnabled } from '../lib/appwrite'
import { prepareAdminMfa, verifyAdminMfaCode } from '../lib/adminMfa'

const MAX_EMAIL_LENGTH = 254
const MIN_PASSWORD_LENGTH = 8
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Where to go after a successful admin sign-in. Only same-admin paths are
// honoured so the query parameter cannot be used as an open redirect.
function resolveNext(search, fallbackState) {
  const requested = new URLSearchParams(search).get('next') || fallbackState || ''
  if (requested.startsWith('/admin/') && !requested.startsWith('/admin/login')) return requested
  return '/admin/dashboard'
}

// Dedicated admin sign-in. Reachable without a session (it is the only /admin
// route middleware.js allows through); every other admin path is gated.
export default function AdminLogin() {
  const { login, user, loading, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [mfaCode, setMfaCode] = useState('')
  const [mfaStep, setMfaStep] = useState({ mode: 'credentials' })
  const preparedUserId = useRef(null)

  const next = resolveNext(location.search, location.state?.from)
  const signedInNonAdmin = Boolean(user) && user.role !== 'admin'
  const adminUserId = user?.id
  const adminUserRole = user?.role
  const adminUserEmail = user?.email

  useEffect(() => {
    if (loading || !adminUserId || adminUserRole !== 'admin' || preparedUserId.current === adminUserId) return
    preparedUserId.current = adminUserId
    let active = true
    setMfaStep({ mode: 'loading' })
    setError('')
    void (async () => {
      if (isAppwriteAuthEnabled()) {
        throw new Error('Privileged admin sign-in is disabled with Appwrite authentication until its MFA workflow is configured.')
      }
      await clearAdminSession()
      const result = await prepareAdminMfa(supabase?.auth, adminUserEmail)
      if (!active) return
      if (result.mode === 'verified') {
        const established = await establishAdminSession()
        if (!established) throw new Error('The secure admin session could not be established. Check server configuration and try again.')
        void sendSecurityAlertEmail().catch((error) => console.error('Admin sign-in alert email failed', error))
        if (active) navigate(next, { replace: true })
        return
      }
      setMfaStep(result)
    })().catch((mfaError) => {
      if (!active) return
      setError(mfaError?.message || 'Administrator MFA could not be prepared.')
      setMfaStep({ mode: 'error' })
    })
    return () => { active = false }
  }, [loading, adminUserId, adminUserRole, adminUserEmail, next, navigate])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (busy) return

    const normalizedEmail = email.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(normalizedEmail) || normalizedEmail.length > MAX_EMAIL_LENGTH) {
      setError('Enter a valid email address.')
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Admin passwords are at least ${MIN_PASSWORD_LENGTH} characters long.`)
      return
    }

    setError('')
    setBusy(true)
    try {
      if (isAppwriteAuthEnabled()) {
        throw new Error('Privileged admin sign-in is disabled with Appwrite authentication until its MFA workflow is configured.')
      }
      await clearAdminSession()
      const result = await login(normalizedEmail, password)
      if (result?.user?.role !== 'admin') {
        setError('This account does not have admin access.')
        return
      }
    } catch (loginError) {
      setError(loginError?.message || 'Admin sign in failed.')
    } finally {
      setBusy(false)
    }
  }

  const handleMfaSubmit = async (event) => {
    event.preventDefault()
    if (busy || !user || user.role !== 'admin') return
    setError('')
    setBusy(true)
    try {
      await verifyAdminMfaCode(supabase?.auth, mfaStep.factorId, mfaCode)
      const established = await establishAdminSession()
      if (!established) throw new Error('The secure admin session could not be established. Check server configuration and try again.')
      void sendSecurityAlertEmail().catch((alertError) => console.error('Admin sign-in alert email failed', alertError))
      navigate(next, { replace: true })
    } catch (mfaError) {
      setError(mfaError?.message || 'Authenticator verification failed.')
    } finally {
      setBusy(false)
    }
  }

  const handleAdminSignOut = async () => {
    setBusy(true)
    try {
      await logout()
      preparedUserId.current = null
      setMfaStep({ mode: 'credentials' })
      setMfaCode('')
      setError('')
    } catch (logoutError) {
      setError(logoutError?.message || 'Could not sign out.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      title="Admin sign in"
      subtitle="This area is restricted to Nexus administrators. All access is verified against the server."
      compact
    >
      <div className="w-full">
        {signedInNonAdmin ? (
          <div className="space-y-4">
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              You are signed in as {user.email}, which does not have admin access.
            </p>
            <div className="flex flex-wrap gap-2">
              <ChatButton
                onClick={async () => { await logout(); setError('') }}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              >
                Sign in as an administrator
              </ChatButton>
              <ChatButton onClick={() => navigate('/app')} className="rounded-lg border border-border px-4 py-2 text-sm">
                Back to Nexus
              </ChatButton>
            </div>
          </div>
        ) : user?.role === 'admin' ? (
          <section className="space-y-5" aria-live="polite">
            {mfaStep.mode === 'loading' && <p className="text-sm text-muted-foreground">Preparing secure administrator verification…</p>}
            {mfaStep.mode === 'error' && (
              <p role="alert" className="text-sm text-destructive">{error || 'Administrator MFA could not be prepared.'}</p>
            )}
            {(mfaStep.mode === 'challenge' || mfaStep.mode === 'enroll') && (
              <>
                <div>
                  <h2 className="text-lg font-semibold text-foreground">
                    {mfaStep.mode === 'enroll' ? 'Set up an authenticator app' : 'Verify your authenticator'}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {mfaStep.mode === 'enroll'
                      ? 'Scan this QR code with an authenticator app, then enter its six-digit code.'
                      : 'Enter the current six-digit code from your authenticator app to continue.'}
                  </p>
                </div>
                {mfaStep.mode === 'enroll' && (
                  <div className="space-y-3 rounded-lg border border-border p-4">
                    <img
                      src={`data:image/svg+xml;utf-8,${encodeURIComponent(mfaStep.qrCode)}`}
                      alt="QR code for administrator authenticator setup"
                      className="mx-auto h-48 w-48 bg-white p-2"
                    />
                    <label htmlFor="admin-totp-secret" className="block text-sm font-medium text-muted-foreground">
                      If you cannot scan the QR code, enter this setup key manually:
                    </label>
                    <input
                      id="admin-totp-secret"
                      type="text"
                      value={mfaStep.secret}
                      readOnly
                      autoComplete="off"
                      className="w-full select-all rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm text-foreground"
                    />
                  </div>
                )}
                <form onSubmit={handleMfaSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="admin-mfa-code" className="mb-2 block text-sm font-medium text-muted-foreground">
                      Authenticator code
                    </label>
                    <input
                      id="admin-mfa-code"
                      type="text"
                      value={mfaCode}
                      onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                      className="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm tracking-[0.3em] text-foreground outline-none focus:border-primary focus:ring-primary"
                    />
                  </div>
                  {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                  <ChatButton
                    type="submit"
                    disabled={busy || mfaCode.length !== 6}
                    className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy ? 'Verifying…' : mfaStep.mode === 'enroll' ? 'Enable authenticator and continue' : 'Verify and continue'}
                  </ChatButton>
                </form>
              </>
            )}
            {mfaStep.mode === 'error' && (
              <ChatButton
                onClick={handleAdminSignOut}
                disabled={busy}
                className="rounded-lg border border-border px-4 py-2 text-sm"
              >
                Sign out and try again
              </ChatButton>
            )}
          </section>
        ) : (
          <>
            <p className="mb-5 flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldCheckIcon className="h-5 w-5 text-primary" /> Administrator credentials required.
            </p>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="admin-email" className="mb-2 block text-sm font-medium text-muted-foreground">Email address</label>
                <input
                  id="admin-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  maxLength={MAX_EMAIL_LENGTH}
                  required
                  className="w-full rounded-lg border border-input bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-primary"
                  placeholder="admin@nexus-chat-world.com"
                />
              </div>
              <div>
                <label htmlFor="admin-password" className="mb-2 block text-sm font-medium text-muted-foreground">Password</label>
                <div className="relative">
                  <input
                    id="admin-password"
                    type={passwordVisible ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    autoComplete="current-password"
                    className="w-full rounded-lg border border-input bg-background px-4 py-3 pr-12 text-sm text-foreground outline-none transition focus:border-primary focus:ring-primary"
                    placeholder="••••••••"
                  />
                  <ChatButton
                    type="button"
                    onClick={() => setPasswordVisible((visible) => !visible)}
                    aria-label={passwordVisible ? 'Hide password' : 'Show password'}
                    aria-pressed={passwordVisible}
                    className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted-foreground"
                  >
                    {passwordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </ChatButton>
                </div>
              </div>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <ChatButton
                type="submit"
                disabled={busy || loading}
                className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? 'Verifying…' : 'Sign in to admin'}
              </ChatButton>
            </form>
          </>
        )}
      </div>
    </AuthShell>
  )
}
